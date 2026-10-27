/** AI Creative Director: consumer insight → several genuinely different ad concepts → a critic that ranks
 * them → the best concept that passed, chosen before any video credit is spent.
 *
 * INTELLIGENT mode asks a configured language model (local first; never a new paid service) to brainstorm,
 * then holds its ideas to exactly the same evidence, rights and claim gates as the built-in director.
 * When no model is ready the built-in director plans from the category playbook and verified facts, and the
 * record says so. Critic scores are creative heuristics, never predictions of views or sales. */
import { z } from "zod";
import { AD_FORMAT_LABEL, categoryPlaybook, type AdFormat, type CategoryPlaybook, type VisualStyle } from "./category-insight";
import { claimIssues } from "./claims";
import type { StructuredCreativeProvider } from "./providers";

export const AD_DIRECTOR_VERSION = "ad-director-v1";

export interface DirectorFact { id: string; text: string; role?: "PROBLEM" | "SELLING_POINT" | "OBSERVATION"; source?: string }
export interface DirectorAsset { id: string; kind: "REAL_IMAGE" | "REAL_FOOTAGE" | "OPERATION_FOOTAGE" | "LICENSED_AUDIO"; rightsCleared: boolean; credit?: string }
export interface DirectorInput {
  product: { id: string; title: string; categoryKey: string; model?: string | null };
  facts: DirectorFact[]; assets: DirectorAsset[];
  account: { id: string; mode: "GROWTH" | "AFFILIATE"; affiliateEligible: boolean };
  /** Formats and hooks this account used recently, newest first. */
  history?: { formats: string[]; hooks: string[] };
  /** Measured format results; only used when the sample is large enough to mean something. */
  learning?: Array<{ format: AdFormat; liftVsAccount: number; samples: number }>;
  conceptCount?: number;
}

export type InsightStatus = "HYPOTHESIS" | "EVIDENCED";
export interface InsightItem { text: string; status: InsightStatus; evidenceIds: string[] }
export interface ConsumerInsight {
  category: CategoryPlaybook["family"]; audience: InsightItem[]; needs: InsightItem[]; stopReasons: InsightItem[];
  interestReasons: InsightItem[]; differentiators: InsightItem[]; mood: VisualStyle; doNotClaim: string[];
}
export interface AdConcept {
  id: string; format: AdFormat; formatLabel: string; angle: string; audience: string; insight: string;
  hook: { text: string; visual: string }; message: string; sellingPoints: Array<{ factId: string; text: string }>;
  style: VisualStyle; cta: string; source: "LLM" | "DIRECTOR_HEURISTIC";
  feasible: boolean; infeasibleReasons: string[];
}
export const CRITIC_CRITERIA = ["hook", "clarity", "novelty", "productFit", "visualFeasibility", "claimAccuracy", "durationFit", "freshness", "costRisk", "accountFit"] as const;
export type CriticCriterion = typeof CRITIC_CRITERIA[number];
export interface ConceptCritique { conceptId: string; scores: Record<CriticCriterion, number>; total: number; passed: boolean; reasons: string[] }
export interface DirectorPlan {
  version: string; mode: "INTELLIGENT_LLM" | "DIRECTOR_HEURISTIC"; modeReason: string; model: string | null;
  insight: ConsumerInsight; concepts: AdConcept[]; critiques: ConceptCritique[]; selectedConceptId: string | null;
  scoreMeaning: string; usage: { inputTokens: number; outputTokens: number };
}

const CRITIC_WEIGHTS: Record<CriticCriterion, number> = { hook: 15, clarity: 12, novelty: 8, productFit: 12, visualFeasibility: 12, claimAccuracy: 15, durationFit: 6, freshness: 8, costRisk: 6, accountFit: 6 };
export const CRITIC_PASS_TOTAL = 62;
const visibleLength = (t: string) => t.normalize("NFC").replace(/\p{M}/gu, "").replace(/\s+/g, "").length;
const hasNumber = (t: string) => /[0-9]/.test(t);
const sellingFacts = (facts: DirectorFact[]) => facts.filter(f => f.role !== "PROBLEM").toSorted((a, b) => Number(hasNumber(b.text)) - Number(hasNumber(a.text)));

