import { describe,it,expect,vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only",()=>({}));
vi.mock("@/lib/server-env",()=>({serverEnv:{tiktokProvider:"official"}}));
vi.mock("../tiktok/services",()=>({TikTokTokenService:class {getAccessToken(){throw new Error("Live credentials must not be used in tests");}}}));
import { fetchFollowerStats,syncAutoDiscovery } from "./discovery-service";
describe("official read-only stats boundary",()=>{
 it("uses only official HTTPS read endpoint and never returns missing count as zero",async()=>{
  const request=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({error:{code:"ok"},data:{user:{open_id:"own",follower_count:300}}})));
  expect(await fetchFollowerStats("test-token",request)).toEqual({identity:"own",count:300});
  expect(request.mock.calls[0][0]).toBe("https://open.tiktokapis.com/v2/user/info/?fields=open_id,follower_count");
  expect(request.mock.calls[0][1]?.redirect).toBe("error");
  request.mockResolvedValue(new Response(JSON.stringify({error:{code:"ok"},data:{user:{open_id:"own"}}})));
  await expect(fetchFollowerStats("test-token",request)).rejects.toThrow("FOLLOWER_SYNC_FAILED");
 });
 it("handles network failure, missing scope and identity conflict without granting execution",async()=>{
  const now=new Date(),items=[{owner:"o",account:"a",identity:"a",previousMode:"GROWTH",optedIn:true,connected:true,scopes:[],commerce:null},{owner:"o",account:"b",identity:"b",previousMode:"AFFILIATE",optedIn:true,connected:true,scopes:["user.info.basic","user.info.stats"],commerce:null},{owner:"o",account:"c",identity:"c",previousMode:"GROWTH",optedIn:false,connected:true,scopes:["user.info.basic","user.info.stats"],commerce:null}];
  const results:Record<string,unknown>[]=[];const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>name==="claim_auto_account_sync"?{data:items.shift()??null,error:null}:(results.push(args.p_result as Record<string,unknown>),{data:true,error:null}));
  const read=vi.fn(async(_owner:string,account:string)=>{if(account==="b")throw new Error("network");return{identity:"wrong",count:5000};});
  expect(await syncAutoDiscovery({rpc} as unknown as SupabaseClient,now,Date.now()+10000,read)).toEqual({installed:true,synced:3});
  expect(read).toHaveBeenCalledTimes(2);expect(results.every(r=>r.canExecute===false)).toBe(true);
  expect(results.map(r=>r.failure)).toEqual(["FOLLOWERS_PERMISSION_REQUIRED","FOLLOWER_SYNC_FAILED","FOLLOWER_IDENTITY_CONFLICT"]);
 });
});
