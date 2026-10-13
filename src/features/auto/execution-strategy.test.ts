import {beforeEach,describe,expect,it,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {ExecutionClaim} from "./processor";
import {CREATIVE_STRATEGY_VERSION} from "../creative/strategist";
const mocks=vi.hoisted(()=>({create:vi.fn(),detail:vi.fn(),generate:vi.fn(),select:vi.fn(),fal:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/server-env",()=>({serverEnv:{falKey:"fixture-not-real",falWanProviderState:"PRODUCTION_APPROVED",tiktokPublishingProvider:"mock"}}));
vi.mock("@/features/creative/services",()=>({createProjectFromAssignment:mocks.create,getCreativeProjectDetail:mocks.detail,generateCreativeProject:mocks.generate,selectCreative:mocks.select}));
vi.mock("@/features/video/auto-fal",()=>({generateAutoFalMaster:mocks.fal,reverifyAutoFalMaster:vi.fn()}));
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://example.supabase.co");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY","sb_publishable_strategy_wiring_fixture");
const {createAutoExecutionPorts}=await import("./execution-ports");
const client={from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{is_mock:false},error:null})};return q;}} as unknown as SupabaseClient;
const claim:ExecutionClaim={ownerId:"owner",accountId:"pilot",runId:"run",itemIndex:1,mode:"GROWTH",dailyTarget:1,attempt:1,step:"CREATE_CREATIVE",leaseToken:"lease",operationKey:"existing-operation",checkpoint:{assignmentId:"assignment",projectId:"project"}};
const detail=()=>({project:{id:"project",selected_script_id:null},scripts:[{id:"script",version:CREATIVE_STRATEGY_VERSION,creative_angle_id:"angle"}],angles:[{id:"angle",policy_status:"REVIEW"}]});
beforeEach(()=>{vi.clearAllMocks();mocks.create.mockResolvedValue({id:"project"});mocks.detail.mockResolvedValue(detail());});
describe("Auto evidence strategy stays in existing restartable stages",()=>{
  it("waits at the existing project instead of skipping or generating repeated drafts",async()=>{
    const ports=createAutoExecutionPorts(client);
    for(let restart=0;restart<2;restart++)expect(await ports.CREATE_CREATIVE(claim)).toMatchObject({kind:"WAIT",state:"WAITING_FOR_DATA",reason:"CREATIVE_EVIDENCE_OR_HUMAN_REVIEW_REQUIRED"});
    expect(mocks.generate).not.toHaveBeenCalled();expect(mocks.select).not.toHaveBeenCalled();expect(mocks.fal).not.toHaveBeenCalled();
  });
  it("holds new strategies before the legacy paid fal path, even if provider key/state are configured",async()=>{
    mocks.detail.mockResolvedValue({...detail(),project:{id:"project",selected_script_id:"script"}});
    expect(await createAutoExecutionPorts(client).GENERATE_VIDEO({...claim,step:"GENERATE_VIDEO"})).toMatchObject({kind:"WAIT",state:"WAITING_FOR_PROVIDER",reason:"REVIEWED_ASSISTED_PRODUCTION_REQUIRED"});
    expect(mocks.fal).not.toHaveBeenCalled();
  });
  it("still skips a rejected legacy creative rather than changing the legacy contract",async()=>{
    mocks.detail.mockResolvedValue({...detail(),scripts:[{id:"legacy",version:"creative-concept-v1"}],angles:[{policy_status:"REJECT"}]});
    expect(await createAutoExecutionPorts(client).CREATE_CREATIVE(claim)).toMatchObject({kind:"SKIP_ITEM",reason:"CREATIVE_RISK_REJECTED"});
  });
});