/** Insight: audience/needs come from the category playbook and stay HYPOTHESIS; differentiators exist only as verified facts. */
export function buildConsumerInsight(input: DirectorInput): ConsumerInsight {
  const book = categoryPlaybook(input.product.categoryKey, input.product.title), h = (text: string): InsightItem => ({ text, status: "HYPOTHESIS", evidenceIds: [] });
  const style = book.styles[Math.abs(hash(input.product.id)) % book.styles.length];
  return { category: book.family, audience: book.audiences.map(h), needs: book.needs.map(h), stopReasons: book.stopReasons.map(h), interestReasons: book.interestReasons.map(h),
    differentiators: sellingFacts(input.facts).map(f => ({ text: f.text, status: "EVIDENCED", evidenceIds: [f.id] })), mood: style,
    doNotClaim: [book.forbiddenNote, "ห้ามสร้างรีวิว ประสบการณ์ลูกค้า ยอดขาย หรือผลลัพธ์ที่ไม่มีหลักฐาน", "ห้ามให้ AI สร้าง/ดัดแปลงตัวสินค้า โลโก้ หรือหน้าปัด"] };
}

const words = (t: string) => new Set([...new Intl.Segmenter("th", { granularity: "word" }).segment(t.normalize("NFC").toLowerCase())].filter(w => w.isWordLike).map(w => w.segment));
/** Jaccard overlap of Thai word segments, so reworded copies of an old hook are caught. */
export function hookSimilarity(a: string, b: string) {
  const x = words(a), y = words(b), inter = [...x].filter(w => y.has(w)).length;
  return x.size + y.size - inter ? inter / (x.size + y.size - inter) : 0;
}
function hash(s: string) { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) | 0; return x; }
function ctaFor(input: DirectorInput, format: AdFormat) {
  if (input.account.mode === "AFFILIATE" && input.account.affiliateEligible) return format === "BUYING_GUIDE" ? "เช็กสเปกและราคาในตะกร้าก่อนตัดสินใจ" : "กดดูรายละเอียดในตะกร้า";
  return format === "BUYING_GUIDE" || format === "PRODUCT_DETAIL" ? "เซฟไว้ดูก่อนตัดสินใจ" : "ติดตามไว้ ดูของดีชิ้นต่อไป";
}

/** What each format needs to be truthful; a format without its evidence is listed but marked infeasible. */
function feasibility(format: AdFormat, input: DirectorInput) {
  const cleared = input.assets.filter(a => a.rightsCleared), reasons: string[] = [];
  const images = cleared.filter(a => a.kind === "REAL_IMAGE").length, footage = cleared.filter(a => a.kind !== "REAL_IMAGE" && a.kind !== "LICENSED_AUDIO").length;
  const operation = cleared.some(a => a.kind === "OPERATION_FOOTAGE"), facts = sellingFacts(input.facts).length;
  if (images + footage === 0) reasons.push("ไม่มีภาพ/วิดีโอสินค้าที่ผ่านสิทธิ์");
  if (format === "COMPARISON" && !input.facts.some(f => /เทียบ|กว่า|vs/i.test(f.text))) reasons.push("ไม่มีข้อมูลเปรียบเทียบที่ยืนยัน");
  if (format === "UGC_STORY" && !operation) reasons.push("UGC ต้องมีฟุตเทจการใช้งานจริงที่ได้รับสิทธิ์ ห้ามสร้างคนรีวิวปลอม");
  if (format === "ASMR_SENSORY" && (!footage || !cleared.some(a => a.kind === "LICENSED_AUDIO" || a.kind === "OPERATION_FOOTAGE"))) reasons.push("ASMR ต้องมีฟุตเทจและเสียงจริงที่ได้รับสิทธิ์");
  if ((format === "PRODUCT_DETAIL" || format === "BUYING_GUIDE") && facts === 0) reasons.push("ต้องมีข้อเท็จจริงสินค้าที่ยืนยันอย่างน้อย 1 ข้อ");
  if (format === "PROBLEM_SOLUTION" && !operation) reasons.push("ไม่มีฟุตเทจการใช้งานจริง จะเล่าปัญหาได้แต่ห้ามสาธิตการแก้ปัญหา");
  // Problem/solution can still be told as context graphics → product reveal, so that one is a warning, not a blocker.
  const blocking = reasons.filter(r => !r.startsWith("ไม่มีฟุตเทจการใช้งานจริง จะเล่า"));
  return { feasible: blocking.length === 0, reasons };
}

