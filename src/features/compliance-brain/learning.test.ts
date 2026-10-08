import {describe,expect,it,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
vi.mock("server-only",()=>({}));
import {ComplianceLearning,complianceAllowsOptimization,persistLearningPattern,recordComplianceFeedback} from "./learning";
import type {LearningObservation} from "./learning";
const admin={id:"11111111-1111-4111-8111-111111111111",app_metadata:{viralflow_role:"admin"}};
const observation=(extra:Partial<LearningObservation>={}):LearningObservation=>({eventId:"warning-1",ownerId:"tenant-1",eventType:"violation",policyVersion:"TH-1",
  semanticCategory:"GUARANTEED_RESULT",category:"SKINCARE",country:"TH",platform:"TIKTOK_SHOP",channel:"POST",riskScore:85,source:"OFFICIAL_PLATFORM",...extra});
describe("private compliance learning",()=>{
  it("never turns one violation into an enforced global block",()=>{
    const learning=new ComplianceLearning(),pattern=learning.aggregate([observation()])[0];
    expect(pattern.lifecycle).toBe("OBSERVED");
    expect(()=>learning.approve(pattern,admin)).toThrow("insufficient_validation");
    expect(()=>learning.enforce(pattern,admin)).toThrow("not_verified");
  });
  it("makes multi-tenant candidates shadow-only until trusted approval",()=>{
    const learning=new ComplianceLearning(),events=Array.from({length:25},(_,index)=>observation({eventId:`v-${index}`,ownerId:`tenant-${index%5}`,shadowDecision:index%2?"AUTO_REWRITE":"BLOCK"}));
    const shadow=learning.aggregate(events)[0];
    expect(shadow).toMatchObject({lifecycle:"SHADOW",sampleCount:25,tenantCount:5,shadowWouldBlock:13,shadowWouldRewrite:12});
    expect(()=>learning.approve(shadow,{id:admin.id,app_metadata:{viralflow_role:"member"}})).toThrow("admin_required");
    expect(learning.enforce(learning.approve(shadow,admin),admin).lifecycle).toBe("ENFORCED");
  });
  it("appeal acceptance raises false-positive evidence and lowers confidence/risk; rejection adds distinct evidence",()=>{
    const learning=new ComplianceLearning();
    const initial=learning.aggregate([observation()])[0];
    const accepted=learning.aggregate([observation(),observation({eventId:"appeal",eventType:"appeal_accepted"})])[0];
    const rejected=learning.aggregate([observation(),observation({eventId:"appeal",eventType:"appeal_rejected"})])[0];
    expect(accepted.appealAcceptedCount).toBe(1);expect(accepted.falsePositiveRate).toBe(0.5);
    expect(accepted.riskScore).toBeLessThan(initial.riskScore);expect(rejected.riskScore).toBeGreaterThan(initial.riskScore);
    expect(accepted.confidence).toBeLessThan(rejected.confidence);
  });
  it("drops unverified platform outcomes, deduplicates events, and ignores publication/sales optimization signals",()=>{
    const learning=new ComplianceLearning();
    const patterns=learning.aggregate([observation(),observation(),observation({eventId:"fake",source:"HUMAN_CORRECTION"}),observation({eventId:"published",eventType:"publish",riskScore:0})]);
    expect(patterns[0].sampleCount).toBe(1);
    expect(learning.aggregate([observation({eventType:"publish"})])).toEqual([]);
  });
  it("preserves two semantic groups from the same private event while deduplicating each group",()=>{
    const patterns=new ComplianceLearning().aggregate([observation(),observation(),observation({semanticCategory:"TIME_BOUND_RESULT"})]);
    expect(patterns.map(pattern=>[pattern.semanticCategory,pattern.sampleCount])).toEqual([["GUARANTEED_RESULT",1],["TIME_BOUND_RESULT",1]]);
  });
  it("has no customer identifiers or raw text in the global DTO or persisted RPC even if inputs have extra fields",async()=>{
    const raw=Object.assign(observation(),{script:"customer secret",accountId:"secret-account",productSecret:"secret-product",sales:999,email:"private@example.test"});
    const pattern=new ComplianceLearning().aggregate([raw])[0];
    const rpc=vi.fn(async()=>({data:"pattern-id",error:null}));
    await persistLearningPattern({rpc} as unknown as SupabaseClient,pattern);
    const serialized=JSON.stringify({pattern,call:rpc.mock.calls});
    for(const secret of ["tenant-1","warning-1","customer secret","secret-account","secret-product","private@example.test","sales"]){expect(serialized).not.toContain(secret)}
  });
  it("stores platform reason text only with owner-isolated private feedback",async()=>{
    const rpc=vi.fn(async()=>({data:"feedback-id",error:null}));
    const query={eq:()=>query,maybeSingle:async()=>({data:{id:admin.id,owner_id:admin.id,policy_version:null},error:null})};
    await recordComplianceFeedback({rpc,from:()=>({select:()=>query})} as unknown as SupabaseClient,
      {ownerId:admin.id,decisionId:admin.id,eventKey:"appeal-accepted",eventType:"appeal_accepted",source:"OFFICIAL_PLATFORM",
        platformReasonCode:"APPEAL_ACCEPTED",platformReasonText:"Official adjudication",platformEvidenceRef:"https://seller-th.tiktok.com/notice/appeal"},admin);
    expect(rpc).toHaveBeenCalledWith("append_compliance_brain_feedback",{p_feedback:expect.objectContaining({owner_id:admin.id,event_type:"appeal_accepted",platform_reason_text:"Official adjudication"})});
  });
  it("allows optimization only after compliance permits the content",()=>{
    expect(["PASS","PASS_WITH_WARNING","AUTO_REWRITE","REVIEW_REQUIRED","BLOCK",null,undefined].map(status=>complianceAllowsOptimization(status as never)))
      .toEqual([true,true,false,false,false,false,false]);
  });
  it("keeps an approval actor only in private audits, never the global pattern",async()=>{
    const learning=new ComplianceLearning(),shadow=learning.aggregate(Array.from({length:25},(_,index)=>observation({eventId:`v-${index}`,ownerId:`tenant-${index%5}`})))[0];
    const approved=learning.approve(shadow,admin),rpc=vi.fn(async()=>({data:"pattern-id",error:null}));
    expect(JSON.stringify(approved)).not.toContain(admin.id);
    await expect(persistLearningPattern({rpc} as unknown as SupabaseClient,approved)).rejects.toThrow("admin_required");
    await persistLearningPattern({rpc} as unknown as SupabaseClient,approved,admin);
    expect(rpc).toHaveBeenCalledWith("upsert_compliance_brain_learning_pattern",{p_actor:admin.id,p_pattern:expect.objectContaining({approved:true})});
  });
});
