import {describe,expect,it,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
import {createPolicyAdminHandlers} from "./admin-api";
import {createAccountSafetyHandler} from "./customer-api";

const owner="11111111-1111-4111-8111-111111111111";
const account="22222222-2222-4222-8222-222222222222";
const origin="https://app.example";

describe("Compliance Brain HTTP access boundaries",()=>{
  it("rejects signed-out customers before reading account data",async()=>{
    const authenticate=vi.fn(async()=>null);
    const response=await createAccountSafetyHandler(authenticate)(new Request(`${origin}/api/compliance-brain/account-safety?account=${account}`));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({error:"authentication_required"});
  });

  it("returns the same not-found response for malformed and other-owner accounts",async()=>{
    const calls:unknown[][]=[];
    type OwnershipQuery={select:(...args:unknown[])=>OwnershipQuery;eq:(...args:unknown[])=>OwnershipQuery;
      maybeSingle:()=>Promise<{data:null;error:null}>};
    const query:OwnershipQuery={select:(...args:unknown[])=>{calls.push(args);return query},
      eq:(...args:unknown[])=>{calls.push(args);return query},maybeSingle:async()=>({data:null,error:null})};
    const from=vi.fn(()=>query);
    const handler=createAccountSafetyHandler(async()=>({client:{from} as unknown as SupabaseClient,ownerId:owner}));
    expect((await handler(new Request(`${origin}/api/compliance-brain/account-safety?account=invalid`))).status).toBe(404);
    expect(from).not.toHaveBeenCalled();
    const response=await handler(new Request(`${origin}/api/compliance-brain/account-safety?account=${account}`));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({error:"account_not_found"});
    expect(from).toHaveBeenCalledExactlyOnceWith("tiktok_accounts");
    expect(calls).toEqual([["id"],["owner_id",owner],["id",account]]);
  });

  it("never constructs a privileged client for a member or user-editable admin claim",async()=>{
    const adminClient=vi.fn();
    for(const actor of [null,{id:owner,app_metadata:{viralflow_role:"member"}},
      {id:owner,user_metadata:{viralflow_role:"admin"}}]){
      const handlers=createPolicyAdminHandlers({authenticate:async()=>actor,adminClient,
        verify:vi.fn(),rateLimit:vi.fn()});
      expect((await handlers.GET()).status).toBe(403);
      expect((await handlers.POST(new Request(`${origin}/api/compliance-brain/admin/policies`,{method:"POST"}))).status).toBe(403);
    }
    expect(adminClient).not.toHaveBeenCalled();
  });

  it("rejects cross-origin and malformed policy mutations before database access",async()=>{
    const adminClient=vi.fn(),rateLimit=vi.fn(async()=>{});
    const handlers=createPolicyAdminHandlers({authenticate:async()=>({id:owner,app_metadata:{viralflow_role:"admin"}}),
      adminClient,verify:vi.fn(),rateLimit});
    const crossOrigin=await handlers.POST(new Request(`${origin}/api/compliance-brain/admin/policies`,{
      method:"POST",headers:{origin:"https://other.example","content-type":"application/json"},
      body:JSON.stringify({action:"activate",version:"TH-1"})}));
    expect(crossOrigin.status).toBe(403);
    expect(rateLimit).not.toHaveBeenCalled();
    const invalid=await handlers.POST(new Request(`${origin}/api/compliance-brain/admin/policies`,{
      method:"POST",headers:{origin,"content-type":"application/json"},
      body:JSON.stringify({action:"activate",version:"TH-1",publicKey:"customer-owned"})}));
    expect(invalid.status).toBe(400);
    expect(adminClient).not.toHaveBeenCalled();
  });
});
