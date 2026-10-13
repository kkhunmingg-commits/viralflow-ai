import { randomUUID } from "node:crypto";
import { describe,it,expect,vi } from "vitest";
import { runWorkerPool,retryAt,type WorkerStore,type WorkerPorts } from "./worker";
import type { DurableWork } from "./contracts";
vi.mock("server-only",()=>({}));vi.mock("@/lib/server-env",()=>({serverEnv:{}}));
vi.mock("@/lib/env",()=>({env:{NEXT_PUBLIC_SUPABASE_URL:"https://example.invalid",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"test-public-key"}}));
import { createWorkerPorts,allRows } from "./service";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("pooled workers without a browser",()=>{
  it("processes 50 accounts / 750 simulated tasks concurrently, with partial failure and no duplicates",async()=>{
    const tasks=Array.from({length:750},(_,i)=>({id:`job-${i}`,owner_id:"owner",tiktok_account_id:`a-${i%50}`,kind:"GENERATE",state:"WAITING",attempts:0,due_at:new Date(0).toISOString(),available_at:new Date(0).toISOString(),lease_token:""} as DurableWork));
    const handled=new Set<string>(),active=new Set<string>();let now=0;
    const store:WorkerStore={claim:async(kind,token)=>{const row=tasks.find(t=>t.kind===kind&&t.state==="WAITING"&&Date.parse(t.available_at)<=now&&!active.has(t.tiktok_account_id));if(!row)return null;row.state="CLAIMED";row.lease_token=token;row.attempts++;active.add(row.tiktok_account_id);return{...row};},finish:async(work,out)=>{const row=tasks.find(t=>t.id===work.id)!;if(row.lease_token!==work.lease_token)return false;Object.assign(row,out,{available_at:out.retryAt??row.available_at});active.delete(row.tiktok_account_id);return true;}};
    const ports:WorkerPorts={generate:async work=>{if(work.id==="job-0"&&work.attempts===1)throw new Error("simulated network failure");expect(handled.has(work.id)).toBe(false);handled.add(work.id);return{state:"COMPLETE",reason:"READY"};},publish:vi.fn(),reconcile:vi.fn()};
    const options={kind:"GENERATE" as const,token:randomUUID,batch:1000,concurrency:8,now:()=>now};
    const result=await runWorkerPool(store,ports,options);expect(result.completed).toBe(750);expect(handled.size).toBe(749);
    now=3600000;await runWorkerPool(store,ports,options);expect(handled.size).toBe(750);expect(tasks.every(t=>t.state==="COMPLETE")).toBe(true);
    expect(await runWorkerPool(store,ports,options)).toMatchObject({claimed:0});expect(ports.publish).not.toHaveBeenCalled();
  });
  it("SAFE short-circuits before DB, paid providers, token refresh or TikTok transport",async()=>{
    const admin={from:vi.fn(()=>{throw new Error("unexpected IO");}),rpc:vi.fn()} as unknown as SupabaseClient;
    const ports=createWorkerPorts(admin,true,false),work={} as DurableWork;
    for(const action of [ports.generate,ports.publish,ports.reconcile])expect(await action(work)).toMatchObject({state:"WAITING",reason:"SAFE_MODE"});
    expect(admin.from).not.toHaveBeenCalled();expect(admin.rpc).not.toHaveBeenCalled();
  });
  it("pagination is not an account ceiling and preserves every record",async()=>{
    const data=Array.from({length:1251},(_,i)=>({id:i}));let requests=0;
    expect(await allRows(async(from,to)=>{requests++;return{data:data.slice(from,to+1),error:null};})).toHaveLength(1251);expect(requests).toBe(3);
  });
  it("backoff and retry are bounded; stale leases cannot finalize",async()=>{
    expect(Date.parse(retryAt(100,0))).toBe(3600000);
    const row={id:"stale",kind:"GENERATE",attempts:8} as DurableWork;
    let first=true;const finish=vi.fn(async()=>false);
    const result=await runWorkerPool({claim:async()=>first?(first=false,row):null,finish},{generate:async()=>{throw new Error("provider failure");},publish:vi.fn(),reconcile:vi.fn()},{kind:"GENERATE",token:randomUUID,batch:2,concurrency:1,now:()=>0});
    expect(result.fenced).toBe(1);expect(finish.mock.calls[0]).toBeDefined();
  });
  it("stops claiming at the tick deadline rather than holding a server function forever",async()=>{
    const claim=vi.fn(async()=>null);
    expect(await runWorkerPool({claim,finish:vi.fn()},{generate:vi.fn(),publish:vi.fn(),reconcile:vi.fn()},{kind:"GENERATE",token:randomUUID,batch:1000,concurrency:8,now:()=>10,deadlineAt:10})).toMatchObject({claimed:0});
    expect(claim).not.toHaveBeenCalled();
  });
});
