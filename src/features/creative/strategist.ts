import { createHash } from "node:crypto";
import type { EffectiveMode } from "../accounts/types";
import { chooseGrowthTopics, type TopicEvidence, type TrendIntelligenceReport } from "../growth-manager/topics";
import { checkProductTruth } from "../compliance/compliance";
import { evaluateCreativeRisk } from "./risk";
import { creativeConceptSchema, type CreativeConcept } from "./schemas";

export const CREATIVE_STRATEGY_VERSION = "evidence-production-strategy-v1";
export type ProductionMethod = "REAL_FOOTAGE_EDIT" | "REAL_IMAGE_MOTION" | "GENERATIVE_ATMOSPHERE" | "WAIT_FOR_EVIDENCE";

/** Verified/reviewed fields must originate in trusted, owner-reviewed server records,
 * never request-body assertions. Unknown catalog metadata is not verification. */
export interface StrategyFact {
  id: string; text: string; source: "PDP" | "LABEL" | "OWNER_FOOTAGE" | "AUTHORIZED_SOURCE" | "MOCK";
  reference: string; verified: boolean; capturedAt: string; productId?: string; topic?: string;
  role?: "PROBLEM" | "SELLING_POINT" | "OBSERVATION";
}
export interface StrategyAsset {
  id: string; kind: "REAL_IMAGE" | "REAL_FOOTAGE" | "COMPARISON_FOOTAGE" | "ATMOSPHERE";
  source: "OWNER" | "AUTHORIZED_CATALOG" | "MOCK"; reference: string;
  rightsConfirmed: boolean; reviewed: boolean; productId?: string; topic?: string;
  durationSeconds?: number;
}
export interface ProductionCostAttempt {
  id: string; method: Exclude<ProductionMethod, "WAIT_FOR_EVIDENCE">;
  /** All stages charged for the same final clip share this ID. */
  outputId: string;
  actualCostThb: number | null; billingVerified: boolean; usable: boolean | null;
}
export interface UsableProductionCost {
  status: "OBSERVED" | "UNKNOWN" | "NO_USABLE_OUTPUT";
  totalActualThb: number | null; usableOutputs: number; attempts: number;
  costPerUsableThb: number | null; targetMet: boolean | null;
  basis: "VERIFIED_ACTUAL_COST_PER_USABLE_OUTPUT" | "BILLING_OR_REVIEW_MISSING" | "NO_USABLE_OUTPUT";
  includesFailedAttempts: true;
}
export interface CreativeStrategyInput {
  now: Date;
  account: { id: string; mode: EffectiveMode; affiliateEligible: boolean | null };
  product?: { id: string; title: string; mechanism: "COMPLEX" | "SIMPLE" | "UNKNOWN" };
  facts: StrategyFact[]; assets: StrategyAsset[]; topics?: TopicEvidence[]; trends?: TrendIntelligenceReport;
  learning?: { accountId: string; source: "REAL" | "MOCK"; evidenceIds: string[];
    preferredAngle: string | null; preferredHook: string | null; confidence: number };
  costs?: ProductionCostAttempt[];
}
export interface StrategyConcept {
  id: string; concept: CreativeConcept;
  production: { method: ProductionMethod; ready: boolean; evidenceIds: string[]; missingEvidence: string[] };
  status: "REVIEW_REQUIRED" | "WAIT_FOR_EVIDENCE" | "REJECTED";
  score: number; confidence: number | null; reasons: string[];
  rubric: { evidenceFit: number; productionFeasibility: number; modeFit: number; learningSupport: number };
  cost: UsableProductionCost;
}
export interface CreativeStrategyPlan {
  version: typeof CREATIVE_STRATEGY_VERSION; source: "DETERMINISTIC_EVIDENCE_RUBRIC"; accountId: string;
  concepts: StrategyConcept[]; selectedConceptId: string; fingerprint: string;
  trendStatus: "OBSERVED" | "UNKNOWN"; topic: string | null;
  analysis: { problem: string | null; sellingPoints: string[];
    audience: { status: "OBSERVED" | "HYPOTHESIS" | "UNKNOWN"; segments: string[]; basis: string };
    mechanismRisk: "REAL_FOOTAGE_REQUIRED" | "NO_FUNCTIONAL_GENERATION" | "NOT_APPLICABLE" };
  humanReviewRequired: true; predictedVirality: "UNKNOWN"; warnings: string[];
  confidenceBasis: "EVIDENCE_COMPLETENESS_NOT_PERFORMANCE";
}

