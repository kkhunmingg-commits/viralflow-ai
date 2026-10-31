import { describe, expect, it } from "vitest";
import { creativeConceptSchema } from "./schemas";
import { assertHumanProductionReview, planCreativeStrategy, summarizeUsableProductionCost,
  type CreativeStrategyInput, type ProductionCostAttempt, type StrategyAsset, type StrategyFact } from "./strategist";
import type { TrendIntelligenceReport } from "../growth-manager/topics";

const now = new Date("2026-10-13T12:00:00Z");
const asset = (kind: StrategyAsset["kind"], overrides: Partial<StrategyAsset> = {}): StrategyAsset => ({
  id: kind, kind, source: "OWNER", reference: "owner-reviewed-media-record", rightsConfirmed: true,
  reviewed: true, productId: "mop", durationSeconds: kind === "REAL_IMAGE" ? undefined : 8, ...overrides });
const fact = (overrides: Partial<StrategyFact> = {}): StrategyFact => ({ id: "fact-1", text: "ด้ามกดหมุนในตะแกรงของถัง",
  source: "OWNER_FOOTAGE", reference: "owner-reviewed-footage-observation", verified: true,
  capturedAt: "2026-10-13T10:00:00Z", productId: "mop", role: "OBSERVATION", ...overrides });
const product = (overrides: Partial<CreativeStrategyInput> = {}): CreativeStrategyInput => ({ now,
  account: { id: "new-pilot", mode: "AFFILIATE", affiliateEligible: true },
  product: { id: "mop", title: "ถังปั่นไม้ถูพื้น", mechanism: "COMPLEX" },
  facts: [fact()], assets: [asset("REAL_FOOTAGE"), asset("REAL_IMAGE")], ...overrides });
const trend = (): TrendIntelligenceReport => ({ status: "REAL_OBSERVATIONS", observations: [{
  key: "organizing-observation", topic: "จัดโต๊ะ", sourceReference: "https://trends.google.com/trends/",
  collection: "MANUAL_PUBLIC_OBSERVATION", capturedAt: now.toISOString(), freshnessHours: 0,
  accountFit: "OWN_ACCOUNT", productFit: "UNKNOWN", audience: ["ผู้สนใจจัดโต๊ะ"], hookPattern: "QUESTION",
  storyPattern: "ONE_POINT", growth: { status: "UNKNOWN", metric: null, previous: null,
    current: null, relativeChange: null, comparableWindows: 0 }, confidence: "OBSERVATION_ONLY",
  visualUse: "UNKNOWN", reasons: ["This test exercises normalized evidence, not live trend fetching"] }],
  excluded: [], hypotheses: [], viralOutcome: "UNKNOWN", requiresHumanReview: true });
const growth = (overrides: Partial<CreativeStrategyInput> = {}): CreativeStrategyInput => ({ now,
  account: { id: "new-pilot", mode: "GROWTH", affiliateEligible: false }, trends: trend(),
  facts: [fact({ productId: undefined, topic: "จัดโต๊ะ", text: "ภาพนี้แสดงพื้นที่ว่างข้างสมุดหนึ่งจุด", source: "AUTHORIZED_SOURCE" })],
  assets: [asset("REAL_IMAGE", { productId: undefined, topic: "จัดโต๊ะ" })], ...overrides });

