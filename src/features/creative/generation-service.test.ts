import {beforeEach,describe,expect,it,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
import {creativeFixture} from "./fixtures";
import {planCreativeStrategy,strategyFingerprint} from "./strategist";
import {createAdaptiveArm} from "../growth/adaptive-experiments";
const mocks=vi.hoisted(()=>({env:{creativeAIProvider:"openai",creativeAIModel:"gpt-5.4-nano",openAIApiKey:"synthetic-unit-test-key-never-used"},
  context:vi.fn(),resources:vi.fn(),plan:vi.fn(),discovery:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/server-env",()=>({serverEnv:mocks.env}));
vi.mock("./context",()=>({buildCreativeContext:mocks.context}));
vi.mock("./intelligence-service",()=>({readCreativeIntelligenceResources:mocks.resources}));
vi.mock("./self-learning",async importOriginal=>({...await importOriginal<typeof import("./self-learning")>(),planSelfLearningCreative:mocks.plan}));
vi.mock("../growth-manager/trend-discovery",async importOriginal=>({...await importOriginal<typeof import("../growth-manager/trend-discovery")>(),discoverTrendCandidates:mocks.discovery}));
import {generateEvidenceStrategyProject} from "./services";

type Row=Record<string,unknown>;
function clientFor(denyClaim=false){
  const rows:Record<string,Row[]>={creative_projects:[{id:"project",owner_id:"owner",tiktok_account_id:"pilot",product_id:"mop",product_assignment_id:"assignment",status:"DRAFT"}],
    product_assignments:[{id:"assignment",owner_id:"owner",score_id:"fit"}],tiktok_accounts:[{id:"pilot",owner_id:"owner"}],
    products:[{id:"mop",owner_id:"owner",external_provider:"fixture",category_key:"home"}],account_product_scores:[{id:"fit",owner_id:"owner"}]};
  const writes: Array<{table:string;patch:Row;filters:Array<[string,unknown]>}>=[];
  const client={from(table:string){const filters:Array<[string,unknown]>=[];let patch:Row|null=null;
    const execute=(single:boolean)=>{
      const found=(rows[table]??[]).filter(row=>filters.every(([k,v])=>row[k]===v));
      if(patch){writes.push({table,patch,filters:[...filters]});if(denyClaim&&patch.status==="GENERATING")return {data:null,error:null};found.forEach(row=>Object.assign(row,patch));}
      return {data:single?found[0]??null:found,error:null};
    };
    const q={select:()=>q,eq:(k:string,v:unknown)=>{filters.push([k,v]);return q;},in:()=>q,order:()=>q,limit:()=>q,
      update:(v:Row)=>{patch=v;return q;},maybeSingle:async()=>execute(true),single:async()=>execute(true),
      then:(resolve:(r:ReturnType<typeof execute>)=>unknown,reject:(e:unknown)=>unknown)=>Promise.resolve(execute(false)).then(resolve,reject)};
    return q;
  },rpc:vi.fn(async(_name:string,payload:Row)=>{
    const generation=payload.p_generation as Row;
    rows.creative_angles=payload.p_angles as Row[];rows.scripts=payload.p_scripts as Row[];rows.creative_projects[0].status="READY";
    return {data:generation.id,error:null};
  })};
  return {client:client as unknown as SupabaseClient,rpc:client.rpc,rows,writes};
}
beforeEach(async()=>{
  vi.clearAllMocks();mocks.env.creativeAIProvider="openai";mocks.env.creativeAIModel="gpt-5.4-nano";mocks.env.openAIApiKey="synthetic-unit-test-key-never-used";
  const original=await vi.importActual<typeof import("./context")>("./context");mocks.context.mockImplementationOnce(original.buildCreativeContext);
  const context=creativeFixture("AFFILIATE","home");context.account.id="pilot";context.product.id="mop";mocks.context.mockReturnValue(context).mockClear();
  mocks.resources.mockResolvedValue({resources:{ownerId:"owner",now:new Date("2026-10-13T12:00:00Z"),realAccount:true,optedIn:true,affiliateEligible:true,adaptiveHistory:[]}});
  mocks.discovery.mockResolvedValue({accountId:"pilot",status:"UNKNOWN"});
});
describe("local-only real creative runtime wiring (model transport separately mocked)",()=>{
  it("missing LLM config never reads data or spends on a mock replacement",async()=>{
    mocks.env.creativeAIProvider="mock";mocks.env.openAIApiKey="";const state=clientFor();
    await expect(generateEvidenceStrategyProject(state.client,"owner","project")).rejects.toThrow("CREATIVE_LLM_NOT_CONFIGURED");
    expect(mocks.context).not.toHaveBeenCalled();expect(mocks.plan).not.toHaveBeenCalled();expect(state.writes).toEqual([]);
  });
  it("plans with the zero-cost evidence rubric only when the owner chose it, keeping review pending",async()=>{
    mocks.env.creativeAIProvider="evidence-rubric";mocks.env.openAIApiKey="";const state=clientFor();
    mocks.resources.mockResolvedValue({resources:{ownerId:"owner",now:new Date("2026-10-13T12:00:00Z"),realAccount:true,optedIn:true,affiliateEligible:true,adaptiveHistory:[],
      facts:[{id:"fact-1",text:"ด้ามกดหมุนในตะแกรงของถัง",source:"OWNER_FOOTAGE",reference:"owner",verified:true,capturedAt:"2026-10-13T10:00:00Z",productId:"mop",role:"OBSERVATION"}],
      assets:[{id:"clip",kind:"REAL_FOOTAGE",source:"OWNER",reference:"ledger",rightsConfirmed:true,reviewed:true,productId:"mop",durationSeconds:8}]}});
    const result=await generateEvidenceStrategyProject(state.client,"owner","project");
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(result).toMatchObject({cost:0,humanReview:"PENDING"});
    const payload=state.rpc.mock.calls[0][1] as Row,generation=payload.p_generation as Row;
    expect(generation).toMatchObject({provider:"local",model:"evidence-rubric-v1",input_tokens:0,output_tokens:0,estimated_cost:0});
    const angles=payload.p_angles as Row[];
    expect(angles.every(a=>(a.score_explanation_json as {productionStrategy:{review:unknown}}).productionStrategy.review===null)).toBe(true);
    expect((generation.validated_output_json as {strategyPlan:{source:string}}).strategyPlan.source).toBe("DETERMINISTIC_EVIDENCE_RUBRIC");
  });
  it("rejects non-participating accounts before claim or LLM invocation",async()=>{
    mocks.resources.mockResolvedValue({resources:{realAccount:true,optedIn:false}});const state=clientFor();
    await expect(generateEvidenceStrategyProject(state.client,"owner","project")).rejects.toThrow("CREATIVE_ACCOUNT_AUTOMATION_NOT_AUTHORIZED");
    expect(mocks.plan).not.toHaveBeenCalled();expect(state.writes).toEqual([]);
  });
  it("does not treat an unknown model price as zero-cost authorization",async()=>{
    mocks.env.creativeAIModel="unknown-priced-model";const state=clientFor();
    await expect(generateEvidenceStrategyProject(state.client,"owner","project")).rejects.toThrow("CREATIVE_MODEL_PRICING_UNKNOWN");
    expect(mocks.plan).not.toHaveBeenCalled();expect(state.writes).toEqual([]);
  });
  it("conditional claim loss prevents duplicate text generation",async()=>{
    const state=clientFor(true);
    await expect(generateEvidenceStrategyProject(state.client,"owner","project")).rejects.toThrow("CREATIVE_GENERATION_ALREADY_CLAIMED");
    expect(mocks.plan).not.toHaveBeenCalled();expect(mocks.discovery).not.toHaveBeenCalled();expect(state.rpc).not.toHaveBeenCalled();
    expect(state.writes[0].filters).toContainEqual(["status","DRAFT"]);
  });
  it.each(["GENERATING","FAILED"])("does not buy a replacement automatically after interrupted state %s",async status=>{
    const state=clientFor();state.rows.creative_projects[0].status=status;
    await expect(generateEvidenceStrategyProject(state.client,"owner","project",{forAutoWorker:true})).rejects.toThrow("CREATIVE_GENERATION_REVIEW_REQUIRED");
    expect(mocks.plan).not.toHaveBeenCalled();expect(state.writes).toEqual([]);
  });
  it("persists reasoning/usage/attribution and selects the AI's choice without owner selection",async()=>{
    // Synthetic provider result: this is persistence proof, not a real LLM trial.
    const plan=planCreativeStrategy({now:new Date("2026-10-13T12:00:00Z"),account:{id:"pilot",mode:"AFFILIATE",affiliateEligible:true},
      product:{id:"mop",title:"ถังปั่น",mechanism:"COMPLEX"},facts:[],assets:[{id:"asset",kind:"REAL_FOOTAGE",source:"OWNER",reference:"fixture",productId:"mop",rightsConfirmed:true,reviewed:true,durationSeconds:8}]});
    plan.source="LLM_EVIDENCE_STRATEGY";plan.fingerprint=strategyFingerprint(plan);
    const selected=plan.concepts.find(c=>c.id===plan.selectedConceptId)!;
    const arm=createAdaptiveArm({ownerId:"owner",accountId:"pilot",mode:"AFFILIATE",contextKey:"product:mop",hook:"actual-operation-question",angle:"observed-mechanism",topic:"ถังปั่น",productionMethod:selected.production.method,introducedAt:"2026-10-13T12:00:00Z"});
    mocks.plan.mockResolvedValue({plan,usage:{inputTokens:200,outputTokens:700},promptVersion:"test-agent-version",output:{concepts:plan.concepts.map(c=>({id:c.id,format:"actual-demonstration"}))},arms:[{conceptId:selected.id,arm}],decision:{status:"EXPLORE",proposal:null}});
    const state=clientFor();await generateEvidenceStrategyProject(state.client,"owner","project",{forAutoWorker:true});
    expect(state.rpc).toHaveBeenCalledTimes(1);expect(state.rpc.mock.calls[0][0]).toBe("save_auto_creative_generation");
    const payload=state.rpc.mock.calls[0][1],generation=payload.p_generation as Row;
    expect(generation).toMatchObject({provider:"openai",model:"gpt-5.4-nano",input_tokens:200,output_tokens:700});
    expect(generation.estimated_cost).toBeGreaterThan(0);
    expect(JSON.stringify(payload)).not.toContain(mocks.env.openAIApiKey);
    expect((generation.validated_output_json as Row).adaptiveDecision).toMatchObject({status:"EXPLORE"});
    const chosen=state.rows.creative_angles.find(row=>row.is_selected===true)!;
    expect((chosen.score_explanation_json as Row).creativeAttribution).toMatchObject({spokenHook:selected.concept.hook,arm:{id:arm.id}});
    expect(state.rows.creative_projects[0]).toMatchObject({status:"SELECTED",selected_angle_id:chosen.id});
    expect(chosen.policy_status).toBe("REVIEW");
  });
});
