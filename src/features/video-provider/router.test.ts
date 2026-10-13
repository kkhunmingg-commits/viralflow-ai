import {describe,it,expect} from "vitest";
import {defaultProviderSettings,providerSettingsSchema,type RouterJob,type ProviderSnapshot} from "./contracts";
import {routeVideoJob} from "./router";
import {GoogleVidsOmniProvider} from "./google-vids";
import {assertProviderAdministrator} from "./access";
const fresh:RouterJob={state:"QUEUED",provider:null,submission:"NOT_SENT",requestId:null,retries:0,nextRetryAt:null};
const snapshot:ProviderSnapshot={google:{status:"READY",automated:true},falAvailable:true,estimateUsd:.3,budgetAvailable:true};
const paid=()=>providerSettingsSchema.parse({paidFallback:true,maxCostUsd:1,dailyBudgetUsd:5,monthlyBudgetUsd:30,autoRecovery:true});
describe("video provider routing decisions (capability fixtures, not real Google generation)",()=>{
  it("Gemini requires paid mode and its own quote; assisted defaults are preserved",()=>{
    const settings=providerSettingsSchema.parse({mode:"GEMINI_ONLY",paidMode:true,maxCostUsd:3,dailyBudgetUsd:6,monthlyBudgetUsd:20});
    const ready={...snapshot,geminiAvailable:true,geminiEstimateUsd:2};
    expect(routeVideoJob(settings,fresh,ready)).toMatchObject({action:"SUBMIT",provider:"gemini_omni_api"});
    expect(routeVideoJob({...settings,paidMode:false},fresh,ready).reason).toBe("PAID_MODE_DISABLED");
    expect(routeVideoJob(settings,fresh,{...ready,geminiEstimateUsd:null})).toMatchObject({action:"WAIT",provider:"gemini_omni_api"});
    expect(routeVideoJob(settings,fresh,{...ready,geminiAvailable:false}).reason).toBe("GEMINI_UNAVAILABLE");
    expect(routeVideoJob({...settings,paidFallback:true},fresh,{...ready,geminiAvailable:false})).toMatchObject({action:"SUBMIT",provider:"fal_ai"});
    expect(routeVideoJob(settings,{...fresh,provider:"gemini_omni_api",submission:"SUBMITTING"},ready).action).toBe("RECONCILE");
  });
  it("defaults to no paid permission and no budget",()=>{expect(defaultProviderSettings()).toMatchObject({mode:"AUTO",paidFallback:false,maxCostUsd:0,autoRecovery:false});});
  it("requires ordered positive caps for every paid mode",()=>{expect(()=>providerSettingsSchema.parse({mode:"FAL_ONLY"})).toThrow();expect(()=>providerSettingsSchema.parse({paidFallback:true,maxCostUsd:1,dailyBudgetUsd:.5,monthlyBudgetUsd:10})).toThrow();});
  it("chooses verified automation capability before fal",()=>expect(routeVideoJob(paid(),fresh,snapshot).provider).toBe("google_vids_omni"));
  it("actual Vids adapter always returns Assisted and unknown quota",async()=>{const p=new GoogleVidsOmniProvider();expect(p.health(defaultProviderSettings())).toMatchObject({automated:false,quotaUsed:null,quotaRemaining:null});expect(routeVideoJob(paid(),fresh,{...snapshot,google:p.health(paid())}).action).toBe("ASSIST");await expect(p.submit()).rejects.toThrow("ASSISTED_ONLY");});
  it.each(["QUOTA_EXHAUSTED","LOGIN_EXPIRED","UNAVAILABLE"] as const)("falls back for %s only with approved limits",status=>{
    const state={...snapshot,google:{status,automated:false}};expect(routeVideoJob(paid(),fresh,state)).toMatchObject({action:"SUBMIT",provider:"fal_ai"});
    expect(routeVideoJob(defaultProviderSettings(),fresh,state).action).toBe("WAIT");
    expect(routeVideoJob({...paid(),mode:"GOOGLE_ONLY"},fresh,state).action).toBe("WAIT");
  });
  it("backs off and stops Google retry before permitted fallback",()=>{const state={...snapshot,google:{status:"TRANSIENT_FAILURE" as const,automated:true}},now=new Date("2026-10-12T00:00:00Z");
    expect(routeVideoJob(paid(),fresh,state,now)).toMatchObject({action:"WAIT",retryAt:"2026-10-12T00:00:05.000Z"});
    expect(routeVideoJob(paid(),{...fresh,retries:2},state,now).provider).toBe("fal_ai");
    expect(routeVideoJob({...paid(),autoRecovery:false},fresh,state,now).reason).toBe("RECOVERY_DISABLED");
  });
  it("returns to Google for new jobs, keeps known fal request when settings change",()=>{expect(routeVideoJob(paid(),fresh,snapshot).provider).toBe("google_vids_omni");expect(routeVideoJob({...paid(),mode:"GOOGLE_ONLY"},{...fresh,provider:"fal_ai",submission:"ACCEPTED",requestId:"known"},snapshot)).toMatchObject({action:"POLL",provider:"fal_ai"});});
  it.each(["EXTERNAL_PENDING","SUBMITTING"] as const)("never buys replacement for %s, even FAL ONLY",submission=>expect(routeVideoJob({...paid(),mode:"FAL_ONLY"},{...fresh,submission},snapshot).action).toBe("RECONCILE"));
  it.each([null,0,-.1,NaN,Infinity,1.01])("blocks missing/invalid/over-cap estimate %s",estimateUsd=>expect(routeVideoJob({...paid(),mode:"FAL_ONLY"},fresh,{...snapshot,estimateUsd}).action).toBe("WAIT"));
  it("queues if balance guard or fal availability rejects",()=>{expect(routeVideoJob({...paid(),mode:"FAL_ONLY"},fresh,{...snapshot,budgetAvailable:false}).action).toBe("WAIT");expect(routeVideoJob({...paid(),mode:"FAL_ONLY"},fresh,{...snapshot,falAvailable:false}).reason).toBe("FAL_UNAVAILABLE");});
  it.each(["COMPLETED","REVIEW_REQUIRED","FAILED"] as const)("terminal %s never creates another job",state=>expect(routeVideoJob(paid(),{...fresh,state},snapshot).action).toBe("DONE"));
  it("accepts only server-issued admin/developer role",()=>{expect(()=>assertProviderAdministrator(null)).toThrow();expect(()=>assertProviderAdministrator({app_metadata:{}})).toThrow();expect(()=>assertProviderAdministrator({app_metadata:{viralflow_role:"member"}})).toThrow();expect(()=>assertProviderAdministrator({app_metadata:{viralflow_role:"admin"}})).not.toThrow();});
  it.each(["FAL_ONLY","GEMINI_ONLY"] as const)("%s cannot override a reviewed real-media production decision",mode=>{
    const settings=providerSettingsSchema.parse({mode,paidMode:true,paidFallback:true,maxCostUsd:3,dailyBudgetUsd:6,monthlyBudgetUsd:20});
    for(const productionMethod of ["REAL_FOOTAGE_EDIT","REAL_IMAGE_MOTION"] as const){
      expect(routeVideoJob(settings,fresh,{...snapshot,productionMethod,geminiAvailable:true,geminiEstimateUsd:2}))
        .toMatchObject({action:"ASSIST",provider:"google_vids_omni",reason:"REAL_MEDIA_EDIT_ONLY_NO_GENERATIVE_PRODUCT"});
    }
    expect(routeVideoJob(settings,fresh,{...snapshot,productionMethod:"WAIT_FOR_EVIDENCE",geminiAvailable:true,geminiEstimateUsd:2}))
      .toMatchObject({action:"WAIT",provider:null,reason:"VERIFIED_CREATIVE_EVIDENCE_REQUIRED"});
  });
  it.each(["fal_ai","gemini_omni_api"] as const)("keeps known %s identity when a later strategy prohibits new generation",provider=>{
    for(const productionMethod of ["REAL_FOOTAGE_EDIT","REAL_IMAGE_MOTION","WAIT_FOR_EVIDENCE"] as const){
      expect(routeVideoJob(defaultProviderSettings(),{...fresh,provider,submission:"ACCEPTED",requestId:"existing-request"},
        {...snapshot,productionMethod})).toMatchObject({action:"POLL",provider,reason:"RESUME_SAME_REQUEST"});
      expect(routeVideoJob(paid(),{...fresh,provider,submission:"SUBMITTING"},
        {...snapshot,productionMethod})).toMatchObject({action:"RECONCILE",provider});
    }
  });
  it.each(["REAL_FOOTAGE_EDIT","REAL_IMAGE_MOTION"] as const)("%s Google handoff describes editing and explicitly forbids reconstruction",productionMethod=>{
    const brief=new GoogleVidsOmniProvider().brief({productTitle:"Spin mop",hook:"ดูจุดหมุน",script:"ดูการทำงานจากภาพจริง",cta:"ตรวจรายละเอียด",productionMethod});
    expect(brief.assisted).toBe(true);expect(brief.quota).toBe("UNKNOWN");
    expect(brief.prompt).toContain("Editing brief only");
    expect(brief.prompt).toContain("Do not generate or reconstruct the product, hands, pivots or mechanism");
    expect(brief.instructions).not.toContain("Create AI videos");
    expect(brief.prompt).not.toContain("Create an 8-second");
  });
  it.each(["FAL_ONLY","GEMINI_ONLY"] as const)("%s cannot route an atmosphere concept into product-generation adapters",mode=>{
    const settings=providerSettingsSchema.parse({mode,paidMode:true,paidFallback:true,maxCostUsd:3,dailyBudgetUsd:6,monthlyBudgetUsd:20});
    expect(routeVideoJob(settings,fresh,{...snapshot,productionMethod:"GENERATIVE_ATMOSPHERE",geminiAvailable:true,geminiEstimateUsd:2}))
      .toMatchObject({action:"ASSIST",provider:"google_vids_omni",reason:"ATMOSPHERE_ASSISTED_TRANSPORT_ONLY"});
  });
  it("atmosphere handoff omits the product identity and explicitly disallows factual/product proof",()=>{
    const brief=new GoogleVidsOmniProvider().brief({productTitle:"PRIVATE-CATALOG-SKU-MOP-123",hook:"ถ้าเป็นคุณ จะสังเกตอะไร?",
      script:"ตั้งคำถามโดยไม่สรุปเหตุการณ์จริง",cta:"เสนอเรื่องที่อยากรู้",productionMethod:"GENERATIVE_ATMOSPHERE"});
    expect(brief.prompt).not.toContain("PRIVATE-CATALOG-SKU-MOP-123");
    expect(brief.prompt).not.toContain("productTitle");
    expect(brief.prompt).toContain("No featured product, product mechanism, claimed demonstration");
    expect(brief.prompt).toContain("not proof");
    expect(brief.assisted).toBe(true);
  });
});
