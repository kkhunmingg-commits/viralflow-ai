import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ComplianceDecision } from "./contracts";
import { activatePolicyVersion, loadActivePolicyPack, loadFinalMediaReview, loadOwnerAccountSafety, loadProductLedger, recordDecision, requirePolicyAdmin } from "./store";
import { summarizeAccountSafety, customerComplianceStatus } from "./presentation";
const owner="11111111-1111-4111-8111-111111111111", product="22222222-2222-4222-8222-222222222222";
const account="33333333-3333-4333-8333-333333333333", evidence="44444444-4444-4444-8444-444444444444";
const claim="55555555-5555-4555-8555-555555555555";
function clientFor(tables:Record<string,{data:unknown;error?:unknown}>) {
  const calls:Array<{table:string;method:string;args:unknown[]}> = [];
  const client={from(table:string){
    const query:Record<string,unknown>={then(resolve:(result:unknown)=>unknown){return Promise.resolve(tables[table]??{data:[],error:null}).then(resolve)}};
    for(const method of ["select","eq","in","lte","gte","order","limit","range","maybeSingle"]) query[method]=(...args:unknown[])=>{calls.push({table,method,args});return query};
    return query;
  },rpc:vi.fn(async()=>({data:"66666666-6666-4666-8666-666666666666",error:null}))};
  return {client:client as unknown as SupabaseClient,calls,rpc:client.rpc};
}
describe("Compliance Brain persistence and customer projection",()=>{
  it("loads only the requested owner/product and preserves authoritative ledger fields",async()=>{
    const fake=clientFor({compliance_brain_claims:{data:[{id:claim,owner_id:owner,product_id:product,claim_text:"ช่วยเพิ่มความชุ่มชื้น",claim_type:"COSMETIC",source:"label",evidence_refs:[evidence],jurisdiction:"TH",expires_at:null,verified:true,allowed_channels:["POST","LIVE"],conditions:["EXTERNAL_USE"],aliases:["ช่วยให้ผิวชุ่มชื้น"]}]},
      compliance_brain_evidence:{data:[{id:evidence,owner_id:owner,product_id:product,kind:"PRODUCT_LABEL",source_url:"label",source_hash:"a".repeat(64),jurisdiction:"TH",verified:true,expires_at:null}]}});
    const result=await loadProductLedger(fake.client,owner,product);
    expect(result.claims[0]).toMatchObject({ownerId:owner,productId:product,evidenceRefs:[evidence],verified:true,conditions:["EXTERNAL_USE"]});
    expect(result.evidence[0]).toMatchObject({source:"label",sourceHash:"a".repeat(64)});
    expect(fake.calls.filter(call=>call.method==="eq")).toHaveLength(4);
    expect(fake.calls.filter(call=>call.method==="eq").map(call=>call.args)).toEqual([["owner_id",owner],["product_id",product],["owner_id",owner],["product_id",product]]);
  });
  it("rejects malformed or cross-tenant data instead of treating it as verified",async()=>{
    const fake=clientFor({compliance_brain_claims:{data:[]},compliance_brain_evidence:{data:[{id:evidence,owner_id:account,product_id:product,kind:"PDP",source_url:"pdp",source_hash:"a".repeat(64),jurisdiction:"TH",verified:true,expires_at:null}]}});
    await expect(loadProductLedger(fake.client,owner,product)).rejects.toThrow("compliance_ledger_scope_invalid");
  });
  it("records an immutable verdict atomically and never sends the raw script or suggested rewrite",async()=>{
    const fake=clientFor({});
    const result:ComplianceDecision={id:claim,status:"REVIEW_REQUIRED",riskScore:70,categoryRisk:"HIGH",policyVersion:null,policyRefs:[],claimRefs:[],evidenceRefs:[],
      reasons:[{code:"UNKNOWN_FACT",message:"ต้องตรวจสอบข้อมูล",policyRefs:[]}],suggestedRewrite:{script:"private draft"},contentHash:"a".repeat(64),checkedAt:"2026-10-07T00:00:00Z",
      scope:{ownerId:owner,productId:product,accountId:account,platform:"TIKTOK_SHOP",country:"TH",region:"TH",category:"SKINCARE",channel:"POST"},stage:"FINAL_PUBLISH",rewrites:[]};
    await recordDecision(fake.client,result);
    expect(fake.rpc).toHaveBeenCalledWith("record_compliance_brain_decision",{p_decision:expect.objectContaining({owner_id:owner,product_id:product,decision:"REVIEW_REQUIRED",content_hash:"a".repeat(64)})});
    expect(JSON.stringify(fake.rpc.mock.calls)).not.toContain("private draft");
  });
  it("does not accept user-editable metadata as policy admin authority",()=>{
    expect(()=>requirePolicyAdmin({id:owner,user_metadata:{viralflow_role:"admin"}} as never)).toThrow("compliance_admin_required");
    expect(()=>requirePolicyAdmin({id:owner,app_metadata:{viralflow_role:"member"}})).toThrow("compliance_admin_required");
    expect(requirePolicyAdmin({id:owner,app_metadata:{viralflow_role:"developer"}}).id).toBe(owner);
  });
  it("requires a trusted signature verifier and validation record before activating a pack",async()=>{
    const fake=clientFor({compliance_brain_policy_versions:{data:{version:"TH-1",platform:"TIKTOK_SHOP",country:"TH",region:"TH",status:"VALIDATED",pack_json:{untrusted:true},validation_hash:"a".repeat(64),validated_at:"2026-10-01"}}});
    await expect(activatePolicyVersion(fake.client,{id:owner,app_metadata:{viralflow_role:"admin"}},"TH-1",()=>{throw new Error("signature_invalid")})).rejects.toThrow("signature_invalid");
    expect(fake.rpc).not.toHaveBeenCalled();
    await activatePolicyVersion(fake.client,{id:owner,app_metadata:{viralflow_role:"admin"}},"TH-1",()=>({version:"TH-1",platform:"TIKTOK_SHOP",country:"TH",region:"TH"}),true);
    expect(fake.rpc).toHaveBeenCalledWith("activate_compliance_brain_policy",{p_version:"TH-1",p_actor:owner,p_rollback:true});
  });
  it("rejects a stored pack whose envelope differs from the registry metadata",async()=>{
    const fake=clientFor({compliance_brain_policy_versions:{data:[{version:"TH-1",region:"TH",checksum:"a",signature:"s",pack_json:{payload:{version:"TH-1",platform:"TIKTOK_SHOP",country:"US",region:"TH"},checksum:"a",signature:"s"}}]}});
    await expect(loadActivePolicyPack(fake.client,{platform:"TIKTOK_SHOP",country:"TH",region:"TH"})).rejects.toThrow("compliance_policy_record_invalid");
  });
  it("uses final checks only, deduplicates retries, excludes other accounts and distinguishes no data",()=>{
    const base={account_id:account,channel:"POST" as const,stage:"FINAL_PUBLISH",content_hash:"a",checked_at:"2026-10-07T00:00:00Z"};
    const summary=summarizeAccountSafety([{...base,id:"1",decision:"BLOCK"},{...base,id:"2",checked_at:"2026-10-07T01:00:00Z",decision:"PASS"},
      {...base,id:"3",content_hash:"b",decision:"BLOCK"},{...base,id:"4",content_hash:"c",decision:"REVIEW_REQUIRED"},
      {...base,id:"5",content_hash:"d",stage:"PRE_GENERATION",decision:"PASS"},{...base,id:"6",account_id:owner,content_hash:"e",decision:"PASS"}],account);
    expect(summary).toMatchObject({state:"READY",checkedContent:3,safePercent:33,preventedRiskyPosts:1,reviewRequired:1});
    expect(summarizeAccountSafety([],account)).toMatchObject({state:"EMPTY",safePercent:null});
    expect(customerComplianceStatus("BLOCK").label).toBe("ถูกบล็อกเพื่อป้องกันบัญชี");
  });
  it("returns unavailable rather than invented zero-risk statistics when storage is unavailable",async()=>{
    const fake=clientFor({compliance_brain_decisions:{data:null,error:{code:"42P01"}}});
    const result=await loadOwnerAccountSafety(fake.client,owner,[account]);
    expect(result[account]).toMatchObject({state:"UNAVAILABLE",safePercent:null,latestStatus:null});
  });
  it("projects only an applied-and-passed rewrite flag, never raw rewrite traces",async()=>{
    const row={id:claim,account_id:account,channel:"LIVE" as const,stage:"LIVE_SPEECH",content_hash:"private-hash",
      decision:"PASS" as const,rewritten:true,checked_at:"2026-10-07T00:00:00Z"};
    const fake=clientFor({compliance_brain_decisions:{data:[row]},compliance_brain_policy_versions:{data:null}});
    const summary=(await loadOwnerAccountSafety(fake.client,owner,[account],new Date("2026-10-07T01:00:00Z")))[account];
    expect(summary).toMatchObject({safePercent:100,latestStatus:"PASS",latestRewritten:true,reviewRequired:0});
    const selection=fake.calls.find(call=>call.table==="compliance_brain_decisions"&&call.method==="select")?.args[0];
    expect(selection).toContain("rewritten");
    expect(selection).not.toContain("rewrites_json");
    expect(JSON.stringify(summary)).not.toMatch(/private-hash|inputHash|outputHash|policyRefs|evidenceRefs|rewrites_json/);
    expect(customerComplianceStatus(summary.latestStatus!,summary.latestRewritten).label).toBe("ปรับคำแล้ว");
    const pending=summarizeAccountSafety([{...row,decision:"AUTO_REWRITE",rewritten:true}],account);
    expect(pending).toMatchObject({safePercent:0,reviewRequired:1,latestStatus:"AUTO_REWRITE",latestRewritten:false});
    expect(customerComplianceStatus("AUTO_REWRITE",true)).toEqual({label:"ควรตรวจสอบ",tone:"review"});
  });
  it("loads actual final media observations only for matching owner, product, account and asset hash",async()=>{
    const row={owner_id:owner,product_id:product,account_id:account,asset_hash:"b".repeat(64),evidence_id:evidence,
      transcript:"actual spoken words",on_screen_text:["actual overlay"],cover_text:"actual cover",visible_claims:[],metadata:[],ai_disclosed:true,
      coverage_complete:true,reviewed_at:"2026-10-01T00:00:00Z",expires_at:"2026-10-10T00:00:00Z"};
    const fake=clientFor({compliance_brain_media_reviews:{data:row}});
    expect(await loadFinalMediaReview(fake.client,owner,product,row.asset_hash,account,new Date("2026-10-07")))
      .toMatchObject({transcript:"actual spoken words",coverageComplete:true,evidenceRefs:[evidence]});
    await expect(loadFinalMediaReview(fake.client,owner,product,row.asset_hash,owner,new Date("2026-10-07"))).rejects.toThrow("scope_invalid");
    expect(await loadFinalMediaReview(fake.client,owner,product,row.asset_hash,account,new Date("2026-10-11"))).toBeNull();
    expect(await loadFinalMediaReview(fake.client,owner,product,row.asset_hash,account,new Date("2026-09-30"))).toBeNull();
  });
});
