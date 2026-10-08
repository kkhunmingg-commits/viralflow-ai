import { describe,it,expect,vi } from "vitest";
import { ClaimLedger } from "./claim-ledger";
import { ComplianceEngine,categoryRisk } from "./engine";
import { evaluateWithBoundedRewrite,LiveSpeechGate,PublishGate } from "./gates";
import { CompositeSemanticClassifier,SAFE_LIVE_TEMPLATES } from "./semantic";
import { LocalSemanticClassifier } from "./semantic-local";
import {createPolicyTestPayload,POLICY_TEST_NOW} from "./policy-test-fixtures";
import type {ComplianceInput,ComplianceRewriter} from "./contracts";

const scope={ownerId:"11111111-1111-4111-8111-111111111111",productId:"22222222-2222-4222-8222-222222222222",
  accountId:"33333333-3333-4333-8333-333333333333",platform:"TIKTOK_SHOP",country:"TH",region:"TH",category:"SKINCARE",channel:"POST" as const};
function fixture(script="ช่วยเพิ่มความชุ่มชื้น"):ComplianceInput {
  return {scope:{...scope},stage:"PRE_GENERATION",content:{script},now:POLICY_TEST_NOW,
    claims:[{id:"44444444-4444-4444-8444-444444444444",ownerId:scope.ownerId,productId:scope.productId,text:"ช่วยเพิ่มความชุ่มชื้น",
      type:"COSMETIC",source:"verified product label",evidenceRefs:["55555555-5555-4555-8555-555555555555"],jurisdiction:"TH",expiresAt:null,
      verified:true,allowedChannels:["POST","LIVE"],conditions:[]}],
    evidence:[{id:"55555555-5555-4555-8555-555555555555",ownerId:scope.ownerId,productId:scope.productId,kind:"PRODUCT_LABEL",
      source:"https://example.test/label",sourceHash:"a".repeat(64),jurisdiction:"TH",verified:true,expiresAt:null}]};
}
const engine=(rewriter?:ComplianceRewriter)=>new ComplianceEngine({policy:async()=>createPolicyTestPayload(),rewriter});
describe("shared ComplianceEngine invariants",()=>{
  it("permits evidence-backed cosmetic facts with trace refs",async()=>{
    const result=await engine().evaluate(fixture());expect(result.status).toBe("PASS");expect(result.claimRefs).toHaveLength(1);expect(result.evidenceRefs).toHaveLength(1);
  });
  it("audit hashes distinguish products and actual media even when their wording is identical",async()=>{
    const input=fixture(),a=await engine().evaluate(input);
    const b=await engine().evaluate({...input,scope:{...input.scope,productId:"99999999-9999-4999-8999-999999999999"}});
    const c=await engine().evaluate({...input,media:{assetHash:"b".repeat(64),coverageComplete:false,evidenceRefs:[]}});
    expect(a.contentHash).not.toBe(b.contentHash);expect(a.contentHash).not.toBe(c.contentHash);
  });
  it.each(["owner","product","country","channel","expired claim","expired evidence","unverified","condition","missing evidence"])("rejects %s claim authority",async(kind)=>{
    const input=fixture();
    if(kind==="owner")input.claims[0].ownerId="other";
    if(kind==="product")input.claims[0].productId="other";
    if(kind==="country")input.evidence[0].jurisdiction="US";
    if(kind==="channel")input.claims[0].allowedChannels=["LIVE"];
    if(kind==="expired claim")input.claims[0].expiresAt="2020-01-01T00:00:00Z";
    if(kind==="expired evidence")input.evidence[0].expiresAt="2020-01-01T00:00:00Z";
    if(kind==="unverified")input.claims[0].verified=false;
    if(kind==="condition")input.claims[0].conditions=["external verified eligibility"];
    if(kind==="missing evidence")input.evidence=[];
    expect((await engine().evaluate(input)).status).toBe("REVIEW_REQUIRED");
  });
  it("does not normalize decimals, signs and units into different factual promises",()=>{
    const input=fixture();input.claims[0].text="ความกว้าง 10.5 cm";
    const ledger=new ClaimLedger(input.scope,input.claims,input.evidence,Date.parse(POLICY_TEST_NOW));
    expect(ledger.state("ความกว้าง 10.5 cm")).toBe("VERIFIED");expect(ledger.state("ความกว้าง 105 cm")).toBe("UNKNOWN");
  });
  it("rechecks a ledger-only rewrite and retains input/output hashes",async()=>{
    const result=await evaluateWithBoundedRewrite(engine(),fixture("วัสดุเป็นทองแท้"));
    expect(result.input.content.script).toBe("ช่วยเพิ่มความชุ่มชื้น");expect(result.decision.status).toBe("PASS");expect(result.decision.rewrites).toHaveLength(1);
  });
  it("does not turn rewrite into authorization without rescanning",async()=>{
    const rewrite=vi.fn(async()=>({script:"ยังมีคำกล่าวอ้างที่ไม่มีหลักฐาน"}));
    const result=await evaluateWithBoundedRewrite(engine({rewrite}),fixture("วัสดุเป็นทองแท้"));
    expect(result.decision.status).toBe("REVIEW_REQUIRED");expect(rewrite.mock.calls.length).toBeLessThanOrEqual(3);
  });
  it("does not soften prohibited treatment even if ledger has that claim",async()=>{
    const input=fixture("รักษาสิวหายขาด");input.claims[0].text="รักษาสิวหายขาด";
    expect((await engine().evaluate(input)).status).toBe("BLOCK");
  });
  it.each(Object.values(SAFE_LIVE_TEMPLATES))("allows neutral refusal context: %s",async(text)=>{
    expect((await engine().evaluate(fixture(text))).status).toBe("PASS");
  });
  it("missing/failing current policy cannot pass",async()=>{
    expect((await new ComplianceEngine({policy:async()=>null}).evaluate(fixture())).status).toBe("REVIEW_REQUIRED");
    expect((await new ComplianceEngine({policy:async()=>{throw new Error("offline")}}).evaluate(fixture())).status).toBe("REVIEW_REQUIRED");
  });
  it("semantic model failure and uncertainty cannot override grounding",async()=>{
    const classifier=new CompositeSemanticClassifier({classify:async()=>{throw new Error("unavailable")}});
    expect((await new ComplianceEngine({policy:async()=>createPolicyTestPayload(),classifier}).evaluate(fixture())).status).toBe("REVIEW_REQUIRED");
  });
  it("requires actual-media transcript/OCR/cover and verified visual coverage",async()=>{
    const input=fixture();input.stage="FINAL_PUBLISH";input.aiGenerated=true;input.disclosureApplied=true;
    const result=await new PublishGate(engine()).check(input);
    expect(result.allowed).toBe(false);expect(result.decision.reasons.some(reason=>reason.code==="VISUAL_REVIEW_REQUIRED")).toBe(true);
    input.media={assetHash:"b".repeat(64),coverageComplete:true,evidenceRefs:[input.evidence[0].id]};
    input.content={...input.content,transcript:input.content.script,onScreenText:[],coverText:""};
    expect((await new PublishGate(engine()).check(input)).allowed).toBe(false);
    input.evidence[0].kind="MEDIA_REVIEW";input.evidence[0].sourceHash=input.media.assetHash;
    expect((await new PublishGate(engine()).check(input)).allowed).toBe(true);
  });
  it("AIGC disclosure absent or final-media unsupported fact blocks final publish",async()=>{
    const input=fixture();input.stage="FINAL_PUBLISH";input.aiGenerated=true;
    expect((await new PublishGate(engine()).check(input)).allowed).toBe(false);
  });
  it("LIVE forces channel policy before TTS and preserves cancellation",async()=>{
    const input=fixture();input.claims[0].allowedChannels=["POST"];
    const gate=new LiveSpeechGate(engine(),()=>input);
    expect((await gate.authorize("ช่วยเพิ่มความชุ่มชื้น")).allowed).toBe(false);
    const abort=new AbortController();abort.abort();await expect(gate.authorize("ช่วยเพิ่มความชุ่มชื้น",abort.signal)).rejects.toThrow();
  });
  it("high-risk and unknown categories use conservative profile",()=>{
    expect(categoryRisk("Beauty")).toBe("HIGH");expect(categoryRisk("UNKNOWN")).toBe("HIGH");expect(categoryRisk("supplement")).toBe("CRITICAL");
  });
  it("local semantic adapter accepts only bounded schema, loopback and no redirect",async()=>{
    const request=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>{void _input;void _init;return new Response(JSON.stringify({response:JSON.stringify({findings:[],assertions:[],complete:true,uncertainty:[]})}))});
    await new LocalSemanticClassifier("test-local",request).classify(fixture());
    expect(request.mock.calls[0][0]).toBe("http://127.0.0.1:11434/api/generate");
    expect(request.mock.calls[0][1]).toMatchObject({redirect:"error"});
  });
});
