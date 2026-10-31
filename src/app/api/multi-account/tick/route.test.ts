import {afterEach,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:vi.fn()}));
vi.mock("@/features/multi-account/service",()=>({tickMultiAccount:vi.fn(async()=>({disabled:true,paidCalls:0,postingCalls:0}))}));
import {POST} from "./route";
import {tickMultiAccount} from "@/features/multi-account/service";
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
it("is disabled by default and unauthorized clients never access queues",async()=>{
  vi.stubEnv("MULTI_ACCOUNT_WORKER_ENABLED","false");expect((await POST(new Request("http://localhost/api/multi-account/tick",{method:"POST"}))).status).toBe(503);
  vi.stubEnv("MULTI_ACCOUNT_WORKER_ENABLED","true");vi.stubEnv("MULTI_ACCOUNT_WORKER_TOKEN","fixture-only-worker-token-32-characters");
  expect((await POST(new Request("http://localhost/api/multi-account/tick",{method:"POST",headers:{authorization:"Bearer invalid"}}))).status).toBe(401);
  expect(tickMultiAccount).not.toHaveBeenCalled();
});
it("accepts only the dedicated server-side worker token and respects the DB disabled state",async()=>{
  vi.stubEnv("MULTI_ACCOUNT_WORKER_ENABLED","true");vi.stubEnv("MULTI_ACCOUNT_WORKER_TOKEN","fixture-only-worker-token-32-characters");
  const response=await POST(new Request("http://localhost/api/multi-account/tick",{method:"POST",headers:{authorization:"Bearer fixture-only-worker-token-32-characters"}}));
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({disabled:true,paidCalls:0,postingCalls:0});
});
