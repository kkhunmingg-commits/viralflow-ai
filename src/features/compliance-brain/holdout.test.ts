import { describe, expect, it } from "vitest";
import { COMPLIANCE_CORPUS } from "./corpus";
import { ComplianceEngine } from "./engine";
import { evaluateWithBoundedRewrite, passesCompliance } from "./gates";
import { HOLDOUT_SEMANTIC_CASES, holdoutInput } from "./holdout-corpus";
import { createSignedPolicyTestFixture } from "./policy-test-fixtures";
import type { ComplianceInput } from "./contracts";

const { payload } = createSignedPolicyTestFixture();
const engine = new ComplianceEngine({ policy: async () => payload });

describe("independent pre-integration holdout / not classifier training", () => {
  it("contains no sentence or case identifier from the existing regression corpus", () => {
    const texts = new Set(COMPLIANCE_CORPUS.map(row => row.text));
    const ids = new Set(COMPLIANCE_CORPUS.map(row => row.id));
    expect(HOLDOUT_SEMANTIC_CASES).toHaveLength(36);
    for (const row of HOLDOUT_SEMANTIC_CASES) {
      expect(texts.has(row.text)).toBe(false);
      expect(ids.has(row.id)).toBe(false);
    }
  });

  describe.each(["POST", "LIVE"] as const)("channel %s", channel => {
    it.each(HOLDOUT_SEMANTIC_CASES)("$id", async row => {
      const input = holdoutInput(row.text, row.category, channel, row.allowed ? row.text : undefined);
      const decision = await engine.evaluate(input);
      expect(passesCompliance(decision)).toBe(row.allowed);
      if (row.category === "skincare") expect(decision.categoryRisk).toBe("HIGH");
      if (row.allowed) expect(decision.claimRefs).toContain("holdout.claim");
      else expect(decision.reasons.length).toBeGreaterThan(0);
    });

    it("a novel indirect promise is replaced only with a verified fact and rescanned", async () => {
      const original = "เพียงทาก็เหมือนย้อนอายุผิวกลับไปวัยมัธยม";
      const fact = "น้ำหนักสุทธิ 42 กรัมตามฉลาก";
      const result = await evaluateWithBoundedRewrite(engine, holdoutInput(original, "skincare", channel, fact));
      expect(result.input.content.script).toBe(fact);
      expect(result.decision.status).toBe("PASS");
      expect(result.decision.rewrites).toHaveLength(1);
      expect(result.decision.rewrites[0]).toMatchObject({ status: "PASS" });
      expect(result.decision.rewrites[0]?.inputHash).not.toBe(result.decision.rewrites[0]?.outputHash);
      expect(result.input.content.script).not.toContain("ย้อนอายุ");
    });

    it("rejects supported-looking facts when evidence is expired, another owner's or an unsatisfied condition", async () => {
      const base = holdoutInput("ฉลากระบุส่วนผสมของ panthenol", "skincare", channel, "ฉลากระบุส่วนผสมของ panthenol");
      const invalid: ComplianceInput[] = [
        { ...base, evidence: base.evidence.map(row => ({ ...row, expiresAt: base.now! })) },
        { ...base, evidence: base.evidence.map(row => ({ ...row, ownerId: "holdout.other-owner" })) },
        { ...base, claims: base.claims.map(row => ({ ...row, conditions: ["specific-approved-placement"] })) },
      ];
      for (const input of invalid) expect(passesCompliance((await evaluateWithBoundedRewrite(engine, input)).decision)).toBe(false);
    });

    it("cannot approve a harmful rewrite that merely adds a cosmetic disclaimer", async () => {
      const authority = new ComplianceEngine({ policy: async () => payload,
        rewriter: { rewrite: async () => ({ script: "ไม่ใช่ยา แต่ซ่อม DNA ผิวให้เหมือนวัยเด็ก" }) } });
      const result = await evaluateWithBoundedRewrite(authority,
        holdoutInput("รีเซ็ตเซลล์ผิวด้วยขวดเดียว", "skincare", channel));
      expect(passesCompliance(result.decision)).toBe(false);
      expect(result.decision.status).toBe("REVIEW_REQUIRED");
      expect(result.decision.rewrites.length).toBeLessThanOrEqual(2);
    });

    it("with no active policy even a verified cosmetic fact stays held", async () => {
      const unavailable = new ComplianceEngine({ policy: async () => null });
      const result = await unavailable.evaluate(holdoutInput("เนื้อสัมผัสครีมเนียน เกลี่ยด้วยมือ", "skincare", channel, "เนื้อสัมผัสครีมเนียน เกลี่ยด้วยมือ"));
      expect(result.status).toBe("REVIEW_REQUIRED");
      expect(result.reasons[0]?.code).toBe("POLICY_UNAVAILABLE");
    });
  });
});