/** Built-in director: one concept per format the category favours, filled with verified facts only. */
export function heuristicConcepts(input: DirectorInput, insight: ConsumerInsight): AdConcept[] {
  const book = categoryPlaybook(input.product.categoryKey, input.product.title), facts = sellingFacts(input.facts);
  const want = Math.max(3, input.conceptCount ?? 4), learned = new Map((input.learning ?? []).filter(l => l.samples >= 10).map(l => [l.format, l.liftVsAccount]));
  const recent = new Set((input.history?.formats ?? []).slice(0, 3));
  // Playbook order, nudged by measured lift and away from formats used in the last few clips.
  const formats = [...book.formats, ...(["CURIOSITY", "BUYING_GUIDE", "CINEMATIC_HERO", "PRODUCT_DETAIL", "LIFESTYLE"] as AdFormat[])]
    .filter((f, i, all) => all.indexOf(f) === i)
    .map((f, i) => ({ f, s: -i + (learned.get(f) ?? 0) * 3 - (recent.has(f) ? 2.5 : 0) })).toSorted((a, b) => b.s - a.s).map(x => x.f);
  const name = input.product.model ? `${input.product.title}`.trim() : input.product.title;
  const fill = (t: string) => t.replaceAll("{product}", name).replaceAll("{fact}", facts[0]?.text ?? "");
  return formats.slice(0, Math.min(formats.length, want + 2)).map((format, i) => {
    const hookText = fill(book.hooks[format]?.[i % (book.hooks[format]?.length || 1)] ?? book.hooks.CURIOSITY[0]);
    const points = (format === "CINEMATIC_HERO" ? facts.slice(0, 1) : facts.slice(0, 2)).map(f => ({ factId: f.id, text: f.text }));
    const audience = insight.audience[i % insight.audience.length].text, need = insight.needs[i % insight.needs.length]?.text ?? "";
    const visual = {
      PROBLEM_SOLUTION: `ฉากบริบทปัญหา: ${book.contextScenes[0]}`, CURIOSITY: "เปิดด้วยภาพมาโครสินค้าจริงที่ยังไม่บอกว่าคืออะไร แล้วค่อยเฉลย",
      LIFESTYLE: `ฉากกราฟิก/บรรยากาศชีวิตประจำวัน (${book.contextScenes[0]}) ตัดเข้าภาพสินค้าจริง`, PRODUCT_DETAIL: "ซูมรายละเอียดสินค้าจริงทีละจุดพร้อม callout",
      BUYING_GUIDE: "การ์ดเช็กลิสต์ 2–3 ข้อ สลับกับภาพสินค้าจริง", COMPARISON: "แบ่งจอเทียบจากสเปกที่ยืนยัน", CINEMATIC_HERO: "แสงกวาดผ่านสินค้าจริงบนฉากโทนแบรนด์",
      UGC_STORY: "ฟุตเทจใช้งานจริงที่ได้รับสิทธิ์ เล่าแบบผู้สร้างคอนเทนต์ (ไม่อ้างเป็นลูกค้า)", ASMR_SENSORY: "เสียงและภาพระยะใกล้จากฟุตเทจจริง",
    }[format];
    const f = feasibility(format, input);
    return { id: `c${i + 1}-${format.toLowerCase()}`, format, formatLabel: AD_FORMAT_LABEL[format],
      angle: `${AD_FORMAT_LABEL[format]} สำหรับ${audience}`, audience, insight: need ? `ลูกค้าน่าจะต้องการ: ${need} (HYPOTHESIS)` : "HYPOTHESIS",
      hook: { text: hookText, visual }, message: points.length ? points.map(p => p.text).join(" · ") : `${name}`,
      sellingPoints: points, style: book.styles[i % book.styles.length], cta: ctaFor(input, format), source: "DIRECTOR_HEURISTIC" as const,
      feasible: f.feasible, infeasibleReasons: f.reasons };
  });
}