describe("evidence-grounded creative strategy", () => {
  it("offers three contiguous 8-second concepts without declaring creative quality passed", () => {
    const plan = planCreativeStrategy(product());
    expect(plan.concepts).toHaveLength(3);
    expect(plan.concepts.every(c => creativeConceptSchema.safeParse(c.concept).success)).toBe(true);
    expect(plan.humanReviewRequired).toBe(true);
    expect(plan.predictedVirality).toBe("UNKNOWN");
    expect(plan.source).toBe("DETERMINISTIC_EVIDENCE_RUBRIC");
    expect(plan.concepts.every(c => c.status !== ("PASS" as string))).toBe(true);
  });
  it("selects real continuous demonstration for a complex pivot and never fabricates mechanics", () => {
    const plan = planCreativeStrategy(product());
    expect(plan.selectedConceptId).toBe("real-demonstration");
    const selected = plan.concepts.find(c => c.id === plan.selectedConceptId)!;
    expect(selected.production.method).toBe("REAL_FOOTAGE_EDIT");
    expect(selected.production.evidenceIds).toContain("REAL_FOOTAGE");
    expect(selected.concept.scenePlan[1].visual).toContain("ไม่สร้างแกน");
    expect(plan.analysis.mechanismRisk).toBe("REAL_FOOTAGE_REQUIRED");
  });
  it("chooses an honest real-image alternate when no mechanism footage is available", () => {
    const plan = planCreativeStrategy(product({ assets: [asset("REAL_IMAGE")] }));
    expect(plan.selectedConceptId).toBe("real-image-detail");
    expect(plan.concepts.find(c => c.id === "real-demonstration")?.status).toBe("WAIT_FOR_EVIDENCE");
    expect(plan.concepts.find(c => c.id === "real-image-detail")?.production.method).toBe("REAL_IMAGE_MOTION");
    expect(plan.concepts.every(c => c.production.method !== "GENERATIVE_ATMOSPHERE")).toBe(true);
  });
  it("does not claim a demonstration from footage the ledger says shows no operation", () => {
    const plan = planCreativeStrategy(product({ assets: [asset("REAL_FOOTAGE", { depictsOperation: false }), asset("REAL_IMAGE")] }));
    expect(plan.concepts.find(c => c.id === "real-demonstration")?.status).toBe("WAIT_FOR_EVIDENCE");
    expect(plan.selectedConceptId).toBe("real-image-detail");
  });
  it("requires real demonstration footage to cover the actual eight-second timeline", () => {
    for (const durationSeconds of [undefined, 5]) {
      const plan = planCreativeStrategy(product({ assets: [asset("REAL_FOOTAGE", { durationSeconds })] }));
      expect(plan.concepts.find(c => c.id === "real-demonstration")?.status).toBe("WAIT_FOR_EVIDENCE");
    }
  });
  it.each(["COMPLEX", "UNKNOWN", "SIMPLE"] as const)("never turns %s product visuals into generative functional proof", mechanism => {
    const plan = planCreativeStrategy(product({ product: { id: "mop", title: "สินค้า", mechanism }, assets: [] }));
    expect(plan.concepts.every(c => c.status === "WAIT_FOR_EVIDENCE" && c.production.method === "WAIT_FOR_EVIDENCE")).toBe(true);
  });
  it("refuses mock, unlicensed, unreviewed or different-product media", () => {
    const rows = [asset("REAL_FOOTAGE", { source: "MOCK" }), asset("REAL_IMAGE", { reviewed: false }),
      asset("COMPARISON_FOOTAGE", { productId: "another-product" }), asset("REAL_IMAGE", { rightsConfirmed: false })];
    expect(planCreativeStrategy(product({ assets: rows })).concepts.every(c => !c.production.ready)).toBe(true);
  });
  it("exposes unknown problem and hypothesis audience rather than inventing product benefits", () => {
    const plan = planCreativeStrategy(product({ facts: [] }));
    expect(plan.analysis.problem).toBeNull();
    expect(plan.analysis.sellingPoints).toEqual([]);
    expect(plan.analysis.audience.status).toBe("HYPOTHESIS");
    expect(plan.concepts.find(c => c.id === "evidence-comparison")?.status).toBe("WAIT_FOR_EVIDENCE");
  });
  it("requires verified facts for comparison and blocks inherited unsupported medical claims", () => {
    const missing = planCreativeStrategy(product({ assets: [asset("COMPARISON_FOOTAGE")], facts: [fact({ verified: false })] }));
    expect(missing.concepts.find(c => c.id === "evidence-comparison")?.status).toBe("WAIT_FOR_EVIDENCE");
    const unsafe = planCreativeStrategy(product({ assets: [asset("COMPARISON_FOOTAGE")], facts: [fact({ text: "รักษาโรคหายขาดแน่นอน" })] }));
    expect(unsafe.concepts.find(c => c.id === "evidence-comparison")?.status).toBe("REJECTED");
  });
  it("does not reuse facts from a different product, mock source or future observation", () => {
    const plan = planCreativeStrategy(product({ assets: [asset("COMPARISON_FOOTAGE")], facts: [
      fact({ productId: "different" }), fact({ source: "MOCK" }), fact({ capturedAt: "2027-01-01T00:00:00Z" })] }));
    expect(plan.concepts.find(c => c.id === "evidence-comparison")?.status).toBe("WAIT_FOR_EVIDENCE");
  });
  it("creates three Growth approaches with non-commerce calls to action", () => {
    const plan = planCreativeStrategy(growth());
    expect(plan.concepts).toHaveLength(4);
    expect(plan.concepts.every(c => !/ตะกร้า|ซื้อ|สั่ง/.test(c.concept.cta))).toBe(true);
    expect(plan.concepts.some(c => /ติดตาม/.test(c.concept.cta))).toBe(true);
    expect(plan.trendStatus).toBe("OBSERVED");
    expect(plan.analysis.audience.status).toBe("OBSERVED");
  });
  it("offers a zero-cost original graphic story for Growth only when a short verified fact exists", () => {
    const ready = planCreativeStrategy(growth({ assets: [], facts: [fact({ productId: undefined, topic: "จัดโต๊ะ", text: "วางของใช้บ่อยไว้ใกล้มือ", source: "AUTHORIZED_SOURCE" })] }));
    const graphic = ready.concepts.find(c => c.id === "growth-graphic-explainer")!;
    expect(graphic.production).toMatchObject({ method: "ORIGINAL_GRAPHIC_STORY", ready: true, missingEvidence: [] });
    expect(graphic.status).toBe("REVIEW_REQUIRED");
    expect(graphic.reasons.join(" ")).toContain("กราฟิกต้นฉบับ");
    const long = planCreativeStrategy(growth({ assets: [], facts: [fact({ productId: undefined, topic: "จัดโต๊ะ", source: "AUTHORIZED_SOURCE",
      text: "ข้อเท็จจริงนี้ยาวเกินกว่าจะอ่านทันบนการ์ดเดียวในเวลาสองวินาทีครึ่ง" })] }));
    expect(long.concepts.find(c => c.id === "growth-graphic-explainer")?.status).toBe("WAIT_FOR_EVIDENCE");
    expect(planCreativeStrategy(growth({ assets: [], facts: [] })).concepts.find(c => c.id === "growth-graphic-explainer")?.production.ready).toBe(false);
    expect(planCreativeStrategy(product()).concepts.some(c => c.production.method === "ORIGINAL_GRAPHIC_STORY")).toBe(false);
  });
  it("permits generative atmosphere only for non-evidentiary Growth questions", () => {
    const plan = planCreativeStrategy(growth({ assets: [], facts: [] }));
    expect(plan.selectedConceptId).toBe("growth-pov-question");
    const selected = plan.concepts.find(c => c.id === plan.selectedConceptId)!;
    expect(selected.production.method).toBe("GENERATIVE_ATMOSPHERE");
    expect(selected.concept.scenePlan[1].visual).toContain("ไม่แสดงผลสินค้า");
    expect(selected.status).toBe("REVIEW_REQUIRED");
  });
  it("keeps category momentum a hypothesis and reports UNKNOWN trend evidence", () => {
    const plan = planCreativeStrategy(growth({ trends: undefined, topics: [{ name: "จัดโต๊ะ", key: "home", source: "tiktok_shop",
      capturedAt: now.toISOString(), authorized: true, confidence: .8, momentum: 70, accountEffect: .1 }] }));
    expect(plan.topic).toBe("จัดโต๊ะ");
    expect(plan.trendStatus).toBe("UNKNOWN");
    expect(plan.predictedVirality).toBe("UNKNOWN");
  });
  it("does not turn absent topics into fabricated trends", () => {
    const plan = planCreativeStrategy(growth({ trends: undefined, topics: [], facts: [], assets: [] }));
    expect(plan.topic).toBeNull();
    expect(plan.concepts.every(c => c.status === "WAIT_FOR_EVIDENCE" && c.confidence === null)).toBe(true);
  });
  it("uses learning support only from actual same-account evidence", () => {
    const learning: NonNullable<CreativeStrategyInput["learning"]> = { accountId: "other-account", source: "REAL",
      evidenceIds: ["post-1"], preferredAngle: "REVIEW_DISCOVERY", preferredHook: null, confidence: .8 };
    expect(planCreativeStrategy(product({ learning })).concepts.every(c => c.rubric.learningSupport === 0)).toBe(true);
    expect(planCreativeStrategy(product({ learning: { ...learning, accountId: "new-pilot", source: "MOCK" } })).concepts.every(c => c.rubric.learningSupport === 0)).toBe(true);
    const plan = planCreativeStrategy(product({ learning: { ...learning, accountId: "new-pilot" } }));
    expect(plan.selectedConceptId).toBe("real-image-detail");
    expect(plan.concepts[0].rubric.learningSupport).toBe(8);
  });
  it("holds Affiliate concepts without confirmed eligibility", () => {
    const plan = planCreativeStrategy(product({ account: { id: "new-pilot", mode: "AFFILIATE", affiliateEligible: null } }));
    expect(plan.concepts.every(c => !c.production.ready)).toBe(true);
  });
  it("requires genuine human review bound to unchanged plan, evidence and concept", () => {
    const plan = planCreativeStrategy(product());
    expect(() => assertHumanProductionReview(plan)).toThrow("HUMAN_CREATIVE_REVIEW_REQUIRED");
    const review = { fingerprint: plan.fingerprint, conceptId: plan.selectedConceptId, reviewedBy: "authenticated-owner",
      creativeApproved: true, factualAccuracyApproved: true, mediaRightsApproved: true };
    expect(assertHumanProductionReview(plan, review).id).toBe(plan.selectedConceptId);
    expect(() => assertHumanProductionReview(plan, { ...review, factualAccuracyApproved: false })).toThrow();
    expect(() => assertHumanProductionReview(plan, { ...review, fingerprint: "stale" })).toThrow();
    const changed = structuredClone(plan);
    changed.concepts[0].production.method = "GENERATIVE_ATMOSPHERE";
    expect(() => assertHumanProductionReview(changed, review)).toThrow();
    const waiting = planCreativeStrategy(product({ assets: [] }));
    expect(() => assertHumanProductionReview(waiting, { ...review, fingerprint: waiting.fingerprint })).toThrow();
  });
});

