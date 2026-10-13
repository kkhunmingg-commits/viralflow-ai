import {it,expect,vi,afterEach} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {DurableWork} from "../multi-account/contracts";
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>{throw new Error("No remote database client is allowed in this test");}}));
vi.mock("@/lib/server-env",()=>({serverEnv:{tiktokPublishingProvider:"official",tiktokPublishingRealMode:true}}));
const paid=vi.hoisted(()=>vi.fn());
vi.mock("@/features/video-provider/service",()=>({enqueueProviderVideo:paid,advanceProviderJob:paid,reconcileProviderBilling:paid,providerSettings:vi.fn()}));
import {createWorkerPorts} from "../multi-account/service";
const work={id:"work",owner_id:"owner",tiktok_account_id:"account",kind:"GENERATE",creative_project_id:"project",provider_job_id:null,ordinal:1} as DurableWork;
afterEach(()=>{vi.unstubAllEnvs();paid.mockClear();});
function fixture(health:string,mode="GROWTH",provider="mock"){
 const now=new Date(),future=new Date(now.getTime()+86400000).toISOString(),called:string[]=[];
 const data:Record<string,unknown>={account_automation_settings:{config:{enabled:true}},tiktok_accounts:{authorization_status:"authorized",hidden_at:null,account_status:"active",is_mock:false,token_expires_at:future},auto_account_discovery:{mode,can_execute:true,affiliate_allowed:mode==="AFFILIATE",observed_at:now.toISOString(),valid_until:future,lease_expires_at:null},account_publish_health:{health_status:health},creative_projects:{mode:"GROWTH"},creative_generations:[{id:"generation",provider}]};
 const admin={from:(table:string)=>{called.push(table);const builder:Record<string,unknown>={};for(const method of ["select","eq","order","limit","maybeSingle","single"])builder[method]=()=>builder;builder.then=(resolve:(result:unknown)=>unknown)=>Promise.resolve(resolve({data:data[table],error:null}));return builder;}};
 return{admin:admin as unknown as SupabaseClient,called};
}
it("SAFE never reads a token, reserves budget or submits a post",async()=>{
 const {admin,called}=fixture("READY"),ports=createWorkerPorts(admin,true,true);
 expect(await ports.generate(work)).toMatchObject({state:"WAITING",reason:"SAFE_MODE"});
 expect(await ports.publish({...work,kind:"PUBLISH"})).toMatchObject({state:"WAITING",reason:"SAFE_MODE"});
 expect(called).toEqual([]);expect(paid).not.toHaveBeenCalled();
});
it("health warnings and mode switches block actual worker submission",async()=>{
 vi.stubEnv("VIDEO_PROVIDER_ROUTER_ENABLED","true");
 const blocked=fixture("LIMITED");expect(await createWorkerPorts(blocked.admin,false,false).generate(work)).toMatchObject({reason:"ACCOUNT_PAUSED"});
 const switched=fixture("READY","AFFILIATE");expect(await createWorkerPorts(switched.admin,false,false).generate(work)).toMatchObject({state:"REVIEW_REQUIRED",reason:"MODE_CHANGED"});
 expect(paid).not.toHaveBeenCalled();
});
it("a real account cannot purchase video using a mock Creative Brain result",async()=>{
 vi.stubEnv("VIDEO_PROVIDER_ROUTER_ENABLED","true");
 const {admin}=fixture("READY");expect(await createWorkerPorts(admin,false,false).generate(work)).toMatchObject({reason:"CREATIVE_REQUIRED"});
 expect(paid).not.toHaveBeenCalled();
});