/** Creative critic: ten heuristic criteria, recorded with reasons. Claim accuracy and feasibility are hard gates. */
export function critiqueConcepts(concepts: AdConcept[], input: DirectorInput): ConceptCritique[] {
  const book = categoryPlaybook(input.product.categoryKey, input.product.title);
  const supported = [...input.facts.map(f => f.text), input.product.title, input.product.model ?? ""];
  const recentHooks = new Set((input.history?.hooks ?? []).slice(0, 10)), recentFormats = (input.history?.formats ?? []).slice(0, 5);
  const seenFormats = new Map<AdFormat, number>();
  return concepts.map(c => {
    const reasons: string[] = [];
    const lines = [c.hook.text, c.message, c.cta];
    const issues = claimIssues(lines, input.assets.some(a => a.rightsCleared && a.kind === "OPERATION_FOOTAGE") ? "REAL_FOOTAGE_OPERATION" : "REAL_IMAGE", supported);
    const forbidden = lines.filter(l => book.forbiddenClaims.some(re => re.test(l)));
    const unsupportedPoints = c.sellingPoints.filter(p => !input.facts.some(f => f.id === p.factId && f.text === p.text));
    const claimAccuracy = issues.length || forbidden.length || unsupportedPoints.length ? 0 : 10;
    if (claimAccuracy === 0) reasons.push(`ข้อกล่าวอ้างไม่ผ่าน: ${[...issues.map(i => i.code), ...forbidden, ...unsupportedPoints.map(p => `ไม่มีหลักฐาน "${p.text}"`)].join(", ")}`);
    const hookLen = visibleLength(c.hook.text);
    const hook = Math.min(10, (hookLen >= 6 && hookLen <= 26 ? 6 : 3) + (/[?？]/.test(c.hook.text) ? 2 : 0) + (hasNumber(c.hook.text) || /มาโคร|ซูม|ใกล้/.test(c.hook.visual) ? 2 : 0));
    const clarity = c.sellingPoints.length ? (visibleLength(c.message) <= 40 ? 10 : 7) : 4;
    const prior = seenFormats.get(c.format) ?? 0; seenFormats.set(c.format, prior + 1);
    const novelty = prior ? 3 : recentFormats.includes(c.format) ? 5 : 9;
    const productFit = book.formats.includes(c.format) ? 10 - book.formats.indexOf(c.format) : 5;
    const visualFeasibility = c.feasible ? (c.infeasibleReasons.length ? 6 : 10) : 0;
    const durationFit = c.sellingPoints.length <= 2 && hookLen <= 26 ? 10 : 6;
    // Near-copies count too: "ดูจุดไหนดี?" and "ดูตรงไหน?" over the same product are the same hook to a viewer.
    const overlap = Math.max(0, ...[...recentHooks].map(h => hookSimilarity(h, c.hook.text)));
    const freshness = overlap >= .6 ? 2 : overlap >= .4 ? 6 : 10;
    const costRisk = c.format === "CINEMATIC_HERO" || c.format === "LIFESTYLE" || c.format === "PROBLEM_SOLUTION" ? 7 : 9;
    const cartCta = /ตะกร้า/.test(c.cta);
    const accountFit = cartCta && !(input.account.mode === "AFFILIATE" && input.account.affiliateEligible) ? 0 : 10;
    if (accountFit === 0) reasons.push("CTA ตะกร้าไม่ตรงสิทธิ์บัญชี");
    if (!c.feasible) reasons.push(`ทำไม่ได้จริงด้วยสื่อที่มี: ${c.infeasibleReasons.join(" / ")}`);
    if (freshness < 10) reasons.push(freshness < 5 ? "Hook ซ้ำกับคลิปล่าสุด" : "Hook คล้ายคลิปล่าสุด");
    const scores = { hook, clarity, novelty, productFit: Math.max(0, productFit), visualFeasibility, claimAccuracy, durationFit, freshness, costRisk, accountFit };
    const total = Math.round(CRITIC_CRITERIA.reduce((a, k) => a + scores[k] * CRITIC_WEIGHTS[k], 0) / 10);
    const passed = c.feasible && claimAccuracy === 10 && accountFit === 10 && total >= CRITIC_PASS_TOTAL;
    reasons.push(passed ? `ผ่านเกณฑ์ (${total}/100)` : `ไม่ผ่านเกณฑ์ (${total}/100, ต้อง ≥ ${CRITIC_PASS_TOTAL} และผ่านข้อกล่าวอ้าง/ความเป็นไปได้)`);
    return { conceptId: c.id, scores, total, passed, reasons };
  });
}

const llmConceptSchema = z.object({ concepts: z.array(z.object({
  format: z.enum(["PROBLEM_SOLUTION", "CURIOSITY", "LIFESTYLE", "PRODUCT_DETAIL", "BUYING_GUIDE", "COMPARISON", "CINEMATIC_HERO", "UGC_STORY", "ASMR_SENSORY"]),
  audience: z.string().min(2).max(120), insight: z.string().min(2).max(200), hookText: z.string().min(2).max(60), hookVisual: z.string().min(2).max(200),
  factIds: z.array(z.string()).max(3), angle: z.string().min(2).max(120),
})).min(3).max(8) });

