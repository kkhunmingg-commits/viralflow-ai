import {describe,expect,it} from "vitest";
import {COMPLIANCE_CORPUS,complianceCorpusInput} from "./corpus";
import {ComplianceEngine} from "./engine";
import {createSignedPolicyTestFixture} from "./policy-test-fixtures";
import {NEUTRAL_CHAT_PHRASES,SAFE_LIVE_TEMPLATES,isNeutralStatement} from "./semantic";

const {payload}=createSignedPolicyTestFixture();
const engine=new ComplianceEngine({policy:async()=>payload});
describe.each(["POST","LIVE"] as const)("grounded semantic regression corpus / %s",channel=>{
  it.each(COMPLIANCE_CORPUS)("$id → $expected",async test=>{
    const decision=await engine.evaluate(complianceCorpusInput(test,channel));
    expect(decision.status).toBe(test.expected);
    if(test.expected==="PASS"&&test.approvedClaim)expect(decision.claimRefs).toContain("fixture.claim");
    if(test.expected==="AUTO_REWRITE"){
      expect(decision.suggestedRewrite?.script).toBe(test.approvedClaim);
      expect((await engine.evaluate({...complianceCorpusInput(test,channel),content:decision.suggestedRewrite!})).status).toBe("PASS");
    }
  });
});
it("has at least fifty unique Thai, English and mixed cases across skincare and general products",()=>{
  expect(COMPLIANCE_CORPUS.length).toBeGreaterThanOrEqual(50);
  expect(new Set(COMPLIANCE_CORPUS.map(row=>row.id)).size).toBe(COMPLIANCE_CORPUS.length);
  expect(COMPLIANCE_CORPUS.some(row=>/[ก-๙]/.test(row.text)&&/[A-Za-z]/.test(row.text))).toBe(true);
});
describe("neutral runtime utterances",()=>{
  it.each([...NEUTRAL_CHAT_PHRASES,...Object.values(SAFE_LIVE_TEMPLATES)])("allows the exact non-factual template: %s",async text=>{
    expect(isNeutralStatement(text)).toBe(true);
    expect((await engine.evaluate(complianceCorpusInput({id:"neutral.runtime",category:"skincare",text,expected:"PASS"},"LIVE"))).status).toBe("PASS");
  });
  it("cannot use a greeting as a prefix to allow a new product claim",async()=>{
    const text="สวัสดีค่ะ ครีมนี้รักษาสิวให้หายขาด";
    expect(isNeutralStatement(text)).toBe(false);
    expect((await engine.evaluate(complianceCorpusInput({id:"neutral.append",category:"skincare",text,expected:"BLOCK"},"LIVE"))).status).toBe("BLOCK");
  });
});
