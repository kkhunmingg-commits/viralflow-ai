import {it,expect,vi,afterEach} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
vi.mock("server-only",()=>({}));
const gates=vi.hoisted(()=>({permission:vi.fn(),project:vi.fn()}));
vi.mock("./discovery-service",()=>({accountAutoPermission:gates.permission}));
vi.mock("../creative/services",()=>({createProjectFromAssignment:gates.project}));
import {prepareAffiliateHandoff} from "./affiliate-handoff";
afterEach(()=>vi.clearAllMocks());
const now=new Date("2026-10-12T12:00:00Z");
function fixture(real:boolean){
 const queries:unknown[][]=[],rows:Record<string,unknown>={growth_pilot_allowlist:{enabled:true},product_assignments:[{id:"same-assignment",product_id:"product"}],products:{external_provider:real?"tiktok_shop":"mock",status:"available",last_seen_at:now.toISOString()}};
 const admin={from:(table:string)=>{const builder:Record<string,unknown>={};for(const method of ["select","eq","in","gt","order","range","maybeSingle"])builder[method]=(...args:unknown[])=>{queries.push([table,method,...args]);return builder;};builder.then=(resolve:(v:unknown)=>unknown)=>Promise.resolve(resolve({data:rows[table],error:null}));return builder;}};
 return{admin:admin as unknown as SupabaseClient,queries};
}
it("revoked eligibility stops before reading products or creating any draft",async()=>{
 gates.permission.mockResolvedValue(null);const {admin,queries}=fixture(true);
 expect(await prepareAffiliateHandoff(admin,"owner","pilot",now)).toEqual({stage:"WAITING_FOR_ELIGIBILITY"});
 expect(queries).toEqual([]);expect(gates.project).not.toHaveBeenCalled();
});
it("verified switch reuses only the enrolled account's real daily assignment and never substitutes mock products",async()=>{
 gates.permission.mockResolvedValue({mode:"AFFILIATE",affiliate_allowed:true});
 const mock=fixture(false);expect(await prepareAffiliateHandoff(mock.admin,"owner","pilot",now)).toEqual({stage:"WAITING_FOR_REAL_PRODUCT_ASSIGNMENT"});expect(gates.project).not.toHaveBeenCalled();
 const real=fixture(true);expect(await prepareAffiliateHandoff(real.admin,"owner","pilot",now)).toEqual({stage:"CREATIVE_REQUIRED"});
 expect(gates.project).toHaveBeenCalledWith(real.admin,"owner","same-assignment");
 expect(real.queries).toContainEqual(["product_assignments","eq","tiktok_account_id","pilot"]);
 expect(real.queries).toContainEqual(["products","eq","owner_id","owner"]);
});
