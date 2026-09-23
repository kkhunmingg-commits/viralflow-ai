import {createHash,randomUUID} from "node:crypto";
import {mkdir,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {SupabaseClient} from "@supabase/supabase-js";
import {operationalPage,operationalWindow} from "../../lib/pagination";
import {CostRouter,chooseVideoStrategy} from "./cost-router";
import {MockImageProvider,MockVideoProvider,MockVoiceProvider,TemplateVideoProvider} from "./providers";
import {DeterministicVideoQualityEvaluator} from "./quality";
import {FFmpegVideoRenderer} from "./renderer";
import {videoSimilarity} from "./similarity";
import {masterJobKey,nextJobAttempt,variationJobKey,variationRunId} from "./jobs";
import {videoStoragePath} from "./storage";
import {templateFor,variationPlan} from "./templates";
import {VIDEO_BUCKET,VIDEO_DURATION_SECONDS,VIDEO_FACTORY_VERSION,type SimilarityMetadata,type VideoBudget,type VideoRenderInput} from "./types";

type Row=Record<string,unknown>;
async function one(client:SupabaseClient,table:string,owner:string,id:string){
  const {data,error}=await client.from(table).select("*").eq("owner_id",owner).eq("id",id).maybeSingle();
  if(error)throw new Error(error.message);return data as Row|null;
}
async function jobFor(client:SupabaseClient,owner:string,key:string,input:Row,jobType:"MASTER_RENDER"|"VARIATION_RENDER"){
  const existing=await client.from("generation_jobs").select("*").eq("owner_id",owner).eq("idempotency_key",key).maybeSingle();
  if(existing.error)throw new Error(existing.error.message);
  if(existing.data)return existing.data as Row;
  const {data,error}=await client.from("generation_jobs").insert({owner_id:owner,idempotency_key:key,job_type:jobType,provider:"local-ffmpeg",model:"ffmpeg-template-v1",input_json:input,status:"QUEUED",attempt:0,max_attempts:2}).select("*").single();
  if(error)throw new Error(error.message);return data as Row;
}
async function beginJob(client:SupabaseClient,owner:string,job:Row){
  const next=nextJobAttempt(Number(job.attempt??0),Number(job.max_attempts??2));
  if(!next.allowed)throw new Error("Maximum render attempts reached");
  const {error}=await client.from("generation_jobs").update({status:next.status,attempt:next.attempt,started_at:new Date().toISOString(),error_code:null,error_message:null}).eq("owner_id",owner).eq("id",job.id);
  if(error)throw new Error(error.message);return next.attempt;
}
async function failJob(client:SupabaseClient,owner:string,jobId:string,error:unknown){
  await client.from("generation_jobs").update({status:"FAILED",error_code:"LOCAL_RENDER_FAILED",error_message:error instanceof Error?error.message:"Render failed",completed_at:new Date().toISOString()}).eq("owner_id",owner).eq("id",jobId);
}
async function recordZeroCost(client:SupabaseClient,owner:string,jobId:string){
  const current=await client.from("generation_costs").select("id").eq("owner_id",owner).eq("generation_job_id",jobId).eq("provider","local-ffmpeg").eq("model","ffmpeg-template-v1").eq("unit","RENDER").maybeSingle();
  if(current.error)throw new Error(current.error.message);if(current.data)return;
  const inserted=await client.from("generation_costs").insert({owner_id:owner,generation_job_id:jobId,provider:"local-ffmpeg",model:"ffmpeg-template-v1",quantity:1,unit:"RENDER",unit_cost_usd:0,total_cost_usd:0});
  if(inserted.error)throw new Error(inserted.error.message);
}
async function upload(client:SupabaseClient,path:string,filePath:string,mime:string){
  const bytes=await readFile(filePath),{error}=await client.storage.from(VIDEO_BUCKET).upload(path,bytes,{contentType:mime,upsert:true});
  if(error)throw new Error(error.message);return {bytes,checksum:createHash("sha256").update(bytes).digest("hex")};
}
async function source(client:SupabaseClient,owner:string,projectId:string){
  const project=await one(client,"creative_projects",owner,projectId);
  if(!project||!project.selected_script_id||!project.selected_angle_id)throw new Error("Select a Creative Brain concept before creating video");
  const [script,angle,account,product]=await Promise.all([
    one(client,"scripts",owner,String(project.selected_script_id)),
    one(client,"creative_angles",owner,String(project.selected_angle_id)),
    one(client,"tiktok_accounts",owner,String(project.tiktok_account_id)),
    one(client,"products",owner,String(project.product_id)),
  ]);
  if(!script||!angle||!account||!product)throw new Error("Selected creative source is incomplete");
  if(angle.policy_status!=="SAFE"||script.status==="REJECTED")throw new Error("Creative risk status must be SAFE");
  const input:VideoRenderInput={productTitle:String(product.title),hook:String(script.hook_text),cta:String(script.cta_text),overlay:script.overlay_text_json as VideoRenderInput["overlay"],scenes:script.scene_plan_json as VideoRenderInput["scenes"],template:templateFor(String(angle.angle_type))};
  return {project,script,angle,account,product,input};
}
async function spend(client:SupabaseClient,owner:string){
  const now=new Date(),day=now.toISOString().slice(0,10),month=day.slice(0,7);
  const {data,error}=await client.from("generation_costs").select("total_cost_usd,created_at").eq("owner_id",owner).gte("created_at",`${month}-01T00:00:00.000Z`);
  if(error)throw new Error(error.message);
  const rows=data??[],monthSpend=rows.reduce((sum,r)=>sum+Number(r.total_cost_usd),0),daySpend=rows.filter(r=>String(r.created_at).startsWith(day)).reduce((sum,r)=>sum+Number(r.total_cost_usd),0);
  return {daySpend,monthSpend};
}
function budget(account:Row,spent:{daySpend:number;monthSpend:number}):VideoBudget{return {maxCostPerVideoUsd:Number(account.max_cost_per_video_usd??0),dailyVideoBudgetUsd:Number(account.daily_video_budget_usd??0),monthlyVideoBudgetUsd:Number(account.monthly_video_budget_usd??0),spentTodayUsd:spent.daySpend,spentMonthUsd:spent.monthSpend}}

export async function buildMasterVideo(client:SupabaseClient,owner:string,projectId:string){
  const src=await source(client,owner,projectId),existing=await client.from("master_videos").select("*").eq("owner_id",owner).eq("creative_project_id",projectId).maybeSingle();
  if(existing.error)throw new Error(existing.error.message);
  if(existing.data&&["READY","APPROVED"].includes(existing.data.status)){if(existing.data.generation_job_id)await recordZeroCost(client,owner,existing.data.generation_job_id);return existing.data}
  const decision=chooseVideoStrategy({existingApprovedMaster:existing.data?.status==="APPROVED",hasUsableAssets:true,qualityRequirement:85,budget:budget(src.account,await spend(client,owner)),availability:{freeCredit:false,lowCostPaid:false,premium:false,paidAllowed:false}});
  const masterId=String(existing.data?.id??randomUUID()),job=await jobFor(client,owner,masterJobKey(projectId,String(src.script.id)),{creativeProjectId:projectId,scriptId:src.script.id,strategy:decision.strategy},"MASTER_RENDER");
  const row={id:masterId,owner_id:owner,tiktok_account_id:src.project.tiktok_account_id,product_id:src.project.product_id,creative_project_id:projectId,selected_script_id:src.script.id,generation_job_id:job.id,provider:"local-ffmpeg",model:"ffmpeg-template-v1",render_strategy:decision.strategy,duration_seconds:8,width:1080,height:1920,fps:30,estimated_cost_usd:0,status:"PROCESSING",quality_explanation_json:{}};
  const saved=existing.data?await client.from("master_videos").update(row).eq("owner_id",owner).eq("id",masterId):await client.from("master_videos").insert(row);
  if(saved.error)throw new Error(saved.error.message);
  await client.from("generation_jobs").update({master_video_id:masterId,creative_project_id:projectId}).eq("owner_id",owner).eq("id",job.id);
  await beginJob(client,owner,job);
  const dir=join(tmpdir(),"viralflow-video",owner,masterId);await mkdir(dir,{recursive:true});
  try{
    const imageProvider=new MockImageProvider(),voiceProvider=new MockVoiceProvider(),provider=new TemplateVideoProvider(),renderer=new FFmpegVideoRenderer(),qualityEvaluator=new DeterministicVideoQualityEvaluator();
    const image=await imageProvider.createProductImage(String(src.product.title),join(dir,"product.ppm")),voice=await voiceProvider.createVoiceTrack(String(src.script.voice_script),join(dir,"voice.wav"),8),plan=await provider.plan(src.input),rendered=await renderer.render(plan,image.path,voice.path,join(dir,"master.mp4"));
    const quality=qualityEvaluator.evaluate({...rendered,overlay:plan.overlay,scenes:plan.scenes,productVisible:true,ctaVisible:Boolean(plan.cta),malformedAssets:false,inheritedRisk:"SAFE"});
    const imagePath=videoStoragePath(owner,"products",String(src.product.id),"mock-product.ppm"),videoPath=videoStoragePath(owner,"masters",masterId,"master.mp4"),voicePath=videoStoragePath(owner,"masters",masterId,"voice.wav");
    const [imageUpload,videoUpload,voiceUpload]=await Promise.all([upload(client,imagePath,image.path,"image/x-portable-pixmap"),upload(client,videoPath,rendered.path,"video/mp4"),upload(client,voicePath,voice.path,"audio/wav")]);
    const assets=[
      {owner_id:owner,product_id:src.product.id,creative_project_id:projectId,asset_type:"PRODUCT_IMAGE",source_type:"MOCK",storage_path:imagePath,mime_type:"image/x-portable-pixmap",width:image.width,height:image.height,provider:imageProvider.provider,model:imageProvider.model,checksum:imageUpload.checksum},
      {owner_id:owner,product_id:src.product.id,creative_project_id:projectId,asset_type:"VOICE",source_type:"MOCK",storage_path:voicePath,mime_type:"audio/wav",duration_seconds:8,provider:voiceProvider.provider,model:voiceProvider.model,checksum:voiceUpload.checksum},
      {owner_id:owner,product_id:src.product.id,creative_project_id:projectId,asset_type:"VIDEO",source_type:"RENDERED",storage_path:videoPath,mime_type:"video/mp4",width:rendered.width,height:rendered.height,duration_seconds:rendered.duration,provider:renderer.provider,model:renderer.model,checksum:videoUpload.checksum},
    ];
    const assetResult=await client.from("media_assets").upsert(assets,{onConflict:"owner_id,storage_path"});if(assetResult.error)throw new Error(assetResult.error.message);
    const status=quality.status==="PASS"?"READY":"FAILED",update=await client.from("master_videos").update({storage_path:videoPath,duration_seconds:rendered.duration,width:rendered.width,height:rendered.height,fps:rendered.fps,quality_score:quality.score,quality_status:quality.status,quality_explanation_json:quality.explanation,status}).eq("owner_id",owner).eq("id",masterId);if(update.error)throw new Error(update.error.message);
    await recordZeroCost(client,owner,String(job.id));
    await client.from("generation_jobs").update({status:"COMPLETED",output_json:{masterId,storagePath:videoPath,quality,rendered,version:VIDEO_FACTORY_VERSION},completed_at:new Date().toISOString()}).eq("owner_id",owner).eq("id",job.id);
    return {...row,storage_path:videoPath,quality_score:quality.score,quality_status:quality.status,status};
  }catch(error){await failJob(client,owner,String(job.id),error);await client.from("master_videos").update({status:"FAILED",quality_status:"RETRY"}).eq("owner_id",owner).eq("id",masterId);throw error}
  finally{await rm(dir,{recursive:true,force:true})}
}

export async function createVideoVariations(client:SupabaseClient,owner:string,masterId:string,count=3){
  const master=await one(client,"master_videos",owner,masterId);if(!master||!["READY","APPROVED"].includes(String(master.status)))throw new Error("A passing master is required");
  const existing=await client.from("video_variations").select("*").eq("owner_id",owner).eq("master_video_id",masterId).order("variation_index");
  if(existing.error)throw new Error(existing.error.message);
  if((existing.data?.length??0)>=count)return existing.data?.slice(0,count)??[];
  const src=await source(client,owner,String(master.creative_project_id)),runId=variationRunId(masterId),base:SimilarityMetadata={masterId,hook:src.input.hook,cta:src.input.cta,scenes:src.input.scenes,motion:{pattern:"ZOOM_IN"},overlay:src.input.overlay,audio:{voice:"mock"}};
  const rows=[] as Row[],accepted=[] as SimilarityMetadata[];
  for(let i=1;i<=count;i++){
    const plan=variationPlan(i,src.input),candidate:SimilarityMetadata={masterId,hook:plan.hook,cta:plan.cta,scenes:src.input.scenes,motion:{pattern:plan.motionPattern,transition:plan.transition},overlay:{items:src.input.overlay,position:plan.overlayPosition},audio:{voice:"mock",speed:plan.speed}};
    const comparisons=[base,...accepted].map(v=>videoSimilarity(v,candidate)),similarity=Math.max(...comparisons.map(v=>v.score));
    if(similarity>=.82)continue;accepted.push(candidate);
    rows.push({owner_id:owner,master_video_id:masterId,tiktok_account_id:master.tiktok_account_id,product_id:master.product_id,creative_project_id:master.creative_project_id,run_id:runId,variation_index:i,variation_type:plan.variationType,hook_variant:plan.hook,cta_variant:plan.cta,overlay_config_json:{position:plan.overlayPosition,items:src.input.overlay},motion_config_json:{pattern:plan.motionPattern,transition:plan.transition,speed:plan.speed},scene_config_json:{scenes:src.input.scenes},audio_config_json:{voice:"mock",normalization:true,fade:true},similarity_score:similarity,estimated_cost_usd:0,status:"QUEUED",quality_explanation_json:{}});
  }
  const {error}=await client.from("video_variations").upsert(rows,{onConflict:"owner_id,master_video_id,variation_index",ignoreDuplicates:true});if(error)throw new Error(error.message);
  const result=await client.from("video_variations").select("*").eq("owner_id",owner).eq("master_video_id",masterId).order("variation_index");if(result.error)throw new Error(result.error.message);return result.data??[];
}

export async function buildVideoVariation(client:SupabaseClient,owner:string,variationId:string){
  const variation=await one(client,"video_variations",owner,variationId);if(!variation)throw new Error("Variation not found");
  if(["READY","APPROVED"].includes(String(variation.status))&&variation.storage_path)return variation;
  const master=await one(client,"master_videos",owner,String(variation.master_video_id));if(!master)throw new Error("Master not found");
  const src=await source(client,owner,String(variation.creative_project_id)),planData=variationPlan(Number(variation.variation_index),src.input),job=await jobFor(client,owner,variationJobKey(String(variation.id),String(variation.run_id)),{variationId:variation.id,runId:variation.run_id},"VARIATION_RENDER");
  await client.from("generation_jobs").update({video_variation_id:variation.id,master_video_id:master.id,creative_project_id:variation.creative_project_id}).eq("owner_id",owner).eq("id",job.id);await beginJob(client,owner,job);
  const dir=join(tmpdir(),"viralflow-video",owner,String(variation.id));await mkdir(dir,{recursive:true});
  try{
    const imageProvider=new MockImageProvider(),voiceProvider=new MockVoiceProvider(),provider=new MockVideoProvider(),renderer=new FFmpegVideoRenderer(),qualityEvaluator=new DeterministicVideoQualityEvaluator();
    const image=await imageProvider.createProductImage(String(src.product.title),join(dir,"product.ppm")),voice=await voiceProvider.createVoiceTrack(String(src.script.voice_script),join(dir,"voice.wav"),VIDEO_DURATION_SECONDS),input={...src.input,hook:planData.hook,cta:planData.cta,variation:planData},rendered=await renderer.render(await provider.plan(input),image.path,voice.path,join(dir,"variation.mp4"));
    const quality=qualityEvaluator.evaluate({...rendered,overlay:input.overlay,scenes:input.scenes,productVisible:true,ctaVisible:Boolean(input.cta),malformedAssets:false,inheritedRisk:"SAFE"}),path=videoStoragePath(owner,"variations",String(variation.id),"video.mp4"),file=await upload(client,path,rendered.path,"video/mp4");
    await client.from("media_assets").upsert({owner_id:owner,product_id:variation.product_id,creative_project_id:variation.creative_project_id,asset_type:"VIDEO",source_type:"RENDERED",storage_path:path,mime_type:"video/mp4",width:rendered.width,height:rendered.height,duration_seconds:rendered.duration,provider:renderer.provider,model:renderer.model,checksum:file.checksum},{onConflict:"owner_id,storage_path"});
    const status=quality.status==="PASS"?"READY":"FAILED";await client.from("video_variations").update({generation_job_id:job.id,storage_path:path,quality_score:quality.score,quality_status:quality.status,quality_explanation_json:quality.explanation,status}).eq("owner_id",owner).eq("id",variation.id);
    await recordZeroCost(client,owner,String(job.id));
    await client.from("generation_jobs").update({status:"COMPLETED",output_json:{variationId:variation.id,storagePath:path,quality,rendered},completed_at:new Date().toISOString()}).eq("owner_id",owner).eq("id",job.id);
    return {...variation,generation_job_id:job.id,storage_path:path,quality_score:quality.score,quality_status:quality.status,status};
  }catch(error){await failJob(client,owner,String(job.id),error);await client.from("video_variations").update({status:"FAILED",quality_status:"RETRY"}).eq("owner_id",owner).eq("id",variation.id);throw error}
  finally{await rm(dir,{recursive:true,force:true})}
}

export async function setVideoStatus(client:SupabaseClient,owner:string,kind:"master"|"variation",id:string,status:"APPROVED"|"REJECTED"){
  const table=kind==="master"?"master_videos":"video_variations",row=await one(client,table,owner,id);if(!row)throw new Error("Video not found");
  if(status==="APPROVED"&&row.quality_status!=="PASS")throw new Error("Only a passing video can be approved");
  const {error}=await client.from(table).update({status}).eq("owner_id",owner).eq("id",id);if(error)throw new Error(error.message);
}
export async function listVideoFactory(client:SupabaseClient,owner:string,page=1){
  const {from,to}=operationalWindow(page);
  const masters=await client.from("master_videos").select("*").eq("owner_id",owner).order("updated_at",{ascending:false}).order("id",{ascending:false}).range(from,to);
  if(masters.error)throw new Error(masters.error.message);
  const masterPage=operationalPage(masters.data??[],page);
  if(!masterPage.items.length)return{...masterPage,items:[]};
  const ids=masterPage.items.map(v=>v.id),accountIds=[...new Set(masterPage.items.map(v=>v.tiktok_account_id))],productIds=[...new Set(masterPage.items.map(v=>v.product_id))];
  const [variations,accounts,products,eligibility,compliance,originality,health]=await Promise.all([
    client.from("video_variations").select("*").eq("owner_id",owner).in("master_video_id",ids).order("variation_index"),
    client.from("tiktok_accounts").select("id,display_name,mode,effective_mode").eq("owner_id",owner).in("id",accountIds),
    client.from("products").select("id,title").eq("owner_id",owner).in("id",productIds),
    client.from("publish_eligibility_checks").select("*").eq("owner_id",owner).in("video_id",ids).order("created_at",{ascending:false}).limit(2000),
    client.from("content_compliance_checks").select("*").eq("owner_id",owner).in("video_id",ids).order("checked_at",{ascending:false}).limit(2000),
    client.from("originality_checks").select("*").eq("owner_id",owner).in("video_id",ids).order("created_at",{ascending:false}).limit(2000),
    client.from("account_publish_health").select("*").eq("owner_id",owner).in("tiktok_account_id",accountIds),
  ]);for(const result of [variations,accounts,products,eligibility,compliance,originality,health])if(result.error)throw new Error(result.error.message);
  const accountMap=new Map((accounts.data??[]).map(v=>[v.id,v])),productMap=new Map((products.data??[]).map(v=>[v.id,v.title]));
  const latest=<T extends {video_id:string}>(rows:T[])=>{const map=new Map<string,T>();for(const row of rows)if(!map.has(row.video_id))map.set(row.video_id,row);return map};
  const eligibilityMap=latest(eligibility.data??[]),complianceMap=latest(compliance.data??[]),originalityMap=latest(originality.data??[]),healthMap=new Map((health.data??[]).map(row=>[row.tiktok_account_id,row]));
  const variationMap=new Map<string,typeof variations.data>();for(const variation of variations.data??[]){const rows=variationMap.get(variation.master_video_id)??[];rows.push(variation);variationMap.set(variation.master_video_id,rows)}
  return {...masterPage,items:masterPage.items.map(master=>{const account=accountMap.get(master.tiktok_account_id);return {...master,account_name:account?.display_name??"Unknown",requested_mode:account?.mode??"—",effective_mode:account?.effective_mode??"—",product_title:productMap.get(master.product_id)??"Unknown",publish_status:eligibilityMap.get(master.id)?.final_status??"NOT_CHECKED",eligibility:eligibilityMap.get(master.id),compliance:complianceMap.get(master.id),originality:originalityMap.get(master.id),publish_health:healthMap.get(master.tiktok_account_id),variations:variationMap.get(master.id)??[]}})};
}
export async function getVideoDetail(client:SupabaseClient,owner:string,masterId:string){
  const master=await one(client,"master_videos",owner,masterId);if(!master)throw new Error("Video not found");
  const [project,script,account,product,variations,jobs]=await Promise.all([
    one(client,"creative_projects",owner,String(master.creative_project_id)),one(client,"scripts",owner,String(master.selected_script_id)),one(client,"tiktok_accounts",owner,String(master.tiktok_account_id)),one(client,"products",owner,String(master.product_id)),
    client.from("video_variations").select("*").eq("owner_id",owner).eq("master_video_id",masterId).order("variation_index"),
    client.from("generation_jobs").select("*").eq("owner_id",owner).eq("master_video_id",masterId).order("created_at",{ascending:false}).limit(100),
  ]);if(variations.error||jobs.error)throw new Error(variations.error?.message??jobs.error?.message);
  const jobIds=(jobs.data??[]).map(j=>j.id);
  const costs=jobIds.length?await client.from("generation_costs").select("*").eq("owner_id",owner).in("generation_job_id",jobIds).order("created_at",{ascending:false}).limit(200):{data:[],error:null};
  if(costs.error)throw new Error(costs.error.message);
  let signedUrl:string|null=null;if(master.storage_path){const signed=await client.storage.from(VIDEO_BUCKET).createSignedUrl(String(master.storage_path),900);if(signed.error)throw new Error(signed.error.message);signedUrl=signed.data.signedUrl}
  const variationRows=await Promise.all((variations.data??[]).map(async v=>{let url:string|null=null;if(v.storage_path){const s=await client.storage.from(VIDEO_BUCKET).createSignedUrl(v.storage_path,900);url=s.data?.signedUrl??null}return {...v,signed_url:url}}));
  return {master,project,script,account,product,variations:variationRows,jobs:jobs.data??[],costs:costs.data??[],signedUrl};
}
export const videoCostRouter=new CostRouter();
