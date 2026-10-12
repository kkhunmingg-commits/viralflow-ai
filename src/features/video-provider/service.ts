import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/server-env";
import { getVideoCreativeSource } from "@/features/video/services";
import { AtomicBudgetLedger } from "@/features/video/budget-ledger";
import { ownsVideoStoragePath, videoStoragePath } from "@/features/video/storage";
import { FAL_MODEL_ENDPOINTS } from "@/features/video/fal-models";
import { portraitProductReference, validateNarrationAudio } from "@/features/video/media-composition";
import { providerSettingsSchema, defaultProviderSettings, type ProviderSettings, type ProviderId, type RouterJob, type JobState } from "./contracts";
import { routeVideoJob } from "./router";
import { GoogleVidsOmniProvider } from "./google-vids";
import { RoutedFalProvider, type FalRequest } from "./fal";
import { finalizeProviderMaster, type ProviderCreativeSource } from "./finalize";

type Row = Record<string,unknown>;
interface Job {id:string;owner_id:string;tiktok_account_id:string;creative_project_id:string;selected_script_id:string;generation_job_id:string;created_at:string;
  state:JobState;provider:ProviderId|null;submission_state:RouterJob["submission"];provider_request_id:string|null;retries:number;next_retry_at:string|null;
  estimated_cost_usd:number;actual_cost_usd?:number|null;checkpoint:{request?:FalRequest;holdId?:string;sourcePath?:string;voicePath?:string;polls?:number;submittedAt?:string};decisions:Row[];lease_token:string|null;}
