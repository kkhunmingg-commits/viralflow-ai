import { createHash, randomUUID } from "node:crypto";
import { ClaimLedger } from "./claim-ledger";
import type { ComplianceAuthority, ComplianceContent, ComplianceDecision, ComplianceInput, ComplianceRewriter,
  CategoryRisk, ComplianceReason, MediaComplianceScanner, SemanticRiskClassifier } from "./contracts";
import { contentTexts, GroundedSemanticClassifier } from "./semantic";
import type { PolicyPackPayload } from "./policy-registry";

export const contentHash = (content: ComplianceContent) => createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(content).sort(([a], [b]) => a.localeCompare(b))))).digest("hex");
export function categoryRisk(category: string): CategoryRisk {
  const value = category.toLowerCase();
  if(!value||["unknown","other","unclassified"].includes(value))return "HIGH";
  if (/medicine|ยา|medical|supplement|อาหารเสริม/.test(value)) return "CRITICAL";
  if (/skin|beauty|health|cosmetic|ความงาม|สุขภาพ|ผิว/.test(value)) return "HIGH";
  if (/food|electronics|gadget|อาหาร|อิเล็ก/.test(value)) return "MEDIUM";
  if (/general|household|home|office|houseware|ทั่วไป|ครัวเรือน|ของใช้/.test(value)) return "LOW";
  return "HIGH";
}
export class EvidenceMediaScanner implements MediaComplianceScanner {
  async scan(input: ComplianceInput) {
    const registry = new ClaimLedger(input.scope, input.claims, input.evidence, Date.parse(input.now ?? new Date().toISOString())).registry;
    const refs = (input.media?.evidenceRefs ?? []).filter(id => {
      const evidence = registry.get(id);
      return evidence?.kind === "MEDIA_REVIEW" && evidence.sourceHash === input.media?.assetHash;
    });
    return { status: input.media?.coverageComplete && refs.length > 0 ? "VERIFIED" as const : "VISUAL_REVIEW_REQUIRED" as const,
      findings: [], evidenceRefs: refs };
  }
}
export class LedgerOnlyRewriter implements ComplianceRewriter {
  async rewrite(input: ComplianceInput) {
    const ledger = new ClaimLedger(input.scope, input.claims, input.evidence, Date.parse(input.now ?? new Date().toISOString()), input.satisfiedConditions);
    const facts = ledger.permitted().filter(row => !/medical|certif|guarantee/i.test(row.type)).map(row => row.text);
    if (!facts.length) return null;
    // Replace unsupported claims with approved statements, never improve a risky promise with a disclaimer.
    const text = [...new Set(facts)].slice(0, 3).join("\n");
    const replacement = Object.fromEntries(Object.keys(input.content).map(key => [key,
      ["hashtags", "onScreenText", "visibleClaims", "metadata"].includes(key) ? [] : text])) as ComplianceContent;
    return replacement;
  }
}
export class ComplianceEngine implements ComplianceAuthority {
  constructor(private readonly options: { policy: (input: ComplianceInput) => Promise<PolicyPackPayload | null>;
    classifier?: SemanticRiskClassifier; scanner?: MediaComplianceScanner; rewriter?: ComplianceRewriter }) {}
  async evaluate(input: ComplianceInput, signal?: AbortSignal): Promise<ComplianceDecision> {
    signal?.throwIfAborted();
    const now = input.now ?? new Date().toISOString(), profile = categoryRisk(input.scope.category), reasons: ComplianceReason[] = [];
    const policyRefs = new Set<string>(), claimRefs = new Set<string>(), evidenceRefs = new Set<string>();
    const make = (status: ComplianceDecision["status"], riskScore: number, version: string | null, rewrite: ComplianceContent | null = null): ComplianceDecision => ({
      id: randomUUID(), status, riskScore, categoryRisk: profile, policyVersion: version, policyRefs: [...policyRefs],
      claimRefs: [...claimRefs], evidenceRefs: [...evidenceRefs], reasons, suggestedRewrite: rewrite,
      contentHash: createHash("sha256").update(JSON.stringify({content:contentHash(input.content),
        product:input.scope.productId,asset:input.media?.assetHash??null})).digest("hex"),
      checkedAt: now, scope: input.scope, stage: input.stage, rewrites: [],
    });
    if (!Number.isFinite(Date.parse(now)) || !contentTexts(input).length) {
      reasons.push({ code: "CONTENT_UNKNOWN", message: "ยังไม่มีข้อมูลครบสำหรับตรวจสอบ", policyRefs: [] });
      return make("REVIEW_REQUIRED", 100, null);
    }
    let pack: PolicyPackPayload | null;
    try { pack = await this.options.policy(input); } catch { pack = null; }
    if (!pack || pack.country !== input.scope.country || pack.platform !== input.scope.platform
      || ![input.scope.region,"*"].includes(pack.region) || !pack.rules.some(rule=>rule.contentTypes.includes(input.scope.channel)
        && (rule.categories.includes("*")||rule.categories.includes(input.scope.category)))) {
      reasons.push({ code: "POLICY_UNAVAILABLE", message: "กำลังรอข้อมูลนโยบายที่ตรวจสอบแล้ว", policyRefs: [] });
      return make("REVIEW_REQUIRED", 100, null);
    }
    const ledger = new ClaimLedger(input.scope, input.claims, input.evidence, Date.parse(now), input.satisfiedConditions);
    let assessment;
    try { assessment = await (this.options.classifier ?? new GroundedSemanticClassifier()).classify({ ...input, now }, signal); }
    catch { reasons.push({ code: "SEMANTIC_UNAVAILABLE", message: "ยังตรวจสอบความหมายได้ไม่ครบ", policyRefs: [] }); return make("REVIEW_REQUIRED", 100, pack.version); }
    let blocked = false, review = !assessment.complete || assessment.uncertainty.length > 0, rewriteable = false, warning = false, riskScore = review ? 90 : 0;
    for (const assertion of assessment.assertions) {
      const matches = ledger.match(assertion);
      matches.forEach(claim => { claimRefs.add(claim.id); claim.evidenceRefs.forEach(ref => evidenceRefs.add(ref)); });
      if (!matches.length) { review = true; rewriteable = true; riskScore = Math.max(riskScore, profile === "HIGH" || profile === "CRITICAL" ? 90 : 70); }
    }
    for (const finding of assessment.findings) {
      if (finding.polarity === "NEGATED") continue;
      const rules = pack.rules.filter(rule => rule.contentTypes.includes(input.scope.channel)
        && (rule.categories.includes("*") || rule.categories.includes(input.scope.category)) && rule.semanticCategories.includes(finding.category));
      if (!rules.length) {
        review = true; reasons.push({ code: "UNMAPPED_RISK", category: finding.category, message: "ข้อมูลนี้ยังต้องตรวจสอบ", policyRefs: [] }); continue;
      }
      for (const rule of rules) {
        policyRefs.add(rule.id);
        const grounded = ledger.match(finding.text);
        // Verified cosmetic/packaging facts may satisfy evidence rules, but not prohibited treatment promises.
        if (finding.polarity === "ASSERTED" && rule.requiresEvidence && grounded.length > 0) continue;
        reasons.push({ code: rule.id, category: finding.category, message: "ข้อความอาจกล่าวอ้างเกินข้อมูลที่ตรวจสอบได้", policyRefs: [rule.id] });
        riskScore = Math.max(riskScore, ({ LOW: 25, MEDIUM: 55, HIGH: 85, CRITICAL: 100 } as const)[rule.severity]);
        if (finding.polarity === "QUESTION") { review = true; continue; }
        if (rule.recommendedDecision === "BLOCK") blocked = true;
        else if (rule.recommendedDecision === "PASS_WITH_WARNING") warning = true;
        else { review = true; rewriteable = true; }
      }
    }
    if (input.aiGenerated && !input.disclosureApplied) {
      review = true; riskScore = Math.max(riskScore, 70);
      const refs = pack.rules.filter(rule => rule.semanticCategories.includes("AIGC_DISCLOSURE")).map(rule => rule.id); refs.forEach(ref => policyRefs.add(ref));
      reasons.push({ code: "DISCLOSURE_REQUIRED", message: "ต้องระบุว่าเป็นเนื้อหาที่สร้างด้วย AI", policyRefs: refs });
    }
    if (input.stage === "POST_GENERATION" || input.stage === "FINAL_PUBLISH") {
      let media;
      try { media = await (this.options.scanner ?? new EvidenceMediaScanner()).scan({ ...input, now }, signal); }
      catch { media = { status: "VISUAL_REVIEW_REQUIRED" as const, findings: [], evidenceRefs: [] }; }
      media.evidenceRefs.forEach(ref => evidenceRefs.add(ref));
      if (media.status !== "VERIFIED" || input.content.transcript === undefined || input.content.onScreenText === undefined || input.content.coverText === undefined) {
        review = true; rewriteable = false; riskScore = Math.max(riskScore, 90);
        reasons.push({ code: "VISUAL_REVIEW_REQUIRED", message: "ต้องตรวจวิดีโอและข้อความที่ปรากฏจริงก่อนโพสต์", policyRefs: [] });
      }
      if (media.findings.length) { blocked = true; riskScore = 100; reasons.push({ code: "VISUAL_RISK", message: "ภาพอาจทำให้เข้าใจข้อมูลสินค้าผิด", policyRefs: [] }); }
    }
    if (blocked) return make("BLOCK", riskScore, pack.version);
    if (review) {
      if (!reasons.length) reasons.push({ code: "CLAIM_UNKNOWN", message: "ยังไม่มีหลักฐานยืนยันคำกล่าวอ้างนี้", policyRefs: [] });
      const decision = make("REVIEW_REQUIRED", riskScore, pack.version);
      let replacement:ComplianceContent|null=null;
      try { replacement = rewriteable ? await (this.options.rewriter ?? new LedgerOnlyRewriter()).rewrite({ ...input, now }, decision) : null; }
      catch { reasons.push({code:"REWRITE_UNAVAILABLE",message:"ต้องตรวจสอบข้อความก่อนใช้งาน",policyRefs:[]}); }
      return replacement ? { ...decision, status: "AUTO_REWRITE", suggestedRewrite: replacement } : decision;
    }
    return make(warning ? "PASS_WITH_WARNING" : "PASS", warning ? Math.max(25, riskScore) : riskScore, pack.version);
  }
}
