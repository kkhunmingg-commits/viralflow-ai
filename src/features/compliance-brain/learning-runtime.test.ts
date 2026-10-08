import {describe,expect,it,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
vi.mock("server-only",()=>({}));
import {createLearningObservations,evaluateLearnedShadowCandidate,refreshComplianceLearning,refreshComplianceLearningForDecision,
  replayLearnedShadowCandidate} from "./learning-runtime";
import {ComplianceLearning,recordComplianceFeedback} from "./learning";

const uuid=(index:number)=>`00000000-0000-4000-8000-${index.toString().padStart(12,"0")}`;
const snapshotAt="2026-10-07T02:00:00Z",policyVersion="TH-TIKTOK-2026-10";
type Row=Parameters<typeof createLearningObservations>[0][number];
const row=(extra:Partial<Row>={}):Row=>({event_id:uuid(1),decision_id:uuid(2),owner_id:uuid(100),event_type:"compliance_flag",
  source:"SYSTEM",policy_version:policyVersion,semantic_categories:["GUARANTEED_RESULT"],category:"SKINCARE",country:"TH",
  platform:"TIKTOK_SHOP",channel:"POST",risk_score:85,decision:"BLOCK",observed_at:"2026-10-07T01:00:00Z",...extra});
function clientFor(rows:Row[],complete=true) {
  const rpc=vi.fn(async(name:string)=>({data:name==="read_compliance_brain_learning_observations"
    ?{snapshot_at:snapshotAt,complete,observations:rows}:uuid(999),error:null}));
  return {client:{rpc} as unknown as SupabaseClient,rpc};
}

describe("server-only feedback to anonymous learning",()=>{
  it("persists actual multi-tenant immutable-decision feedback with a monotonic database snapshot and no promotion",async()=>{
    const rows=Array.from({length:10},(_,index)=>row({event_id:uuid(index+1),decision_id:uuid(index+20),owner_id:uuid(100+index%5)}));
    const f=clientFor(rows),result=await refreshComplianceLearning(f.client,policyVersion);
    expect(result).toMatchObject({feedbackCount:10,observationCount:10,persistedPatternCount:1,cohortSuppressedPatternCount:0});
    expect(f.rpc).toHaveBeenCalledWith("read_compliance_brain_learning_observations",{p_policy_version:policyVersion,p_limit:5000});
    expect(f.rpc).toHaveBeenCalledWith("upsert_compliance_brain_learning_pattern",{p_actor:null,p_pattern:expect.objectContaining({
      lifecycle:"SHADOW",sample_count:10,tenant_count:5,shadow_would_block:10,shadow_evaluated_count:10,
      shadow_unavailable_count:0,approved:false,observed_at:snapshotAt})});
    const stored=JSON.stringify(f.rpc.mock.calls.filter(([name])=>name==="upsert_compliance_brain_learning_pattern"));
    expect(stored).not.toContain(uuid(100));expect(stored).not.toContain(uuid(20));
    expect(f.rpc.mock.calls.every(([name])=>!name.includes("activate"))).toBe(true);
  });
  it("suppresses a global pattern below the minimum distinct-tenant cohort even when one tenant sends many events",async()=>{
    const f=clientFor(Array.from({length:25},(_,index)=>row({event_id:uuid(index+1),decision_id:uuid(index+20)})));
    expect(await refreshComplianceLearning(f.client,policyVersion)).toMatchObject({persistedPatternCount:0,cohortSuppressedPatternCount:1});
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("evaluates the learned candidate independently of the customer verdict and uses the shared category risk profile",()=>{
    const observations=createLearningObservations(Array.from({length:10},(_,index)=>row({event_id:uuid(index+1),
      decision_id:uuid(index+20),owner_id:uuid(100+index%5),decision:"PASS",risk_score:85})),policyVersion);
    const pattern=new ComplianceLearning().aggregate(observations)[0];
    expect(evaluateLearnedShadowCandidate(pattern,observations[0])).toBe("WOULD_BLOCK");
    expect(replayLearnedShadowCandidate(pattern,observations)).toMatchObject({shadowWouldBlock:10,shadowWouldRewrite:0,shadowEvaluatedCount:10});
    expect(evaluateLearnedShadowCandidate({...pattern,riskScore:60},observations[0])).toBe("WOULD_REWRITE");
    expect(evaluateLearnedShadowCandidate({...pattern,riskScore:20},observations[0])).toBe("NO_CHANGE");
    expect(evaluateLearnedShadowCandidate({...pattern,category:"GENERAL_COMMERCE",riskScore:85},
      {...observations[0],category:"GENERAL_COMMERCE"})).toBe("WOULD_REWRITE");
    expect(evaluateLearnedShadowCandidate(pattern,{...observations[0],semanticCategory:"MEDICAL_TREATMENT"})).toBe("NO_MATCH");
  });
  it("marks low-sample/cohort/confidence candidates unavailable and cannot mirror an existing BLOCK as a shadow result",()=>{
    const observations=createLearningObservations([row()],policyVersion);
    const pattern=new ComplianceLearning().aggregate(observations)[0];
    expect(evaluateLearnedShadowCandidate(pattern,observations[0])).toBe("UNAVAILABLE");
    expect(replayLearnedShadowCandidate(pattern,observations)).toMatchObject({shadowWouldBlock:0,shadowWouldRewrite:0,
      shadowEvaluatedCount:0,shadowUnavailableCount:1});
    expect(evaluateLearnedShadowCandidate({...pattern,lifecycle:"SHADOW",sampleCount:30,tenantCount:5,confidence:0.2},observations[0])).toBe("UNAVAILABLE");
    expect(evaluateLearnedShadowCandidate({...pattern,lifecycle:"SHADOW",sampleCount:30,tenantCount:1,confidence:0.95},observations[0])).toBe("UNAVAILABLE");
  });
  it("retains all immutable semantic categories and deduplicates retries of the same decision/outcome",()=>{
    const source=row({semantic_categories:["GUARANTEED_RESULT","TIME_BOUND_RESULT"]});
    const observations=createLearningObservations([source,{...source,event_id:uuid(9)}],policyVersion);
    expect(observations).toHaveLength(2);
    expect(new ComplianceLearning().aggregate(observations).map(pattern=>pattern.sampleCount)).toEqual([1,1]);
  });
  it("learns an appeal only after the same owner's matching case has an earlier verified adverse platform outcome",()=>{
    const violation=row({source:"OFFICIAL_PLATFORM",event_type:"violation"});
    const appeal=row({event_id:uuid(9),source:"OFFICIAL_PLATFORM",event_type:"appeal_accepted",observed_at:"2026-10-07T01:01:00Z"});
    expect(createLearningObservations([appeal],policyVersion)).toEqual([]);
    expect(createLearningObservations([violation,{...appeal,owner_id:uuid(101)}],policyVersion)).toHaveLength(1);
    expect(createLearningObservations([violation,{...appeal,decision_id:uuid(88)}],policyVersion)).toHaveLength(1);
    expect(createLearningObservations([{...violation,observed_at:"2026-10-07T01:02:00Z"},appeal],policyVersion)).toHaveLength(1);
    const pattern=new ComplianceLearning().aggregate(createLearningObservations([violation,appeal],policyVersion))[0];
    expect(pattern).toMatchObject({violationCount:1,appealAcceptedCount:1,falsePositiveRate:0.5});
    expect(pattern.riskScore).toBeLessThan(85);
  });
  it("discards publish/sales signals, invalid source outcomes, and events with no mapped semantic reason",()=>{
    const observations=createLearningObservations([row({event_type:"publish",risk_score:0}),
      row({event_type:"violation",source:"HUMAN_CORRECTION"}),row({semantic_categories:[]})],policyVersion);
    expect(observations).toEqual([]);
  });
  it("maps an unknown product category to a controlled bucket without persisting its arbitrary text",()=>{
    const observations=createLearningObservations([row({category:"customer-private-product-family"})],policyVersion);
    expect(observations[0].category).toBe("OTHER");
    expect(JSON.stringify(new ComplianceLearning().aggregate(observations))).not.toContain("customer-private-product-family");
  });
  it("aborts a truncated or malformed snapshot before persisting any partial patterns",async()=>{
    const f=clientFor([row()],false);
    await expect(refreshComplianceLearning(f.client,policyVersion)).rejects.toThrow("snapshot_limit_exceeded");
    expect(f.rpc).toHaveBeenCalledTimes(1);
    const malformed=clientFor([Object.assign(row(),{raw_script:"private-script"})]);
    await expect(refreshComplianceLearning(malformed.client,policyVersion)).rejects.toThrow("snapshot_invalid");
    expect(malformed.rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects a cross-policy snapshot and unavailable reads before aggregate persistence",async()=>{
    const f=clientFor([row({policy_version:"OTHER-POLICY"})]);
    await expect(refreshComplianceLearning(f.client,policyVersion)).rejects.toThrow("scope_invalid");
    expect(f.rpc).toHaveBeenCalledTimes(1);
    const rpc=vi.fn(async()=>({data:null,error:{message:"unavailable"}}));
    await expect(refreshComplianceLearning({rpc} as unknown as SupabaseClient,policyVersion)).rejects.toThrow("snapshot_unavailable");
  });
  it("loads the learning policy only from the owner-scoped immutable decision",async()=>{
    const f=clientFor([]),calls:unknown[][]=[];
    const query={eq:(...args:unknown[])=>{calls.push(args);return query;},
      maybeSingle:async()=>({data:{id:uuid(2),owner_id:uuid(100),policy_version:policyVersion},error:null})};
    const select=vi.fn(()=>query),from=vi.fn(()=>({select}));
    await refreshComplianceLearningForDecision({...f.client,from} as unknown as SupabaseClient,uuid(100),uuid(2));
    expect(select).toHaveBeenCalledWith("id,owner_id,policy_version");
    expect(calls).toEqual([["owner_id",uuid(100)],["id",uuid(2)]]);
    query.maybeSingle=async()=>({data:{id:uuid(2),owner_id:uuid(101),policy_version:policyVersion},error:null});
    await expect(refreshComplianceLearningForDecision({...f.client,from} as unknown as SupabaseClient,uuid(100),uuid(2))).rejects.toThrow("scope_invalid");
  });
  it("refreshes after durable human feedback and reports pending refresh without losing the recorded event",async()=>{
    const f=clientFor([]),query={eq:()=>query,maybeSingle:async()=>({data:{id:uuid(2),owner_id:uuid(100),policy_version:policyVersion},error:null})};
    const client={rpc:f.rpc,from:()=>({select:()=>query})} as unknown as SupabaseClient;
    const input={ownerId:uuid(100),decisionId:uuid(2),eventKey:"human-edit",eventType:"human_edit" as const,source:"HUMAN_CORRECTION" as const};
    const actor={id:uuid(100),app_metadata:{viralflow_role:"admin"}};
    const result=await recordComplianceFeedback(client,input,actor);
    expect(result).toMatchObject({feedbackId:uuid(999),learningPending:false,learning:{feedbackCount:0}});
    expect(f.rpc.mock.calls.map(([name])=>name)).toEqual(["append_compliance_brain_feedback","read_compliance_brain_learning_observations"]);
    const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
    const unavailable={rpc:vi.fn(async(name:string)=>name==="append_compliance_brain_feedback"
      ?{data:uuid(999),error:null}:{data:null,error:{message:"private upstream details"}}),from:()=>({select:()=>query})} as unknown as SupabaseClient;
    expect(await recordComplianceFeedback(unavailable,input,actor)).toMatchObject({feedbackId:uuid(999),learning:null,learningPending:true});
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private upstream details");
    warn.mockRestore();
  });
});