const columns="id,tiktok_account_id,creative_project_id,state,provider,message,retries,next_retry_at,estimated_cost_usd,actual_cost_usd,master_video_id,created_at,updated_at";
const check = (error:unknown) => {if(error)throw new Error("VIDEO_PROVIDER_STORAGE_UNAVAILABLE");};
export async function providerSettings(client:SupabaseClient,owner:string) {
  const result=await client.from("video_provider_settings").select("config").eq("owner_id",owner).maybeSingle();
  if(result.error && ["42P01","PGRST205"].includes(result.error.code))return{installed:false,settings:defaultProviderSettings()};
  check(result.error); return{installed:true,settings:providerSettingsSchema.parse(result.data?.config??{})};
}
export async function saveProviderSettings(admin:SupabaseClient,owner:string,config:unknown) {
  const parsed=providerSettingsSchema.parse(config);
  const result=await admin.from("video_provider_settings").upsert({owner_id:owner,config:parsed,updated_at:new Date().toISOString()},{onConflict:"owner_id"});check(result.error);
}
export async function listProviderJobs(client:SupabaseClient,owner:string) {
  const result=await client.from("video_provider_jobs").select(columns).eq("owner_id",owner).order("created_at",{ascending:false}).limit(30);check(result.error);return result.data??[];
}
async function readJob(admin:SupabaseClient,owner:string,id:string) {
  const result=await admin.from("video_provider_jobs").select("*").eq("owner_id",owner).eq("id",id).maybeSingle();check(result.error);
  if(!result.data)throw new Error("VIDEO_PROVIDER_JOB_NOT_FOUND");return result.data as Job;
}
export interface RouterRuntime {fal:RoutedFalProvider;enabled:boolean;source?:typeof getVideoCreativeSource;finalize?:typeof finalizeProviderMaster;restrictSettings?:(settings:ProviderSettings)=>ProviderSettings;accountDailyCapUsd?:number;authorizeSubmission?:()=>Promise<void>;}
function enabled(runtime?:RouterRuntime) {return runtime?.enabled??process.env.VIDEO_PROVIDER_ROUTER_ENABLED==="true";}
async function sourceFor(admin:SupabaseClient,owner:string,job:Job,runtime?:RouterRuntime) {
  const source=await(runtime?.source??getVideoCreativeSource)(admin,owner,job.creative_project_id);
  if(String(source.project.tiktok_account_id)!==job.tiktok_account_id || String(source.script.id)!==job.selected_script_id || source.account.is_mock)throw new Error("SELECTED_CREATIVE_CHANGED");
  return source;
}
export async function enqueueProviderVideo(admin:SupabaseClient,owner:string,projectId:string,runtime?:RouterRuntime) {
  if(!enabled(runtime))throw new Error("VIDEO_PROVIDER_ROUTER_DISABLED");
  const source=await(runtime?.source??getVideoCreativeSource)(admin,owner,projectId);
  if(source.account.is_mock)throw new Error("REAL_ACCOUNT_REQUIRED");
  const key=`provider-router:${projectId}:${source.script.id}`;
  const prior=await admin.from("master_videos").select("id").eq("owner_id",owner).eq("creative_project_id",projectId).maybeSingle();check(prior.error);
  if(prior.data)throw new Error("EXISTING_MASTER_REQUIRES_REVIEW");
  const generation=await admin.from("generation_jobs").upsert({owner_id:owner,creative_project_id:projectId,idempotency_key:key,job_type:"MASTER_RENDER",
    provider:"provider-router",model:"google_vids_omni/fal_ai",input_json:{projectId},status:"QUEUED",max_attempts:1},{onConflict:"owner_id,idempotency_key",ignoreDuplicates:true});check(generation.error);
  const generationJob=await admin.from("generation_jobs").select("id").eq("owner_id",owner).eq("idempotency_key",key).single();check(generationJob.error);
  const result=await admin.from("video_provider_jobs").upsert({owner_id:owner,tiktok_account_id:source.account.id,product_id:source.product.id,
    creative_project_id:projectId,selected_script_id:source.script.id,generation_job_id:generationJob.data!.id},{onConflict:"owner_id,creative_project_id,selected_script_id",ignoreDuplicates:true});check(result.error);
  const job=await admin.from("video_provider_jobs").select("id").eq("owner_id",owner).eq("creative_project_id",projectId).eq("selected_script_id",source.script.id).single();check(job.error);return job.data!;
}
async function claim(admin:SupabaseClient,owner:string,id:string) {
  const token=randomUUID(),result=await admin.rpc("claim_video_provider_job",{p_owner_id:owner,p_job_id:id,p_lease_token:token});check(result.error);
  return result.data?.id ? {job:result.data as Job,token} : null;
}
async function save(admin:SupabaseClient,owner:string,id:string,token:string,values:Row) {
  const result=await admin.from("video_provider_jobs").update({...values,updated_at:new Date().toISOString()}).eq("owner_id",owner).eq("id",id).eq("lease_token",token).select("id").maybeSingle();check(result.error);
  if(!result.data)throw new Error("VIDEO_PROVIDER_LEASE_LOST");
}
async function release(admin:SupabaseClient,owner:string,id:string,token:string) {
  const result=await admin.from("video_provider_jobs").update({lease_token:null,lease_expires_at:null}).eq("owner_id",owner).eq("id",id).eq("lease_token",token);check(result.error);
}
async function ownedFile(admin:SupabaseClient,owner:string,path:string,max:number) {
  if(!ownsVideoStoragePath(owner,path))throw new Error("VIDEO_PROVIDER_PATH_INVALID");
  const result=await admin.storage.from("video-assets").download(path);check(result.error);
  if(!result.data || result.data.size>max)throw new Error("VIDEO_PROVIDER_FILE_INVALID");return new Uint8Array(await result.data.arrayBuffer());
}
async function finish(admin:SupabaseClient,owner:string,job:Job,token:string,source:ProviderCreativeSource,runtime?:RouterRuntime) {
  const video=await ownedFile(admin,owner,job.checkpoint.sourcePath!,50_000_000);
  const voice=job.checkpoint.voicePath?await ownedFile(admin,owner,job.checkpoint.voicePath,2_000_000):null;
  const master=await(runtime?.finalize??finalizeProviderMaster)(admin,owner,{...job,provider:job.provider!},source,video,voice);
  await save(admin,owner,job.id,token,{state:master.quality_status==="PASS"?"COMPLETED":master.quality_status==="REJECT"?"FAILED":"REVIEW_REQUIRED",master_video_id:master.id,
    message:master.quality_status==="PASS"?"ไฟล์ผ่านเกณฑ์ภาพและเสียง ยังต้องผ่านประตูอนุมัติการเผยแพร่เดิม":"ไฟล์เข้าระบบแล้ว ต้องตรวจภาพ เสียง และเนื้อหา ยังไม่อนุมัติการเผยแพร่"});
}
async function settleBilledCost(admin:SupabaseClient,owner:string,job:Job,fal:RoutedFalProvider){
  if(job.actual_cost_usd!=null)return job.actual_cost_usd;
  if(!job.checkpoint.request||!job.checkpoint.holdId||!job.provider_request_id)return null;
  const actual=await fal.billedCost(job.checkpoint.request,job.provider_request_id,job.created_at);if(actual===null)return null;
  if(actual>job.checkpoint.request.estimateUsd){
    const {settings}=await providerSettings(admin,owner);await saveProviderSettings(admin,owner,{...settings,mode:"GOOGLE_ONLY",paidFallback:false,autoRecovery:false});
    check((await admin.from("video_provider_jobs").update({actual_cost_usd:actual,message:"ยอดเรียกเก็บเกินประมาณการ ปิดบริการเสียเงินไว้จนเจ้าของตรวจสอบ"}).eq("owner_id",owner).eq("id",job.id)).error);
    throw new Error("BILLING_OVER_CAP");
  }
  await new AtomicBudgetLedger(admin).settle(owner,job.checkpoint.holdId,actual,job.provider_request_id);
  check((await admin.from("video_provider_jobs").update({actual_cost_usd:actual}).eq("owner_id",owner).eq("id",job.id)).error);return actual;
}
export async function advanceProviderJob(admin:SupabaseClient,owner:string,id:string,runtime?:RouterRuntime) {
  const claimed=await claim(admin,owner,id);if(!claimed)return;
  const {job,token}=claimed,ledger=new AtomicBudgetLedger(admin);
  try {
    const configured=await providerSettings(admin,owner),settings=runtime?.restrictSettings?.(configured.settings)??configured.settings,source=await sourceFor(admin,owner,job,runtime);
    const fal=runtime?.fal??new RoutedFalProvider(serverEnv.falKey??"");
    if(job.checkpoint.sourcePath){
      if(job.provider==="fal_ai" && job.checkpoint.holdId && job.checkpoint.request && job.provider_request_id)
        await settleBilledCost(admin,owner,job,fal);
      await finish(admin,owner,job,token,source,runtime);return;
    }
    if(job.checkpoint.holdId && !job.provider_request_id){
      const prior=await admin.from("generation_budget_reservations").select("provider_request_id").eq("owner_id",owner).eq("id",job.checkpoint.holdId).maybeSingle();check(prior.error);
      if(prior.data?.provider_request_id){
        await save(admin,owner,id,token,{provider:"fal_ai",provider_request_id:prior.data.provider_request_id,submission_state:"ACCEPTED",state:"PROCESSING"});return;
      }
    }
    const routerJob:RouterJob={state:job.state,provider:job.provider,submission:job.submission_state,requestId:job.provider_request_id,retries:job.retries,nextRetryAt:job.next_retry_at};
    let request=job.checkpoint.request;
    const google=new GoogleVidsOmniProvider().health(settings);
    let decision=routeVideoJob(settings,routerJob,{google,falAvailable:Boolean(runtime?.fal||serverEnv.falKey),estimateUsd:null,budgetAvailable:false});
    if(decision.action==="RECONCILE"){await save(admin,owner,id,token,{state:"RECONCILIATION_REQUIRED",message:"ตรวจรายการเดิมก่อนเริ่มซ้ำ ไม่มีการสลับไปเสียเงินอัตโนมัติ"});return;}
    if(decision.action==="POLL" && job.provider!=="fal_ai")throw new Error("GOOGLE_VIDS_ASSISTED_ONLY");
    if(decision.action==="WAIT" && decision.reason==="BUDGET_OR_QUOTE_UNAVAILABLE" && enabled(runtime)){
      const photo=await admin.from("media_assets").select("storage_path").eq("owner_id",owner).eq("product_id",source.product.id).eq("asset_type","PRODUCT_IMAGE").in("source_type",["UPLOAD","PRODUCT"]).order("created_at",{ascending:false}).limit(1).maybeSingle();check(photo.error);
      if(!photo.data || !ownsVideoStoragePath(owner,photo.data.storage_path))throw new Error("REAL_PRODUCT_IMAGE_REQUIRED");
      if(settings.falModel===FAL_MODEL_ENDPOINTS.LTX_098_DISTILLED && !job.checkpoint.voicePath)throw new Error("REAL_AUDIO_REQUIRED");
      if(job.checkpoint.voicePath){
        const voice=await ownedFile(admin,owner,job.checkpoint.voicePath,2_000_000);
        await validateNarrationAudio(new Blob([new Uint8Array(voice)]),8);
      }
      let imagePath=photo.data.storage_path;
      if(settings.falModel===FAL_MODEL_ENDPOINTS.WAN_26_FLASH){
        const photoBytes=await ownedFile(admin,owner,imagePath,12_000_000);
        const portrait=await portraitProductReference(new Blob([new Uint8Array(photoBytes)]));
        imagePath=videoStoragePath(owner,"masters",id,"portrait-reference.jpg");
        check((await admin.storage.from("video-assets").upload(imagePath,portrait,{contentType:"image/jpeg",upsert:true})).error);
      }
      const image=await admin.storage.from("video-assets").createSignedUrl(imagePath,3600);check(image.error);if(!image.data)throw new Error("REAL_PRODUCT_IMAGE_REQUIRED");
      const brief=new GoogleVidsOmniProvider().brief({productTitle:String(source.product.title),hook:String(source.script.hook_text),script:String(source.script.voice_script),cta:String(source.script.cta_text??"")});
      request=await fal.prepare(settings.falModel,image.data.signedUrl,brief.prompt);
      decision=routeVideoJob(settings,routerJob,{google,falAvailable:true,estimateUsd:request.estimateUsd,budgetAvailable:true});
    }
    job.decisions=[...job.decisions,{at:new Date().toISOString(),action:decision.action,provider:decision.provider,reason:decision.reason}].slice(-50);
    await save(admin,owner,id,token,{decisions:job.decisions});
    if(decision.action==="ASSIST"){await save(admin,owner,id,token,{state:"WAITING_ASSISTED",provider:"google_vids_omni",message:"เปิดคำแนะนำ สร้างใน Google Vids แล้วนำ MP4 กลับเข้างานนี้ โควตาบัญชียังไม่ทราบ"});return;}
    if(decision.action==="WAIT"){await save(admin,owner,id,token,{state:decision.retryAt?"RETRY_WAIT":"WAITING_PROVIDER",next_retry_at:decision.retryAt??null,retries:decision.retryAt?job.retries+1:job.retries,message:"รอบริการหรือวงเงินพร้อม ไม่มีการเรียกบริการเสียเงิน"});return;}
    if(decision.action==="DONE")return;
    if(decision.provider!=="fal_ai" || !request)throw new Error("GOOGLE_VIDS_ASSISTED_ONLY");
    if(decision.action==="SUBMIT"){
      if(!enabled(runtime))throw new Error("VIDEO_PROVIDER_ROUTER_DISABLED");
      const day=new Date().toISOString().slice(0,10),hold=await ledger.reserve({ownerId:owner,accountId:job.tiktok_account_id,generationJobId:job.generation_job_id,
        autoRunId:null,runKey:id,logicalOperationKey:`provider-router:${id}`,provider:"fal",model:request.endpoint,reservedUsd:request.estimateUsd,
        perVideoCapUsd:settings.maxCostUsd,dailyCapUsd:settings.dailyBudgetUsd,monthlyCapUsd:settings.monthlyBudgetUsd,runCapUsd:settings.maxCostUsd,
        accountCapUsd:Math.min(settings.dailyBudgetUsd,runtime?.accountDailyCapUsd??settings.dailyBudgetUsd),providerCapUsd:settings.dailyBudgetUsd,budgetDay:day,budgetMonth:`${day.slice(0,7)}-01`});
      job.checkpoint={...job.checkpoint,request,holdId:hold.id};
      // A crash between reservation and identity persistence must recover the ledger.
      if(hold.provider_request_id){await save(admin,owner,id,token,{checkpoint:job.checkpoint,provider:"fal_ai",submission_state:"ACCEPTED",provider_request_id:hold.provider_request_id,state:"PROCESSING"});return;}
      if(hold.provider_submission_state!=="REQUEST_NOT_SENT")throw new Error("PREVIOUS_RESULT_UNKNOWN");
      if(hold.state!=="RESERVED" || Number(hold.reserved_usd)<request.estimateUsd)throw new Error("PREVIOUS_RESULT_UNKNOWN");
      const holdModel=await admin.from("generation_budget_reservations").select("model").eq("owner_id",owner).eq("id",hold.id).single();check(holdModel.error);
      if(holdModel.data?.model!==request.endpoint)throw new Error("PREVIOUS_RESULT_UNKNOWN");
      const refreshed=(await providerSettings(admin,owner)).settings;
      if(!(refreshed.mode==="FAL_ONLY" || (refreshed.mode==="AUTO"&&refreshed.paidFallback)))throw new Error("PAID_PERMISSION_CHANGED");
      await runtime?.authorizeSubmission?.();
      await save(admin,owner,id,token,{checkpoint:job.checkpoint,provider:"fal_ai",estimated_cost_usd:request.estimateUsd});
      await ledger.begin(owner,hold.id);
      await save(admin,owner,id,token,{submission_state:"SUBMITTING",state:"PROCESSING"});
      const accepted=await fal.submit(request);if(!accepted.request_id)throw new Error("PREVIOUS_RESULT_UNKNOWN");
      await ledger.submitted(owner,hold.id,accepted.request_id);
      job.checkpoint.submittedAt=new Date().toISOString();
      await save(admin,owner,id,token,{checkpoint:job.checkpoint,submission_state:"ACCEPTED",provider_request_id:accepted.request_id});return;
    }
    job.checkpoint.polls=(job.checkpoint.polls??0)+1;
    if(job.checkpoint.polls>120 || (job.checkpoint.submittedAt && Date.now()-Date.parse(job.checkpoint.submittedAt)>30*60_000))throw new Error("PREVIOUS_RESULT_UNKNOWN");
    await save(admin,owner,id,token,{checkpoint:job.checkpoint});
    const polled=await fal.poll(request,job.provider_request_id!);
    if(polled.status==="PENDING"){await save(admin,owner,id,token,{next_retry_at:new Date(Date.now()+15_000).toISOString()});return;}
    if(polled.status==="FAILED"){
      await settleBilledCost(admin,owner,job,fal);
      await save(admin,owner,id,token,{submission_state:"CONFIRMED_FAILED",state:"FAILED",message:"บริการแจ้งว่าสร้างไม่สำเร็จ ยอดยังเป็นประมาณการ ไม่มีการซื้อซ้ำ"});return;
    }
    const generated=await fal.retrieve(request,job.provider_request_id!);
    const path=videoStoragePath(owner,"masters",id,"routed-source.mp4");
    check((await admin.storage.from("video-assets").upload(path,generated.bytes,{contentType:"video/mp4",upsert:true})).error);
    job.checkpoint.sourcePath=path;
    // Persist source before accounting/finalization: recovery never purchases again.
    await save(admin,owner,id,token,{checkpoint:job.checkpoint});
    await settleBilledCost(admin,owner,job,fal);
    await finish(admin,owner,job,token,source,runtime);
  }catch(error){
    const code=error instanceof Error?error.message:"UNKNOWN";
    if(code==="VIDEO_PROVIDER_LEASE_LOST")return;
    const current=await readJob(admin,owner,id);
    if(["SUBMITTING","ACCEPTED"].includes(current.submission_state) && !current.checkpoint.sourcePath){
      if(current.checkpoint.holdId)await ledger.uncertain(owner,current.checkpoint.holdId,current.provider_request_id).catch(()=>undefined);
      await save(admin,owner,id,token,{state:current.provider_request_id && code!=="PREVIOUS_RESULT_UNKNOWN"?"PROCESSING":"RECONCILIATION_REQUIRED",message:"กำลังตรวจรายการเดิม ไม่มีการสั่งซื้อซ้ำ"});
    }else await save(admin,owner,id,token,{state:["PREVIOUS_RESULT_UNKNOWN","BILLING_OVER_CAP"].includes(code)?"RECONCILIATION_REQUIRED":"WAITING_PROVIDER",message:code==="BILLING_OVER_CAP"?"ยอดเรียกเก็บเกินประมาณการ ปิดบริการเสียเงินจนเจ้าของตรวจสอบ":/BUDGET|budget/.test(code)?"วงเงินไม่พอ ยังไม่เริ่มรายการเสียเงิน":"ต้องตรวจไฟล์ ภาพสินค้า เสียง หรือความพร้อมของระบบ ไม่มีการซื้อซ้ำ"});
  }finally{await release(admin,owner,id,token);}
}
export async function prepareGoogleHandoff(admin:SupabaseClient,owner:string,id:string) {
  const claimed=await claim(admin,owner,id);if(!claimed)throw new Error("JOB_BUSY");
  try{
    const {job,token}=claimed;if(job.provider!=="google_vids_omni" || job.provider_request_id || !["NOT_SENT","EXTERNAL_PENDING"].includes(job.submission_state))throw new Error("PREVIOUS_RESULT_UNKNOWN");
    const source=await sourceFor(admin,owner,job),brief=new GoogleVidsOmniProvider().brief({productTitle:String(source.product.title),hook:String(source.script.hook_text),script:String(source.script.voice_script),cta:String(source.script.cta_text??"")});
    const photo=await admin.from("media_assets").select("storage_path").eq("owner_id",owner).eq("product_id",source.product.id).eq("asset_type","PRODUCT_IMAGE").in("source_type",["UPLOAD","PRODUCT"]).order("created_at",{ascending:false}).limit(1).maybeSingle();check(photo.error);
    if(!photo.data || !ownsVideoStoragePath(owner,photo.data.storage_path))throw new Error("REAL_PRODUCT_IMAGE_REQUIRED");
    const image=await admin.storage.from("video-assets").createSignedUrl(photo.data.storage_path,900);check(image.error);
    await save(admin,owner,id,token,{submission_state:"EXTERNAL_PENDING",state:"WAITING_ASSISTED",message:"ส่งต่อให้คุณสร้างใน Google แล้ว จะไม่ซื้อคลิปสำรองขณะยังไม่ทราบผล"});
    return{...brief,imageUrl:image.data?.signedUrl};
  }finally{await release(admin,owner,id,claimed.token);}
}
export async function beginProviderImport(admin:SupabaseClient,owner:string,id:string,kind:"VIDEO"|"VOICE") {
  const claimed=await claim(admin,owner,id);if(!claimed)throw new Error("JOB_BUSY");
  try{
    const {job,token}=claimed;
    if(job.provider_request_id || ["SUBMITTING","ACCEPTED","CONFIRMED_FAILED"].includes(job.submission_state) || (kind==="VIDEO" && job.provider!=="google_vids_omni"))throw new Error("PREVIOUS_RESULT_UNKNOWN");
    const path=videoStoragePath(owner,"masters",id,kind==="VIDEO"?"google-assisted.mp4":"owner-voice");
    const result=await admin.storage.from("video-assets").createSignedUploadUrl(path,{upsert:true});check(result.error);if(!result.data)throw new Error("UPLOAD_UNAVAILABLE");
    const checkpoint={...job.checkpoint,...(kind==="VIDEO"?{sourcePath:path}:{voicePath:path})};
    // Do not declare a source ready until upload/validation completes.
    await save(admin,owner,id,token,{checkpoint:{...checkpoint,sourcePath:job.checkpoint.sourcePath},submission_state:kind==="VIDEO"?"EXTERNAL_PENDING":job.submission_state});
    return{path,token:result.data.token};
  }finally{await release(admin,owner,id,claimed.token);}
}
export async function completeProviderImport(admin:SupabaseClient,owner:string,id:string,runtime?:RouterRuntime) {
  const claimed=await claim(admin,owner,id);if(!claimed)throw new Error("JOB_BUSY");
  try{
    const {job,token}=claimed;
    if(job.provider!=="google_vids_omni" || job.provider_request_id || job.submission_state!=="EXTERNAL_PENDING")throw new Error("PREVIOUS_RESULT_UNKNOWN");
    const source=await sourceFor(admin,owner,job,runtime);job.checkpoint.sourcePath=videoStoragePath(owner,"masters",id,"google-assisted.mp4");
    // Validate bytes before marking the handoff resolved. Imported provenance is owner attested, not provider attested.
    await finish(admin,owner,job,token,source,runtime);
    await save(admin,owner,id,token,{checkpoint:job.checkpoint,submission_state:"ACCEPTED"});
  }finally{await release(admin,owner,id,claimed.token);}
}
export async function reconcileGoogleNotSubmitted(admin:SupabaseClient,owner:string,id:string) {
  const claimed=await claim(admin,owner,id);if(!claimed)throw new Error("JOB_BUSY");
  try{
    const {job,token}=claimed;if(job.provider!=="google_vids_omni" || job.provider_request_id || job.checkpoint.sourcePath)throw new Error("PREVIOUS_RESULT_UNKNOWN");
    await save(admin,owner,id,token,{submission_state:"NOT_SENT",state:"QUEUED",message:"เจ้าของยืนยันว่าไม่มีงาน Google ถูกส่ง/ค้างอยู่ ยังไม่ถือว่า Google ยืนยันสถานะ",decisions:[...job.decisions,{at:new Date().toISOString(),reason:"OWNER_CONFIRMED_NO_EXTERNAL_JOB"}].slice(-50)});
  }finally{await release(admin,owner,id,claimed.token);}
}
export async function processProviderQueue(admin:SupabaseClient,owner:string,runtime?:RouterRuntime) {
  const {settings}=await providerSettings(admin,owner);if(!settings.autoRecovery || !enabled(runtime))return{processed:0};
  const result=await admin.from("video_provider_jobs").select("id").eq("owner_id",owner).in("state",["QUEUED","WAITING_PROVIDER","RETRY_WAIT","PROCESSING"]).order("updated_at").limit(3);check(result.error);
  for(const row of result.data??[])await advanceProviderJob(admin,owner,row.id,runtime);
  const unbilled=await admin.from("video_provider_jobs").select("id").eq("owner_id",owner).eq("provider","fal_ai").is("actual_cost_usd",null).in("state",["COMPLETED","REVIEW_REQUIRED","FAILED"]).order("updated_at").limit(3);check(unbilled.error);
  for(const row of unbilled.data??[])await reconcileProviderBilling(admin,owner,row.id,runtime);
  return{processed:result.data?.length??0};
}
/** An explicit owner request may extend read-only observation of a known request, never resubmit. */
export async function resumeKnownProviderResult(admin:SupabaseClient,owner:string,id:string){
  const claimed=await claim(admin,owner,id);if(!claimed)return;
  try{
    const {job,token}=claimed;
    if(job.state!=="RECONCILIATION_REQUIRED"||job.provider!=="fal_ai"||!job.provider_request_id||!job.checkpoint.request)throw new Error("PREVIOUS_RESULT_UNKNOWN");
    await save(admin,owner,id,token,{state:"PROCESSING",submission_state:"ACCEPTED",checkpoint:{...job.checkpoint,polls:0,submittedAt:new Date().toISOString()},message:"ติดตามผลรายการเดิมแบบอ่านอย่างเดียว ไม่สร้างงานใหม่"});
  }finally{await release(admin,owner,id,claimed.token);}
}
export async function reconcileProviderBilling(admin:SupabaseClient,owner:string,id:string,runtime?:RouterRuntime){
  const job=await readJob(admin,owner,id);if(job.provider!=="fal_ai")throw new Error("FAL_JOB_REQUIRED");
  return settleBilledCost(admin,owner,job,runtime?.fal??new RoutedFalProvider(serverEnv.falKey??""));
}