/** Count every charged attempt, including rejects/retries. A missing bill is never $0.
 * The observed average is not a future price guarantee. The 5 THB target is a
 * business objective, not an assumption about any provider's cost. */
export function summarizeUsableProductionCost(attempts: ProductionCostAttempt[]): UsableProductionCost {
  const unique = new Map<string, ProductionCostAttempt>();
  let conflict = false;
  for (const row of attempts) {
    const prior = unique.get(row.id);
    if (!row.id || !row.outputId || (prior && JSON.stringify(prior) !== JSON.stringify(row))) conflict = true;
    unique.set(row.id, row);
  }
  const rows = [...unique.values()], usableOutputs = new Set(rows.filter(r => r.usable === true).map(r => r.outputId)).size;
  const complete = rows.length > 0 && !conflict && rows.every(r => r.billingVerified && r.actualCostThb !== null &&
    Number.isFinite(r.actualCostThb) && r.actualCostThb >= 0 && r.usable !== null);
  if (!complete) return { status: "UNKNOWN", totalActualThb: null, usableOutputs, attempts: rows.length,
    costPerUsableThb: null, targetMet: null, basis: "BILLING_OR_REVIEW_MISSING", includesFailedAttempts: true };
  const totalActualThb = rows.reduce((sum, r) => sum + r.actualCostThb!, 0);
  if (!usableOutputs) return { status: "NO_USABLE_OUTPUT", totalActualThb, usableOutputs, attempts: rows.length,
    costPerUsableThb: null, targetMet: false, basis: "NO_USABLE_OUTPUT", includesFailedAttempts: true };
  const costPerUsableThb = totalActualThb / usableOutputs;
  return { status: "OBSERVED", totalActualThb, usableOutputs, attempts: rows.length, costPerUsableThb,
    targetMet: costPerUsableThb <= 5, basis: "VERIFIED_ACTUAL_COST_PER_USABLE_OUTPUT", includesFailedAttempts: true };
}

function verifiedFacts(input: CreativeStrategyInput, topic: string | null) {
  return input.facts.filter(f => f.source !== "MOCK" && f.verified && f.id.trim() && f.reference.trim() && f.text.trim() &&
    Number.isFinite(Date.parse(f.capturedAt)) && Date.parse(f.capturedAt) <= input.now.getTime() &&
    (input.product ? f.productId === input.product.id : Boolean(topic) && f.topic === topic));
}
function approvedAssets(input: CreativeStrategyInput, topic: string | null) {
  return input.assets.filter(a => a.source !== "MOCK" && a.rightsConfirmed && a.reviewed && a.id.trim() && a.reference.trim() &&
    (input.product ? a.productId === input.product.id : Boolean(topic) && a.topic === topic));
}
function draft(angleType: CreativeConcept["angleType"], title: string, hook: string, message: string,
  cta: string, visuals: [string, string, string], motions: [string, string, string]): CreativeConcept {
  return creativeConceptSchema.parse({ angleType, title, hook, coreMessage: message, voiceScript: `${hook} ${message} ${cta}`,
    overlayText: [{ start: 0, end: 2, text: hook }, { start: 5, end: 8, text: cta }],
    scenePlan: [{ start: 0, end: 2, visual: visuals[0], motion: motions[0] },
      { start: 2, end: 5, visual: visuals[1], motion: motions[1] },
      { start: 5, end: 8, visual: visuals[2], motion: motions[2] }],
    cta, caption: `${title}: ${message}`, hashtags: ["#เรียนรู้จากภาพจริง", "#วิดีโอสั้น"],
    visualStrategy: visuals.join(" → "),
    // These legacy-schema fields are deliberately unused in strategy ranking.
    // A model's self-rated hook/novelty score is not evidence of virality.
    modelSignals: { hookStrength: 0, novelty: 0, visualFeasibility: 0 } });
}

/** Extends Creative Brain with deterministic, inspectable planning before generation.
 * This function neither generates media nor asserts human creative approval. */
