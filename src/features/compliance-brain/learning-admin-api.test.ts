import {describe,expect,it,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
vi.mock("server-only",()=>({}));
import {createLearningAdminHandler} from "./learning-admin-api";
import {recordComplianceFeedback} from "./learning";

const owner="11111111-1111-4111-8111-111111111111",decision="22222222-2222-4222-8222-222222222222";
const actor={id:owner,app_metadata:{viralflow_role:"admin"}},origin="https://app.example";
const request=(value:unknown,requestOrigin=origin)=>new Request(`${origin}/api/compliance-brain/admin/learning`,{
  method:"POST",headers:{origin:requestOrigin,"content-type":"application/json"},body:JSON.stringify(value)});
function setup() {
  const rpc=vi.fn(async(name:string)=>({data:name==="read_compliance_brain_learning_observations"
    ?{snapshot_at:"2026-10-07T02:00:00Z",complete:true,observations:[]}:decision,error:null}));
  const query={eq:()=>query,maybeSingle:async()=>({data:{id:decision,owner_id:owner,policy_version:null},error:null})};
  const adminClient=vi.fn(()=>({rpc,from:()=>({select:()=>query})}) as unknown as SupabaseClient);
  const rateLimit=vi.fn(async()=>{});
  return {rpc,adminClient,rateLimit,handler:createLearningAdminHandler({authenticate:async()=>actor,adminClient,rateLimit})};
}

describe("internal learning intake boundaries",()=>{
  it("does not construct a privileged client for a signed-out user, member, or user-editable admin role",async()=>{
    const adminClient=vi.fn(),rateLimit=vi.fn(async()=>{});
    for(const identity of [null,{id:owner,app_metadata:{viralflow_role:"member"}},
      {id:owner,user_metadata:{viralflow_role:"admin"}}]) {
      const handler=createLearningAdminHandler({authenticate:async()=>identity,adminClient,rateLimit});
      expect((await handler(request({action:"refresh",policyVersion:"TH-1"}))).status).toBe(403);
    }
    expect(adminClient).not.toHaveBeenCalled();expect(rateLimit).not.toHaveBeenCalled();
  });
  it("rejects cross-origin requests before privileged work",async()=>{
    const f=setup();expect((await f.handler(request({action:"refresh",policyVersion:"TH-1"},"https://other.example"))).status).toBe(403);
    expect(f.rateLimit).not.toHaveBeenCalled();expect(f.adminClient).not.toHaveBeenCalled();
  });
  it("maps a human correction to a server-owned source and the existing immutable decision",async()=>{
    const f=setup();const response=await f.handler(request({action:"human_correction",ownerId:owner,decisionId:decision,eventKey:"review-1"}));
    expect(response.status).toBe(200);
    expect(f.rpc).toHaveBeenCalledWith("append_compliance_brain_feedback",{p_feedback:expect.objectContaining({
      owner_id:owner,decision_id:decision,event_type:"human_edit",source:"HUMAN_CORRECTION",platform_evidence_ref:null})});
  });
  it("rejects any client attempt to supply source, verified decision, policy version, or risk mapping",async()=>{
    const f=setup();
    for(const extra of [{source:"OFFICIAL_PLATFORM"},{verifiedDecision:true},{riskScore:100},{policyVersion:"TH-1"},{semanticCategory:"MEDICAL_TREATMENT"}]) {
      expect((await f.handler(request({action:"human_correction",ownerId:owner,decisionId:decision,eventKey:"review-1",...extra}))).status).toBe(400);
    }
    expect(f.adminClient).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();
  });
  it("requires a trusted admin and an official dashboard notice reference for manually imported platform evidence",async()=>{
    const f=setup(),notice={action:"platform_notice",ownerId:owner,decisionId:decision,eventKey:"appeal-1",eventType:"appeal_accepted",
      platformReasonCode:"ACCEPTED",platformReasonText:"private notice details"};
    for(const reference of [undefined,"http://seller-th.tiktok.com/notice/1","https://tiktok.com.evil.example/1",
      "https://admin:password@seller-th.tiktok.com/notice/1"]) {
      expect((await f.handler(request({...notice,...(reference?{platformEvidenceRef:reference}:{})}))).status).toBe(400);
    }
    expect(f.adminClient).not.toHaveBeenCalled();
    const response=await f.handler(request({...notice,platformEvidenceRef:"https://seller-th.tiktok.com/notice/1"}));
    expect(response.status).toBe(200);
    expect(f.rpc).toHaveBeenCalledWith("append_compliance_brain_feedback",{p_feedback:expect.objectContaining({
      source:"OFFICIAL_PLATFORM",platform_evidence_ref:"https://seller-th.tiktok.com/notice/1",platform_reason_text:"private notice details"})});
    expect(JSON.stringify(await response.json())).not.toContain("private notice details");
  });
  it("performs a rate-limited internal policy refresh without accepting lifecycle/approval mutations",async()=>{
    const f=setup();const response=await f.handler(request({action:"refresh",policyVersion:"TH-1"}));
    expect(response.status).toBe(200);expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(f.rateLimit).toHaveBeenCalledWith(owner);
    expect(f.rpc).toHaveBeenCalledWith("read_compliance_brain_learning_observations",{p_policy_version:"TH-1",p_limit:5000});
    for(const extra of [{approved:true},{lifecycle:"ENFORCED"},{signedPolicyPack:{untrusted:true}}]) {
      expect((await f.handler(request({action:"refresh",policyVersion:"TH-1",...extra}))).status).toBe(400);
    }
  });
  it("rejects direct untrusted official or invalid system feedback before persistence",async()=>{
    const rpc=vi.fn(),client={rpc} as unknown as SupabaseClient;
    await expect(recordComplianceFeedback(client,{ownerId:owner,decisionId:decision,eventKey:"fake-1",eventType:"violation",
      source:"OFFICIAL_PLATFORM",platformEvidenceRef:"https://seller-th.tiktok.com/notice/1"})).rejects.toThrow("admin_required");
    await expect(recordComplianceFeedback(client,{ownerId:owner,decisionId:decision,eventKey:"fake-2",eventType:"violation",source:"SYSTEM"})).rejects.toThrow("source_invalid");
    await expect(recordComplianceFeedback(client,{ownerId:owner,decisionId:decision,eventKey:"fake-3",eventType:"violation",
      source:"OFFICIAL_PLATFORM",platformEvidenceRef:"https://example.test/notice"},actor)).rejects.toThrow("source_invalid");
    expect(rpc).not.toHaveBeenCalled();
  });
});