describe("actual usable cost, not nominal generation price", () => {
  const attempt = (id: string, overrides: Partial<ProductionCostAttempt> = {}): ProductionCostAttempt => ({ id,
    method: "REAL_FOOTAGE_EDIT", outputId: id, actualCostThb: 3, billingVerified: true, usable: true, ...overrides });
  it("includes failures and repeat generation in the cost of usable outputs", () => {
    expect(summarizeUsableProductionCost([attempt("first", { usable: false }), attempt("retry")])).toMatchObject({
      status: "OBSERVED", totalActualThb: 6, usableOutputs: 1, costPerUsableThb: 6, targetMet: false });
  });
  it("does not hide failed generation spend when switching to real-footage editing", () => {
    const plan=planCreativeStrategy(product({costs:[attempt("failed-generation",{method:"GENERATIVE_ATMOSPHERE",usable:false,actualCostThb:4}),attempt("accepted-edit",{actualCostThb:3})]}));
    expect(plan.concepts.every(c=>c.cost.totalActualThb===7&&c.cost.costPerUsableThb===7&&c.cost.targetMet===false)).toBe(true);
  });
  it("counts voice/editing/generation cost for one clip without inflating usable clip count", () => {
    const result = summarizeUsableProductionCost([attempt("generation", { outputId: "clip-1" }),
      attempt("voice", { outputId: "clip-1", actualCostThb: 1 }), attempt("editing", { outputId: "clip-1", actualCostThb: 2 })]);
    expect(result).toMatchObject({ totalActualThb: 6, usableOutputs: 1, costPerUsableThb: 6, targetMet: false });
  });
  it("keeps unknown billing/quality unknown rather than claiming free generation", () => {
    expect(summarizeUsableProductionCost([]).status).toBe("UNKNOWN");
    expect(summarizeUsableProductionCost([attempt("a", { actualCostThb: null })]).costPerUsableThb).toBeNull();
    expect(summarizeUsableProductionCost([attempt("a", { billingVerified: false })]).status).toBe("UNKNOWN");
    expect(summarizeUsableProductionCost([attempt("a", { usable: null })]).status).toBe("UNKNOWN");
  });
  it("never reports cost per usable output when all attempts were rejected", () => {
    expect(summarizeUsableProductionCost([attempt("a", { usable: false })])).toMatchObject({
      status: "NO_USABLE_OUTPUT", totalActualThb: 3, costPerUsableThb: null, targetMet: false });
  });
  it("deduplicates identical ledger rows but fails closed on contradictory billing", () => {
    const row = attempt("charge-1");
    expect(summarizeUsableProductionCost([row, row]).totalActualThb).toBe(3);
    expect(summarizeUsableProductionCost([row, { ...row, actualCostThb: 2 }]).status).toBe("UNKNOWN");
  });
});