/** Asks the configured model for ideas, then rebuilds each idea from verified facts only. */
export async function llmConcepts(provider: StructuredCreativeProvider, input: DirectorInput, insight: ConsumerInsight) {
  const prompt = JSON.stringify({ task: "Brainstorm distinct Thai TikTok ad concepts for one product. Use only listed fact ids for selling points. No fake reviews, no product reconstruction by AI, no claims beyond facts.",
    product: input.product, facts: input.facts.map(f => ({ id: f.id, text: f.text })), clearedMedia: input.assets.filter(a => a.rightsCleared).map(a => a.kind),
    insightHypotheses: { audience: insight.audience.map(i => i.text), needs: insight.needs.map(i => i.text) }, doNotClaim: insight.doNotClaim,
    recentHooks: input.history?.hooks.slice(0, 5) ?? [], wantConcepts: Math.max(3, input.conceptCount ?? 4) });
  const result = await provider.generateStructured(prompt, { name: "ad_concepts", schema: z.toJSONSchema(llmConceptSchema), instructions: "Return JSON only. Thai copy. Concepts must differ in format and story.", maxOutputTokens: 2500 });
  const parsed = llmConceptSchema.parse(result.output), book = categoryPlaybook(input.product.categoryKey, input.product.title);
  const concepts: AdConcept[] = parsed.concepts.map((c, i) => {
    const points = c.factIds.map(id => input.facts.find(f => f.id === id)).filter((f): f is DirectorFact => Boolean(f)).map(f => ({ factId: f.id, text: f.text }));
    const f = feasibility(c.format, input);
    return { id: `llm${i + 1}-${c.format.toLowerCase()}`, format: c.format, formatLabel: AD_FORMAT_LABEL[c.format], angle: c.angle, audience: c.audience,
      insight: `${c.insight} (HYPOTHESIS)`, hook: { text: c.hookText, visual: c.hookVisual }, message: points.map(p => p.text).join(" · ") || input.product.title,
      sellingPoints: points, style: book.styles[i % book.styles.length], cta: ctaFor(input, c.format), source: "LLM", feasible: f.feasible, infeasibleReasons: f.reasons };
  });
  return { concepts, usage: result.usage, model: provider.model };
}

/** Full director pass. A model failure falls back to the built-in director and is recorded, never hidden. */
export async function directAd(input: DirectorInput, provider: StructuredCreativeProvider | null = null): Promise<DirectorPlan> {
  const insight = buildConsumerInsight(input);
  let concepts: AdConcept[] = [], mode: DirectorPlan["mode"] = "DIRECTOR_HEURISTIC", modeReason = "ไม่มีโมเดลภาษาที่พร้อมใช้งานในเครื่อง (ไม่มี LOCAL_LLM_MODEL_PATH/คีย์) จึงใช้ Director แบบ Playbook + หลักฐาน";
  let usage = { inputTokens: 0, outputTokens: 0 }, model: string | null = null;
  if (provider) {
    try { const r = await llmConcepts(provider, input, insight); concepts = r.concepts; usage = r.usage; model = r.model; mode = "INTELLIGENT_LLM"; modeReason = `ใช้โมเดล ${r.model} ระดมแนวคิด แล้วผ่านเกณฑ์หลักฐานเดียวกัน`; }
    catch (error) { modeReason = `โมเดลภาษาทำงานไม่สำเร็จ (${error instanceof Error ? error.message : String(error)}) จึงใช้ Director แบบ Playbook`; }
  }
  // The built-in concepts always join, so a weak model batch cannot leave the owner with nothing usable.
  const all = [...concepts, ...heuristicConcepts(input, insight).filter(h => !concepts.some(c => c.format === h.format))];
  const critiques = critiqueConcepts(all, input);
  const best = critiques.filter(c => c.passed).toSorted((a, b) => b.total - a.total)[0];
  return { version: AD_DIRECTOR_VERSION, mode, modeReason, model, insight, concepts: all, critiques, selectedConceptId: best?.conceptId ?? null,
    scoreMeaning: "คะแนนเป็น Creative Heuristic สำหรับจัดลำดับแนวคิด ไม่ใช่การทำนายยอดวิวหรือยอดขาย", usage };
}
