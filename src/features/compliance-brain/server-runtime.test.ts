import {createHash} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
const boundary=vi.hoisted(()=>({admin:vi.fn(),creator:vi.fn(),token:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:boundary.admin}));
vi.mock("@/lib/server-env",()=>({serverEnv:{tiktokAllowedPullHosts:[],tiktokAllowedUploadHosts:[],opsLogLevel:"ERROR"}}));
vi.mock("@/features/tiktok/services",()=>({TikTokCreatorService:class{queryCreatorInfo=boundary.creator},TikTokTokenService:class{getAccessToken=boundary.token}}));
import {checkFinalMedia,commerceScope,currentVerifiedPolicy,generationConstraints} from "./server-runtime";
import {createSignedPolicyTestFixture} from "./policy-test-fixtures";
import {TikTokPublishingService} from "../publishing/services";
import {OfficialTikTokPublishingProvider,type TikTokPublishingProvider} from "../publishing/provider";
import {consentHash} from "../publishing/state";
import {createAutoExecutionPorts} from "../auto/execution-ports";
import type {ExecutionClaim} from "../auto/processor";

type Row=Record<string,unknown>;
const owner="11111111-1111-4111-8111-111111111111",product="22222222-2222-4222-8222-222222222222",account="33333333-3333-4333-8333-333333333333";
const video="44444444-4444-4444-8444-444444444444",project="55555555-5555-4555-8555-555555555555",script="66666666-6666-4666-8666-666666666666";
const evidence="77777777-7777-4777-8777-777777777777",claim="88888888-8888-4888-8888-888888888888",queue="99999999-9999-4999-8999-999999999999";
const scope=commerceScope(owner,product,account,"SKINCARE"),path=`owner/${owner}/masters/${video}/master.mp4`;
class Query{
  private filters:Array<(row:Row)=>boolean>=[];private cap=1000;private descending:string|null=null;private write:Row|Row[]|null=null;
  constructor(private rows:Record<string,Row[]>,private table:string,private failure:()=>boolean){}
  select(){return this}eq(key:string,value:unknown){this.filters.push(row=>row[key]===value);return this}
  in(key:string,values:unknown[]){this.filters.push(row=>values.includes(row[key]));return this}
  lte(key:string,value:string){this.filters.push(row=>String(row[key])<=value);return this}
  gte(){return this}neq(){return this}or(){return this}
  order(key:string,options?:{ascending?:boolean}){if(options?.ascending===false)this.descending=key;return this}
  limit(count:number){this.cap=count;return this}insert(value:Row|Row[]){this.write=value;return this}upsert(value:Row){this.write=value;return this}
  private result(single:boolean){
    if(this.table==="compliance_brain_policy_versions"&&this.failure())return{data:null,error:{message:"transport"}};
    if(this.write){this.rows[this.table]??=[];this.rows[this.table].push(...(Array.isArray(this.write)?this.write:[this.write])
      .map(row=>({created_at:new Date().toISOString(),...row})));}
    let rows=(this.rows[this.table]??[]).filter(row=>this.filters.every(filter=>filter(row)));
    if(this.descending)rows=rows.toSorted((a,b)=>String(b[this.descending!]).localeCompare(String(a[this.descending!])));
    rows=rows.slice(0,this.cap);return{data:single?rows[0]??null:rows,error:null,count:rows.length};
  }
  maybeSingle(){return Promise.resolve(this.result(true))}single(){return this.maybeSingle()}
  then(resolve:(value:unknown)=>unknown,reject?:(error:unknown)=>unknown){return Promise.resolve(this.result(false)).then(resolve,reject)}
}
function fixture(){
  const signed=createSignedPolicyTestFixture();
  vi.stubEnv("COMPLIANCE_POLICY_PUBLIC_KEYS_JSON",JSON.stringify(Object.fromEntries(Object.entries(signed.trustedKeys)
    .map(([id,key])=>[id,key.export({format:"pem",type:"spki"}).toString()]))));
  const bytes=new Uint8Array([1,2,3,4]),assetHash=createHash("sha256").update(bytes).digest("hex");
  const rows:Record<string,Row[]>={
    compliance_brain_policy_versions:[{version:signed.payload.version,region:"TH",platform:"TIKTOK_SHOP",country:"TH",status:"ACTIVE",
      effective_at:"2026-01-01T00:00:00Z",activated_at:"2026-10-07T01:00:00Z",pack_json:signed.signed,checksum:signed.signed.checksum,signature:signed.signed.signature}],
    compliance_brain_claims:[{id:claim,owner_id:owner,product_id:product,claim_text:"ช่วยเพิ่มความชุ่มชื้น",claim_type:"COSMETIC",source:"verified label",
      evidence_refs:[evidence],jurisdiction:"TH",expires_at:null,verified:true,allowed_channels:["POST","LIVE"],conditions:[],aliases:[]}],
    compliance_brain_evidence:[{id:evidence,owner_id:owner,product_id:product,kind:"MEDIA_REVIEW",source_url:"https://example.test/review",
      source_hash:assetHash,jurisdiction:"TH",verified:true,expires_at:null}],
    compliance_brain_media_reviews:[{owner_id:owner,product_id:product,account_id:account,asset_hash:assetHash,evidence_id:evidence,
      transcript:"ช่วยเพิ่มความชุ่มชื้น",on_screen_text:[],cover_text:"",visible_claims:[],metadata:[],ai_disclosed:true,coverage_complete:true,
      reviewed_at:"2026-10-07T01:00:00Z",expires_at:null}],
    products:[{id:product,owner_id:owner,title:"generic skincare",category_key:"SKINCARE"}],
    tiktok_accounts:[{id:account,owner_id:owner,display_name:"fixture",effective_mode:"GROWTH",mode:"AUTO",authorization_status:"authorized",
      account_status:"active",daily_post_target:5,daily_post_hard_limit:10,ecommerce_permission:false,cart_enabled:false}],
    scripts:[{id:script,owner_id:owner,hook_text:"ช่วยเพิ่มความชุ่มชื้น",voice_script:"ช่วยเพิ่มความชุ่มชื้น",cta_text:"ตรวจสอบข้อมูลสินค้า",
      caption:"ช่วยเพิ่มความชุ่มชื้น",hashtags_json:[],overlay_text_json:[],scene_plan_json:[],status:"SELECTED"}],
    creative_projects:[{id:project,owner_id:owner,product_id:product,tiktok_account_id:account,mode:"GROWTH"}],
    creative_angles:[{owner_id:owner,creative_project_id:project,policy_status:"SAFE",is_selected:true}],
    master_videos:[{id:video,owner_id:owner,product_id:product,tiktok_account_id:account,creative_project_id:project,selected_script_id:script,
      storage_path:path,quality_status:"PASS",duration_seconds:8,fps:30,provider:"fixture"}],
    media_assets:[{owner_id:owner,product_id:product,storage_path:path,asset_type:"VIDEO",mime_type:"video/mp4"}],
    publishing_queue:[{id:queue,owner_id:owner,tiktok_account_id:account,video_id:video,video_kind:"MASTER",publish_mode:"DIRECT_POST",
      status:"QUEUED",source_method:"FILE_UPLOAD",caption_snapshot:"รักษาสิวหายขาด",is_aigc:true,provider_publish_id:null}],
    video_variations:[],account_daily_stats:[],account_publish_health:[],
  };
  let policyFailure=false,auditFailure=false,learningFailure=false,changedBytes=false;
  let learningRows:Row[]=[];
  const rpc=vi.fn(async(name:string,args:Record<string,Row>)=>{
    if(auditFailure)return{data:null,error:{message:"unavailable"}};
    if(name==="read_compliance_brain_learning_observations")return learningFailure
      ?{data:null,error:{message:"private learning upstream details"}}
      :{data:{snapshot_at:new Date().toISOString(),complete:true,observations:learningRows},error:null};
    return{data:name==="record_compliance_brain_decision"?args.p_decision.id:claim,error:null};
  });
  const download=vi.fn(async()=>({data:new Blob([changedBytes?new Uint8Array([9]):bytes]),error:null}));
  const admin={from:(table:string)=>new Query(rows,table,()=>policyFailure),rpc,
    storage:{from:()=>({download})}} as unknown as SupabaseClient;
  boundary.admin.mockReturnValue(admin);
  return{rows,admin,rpc,download,setPolicyFailure:(value:boolean)=>policyFailure=value,setAuditFailure:(value:boolean)=>auditFailure=value,
    setLearningFailure:(value:boolean)=>learningFailure=value,setLearningRows:(value:Row[])=>learningRows=value,
    setChangedBytes:(value:boolean)=>changedBytes=value};
}
describe("production POST uses shared compliance with trusted database/network boundaries",()=>{
  beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-07T02:00:00Z"));boundary.creator.mockResolvedValue({});boundary.token.mockResolvedValue("unit-test-token");});
  afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();vi.clearAllMocks();});
  it("provides current grounded constraints before generation",async()=>{
    const f=fixture();expect((await generationConstraints(f.admin,scope)).allowedClaims[0].text).toBe("ช่วยเพิ่มความชุ่มชื้น");
    f.rows.compliance_brain_claims=[];await expect(generationConstraints(f.admin,scope)).rejects.toThrow("compliance_review_required");
  });
  it("persisted decision plus actual verified media can pass",async()=>{
    const f=fixture();expect((await checkFinalMedia(f.admin,scope,path,{caption:"ช่วยเพิ่มความชุ่มชื้น"})).status).toBe("PASS");
    expect(f.rpc.mock.calls.some(([name])=>name==="record_compliance_brain_decision")).toBe(true);
  });
  it("refreshes and persists anonymous shadow learning only after the immutable decision is recorded",async()=>{
    const f=fixture(),uuid=(index:number)=>`00000000-0000-4000-8000-${index.toString().padStart(12,"0")}`;
    const version=String(f.rows.compliance_brain_policy_versions[0].version);
    f.setLearningRows(Array.from({length:10},(_,index)=>({event_id:uuid(index+1),decision_id:uuid(index+20),
      owner_id:uuid(100+index%5),event_type:"compliance_flag",source:"SYSTEM",policy_version:version,
      semantic_categories:["GUARANTEED_RESULT"],category:"SKINCARE",country:"TH",platform:"TIKTOK_SHOP",channel:"POST",
      risk_score:85,decision:"BLOCK",observed_at:"2026-10-07T01:00:00Z"})));
    const decision=await checkFinalMedia(f.admin,scope,path,{caption:"ช่วยเพิ่มความชุ่มชื้น"});
    expect(decision.status).toBe("PASS");
    const names=f.rpc.mock.calls.map(([name])=>name);
    expect(names).toEqual(["record_compliance_brain_decision","read_compliance_brain_learning_observations",
      "upsert_compliance_brain_learning_pattern"]);
    expect(f.rpc).toHaveBeenCalledWith("read_compliance_brain_learning_observations",{p_policy_version:version,p_limit:5000});
    expect(f.rpc).toHaveBeenCalledWith("upsert_compliance_brain_learning_pattern",{p_actor:null,p_pattern:expect.objectContaining({
      sample_count:10,tenant_count:5,lifecycle:"SHADOW",approved:false,shadow_would_block:10,shadow_evaluated_count:10,
      observed_at:"2026-10-07T02:00:00.000Z"})});
    const audited=f.rpc.mock.calls[0][1].p_decision;
    expect({id:decision.id,status:decision.status,riskScore:decision.riskScore,policyVersion:decision.policyVersion,
      reasons:decision.reasons}).toEqual({id:audited.id,status:audited.decision,riskScore:audited.risk_score,
      policyVersion:audited.policy_version,reasons:audited.reasons});
    expect(JSON.stringify(f.rpc.mock.calls[2])).not.toContain(uuid(100));
  });
  it.each(["PASS","BLOCK","REVIEW_REQUIRED"] as const)("a learning refresh failure cannot change an audited %s verdict",async(status)=>{
    const f=fixture();f.setLearningFailure(true);
    if(status==="REVIEW_REQUIRED")f.rows.compliance_brain_media_reviews=[];
    const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
    try {
      const decision=await checkFinalMedia(f.admin,scope,path,{caption:status==="BLOCK"?"รักษาสิวหายขาด":"ช่วยเพิ่มความชุ่มชื้น"});
      expect(decision.status).toBe(status);
      expect(f.rpc.mock.calls.map(([name])=>name)).toEqual(["record_compliance_brain_decision","read_compliance_brain_learning_observations"]);
      const audited=f.rpc.mock.calls[0][1].p_decision;
      expect({id:decision.id,status:decision.status,riskScore:decision.riskScore,reasons:decision.reasons})
        .toEqual({id:audited.id,status:audited.decision,riskScore:audited.risk_score,reasons:audited.reasons});
      expect(decision.reasons.some(reason=>reason.code==="AUDIT_UNAVAILABLE")).toBe(false);
      expect(JSON.stringify(warn.mock.calls)).toContain("learning_refresh_pending");
      expect(JSON.stringify(warn.mock.calls)).not.toContain("private learning upstream details");
    } finally {warn.mockRestore();}
  });
  it("missing actual media coverage and byte replacement cannot use intended script as transcript",async()=>{
    const f=fixture();f.setChangedBytes(true);expect((await checkFinalMedia(f.admin,scope,path,{script:"ช่วยเพิ่มความชุ่มชื้น"})).status).toBe("REVIEW_REQUIRED");
    f.setChangedBytes(false);f.rows.compliance_brain_media_reviews=[];
    expect((await checkFinalMedia(f.admin,scope,path,{script:"ช่วยเพิ่มความชุ่มชื้น"})).status).toBe("REVIEW_REQUIRED");
  });
  it("failed immutable audit cannot release a safe clip",async()=>{
    const f=fixture();f.setAuditFailure(true);expect((await checkFinalMedia(f.admin,scope,path,{caption:"ช่วยเพิ่มความชุ่มชื้น"})).status).toBe("REVIEW_REQUIRED");
    expect(f.rpc.mock.calls.map(([name])=>name)).toEqual(["record_compliance_brain_decision"]);
  });
  it("binds final review to the exact upload Blob, and cannot certify a mutable pull URL",async()=>{
    const f=fixture(),original=new Blob([new Uint8Array([1,2,3,4])]);f.setChangedBytes(true);
    expect((await checkFinalMedia(f.admin,scope,path,{caption:"ช่วยเพิ่มความชุ่มชื้น"},"FINAL_PUBLISH",true,original)).status).toBe("PASS");
    expect(f.download).not.toHaveBeenCalled();
    expect((await checkFinalMedia(f.admin,scope,path,{caption:"ช่วยเพิ่มความชุ่มชื้น"},"FINAL_PUBLISH",true,new Blob([new Uint8Array([9])]))).status).toBe("REVIEW_REQUIRED");
    expect((await checkFinalMedia(f.admin,scope,path,{caption:"ช่วยเพิ่มความชุ่มชื้น"},"FINAL_PUBLISH",true,null)).status).toBe("REVIEW_REQUIRED");
    expect(f.download).not.toHaveBeenCalled();
  });
  it("cannot read another owner's storage through the admin media gate",async()=>{
    const f=fixture();const download=vi.spyOn(f.admin.storage,"from");
    expect((await checkFinalMedia(f.admin,scope,"owner/other/masters/video.mp4",{script:"ช่วยเพิ่มความชุ่มชื้น"})).status).toBe("REVIEW_REQUIRED");
    expect(download).not.toHaveBeenCalled();
  });
  it("signed LKG survives transport failure, explicit retirement and revoked trust cannot pass",async()=>{
    const f=fixture();expect(await currentVerifiedPolicy(f.admin,scope)).not.toBeNull();f.setPolicyFailure(true);
    expect(await currentVerifiedPolicy(f.admin,scope)).not.toBeNull();vi.stubEnv("COMPLIANCE_POLICY_PUBLIC_KEYS_JSON","{}");
    expect(await currentVerifiedPolicy(f.admin,scope)).toBeNull();
    f.setPolicyFailure(false);f.rows.compliance_brain_policy_versions=[];expect(await currentVerifiedPolicy(f.admin,scope)).toBeNull();
  });
  it("expired outage lease and a backwards clock cannot authorize stale policy",async()=>{
    const f=fixture();expect(await currentVerifiedPolicy(f.admin,scope)).not.toBeNull();f.setPolicyFailure(true);
    vi.advanceTimersByTime(59_999);expect(await currentVerifiedPolicy(f.admin,scope)).not.toBeNull();
    vi.advanceTimersByTime(1);expect(await currentVerifiedPolicy(f.admin,scope)).toBeNull();
    f.setPolicyFailure(false);expect(await currentVerifiedPolicy(f.admin,scope)).not.toBeNull();f.setPolicyFailure(true);
    vi.setSystemTime(new Date("2026-10-07T01:00:00Z"));expect(await currentVerifiedPolicy(f.admin,scope)).toBeNull();
  });
  it("a slow policy response cannot mint a new outage lease for old authority",async()=>{
    const f=fixture(),start=Date.now(),clock=vi.spyOn(Date,"now").mockReturnValueOnce(start).mockReturnValue(start+60_000);
    try{expect(await currentVerifiedPolicy(f.admin,scope)).toBeNull();}
    finally{clock.mockRestore();}
    f.setPolicyFailure(true);expect(await currentVerifiedPolicy(f.admin,scope)).toBeNull();
  });
  it.each(["DIRECT_POST","DRAFT_UPLOAD"])("real publishing orchestration refuses unsafe queued caption before %s network submission",async(mode)=>{
    const f=fixture();f.rows.publishing_queue[0].publish_mode=mode;
    const provider={directPost:vi.fn(),uploadDraft:vi.fn()} as unknown as TikTokPublishingProvider;
    const service=new TikTokPublishingService(f.admin,provider);
    const result=mode==="DIRECT_POST"?service.directPost(owner,queue):service.uploadDraft(owner,queue);
    await expect(result).rejects.toThrow(/phase_6c_/);
    expect(f.download).toHaveBeenCalledTimes(1);
    expect(provider.directPost).not.toHaveBeenCalled();expect(provider.uploadDraft).not.toHaveBeenCalled();
    expect(f.rpc.mock.calls.some(([name,args])=>name==="record_compliance_brain_decision"&&args.p_decision.decision==="BLOCK")).toBe(true);
  });
  it("publishing refuses changed upload bytes even with a safe script and old media attestation",async()=>{
    const f=fixture();f.rows.publishing_queue[0].caption_snapshot="ช่วยเพิ่มความชุ่มชื้น";f.setChangedBytes(true);
    const provider={directPost:vi.fn(),uploadDraft:vi.fn()} as unknown as TikTokPublishingProvider;
    await expect(new TikTokPublishingService(f.admin,provider).directPost(owner,queue)).rejects.toThrow(/phase_6c_/);
    expect(f.download).toHaveBeenCalledTimes(1);expect(provider.directPost).not.toHaveBeenCalled();
    expect(f.rpc.mock.calls.some(([name,args])=>name==="record_compliance_brain_decision"&&args.p_decision.decision==="REVIEW_REQUIRED")).toBe(true);
  });
  it("AUTO/export re-evaluates cached eligibility against current policy",async()=>{
    const f=fixture();f.rows.compliance_brain_policy_versions=[];
    f.rows.auto_runs=[{id:queue,owner_id:owner,tiktok_account_id:account,posting_mode:"EXPORT"}];
    const old={owner_id:owner,video_id:video,tiktok_account_id:account,created_at:"2026-10-06T00:00:00Z"};
    f.rows.content_compliance_checks=[{...old,checked_at:old.created_at,overall_status:"PASS"}];
    f.rows.originality_checks=[{...old,originality_status:"ORIGINAL"}];f.rows.publish_eligibility_checks=[{...old,final_status:"READY_TO_PUBLISH"}];
    const result=await createAutoExecutionPorts(f.admin).COMPLIANCE_CHECK({ownerId:owner,accountId:account,runId:queue,
      postingMode:"EXPORT",mode:"GROWTH",itemIndex:1,dailyTarget:1,attempt:1,step:"COMPLIANCE_CHECK",
      leaseToken:claim,operationKey:"compliance-fixture",checkpoint:{videoId:video}} satisfies ExecutionClaim);
    expect(result).toMatchObject({kind:"WAIT",reason:"COMPLIANCE_REVIEW"});
    expect(f.rpc.mock.calls.some(([name,args])=>name==="record_compliance_brain_decision"&&args.p_decision.decision==="REVIEW_REQUIRED")).toBe(true);
  });
  it.each(["UNCHANGED","CLAIM_CHANGED","BEGIN_CHANGED"])("official adapter consumes only the checked snapshot: %s",async(change)=>{
    const f=fixture();const settings={caption:"ช่วยเพิ่มความชุ่มชื้น",privacyLevel:"SELF_ONLY",disableComment:true,
      disableDuet:true,disableStitch:true,isAigc:true,commercialContent:{}};
    const original={...f.rows.publishing_queue[0],caption_snapshot:settings.caption,privacy_level:settings.privacyLevel,
      disable_comment:true,disable_duet:true,disable_stitch:true,commercial_content_json:{},consent_id:claim,pull_from_url:null,
      retry_count:0,max_retries:0};
    f.rows.publishing_queue=[original];f.rows.publish_consents=[{id:claim,owner_id:owner,consent_hash:consentHash(settings)}];
    Object.assign(f.rows.tiktok_accounts[0],{audit_status:"UNAUDITED",granted_scopes:["user.info.basic","video.publish"],direct_post_status:"READY"});
    f.rpc.mockImplementation(async(name,args)=>{
      if(name==="record_compliance_brain_decision")return{data:args.p_decision.id,error:null};
      if(name==="claim_publish_operation")return{data:{claimed:true,leaseToken:claim,attemptId:evidence,
        queue:{...original,...(change==="CLAIM_CHANGED"?{caption_snapshot:"รักษาสิวหายขาด"}:{})}},error:null};
      if(name==="begin_publish_submission")return{data:{...original,...(change==="BEGIN_CHANGED"?{caption_snapshot:"รักษาสิวหายขาด"}:{})},error:null};
      if(name==="record_publish_submission")return{data:{...original,provider_publish_id:"test-publish",status:"PROCESSING"},error:null};
      if(name==="record_publish_failure"||name==="record_publish_unknown")return{data:{...original,status:"FAILED"},error:null};
      throw new Error(`unexpected fixture RPC ${name}`);
    });
    const uploaded:Uint8Array[]=[],request=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
      if(init?.method==="PUT"){uploaded.push(new Uint8Array(await (init.body as Blob).arrayBuffer()));return new Response(null,{status:200});}
      expect(String(url)).toBe("https://open.tiktokapis.com/v2/post/publish/video/init/");
      expect(JSON.parse(String(init?.body)).post_info.title).toBe(settings.caption);
      return Response.json({data:{publish_id:"test-publish",upload_url:"https://open-upload.tiktokapis.com/test"},error:{code:"ok"}});
    });
    const result=await new TikTokPublishingService(f.admin,new OfficialTikTokPublishingProvider(request as typeof fetch)).directPost(owner,queue);
    if(change==="UNCHANGED"){
      expect(result.status).toBe("PROCESSING");expect(request).toHaveBeenCalledTimes(2);expect([...uploaded[0]]).toEqual([1,2,3,4]);
    }else{
      expect(result.status).toBe("FAILED");expect(request).not.toHaveBeenCalled();
      expect(f.rpc.mock.calls.some(([name])=>name=== (change==="CLAIM_CHANGED"?"record_publish_failure":"record_publish_unknown"))).toBe(true);
    }
    expect(f.download).toHaveBeenCalledTimes(1);
  });
});
