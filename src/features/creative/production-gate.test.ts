import {describe,expect,it} from "vitest";
import {planCreativeStrategy} from "./strategist";
import {CREATIVE_STRATEGY_VERSION} from "./strategist";
import {creativeScriptDigest,reviewedProductionMethod,storedProductionStrategy} from "./production-gate";
const now = new Date("2026-10-13T12:00:00Z");
function source() {
  const plan=planCreativeStrategy({now,account:{id:"a",mode:"AFFILIATE",affiliateEligible:true},product:{id:"p",title:"ไม้ถูพื้น",mechanism:"COMPLEX"},facts:[],
    assets:[{id:"footage",kind:"REAL_FOOTAGE",source:"OWNER",reference:"owner/fixture.mp4",productId:"p",rightsConfirmed:true,reviewed:true,durationSeconds:8}]});
  const selected=plan.concepts.find(c=>c.id===plan.selectedConceptId)!;
  const script={hook_text:selected.concept.hook,voice_script:selected.concept.voiceScript,cta_text:selected.concept.cta,caption:selected.concept.caption,scene_plan_json:selected.concept.scenePlan,overlay_text_json:selected.concept.overlayText};
  const metadata={plan,conceptId:selected.id,productId:"p",scriptDigest:creativeScriptDigest(script),review:{fingerprint:plan.fingerprint,conceptId:selected.id,reviewedBy:"owner",creativeApproved:true,factualAccuracyApproved:true,mediaRightsApproved:true}};
  return {angle:{score_explanation_json:{productionStrategy:metadata}},script,account:{id:"a"},product:{id:"p"}};
}
describe("review bound to selected account/product/script",()=>{
  it("preserves legacy rows and rejects malformed metadata",()=>{
    expect(storedProductionStrategy({})).toBeNull();expect(()=>storedProductionStrategy({score_explanation_json:{productionStrategy:{}}})).toThrow("CREATIVE_STRATEGY_INVALID");
  });
  it("permits only the human-reviewed production method",()=>expect(reviewedProductionMethod(source(),"owner")).toBe("REAL_FOOTAGE_EDIT"));
  it("keeps an approval valid after JSONB reorders nested object keys",()=>{
    const reorder=(value:unknown):unknown=>Array.isArray(value)?value.map(reorder):value&&typeof value==="object"
      ?Object.fromEntries(Object.entries(value as Record<string,unknown>).toReversed().map(([key,child])=>[key,reorder(child)])):value;
    const stored=JSON.parse(JSON.stringify(reorder(source()))) as ReturnType<typeof source>;
    expect(reviewedProductionMethod(stored,"owner")).toBe("REAL_FOOTAGE_EDIT");
    expect(creativeScriptDigest(stored.script)).toBe(creativeScriptDigest(source().script));
  });
  it("does not treat missing strategy metadata as permission to fall back to a legacy mock",()=>{
    const original=source();
    expect(()=>reviewedProductionMethod({...original,angle:{},script:{...original.script,version:CREATIVE_STRATEGY_VERSION}},"owner")).toThrow("CREATIVE_STRATEGY_INVALID");
    expect(reviewedProductionMethod({...original,angle:{},script:{...original.script,version:"creative-concept-v1"}},"owner")).toBeNull();
  });
  it("blocks pending reviews, another user, changed script and another account/product",()=>{
    const pending=source();pending.angle.score_explanation_json.productionStrategy.review=null as never;
    expect(()=>reviewedProductionMethod(pending,"owner")).toThrow();expect(()=>reviewedProductionMethod(source(),"someone-else")).toThrow();
    const changed=source();changed.script.voice_script="แก้ข้อความหลังอนุมัติ";expect(()=>reviewedProductionMethod(changed,"owner")).toThrow();
    expect(()=>reviewedProductionMethod({...source(),account:{id:"another"}},"owner")).toThrow();
    expect(()=>reviewedProductionMethod({...source(),product:{id:"another"}},"owner")).toThrow();
  });
});