export function planCreativeStrategy(input: CreativeStrategyInput): CreativeStrategyPlan {
  if (!Number.isFinite(input.now.getTime())) throw new Error("STRATEGY_CLOCK_REQUIRED");
  const applicableTrend = input.trends?.status === "REAL_OBSERVATIONS"
    ? input.trends.observations.find(o => (o.accountFit === "OWN_ACCOUNT" || o.accountFit === "OBSERVED_AUDIENCE_MATCH") &&
      o.productFit !== "MISMATCH") : undefined;
  // Category Intelligence can propose a topic, but is not social-trend evidence.
  const topic = applicableTrend?.topic ?? input.trends?.hypotheses[0]?.topic ?? chooseGrowthTopics(input.topics ?? [], input.now)[0] ?? null;
  const facts = verifiedFacts(input, topic), assets = approvedAssets(input, topic);
  const footage = assets.find(a => a.kind === "REAL_FOOTAGE"), image = assets.find(a => a.kind === "REAL_IMAGE");
  const comparison = assets.find(a => a.kind === "COMPARISON_FOOTAGE"), atmosphere = assets.find(a => a.kind === "ATMOSPHERE");
  const learning = input.learning?.source === "REAL" && input.learning.accountId === input.account.id &&
    input.learning.evidenceIds.length > 0 && Number.isFinite(input.learning.confidence) && input.learning.confidence > 0 && input.learning.confidence <= 1
    ? input.learning : null;
  const commerce = input.account.mode === "AFFILIATE", eligible = !commerce || input.account.affiliateEligible === true;
  const cta = commerce ? "ดูรายละเอียดสินค้าก่อนตัดสินใจ" : "ติดตามเพื่อดูเรื่องถัดไป";
  const fact = facts[0]?.text.slice(0, 75) ?? "พิจารณาเฉพาะสิ่งที่เห็น อย่าเพิ่งสรุปผลที่ยังไม่ได้ทดสอบ";
  const name = (input.product?.title ?? topic ?? "หัวข้อที่ต้องการทดลอง").slice(0, 35);
  const hasProduct = Boolean(input.product);
  const drafts = hasProduct ? [
    { id: "real-demonstration", required: footage, method: "REAL_FOOTAGE_EDIT" as const,
      missing: "วิดีโอสาธิตสินค้าจริงที่มีสิทธิ์ใช้และตรวจแกน จุดหมุน และมือแล้ว",
      concept: draft("DEMONSTRATION", `${name}: ดูหนึ่งจังหวะจริง`, "จุดนี้ทำงานอย่างไร?", "ดูการทำงานจากวิดีโอจริง", cta,
        ["ภาพจริงระยะใกล้ให้เห็นมือและจุดหมุนก่อนเริ่ม", "ใช้ช็อตสาธิตจริงต่อเนื่อง ไม่สร้างแกนหรือชิ้นส่วนเพิ่ม", "คงภาพผลที่สังเกตได้จริงและชื่อสินค้า"],
        ["ครอปโดยไม่บังแกนหรือข้อต่อ", "รักษาความเร็วจริง ไม่กลับด้านเพื่อบิดความหมาย", "หยุดคำอธิบายก่อนจบช็อตจริง"]) },
    { id: "real-image-detail", required: image, method: "REAL_IMAGE_MOTION" as const,
      missing: "ภาพสินค้าจริงที่ยืนยันสิทธิ์และตรวจความตรงรุ่นแล้ว",
      concept: draft("REVIEW_DISCOVERY", `${name}: ดูรายละเอียดก่อนเลือก`, "ก่อนเลือก ดูส่วนนี้ก่อน", "สังเกตรายละเอียดจากภาพสินค้าจริง", cta,
        ["ภาพสินค้าจริงเต็มชิ้น ระบุว่าเป็นภาพนิ่ง", "ครอปรายละเอียดที่เห็นได้จริง ไม่อ้างว่าสาธิตการทำงาน", "กลับสู่ภาพเต็มพร้อมชวนตรวจรายละเอียด"],
        ["แพนช้าในกรอบภาพจริง", "ขยายเฉพาะจุดที่มีอยู่ในภาพ", "ไม่สร้างมือหรือกลไกให้เคลื่อนไหว"]) },
    { id: "evidence-comparison", required: comparison, method: "REAL_FOOTAGE_EDIT" as const,
      missing: "วิดีโอเปรียบเทียบจริงภายใต้เงื่อนไขเดียวกันและหลักฐานของข้อความที่จะกล่าว",
      requiresFact: true,
      concept: draft("COMPARISON", `${name}: เทียบจากหลักฐาน`, "เทียบให้เห็น ไม่ต้องเดา", fact, cta,
        ["ระบุสิ่งที่จะเปรียบเทียบและเงื่อนไขจากหลักฐานจริง", "แสดงวิดีโอเปรียบเทียบจริง ไม่ใช้ภาพ AI แทนผลทดสอบ", "บอกขอบเขตที่หลักฐานรองรับ ไม่สรุปเหนือคู่แข่ง"],
        ["แสดงเงื่อนไขสั้น ๆ", "คงเวลาและมาตราส่วนที่เทียบกันได้", "ไม่ตัดช็อตเพื่อซ่อนผลที่ขัดแย้ง"]) },
  ] : [
    { id: "growth-one-point", required: footage ?? image, method: footage ? "REAL_FOOTAGE_EDIT" as const : "REAL_IMAGE_MOTION" as const,
      missing: "หัวข้อและข้อเท็จจริงจากแหล่งที่ได้รับอนุญาต พร้อมภาพที่มีสิทธิ์ใช้", requiresFact: true,
      concept: draft("DEMONSTRATION", `${name}: หนึ่งเรื่องที่ตรวจสอบได้`, "เรื่องนี้สังเกตจากอะไร?", fact, cta,
        ["คำถามเดียวจากหัวข้อที่มีข้อมูลจริง", "ภาพที่มีสิทธิ์พร้อมข้อเท็จจริงหนึ่งข้อและที่มา", "สรุปขอบเขตความรู้และชวนติดตาม"],
        ["เปิดด้วยคำถามภายในสองวินาที", "แสดงหลักฐานให้เวลาผู้ชมอ่าน", "จบโดยไม่ขายสินค้า"]) },
    { id: "growth-pov-question", required: image ?? atmosphere, method: image ? "REAL_IMAGE_MOTION" as const : "GENERATIVE_ATMOSPHERE" as const,
      requiresAsset: false,
      missing: "หัวข้อจากแหล่งที่ได้รับอนุญาต และภาพบรรยากาศหรือภาพจริงที่มีสิทธิ์ใช้",
      concept: draft("POV", `${name}: เปิดคำถามให้คิด`, "ถ้าเป็นคุณ จะสังเกตอะไร?", "ลองเสนอสิ่งที่อยากรู้ เป็นคำถามเพื่อทดลอง ไม่ใช่ข้อสรุป", "คอมเมนต์ประเด็นที่อยากรู้ต่อ",
        ["ตั้งคำถามจากหัวข้อ พร้อมระบุว่าเป็นแนวคิดทดลอง", "ภาพบรรยากาศประกอบเท่านั้น ไม่แสดงผลสินค้า บุคคลจริง หรือเหตุการณ์จริง", "เชิญคำตอบโดยไม่รับประกันว่าจะเพิ่มผู้ติดตาม"],
        ["เปิดคำถามที่อ่านจบในสองวินาที", "ขยับฉากบรรยากาศช้า ๆ ไม่ใช้เป็นหลักฐาน", "แสดงคำถามสั้นก่อนจบ"]) },
    { id: "growth-evidence-story", required: footage ?? image, method: footage ? "REAL_FOOTAGE_EDIT" as const : "REAL_IMAGE_MOTION" as const,
      missing: "ข้อเท็จจริงและภาพต้นทางที่อนุญาตให้เล่าเรื่อง โดยไม่แต่งประสบการณ์ผู้ใช้", requiresFact: true,
      concept: draft("PROBLEM_SOLUTION", `${name}: เรื่องสั้นจากข้อมูล`, "เริ่มจากสิ่งที่เห็นจริง", fact, "บันทึกไว้ แล้วติดตามตอนต่อไป",
        ["เปิดด้วยข้อสังเกตที่หลักฐานรองรับ", "เล่าข้อเท็จจริงเดียวจากที่มา ไม่สร้างคำรับรอง", "ปิดด้วยคำถามสิ่งที่ยังไม่รู้และชวนบันทึก"],
        ["ภาพจริงหรือกราฟิกจากข้อมูลที่ตรวจได้", "หนึ่งประเด็นต่อช็อต ไม่มีรีวิวสมมติ", "ปิดเรื่องภายในแปดวินาที"]) },
  ];
  const concepts: StrategyConcept[] = drafts.map(d => {
    const requiresFact = "requiresFact" in d && d.requiresFact;
    const requiresAsset = !("requiresAsset" in d && d.requiresAsset === false);
    const realVideoTooShort = d.required && (d.required.kind === "REAL_FOOTAGE" || d.required.kind === "COMPARISON_FOOTAGE") &&
      (!Number.isFinite(d.required.durationSeconds) || d.required.durationSeconds! < 8);
    const missingEvidence = [...(requiresAsset && !d.required ? [d.missing] : []), ...(requiresFact && !facts.length ? ["หลักฐานข้อเท็จจริงที่ตรวจสอบแล้ว"] : []),
      ...(realVideoTooShort ? ["ต้องยืนยันว่าฟุตเทจจริงครอบคลุมแปดวินาที ไม่ยืดหรือเติมภาพเพื่ออ้างการสาธิตต่อเนื่อง"] : []),
      ...(!hasProduct && !topic ? ["หัวข้อที่มีข้อมูลจริง ห้ามอ้างว่าเป็นเทรนด์ที่ยืนยันแล้ว"] : []),
      ...(!eligible ? ["สิทธิ์ Affiliate ของบัญชียังไม่ยืนยัน"] : [])];
    const ready = missingEvidence.length === 0;
    const risk = evaluateCreativeRisk(d.concept, facts.map(f => f.text).join(" "));
    const truth = checkProductTruth([d.concept.hook, d.concept.voiceScript, d.concept.caption].join(" "), facts.map(f => f.text));
    const rejected = risk.status === "REJECT" || truth.status === "REJECT";
    const learningSupport = learning?.preferredAngle === d.concept.angleType ? Math.round(learning.confidence * 10) : 0;
    const rubric = { evidenceFit: ready ? 40 : d.required ? 15 : 0, productionFeasibility: ready ? 30 : 0,
      modeFit: eligible ? 20 : 0, learningSupport };
    const score = rejected ? 0 : Object.values(rubric).reduce((a, b) => a + b, 0);
    const reasons = [ready ? "มีหลักฐานและภาพที่รองรับวิธีผลิตนี้" : "ยังขาดหลักฐาน จึงยังผลิตไม่ได้", d.method === "REAL_IMAGE_MOTION"
      ? "ใช้ภาพจริงและตัดต่อ ไม่อ้างว่าการแพนภาพคือการสาธิต" : d.method === "REAL_FOOTAGE_EDIT"
        ? "การเคลื่อนไหวที่พิสูจน์สินค้าต้องมาจากวิดีโอจริง" : "ภาพสร้างใช้ได้เฉพาะบรรยากาศ ไม่ใช้ยืนยันข้อเท็จจริง",
      "คะแนนเป็นความเหมาะสมตามเกณฑ์ที่เปิดเผย ไม่ใช่โอกาสไวรัล", ...(learningSupport ? ["มีผลจริงเฉพาะบัญชีรองรับรูปแบบนี้"] : ["ยังไม่มีผลจริงรองรับว่ารูปแบบนี้ทำงานดีในบัญชีนี้"]),
      ...risk.reasons, ...truth.issues.map(i => i.message)];
    return { id: d.id, concept: d.concept, production: { method: ready ? d.method : "WAIT_FOR_EVIDENCE", ready,
      evidenceIds: [...(d.required ? [d.required.id] : []), ...(requiresFact ? facts.map(f => f.id) : []), ...(applicableTrend ? [applicableTrend.key] : [])], missingEvidence },
      status: rejected ? "REJECTED" : ready ? "REVIEW_REQUIRED" : "WAIT_FOR_EVIDENCE", score,
      confidence: ready ? Number(((rubric.evidenceFit + rubric.productionFeasibility) / 100).toFixed(2)) : null,
      // Switching production method must not erase the spend on rejected earlier methods.
      rubric, reasons, cost: summarizeUsableProductionCost(input.costs ?? []) };
  });
  concepts.sort((a, b) => (b.status === "REVIEW_REQUIRED" ? 1 : 0) - (a.status === "REVIEW_REQUIRED" ? 1 : 0) || b.score - a.score);
  const selectedConceptId = concepts[0].id;
  const payload: Pick<CreativeStrategyPlan, "version" | "accountId" | "concepts" | "selectedConceptId"> = {
    version: CREATIVE_STRATEGY_VERSION, accountId: input.account.id, concepts, selectedConceptId };
  return { ...payload, source: "DETERMINISTIC_EVIDENCE_RUBRIC", fingerprint: strategyFingerprint(payload),
    trendStatus: applicableTrend ? "OBSERVED" : "UNKNOWN", topic,
    analysis: { problem: facts.find(f => f.role === "PROBLEM")?.text ?? null,
      sellingPoints: facts.filter(f => f.role === "SELLING_POINT").map(f => f.text),
      audience: applicableTrend && applicableTrend.audience !== "UNKNOWN"
        ? { status: "OBSERVED", segments: applicableTrend.audience, basis: applicableTrend.sourceReference }
        : hasProduct ? { status: "HYPOTHESIS", segments: [`ผู้ที่กำลังพิจารณา ${name}`], basis: "สมมติฐานจากตัวสินค้า ยังไม่มีข้อมูลผู้ชมยืนยัน" }
          : { status: "UNKNOWN", segments: [], basis: "ยังไม่มีข้อมูลกลุ่มผู้ชมที่ยืนยันได้" },
      mechanismRisk: hasProduct ? input.product?.mechanism === "SIMPLE" ? "NO_FUNCTIONAL_GENERATION" : "REAL_FOOTAGE_REQUIRED" : "NOT_APPLICABLE" },
    humanReviewRequired: true, predictedVirality: "UNKNOWN", confidenceBasis: "EVIDENCE_COMPLETENESS_NOT_PERFORMANCE",
    warnings: ["ความสร้างสรรค์ ความถูกต้อง และสิทธิ์ในสื่อยังต้องให้มนุษย์ตรวจ ก่อนผลิตและเผยแพร่", "ต้นทุนต่อคลิปใช้ได้รวมงานเสียและการสร้างซ้ำ; หากบิลไม่ยืนยันจะแสดง UNKNOWN",
      ...(!applicableTrend ? ["ไม่มีข้อมูลเทรนด์จริงที่ยืนยันความเหมาะสมกับบัญชี แนวคิดนี้เป็นสมมติฐานเพื่อทดลอง"] : []),
      ...(input.product?.mechanism !== "SIMPLE" && hasProduct ? ["กลไกซับซ้อนหรือยังไม่ทราบ ห้ามสร้างการทำงานของสินค้าใหม่ด้วยภาพ AI"] : [])] };
}

