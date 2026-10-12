import {randomUUID} from "node:crypto";
import {describe,it,expect,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
vi.mock("server-only",()=>({}));
vi.mock("@/lib/server-env",()=>({serverEnv:{}}));
import {enqueueProviderVideo,advanceProviderJob,completeProviderImport,resumeKnownProviderResult,processProviderQueue,reconcileProviderBilling,type RouterRuntime} from "./service";
import {providerSettingsSchema} from "./contracts";
import {RoutedFalProvider} from "./fal";
import {GeminiOmniProvider} from "./gemini";
import {resolveFalModelSettings,FAL_MODEL_ENDPOINTS} from "@/features/video/fal-models";
type Row=Record<string,unknown>;
const owner=randomUUID(),account=randomUUID(),project=randomUUID(),script=randomUUID(),product=randomUUID();
const photoPath=`owner/${owner}/products/photo.jpg`;
const source={project:{id:project,tiktok_account_id:account},account:{id:account,is_mock:false},product:{id:product,title:"Test product"},script:{id:script,voice_script:"เสียงทดสอบ",hook_text:"ลองจัดโต๊ะ",cta_text:"ดูรายละเอียด"},angle:{policy_status:"SAFE"},input:{} as never};
function database(){
  const rows:Record<string,Row[]>={video_provider_settings:[{owner_id:owner,config:providerSettingsSchema.parse({mode:"FAL_ONLY",maxCostUsd:1,dailyBudgetUsd:2,monthlyBudgetUsd:10})}],video_provider_jobs:[],generation_jobs:[],master_videos:[],generation_budget_reservations:[],media_assets:[{owner_id:owner,product_id:product,asset_type:"PRODUCT_IMAGE",source_type:"UPLOAD",storage_path:photoPath}]};
  const files=new Map<string,Blob>();files.set(photoPath,new Blob(["fixture image"]));
  function from(table:string){let operation="read",values:Row={},limit=1000,projection="*",conflict="",ignore=false;const filters:Array<(row:Row)=>boolean>=[];
    const q={select:(value="*")=>{projection=value;return q;},eq:(key:string,value:unknown)=>{filters.push(r=>r[key]===value);return q;},is:(key:string,value:unknown)=>{filters.push(r=>value===null?r[key]==null:r[key]===value);return q;},in:(key:string,list:unknown[])=>{filters.push(r=>list.includes(r[key]));return q;},order:()=>q,limit:(n:number)=>{limit=n;return q;},
      update:(value:Row)=>{operation="update";values=value;return q;},upsert:(value:Row,options?:{onConflict?:string;ignoreDuplicates?:boolean})=>{operation="insert";values=value;conflict=options?.onConflict??"id";ignore=!!options?.ignoreDuplicates;return q;},
      single:async()=>exec(true),maybeSingle:async()=>exec(true),then:(resolve:(r:unknown)=>void)=>Promise.resolve(exec(false)).then(resolve)};
    function exec(single:boolean){let selected=rows[table].filter(row=>filters.every(test=>test(row))).slice(0,limit);
      if(operation==="insert"){
        const prior=rows[table].find(row=>conflict.split(",").every(key=>row[key]===values[key]));
        if(prior){if(!ignore)Object.assign(prior,structuredClone(values));selected=[prior];}
        else{const row={id:randomUUID(),state:"QUEUED",provider:null,submission_state:"NOT_SENT",provider_request_id:null,retries:0,next_retry_at:null,checkpoint:{},decisions:[],lease_token:null,estimated_cost_usd:0,created_at:new Date().toISOString(),...values};rows[table].push(row);selected=[row];}
      }
      if(operation==="update")selected.forEach(row=>Object.assign(row,structuredClone(values)));
      const projected=selected.map(row=>projection==="*"?row:Object.fromEntries(projection.split(",").map(key=>[key,row[key]])));
      return{data:structuredClone(single?projected[0]??null:projected),error:null};
    }return q;
  }
  const rpc=vi.fn(async(name:string,args:Row)=>{
    if(name==="gemini_video_guard_version")return{data:"gemini-omni-budget-v1",error:null};
    if(name==="fal_budget_guard_version")return{data:"fal-generation-budget-guards-v1",error:null};
    if(name==="claim_video_provider_job"){
      const job=rows.video_provider_jobs.find(row=>row.owner_id===args.p_owner_id&&row.id===args.p_job_id);
      if(!job||job.lease_token||["COMPLETED","REVIEW_REQUIRED","FAILED"].includes(String(job.state))||(job.next_retry_at&&Date.parse(String(job.next_retry_at))>Date.now())||rows.video_provider_jobs.some(row=>row.tiktok_account_id===job.tiktok_account_id&&row.owner_id===job.owner_id&&row.lease_token))return{data:null,error:null};
      job.lease_token=args.p_lease_token;return{data:structuredClone(job),error:null};
    }
    if(name==="reserve_generation_budget"){
      const prior=rows.generation_budget_reservations.find(row=>row.owner_id===args.p_owner_id&&row.logical_operation_key===args.p_logical_operation_key);if(prior)return{data:structuredClone(prior),error:null};
      const spent=rows.generation_budget_reservations.filter(row=>row.owner_id===args.p_owner_id).reduce((sum,row)=>sum+Number(row.reserved_usd),0);
      if(spent+Number(args.p_reserved_usd)>Number(args.p_daily_cap_usd))return{data:null,error:{message:"daily_budget_exceeded"}};
      const hold={id:randomUUID(),owner_id:args.p_owner_id,logical_operation_key:args.p_logical_operation_key,reserved_usd:args.p_reserved_usd,state:"RESERVED",provider_submission_state:"REQUEST_NOT_SENT",provider_request_id:null,model:args.p_model,provider:args.p_provider};rows.generation_budget_reservations.push(hold);return{data:structuredClone(hold),error:null};
    }
    const hold=rows.generation_budget_reservations.find(row=>row.id===args.p_reservation_id&&row.owner_id===args.p_owner_id);if(!hold)return{data:null,error:{message:"missing hold"}};
    if(name==="begin_generation_submission"){if(hold.provider_submission_state!=="REQUEST_NOT_SENT")return{data:null,error:{message:"begun"}};hold.provider_submission_state="SUBMITTING";}
    if(name==="mark_generation_submitted"){hold.provider_submission_state="SUBMITTED";hold.provider_request_id=args.p_provider_request_id;}
    if(name==="mark_generation_unknown")hold.provider_submission_state="SUBMITTED_UNKNOWN";
    if(name==="settle_generation_budget"){hold.state="SETTLED";hold.actual_usd=args.p_actual_usd;}
    return{data:structuredClone(hold),error:null};
  });
  const client={from,rpc,storage:{from:()=>({download:async(path:string)=>({data:files.get(path),error:null}),upload:async(path:string,bytes:Uint8Array)=>{files.set(path,new Blob([new Uint8Array(bytes)]));return{error:null};},createSignedUrl:async()=>({data:{signedUrl:"https://project.supabase.co/photo.jpg"},error:null})})}} as unknown as SupabaseClient;
  return{client,rows,files,rpc};
}
function runtime(){
  const fal=new RoutedFalProvider("not-a-real-key");fal.prepare=vi.fn(async()=>({endpoint:FAL_MODEL_ENDPOINTS.LTX_23_FAST,input:{},estimateUsd:.5,settings:resolveFalModelSettings({model:FAL_MODEL_ENDPOINTS.LTX_23_FAST})}));
  fal.billedCost=vi.fn(async()=>null);fal.submit=vi.fn(async()=>({request_id:"same-request"}));fal.poll=vi.fn(async()=>({status:"COMPLETE" as const}));fal.retrieve=vi.fn(async()=>({bytes:new Uint8Array([1,2,3])})) as unknown as typeof fal.retrieve;
  const finalize=vi.fn(async()=>({id:randomUUID(),quality_status:"RETRY"}));return{enabled:true,fal,source:vi.fn(async()=>source),finalize} satisfies RouterRuntime;
}

function geminiFixture(){
  const d=database(),r=runtime(),gemini=new GeminiOmniProvider("fixture-not-a-real-key",fetch,{paidMode:true});
  d.rows.video_provider_settings[0].config=providerSettingsSchema.parse({mode:"GEMINI_ONLY",paidMode:true,geminiInputMode:"TEXT_TO_VIDEO",maxCostUsd:3,dailyBudgetUsd:6,monthlyBudgetUsd:20});
  gemini.submit=vi.fn(async()=>({request_id:"omni-existing-request"}));gemini.poll=vi.fn(async()=>({status:"COMPLETE" as const}));
  gemini.retrieve=vi.fn(async()=>({bytes:new Uint8Array([1,2,3]),costUsd:null,usageCostUsd:.82,costBasis:"PROVIDER_USAGE_ESTIMATE" as const}));
  return{d,r:{...r,gemini,geminiEnabled:true as boolean} satisfies RouterRuntime};
}

describe("Gemini durable integration with mocked transport, zero paid calls",()=>{
  it("TTV without a product image reserves once, retrieves the same id and enters quality review",async()=>{
    const {d,r}=geminiFixture();d.rows.media_assets=[];
    const j=await enqueueProviderVideo(d.client,owner,project,r);
    await Promise.all([advanceProviderJob(d.client,owner,j.id,r),advanceProviderJob(d.client,owner,j.id,r)]);
    await advanceProviderJob(d.client,owner,j.id,r);await advanceProviderJob(d.client,owner,j.id,r);
    expect(r.gemini.submit).toHaveBeenCalledOnce();expect(r.fal.submit).not.toHaveBeenCalled();
    expect(d.rows.video_provider_jobs[0]).toMatchObject({provider:"gemini_omni_api",state:"REVIEW_REQUIRED",checkpoint:{usageCostUsd:.82}});
    expect(d.rows.video_provider_jobs[0].actual_cost_usd).toBeUndefined();expect(d.rows.generation_budget_reservations[0]).toMatchObject({provider:"gemini",state:"RESERVED"});
    expect(r.finalize).toHaveBeenCalledOnce();expect(r.gemini.poll).toHaveBeenCalledWith(expect.anything(),"omni-existing-request");
  });
  it("I2V sends an owner-bound image but persists only its hash and private storage path",async()=>{
    const {d,r}=geminiFixture();d.rows.video_provider_settings[0].config={...d.rows.video_provider_settings[0].config as Row,geminiInputMode:"IMAGE_TO_VIDEO"};
    d.files.set(photoPath,new Blob([new Uint8Array([255,216,255,224,1,2,3,4])]));
    const j=await enqueueProviderVideo(d.client,owner,project,r);await advanceProviderJob(d.client,owner,j.id,r);
    expect(r.gemini.submit).toHaveBeenCalledWith(expect.objectContaining({task:"image_to_video",image:expect.objectContaining({sha256:expect.any(String)})}),expect.objectContaining({mimeType:"image/jpeg"}));
    const checkpoint=d.rows.video_provider_jobs[0].checkpoint as Row;expect(checkpoint.imagePath).toBe(photoPath);expect(JSON.stringify(checkpoint)).not.toContain("base64");
  });
  it.each(["permission","server flag","budget","schema guard"])("blocks paid submit for missing %s",async(blocker)=>{
    const {d,r}=geminiFixture();
    if(blocker==="permission")d.rows.video_provider_settings[0].config={...d.rows.video_provider_settings[0].config as Row,paidMode:false};
    if(blocker==="server flag")r.geminiEnabled=false;
    if(blocker==="budget")d.rows.video_provider_settings[0].config={...d.rows.video_provider_settings[0].config as Row,maxCostUsd:.5};
    if(blocker==="schema guard"){const old=d.rpc.getMockImplementation()!;d.rpc.mockImplementation(async(name,args)=>name==="gemini_video_guard_version"?{data:null,error:{message:"not installed"}}:old(name,args));}
    const j=await enqueueProviderVideo(d.client,owner,project,r);await advanceProviderJob(d.client,owner,j.id,r);
    expect(r.gemini.submit).not.toHaveBeenCalled();expect(r.fal.submit).not.toHaveBeenCalled();
  });
  it("lost POST response prevents both resubmission and paid fallback",async()=>{
    const {d,r}=geminiFixture();d.rows.video_provider_settings[0].config={...d.rows.video_provider_settings[0].config as Row,paidFallback:true};
    r.gemini.submit=vi.fn(async()=>{throw new Error("GEMINI_SUBMISSION_UNKNOWN");});const j=await enqueueProviderVideo(d.client,owner,project,r);
    await advanceProviderJob(d.client,owner,j.id,r);await advanceProviderJob(d.client,owner,j.id,r);
    expect(r.gemini.submit).toHaveBeenCalledOnce();expect(r.fal.submit).not.toHaveBeenCalled();expect(d.rows.video_provider_jobs[0].state).toBe("RECONCILIATION_REQUIRED");
  });
  it("restart and changed mode only retrieve the original interaction",async()=>{
    const {d,r}=geminiFixture();const j=await enqueueProviderVideo(d.client,owner,project,r);await advanceProviderJob(d.client,owner,j.id,r);
    d.rows.video_provider_settings[0].config=providerSettingsSchema.parse({mode:"GOOGLE_ONLY"});r.geminiEnabled=false;
    await advanceProviderJob(d.client,owner,j.id,r);expect(r.gemini.submit).toHaveBeenCalledOnce();expect(r.gemini.retrieve).toHaveBeenCalledWith(expect.anything(),"omni-existing-request");
  });
  it("recovers Gemini identity from ledger without changing provider to fal",async()=>{
    const {d,r}=geminiFixture();const j=await enqueueProviderVideo(d.client,owner,project,r);await advanceProviderJob(d.client,owner,j.id,r);
    Object.assign(d.rows.video_provider_jobs[0],{provider_request_id:null,submission_state:"SUBMITTING"});await advanceProviderJob(d.client,owner,j.id,r);
    expect(d.rows.video_provider_jobs[0]).toMatchObject({provider:"gemini_omni_api",provider_request_id:"omni-existing-request"});expect(r.gemini.submit).toHaveBeenCalledOnce();
  });
  it.each(["fal","gemini"])("a prior %s request cannot be recovered as the other provider after a mode change",async(provider)=>{
    const {d,r}=geminiFixture();const j=await enqueueProviderVideo(d.client,owner,project,r);
    if(provider==="fal")d.rows.generation_budget_reservations.push({id:randomUUID(),owner_id:owner,logical_operation_key:`provider-router:${j.id}`,provider:"fal",model:FAL_MODEL_ENDPOINTS.LTX_23_FAST,reserved_usd:3,state:"RESERVED",provider_submission_state:"SUBMITTED",provider_request_id:"old-fal"});
    else{await advanceProviderJob(d.client,owner,j.id,r);Object.assign(d.rows.video_provider_jobs[0],{provider:null,provider_request_id:null,checkpoint:{},submission_state:"NOT_SENT",state:"QUEUED"});d.rows.video_provider_settings[0].config=providerSettingsSchema.parse({mode:"FAL_ONLY",maxCostUsd:3,dailyBudgetUsd:6,monthlyBudgetUsd:20});}
    await advanceProviderJob(d.client,owner,j.id,r);
    expect(d.rows.video_provider_jobs[0].state).toBe("RECONCILIATION_REQUIRED");expect(r.fal.poll).not.toHaveBeenCalled();expect(r.gemini.poll).not.toHaveBeenCalled();expect(r.fal.submit).not.toHaveBeenCalled();
    expect(r.gemini.submit).toHaveBeenCalledTimes(provider==="fal"?0:1);
  });
  it("confirmed failure stays failed and never falls back automatically",async()=>{
    const {d,r}=geminiFixture();r.gemini.poll=vi.fn(async()=>({status:"FAILED" as const}));const j=await enqueueProviderVideo(d.client,owner,project,r);
    await advanceProviderJob(d.client,owner,j.id,r);await advanceProviderJob(d.client,owner,j.id,r);await advanceProviderJob(d.client,owner,j.id,r);
    expect(d.rows.video_provider_jobs[0].state).toBe("FAILED");expect(r.gemini.submit).toHaveBeenCalledOnce();expect(r.fal.submit).not.toHaveBeenCalled();
  });
  it("SAFE execution disabled never calls either paid transport",async()=>{
    const {d,r}=geminiFixture();const j=await enqueueProviderVideo(d.client,owner,project,r);
    await advanceProviderJob(d.client,owner,j.id,{...r,enabled:false});expect(r.gemini.submit).not.toHaveBeenCalled();expect(r.fal.submit).not.toHaveBeenCalled();
  });
  it("polls with bounded backoff and an explicit recovery resumes only the same ID",async()=>{
    const {d,r}=geminiFixture();const j=await enqueueProviderVideo(d.client,owner,project,r);await advanceProviderJob(d.client,owner,j.id,r);
    r.gemini.poll=vi.fn(async()=>({status:"PENDING" as const}));await advanceProviderJob(d.client,owner,j.id,r);
    expect(Date.parse(String(d.rows.video_provider_jobs[0].next_retry_at))-Date.now()).toBeGreaterThan(5_000);
    Object.assign(d.rows.video_provider_jobs[0],{next_retry_at:null});(d.rows.video_provider_jobs[0].checkpoint as Row).polls=120;
    await advanceProviderJob(d.client,owner,j.id,r);expect(d.rows.video_provider_jobs[0].state).toBe("RECONCILIATION_REQUIRED");
    await resumeKnownProviderResult(d.client,owner,j.id);r.gemini.poll=vi.fn(async()=>({status:"COMPLETE" as const}));
    await advanceProviderJob(d.client,owner,j.id,r);expect(d.rows.video_provider_jobs[0].state).toBe("REVIEW_REQUIRED");expect(r.gemini.submit).toHaveBeenCalledOnce();
  });
  it("over-estimate usage pauses paid execution and never records an invoice",async()=>{
    const {d,r}=geminiFixture();const j=await enqueueProviderVideo(d.client,owner,project,r);await advanceProviderJob(d.client,owner,j.id,r);
    r.gemini.retrieve=vi.fn(async()=>({bytes:new Uint8Array([1,2,3]),costUsd:null,usageCostUsd:4,costBasis:"PROVIDER_USAGE_ESTIMATE" as const}));
    await advanceProviderJob(d.client,owner,j.id,r);
    expect(d.rows.video_provider_settings[0].config).toMatchObject({paidMode:false,paidFallback:false,mode:"GOOGLE_ONLY"});
    expect(d.rows.video_provider_jobs[0]).toMatchObject({state:"RECONCILIATION_REQUIRED",checkpoint:{usageCostUsd:4}});
    expect(d.rows.video_provider_jobs[0].actual_cost_usd).toBeUndefined();expect(d.rows.generation_budget_reservations[0].state).toBe("RESERVED");
  });
});
describe("durable provider service with transport fixtures (no real paid calls)",()=>{
  it("automatic recovery processes at most three jobs and respects daily reservation limit",async()=>{const d=database(),r=runtime(),sources=new Map<string,typeof source>();d.rows.video_provider_settings[0].config=providerSettingsSchema.parse({mode:"FAL_ONLY",maxCostUsd:.5,dailyBudgetUsd:2,monthlyBudgetUsd:10,autoRecovery:true});
    for(let i=0;i<21;i++){const id=randomUUID(),a=[account,project,product][i%3],s={...source,project:{id,tiktok_account_id:a},account:{id:a,is_mock:false},script:{...source.script,id:randomUUID()}};sources.set(id,s);r.source=vi.fn(async()=>s);await enqueueProviderVideo(d.client,owner,id,r);}
    r.source=vi.fn(async(_client:SupabaseClient,_owner:string,id:string)=>sources.get(id)!) as unknown as typeof r.source; r.fal.submit=vi.fn(async()=>({request_id:randomUUID()}));expect(await processProviderQueue(d.client,owner,r)).toEqual({processed:3});expect(r.fal.submit).toHaveBeenCalledTimes(3);expect(d.rows.video_provider_jobs).toHaveLength(21);
  });
  it("reconciles actual billed amount after delayed billing without buying again",async()=>{const d=database(),r=runtime(),j=await enqueueProviderVideo(d.client,owner,project,r);await advanceProviderJob(d.client,owner,j.id,r);await advanceProviderJob(d.client,owner,j.id,r);expect(d.rows.generation_budget_reservations[0].state).toBe("RESERVED");r.fal.billedCost=vi.fn(async()=>.4);await reconcileProviderBilling(d.client,owner,j.id,r);await reconcileProviderBilling(d.client,owner,j.id,r);expect(d.rows.video_provider_jobs[0].actual_cost_usd).toBe(.4);expect(d.rows.generation_budget_reservations[0]).toMatchObject({state:"SETTLED",actual_usd:.4});expect(r.fal.submit).toHaveBeenCalledOnce();expect(r.fal.billedCost).toHaveBeenCalledOnce();});
  it("an unexpected charge over quote blocks further paid jobs and records evidence",async()=>{const d=database(),r=runtime(),j=await enqueueProviderVideo(d.client,owner,project,r);await advanceProviderJob(d.client,owner,j.id,r);r.fal.billedCost=vi.fn(async()=>.8);await expect(reconcileProviderBilling(d.client,owner,j.id,r)).rejects.toThrow("BILLING_OVER_CAP");expect(d.rows.video_provider_settings[0].config).toMatchObject({mode:"GOOGLE_ONLY",paidFallback:false});expect(d.rows.video_provider_jobs[0].actual_cost_usd).toBe(.8);expect(d.rows.generation_budget_reservations[0].state).toBe("RESERVED");expect(r.fal.submit).toHaveBeenCalledOnce();});
  it("enqueues the same creative once and preserves account scope",async()=>{const d=database(),r=runtime();const a=await enqueueProviderVideo(d.client,owner,project,r),b=await enqueueProviderVideo(d.client,owner,project,r);expect(a.id).toBe(b.id);expect(d.rows.video_provider_jobs).toHaveLength(1);expect(d.rows.generation_jobs).toHaveLength(1);expect(d.rows.video_provider_jobs[0].tiktok_account_id).toBe(account);});
  it("requires feature enablement and a real account",async()=>{const d=database(),r=runtime();await expect(enqueueProviderVideo(d.client,owner,project,{...r,enabled:false})).rejects.toThrow("DISABLED");r.source=vi.fn(async()=>({...source,account:{id:account,is_mock:true}}));await expect(enqueueProviderVideo(d.client,owner,project,r)).rejects.toThrow("REAL_ACCOUNT_REQUIRED");expect(r.fal.submit).not.toHaveBeenCalled();});
  it("completes fal into review, leaves actual billing unknown, never duplicates",async()=>{const d=database(),r=runtime(),j=await enqueueProviderVideo(d.client,owner,project,r);await Promise.all([advanceProviderJob(d.client,owner,j.id,r),advanceProviderJob(d.client,owner,j.id,r)]);expect(r.fal.submit).toHaveBeenCalledOnce();await advanceProviderJob(d.client,owner,j.id,r);await advanceProviderJob(d.client,owner,j.id,r);expect(d.rows.video_provider_jobs[0].state).toBe("REVIEW_REQUIRED");expect(d.rows.video_provider_jobs[0].actual_cost_usd).toBeUndefined();expect(r.finalize).toHaveBeenCalledOnce();expect(d.rows.generation_budget_reservations[0].state).toBe("RESERVED");expect(r.fal.submit).toHaveBeenCalledOnce();});
  it("restores known request after worker restart and mode change",async()=>{const d=database(),r=runtime(),j=await enqueueProviderVideo(d.client,owner,project,r);await advanceProviderJob(d.client,owner,j.id,r);const second=runtime();d.rows.video_provider_settings[0].config=providerSettingsSchema.parse({mode:"GOOGLE_ONLY"});await advanceProviderJob(d.client,owner,j.id,second);expect(second.fal.submit).not.toHaveBeenCalled();expect(second.fal.poll).toHaveBeenCalledWith(expect.anything(),"same-request");expect(d.rows.video_provider_jobs[0].state).toBe("REVIEW_REQUIRED");});
  it("recovers accepted identity recorded in ledger before job checkpoint",async()=>{const d=database(),r=runtime(),j=await enqueueProviderVideo(d.client,owner,project,r);await advanceProviderJob(d.client,owner,j.id,r);Object.assign(d.rows.video_provider_jobs[0],{provider_request_id:null,submission_state:"SUBMITTING"});await advanceProviderJob(d.client,owner,j.id,r);expect(d.rows.video_provider_jobs[0].provider_request_id).toBe("same-request");expect(r.fal.submit).toHaveBeenCalledOnce();});
  it("lost submit response blocks retry and fallback",async()=>{const d=database(),r=runtime(),j=await enqueueProviderVideo(d.client,owner,project,r);r.fal.submit=vi.fn(async()=>{throw new Error("connection lost after sending");});await advanceProviderJob(d.client,owner,j.id,r);await advanceProviderJob(d.client,owner,j.id,r);expect(d.rows.video_provider_jobs[0].state).toBe("RECONCILIATION_REQUIRED");expect(r.fal.submit).toHaveBeenCalledOnce();expect(d.rows.generation_budget_reservations[0].state).toBe("RESERVED");});
  it("terminal provider failure settles conservatively without another paid attempt",async()=>{const d=database(),r=runtime(),j=await enqueueProviderVideo(d.client,owner,project,r);r.fal.poll=vi.fn(async()=>({status:"FAILED" as const})) as unknown as typeof r.fal.poll;await advanceProviderJob(d.client,owner,j.id,r);await advanceProviderJob(d.client,owner,j.id,r);await advanceProviderJob(d.client,owner,j.id,r);expect(d.rows.video_provider_jobs[0].state).toBe("FAILED");expect(r.fal.submit).toHaveBeenCalledOnce();expect(r.finalize).not.toHaveBeenCalled();});
  it("does not release another worker's reserved budget",async()=>{const d=database(),r=runtime(),j=await enqueueProviderVideo(d.client,owner,project,r);await advanceProviderJob(d.client,owner,j.id,r);await advanceProviderJob(d.client,randomUUID(),j.id,r);expect(r.fal.poll).not.toHaveBeenCalled();expect(d.rows.generation_budget_reservations[0].owner_id).toBe(owner);});
  it("API read error continues only known request",async()=>{const d=database(),r=runtime(),j=await enqueueProviderVideo(d.client,owner,project,r);await advanceProviderJob(d.client,owner,j.id,r);r.fal.poll=vi.fn(async()=>{throw new Error("read error");});await advanceProviderJob(d.client,owner,j.id,r);expect(d.rows.video_provider_jobs[0].state).toBe("PROCESSING");expect(r.fal.submit).toHaveBeenCalledOnce();});
  it("poll timeout parks, explicit observation resumes the same request",async()=>{const d=database(),r=runtime(),j=await enqueueProviderVideo(d.client,owner,project,r);await advanceProviderJob(d.client,owner,j.id,r);(d.rows.video_provider_jobs[0].checkpoint as Row).polls=120;await advanceProviderJob(d.client,owner,j.id,r);expect(d.rows.video_provider_jobs[0].state).toBe("RECONCILIATION_REQUIRED");await resumeKnownProviderResult(d.client,owner,j.id);await advanceProviderJob(d.client,owner,j.id,r);expect(d.rows.video_provider_jobs[0].state).toBe("REVIEW_REQUIRED");expect(r.fal.submit).toHaveBeenCalledOnce();});
  it("a crash after source persistence settles the old hold and never downloads/buys again",async()=>{const d=database(),r=runtime(),j=await enqueueProviderVideo(d.client,owner,project,r);await advanceProviderJob(d.client,owner,j.id,r);const path=`owner/${owner}/masters/${j.id}/routed-source.mp4`;d.files.set(path,new Blob(["stored fixture"]));(d.rows.video_provider_jobs[0].checkpoint as Row).sourcePath=path;await advanceProviderJob(d.client,owner,j.id,r);expect(r.fal.submit).toHaveBeenCalledOnce();expect(r.fal.retrieve).not.toHaveBeenCalled();expect(d.rows.generation_budget_reservations[0].state).toBe("RESERVED");});
  it("daily guard rejects a concurrent account when combined reservations exceed cap",async()=>{const d=database(),r=runtime();const first=await enqueueProviderVideo(d.client,owner,project,r);d.rows.video_provider_settings[0].config=providerSettingsSchema.parse({mode:"FAL_ONLY",maxCostUsd:.5,dailyBudgetUsd:.5,monthlyBudgetUsd:1});await advanceProviderJob(d.client,owner,first.id,r);const secondSource={...source,project:{id:randomUUID(),tiktok_account_id:randomUUID()},account:{id:randomUUID(),is_mock:false},script:{...source.script,id:randomUUID()}};secondSource.project.tiktok_account_id=secondSource.account.id;r.source=vi.fn(async()=>secondSource);const next=await enqueueProviderVideo(d.client,owner,String(secondSource.project.id),r);await advanceProviderJob(d.client,owner,next.id,r);expect(r.fal.submit).toHaveBeenCalledOnce();expect(d.rows.video_provider_jobs[1].state).toBe("WAITING_PROVIDER");});
  it("default Google assisted and SAFE disabled execution never touch paid transport",async()=>{const d=database(),r=runtime();d.rows.video_provider_settings[0].config=providerSettingsSchema.parse({});const j=await enqueueProviderVideo(d.client,owner,project,r);await advanceProviderJob(d.client,owner,j.id,r);expect(d.rows.video_provider_jobs[0].state).toBe("WAITING_ASSISTED");expect(r.fal.prepare).not.toHaveBeenCalled();expect(r.fal.submit).not.toHaveBeenCalled();expect(await processProviderQueue(d.client,owner,{...r,enabled:false})).toEqual({processed:0});});
  it("accepts assisted MP4 into existing master boundary without claiming verified Google generation",async()=>{const d=database(),r=runtime();d.rows.video_provider_settings[0].config=providerSettingsSchema.parse({});const j=await enqueueProviderVideo(d.client,owner,project,r);await advanceProviderJob(d.client,owner,j.id,r);Object.assign(d.rows.video_provider_jobs[0],{submission_state:"EXTERNAL_PENDING"});d.files.set(`owner/${owner}/masters/${j.id}/google-assisted.mp4`,new Blob(["fixture, not real Google output"]));await completeProviderImport(d.client,owner,j.id,r);expect(d.rows.video_provider_jobs[0].state).toBe("REVIEW_REQUIRED");expect(r.fal.submit).not.toHaveBeenCalled();expect(r.finalize).toHaveBeenCalledOnce();});
});