export function strategyEvidenceDigest(value: unknown): string {
  const canonical=(item:unknown):unknown=>Array.isArray(item)?item.map(canonical):item&&typeof item==="object"
    ?Object.fromEntries(Object.entries(item as Record<string,unknown>).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,child])=>[key,canonical(child)])):item;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
function strategyFingerprint(plan: Pick<CreativeStrategyPlan, "version" | "accountId" | "concepts" | "selectedConceptId">) {
  return strategyEvidenceDigest({ version: plan.version, accountId: plan.accountId,
    concepts: plan.concepts, selectedConceptId: plan.selectedConceptId });
}

/** Call at the production boundary with a server-authenticated review. Asset readiness
 * alone never authorizes production, paid generation or TikTok publishing. */
export function assertHumanProductionReview(plan: CreativeStrategyPlan, review?: {
  fingerprint: string; conceptId: string; reviewedBy: string; creativeApproved: boolean;
  factualAccuracyApproved: boolean; mediaRightsApproved: boolean;
}) {
  const selected = plan.concepts.find(c => c.id === review?.conceptId);
  if (!review || review.fingerprint !== plan.fingerprint || strategyFingerprint(plan) !== plan.fingerprint || !review.reviewedBy.trim() ||
    !review.creativeApproved || !review.factualAccuracyApproved || !review.mediaRightsApproved ||
    selected?.status !== "REVIEW_REQUIRED" || !selected.production.ready) throw new Error("HUMAN_CREATIVE_REVIEW_REQUIRED");
  return selected;
}
