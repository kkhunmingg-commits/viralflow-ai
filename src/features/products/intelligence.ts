/** Product Intelligence: ranks products the owner can actually sell from observed, sourced data only.
 * Opportunity, creative potential, data confidence and eligibility are kept apart, because a product with
 * excellent demand but no cleared media, or with lovely media but no known demand, needs a different decision.
 * A metric nobody observed stays UNKNOWN: it is never treated as zero and never filled in with a guess. */
export const PRODUCT_INTELLIGENCE_VERSION = "product-intelligence-v1";

export type Reliability = "VERIFIED_API" | "OWNER_REPORT" | "AUTHORIZED_FEED" | "PUBLIC_PAGE" | "MANUAL_ESTIMATE";
/** One observed number with where and when it came from. A null value means nobody observed it. */
export interface Observed { value: number | null; source: string | null; observedAt: string | null; reliability: Reliability | null }
export const unknown = (): Observed => ({ value: null, source: null, observedAt: null, reliability: null });

/** Where the product row came from; every adapter maps its own records into the same shape. */
export type DiscoveryAdapter = "OWNER_CATALOG_FILE" | "AUTHORIZED_FEED" | "SHOP_API" | "PUBLIC_MEDIA_COMMONS" | "MANUAL_OWNER_ENTRY";

export interface ProductIntelInput {
  id: string; title: string; categoryKey: string; model: string | null;
  adapter: DiscoveryAdapter; sourceUrl: string | null; capturedAt: string;
  /** Model/brand/identity confirmed against the maker or an authorized listing. */
  identityVerified: boolean;
  stock: "IN_STOCK" | "OUT_OF_STOCK" | "DISCONTINUED" | "UNKNOWN";
  price: Observed;
  demand: { unitsSold30d: Observed; velocityPerDay: Observed; trend: "RISING" | "STABLE" | "FALLING" | null };
  commission: { rate: Observed; amountThb: Observed };
  marginThb: Observed;
  reviews: { rating: Observed; count: Observed; complaintRate: Observed };
  /** 0 = nobody makes this content, 1 = saturated; measured, not imagined. */
  contentSaturation: Observed;
  media: { rightsClearedImages: number; rightsClearedVideos: number; operationFootage: number };
  verifiedFactCount: number;
  risk: { restrictedCategory: boolean; counterfeitRisk: boolean; claimSensitivity: "LOW" | "MEDIUM" | "HIGH" };
  /** Per-account audience fit 0..1, from observed account results; null when there are none yet. */
  audienceFit: Record<string, number | null>;
  /** Actual production cost per usable clip, including rejected attempts, when it has been measured. */
  costPerUsableClipThb: Observed;
  /** Account-level price reference; null leaves price fit UNKNOWN. */
  audiencePriceReferenceThb?: number | null;
}

export type OpportunityKey = "demand" | "velocity" | "commission" | "margin" | "priceFit" | "reviews" | "competition" | "audienceFit" | "productionCost";
export type OpportunityWeights = Record<OpportunityKey, number>;
/** Starting weights. They are a documented editorial prior, adjusted later only by measured outcomes. */
export const DEFAULT_OPPORTUNITY_WEIGHTS: OpportunityWeights = {
  demand: .2, velocity: .15, commission: .12, margin: .08, priceFit: .1, reviews: .1, competition: .08, audienceFit: .12, productionCost: .05,
};

export interface Component { key: string; value: number | null; weight: number; status: "KNOWN" | "UNKNOWN"; reason: string }
export interface ProductIntelligence {
  productId: string; title: string; categoryKey: string; rank: number | null;
  opportunity: { score: number | null; status: "SCORED" | "UNKNOWN"; knownWeightShare: number; components: Component[] };
  creativePotential: { score: number; components: Component[] };
  dataConfidence: { value: number; label: "HIGH" | "MEDIUM" | "LOW" | "NONE"; reasons: string[] };
  eligibility: { eligible: boolean; blockers: string[]; warnings: string[] };
  explanation: string;
}
export interface ProductRankingReport {
  version: string; mode: "RANKED_SET" | "SINGLE_PRODUCT_TRIAL" | "NO_ELIGIBLE_PRODUCT";
  weights: OpportunityWeights; weightsSource: "DEFAULT_PRIOR" | "LEARNED_FROM_OUTCOMES";
  items: ProductIntelligence[]; headline: string; caveats: string[];
}

const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const known = (o: Observed) => typeof o.value === "number" && Number.isFinite(o.value);
const RELIABILITY: Record<Reliability, number> = { VERIFIED_API: 1, AUTHORIZED_FEED: .9, OWNER_REPORT: .85, PUBLIC_PAGE: .6, MANUAL_ESTIMATE: .35 };
const DAY = 86_400_000;

function component(key: string, weight: number, obs: Observed[], score: (() => number) | null, reason: string): Component {
  const ok = score !== null && obs.every(known);
  return { key, weight, value: ok ? round(clamp(score!()) * 100, 1) : null, status: ok ? "KNOWN" : "UNKNOWN", reason: ok ? reason : `${reason} — ยังไม่มีข้อมูลจริง (UNKNOWN)` };
}

function opportunityComponents(p: ProductIntelInput, w: OpportunityWeights, accountId?: string): Component[] {
  const d = p.demand, ref = p.audiencePriceReferenceThb ?? null, fit = accountId ? p.audienceFit[accountId] ?? null : null;
  return [
    component("demand", w.demand, [d.unitsSold30d], () => Math.log1p(d.unitsSold30d.value!) / Math.log1p(5000), "ยอดขาย 30 วันที่สังเกตได้"),
    component("velocity", w.velocity, [d.velocityPerDay], () => Math.log1p(d.velocityPerDay.value!) / Math.log1p(200) * (d.trend === "RISING" ? 1 : d.trend === "FALLING" ? .6 : .85), "ความเร็วยอดขายต่อวันและทิศทาง"),
    component("commission", w.commission, [p.commission.rate, p.commission.amountThb], () => Math.sqrt(clamp(p.commission.rate.value! / .2) * clamp(Math.log1p(p.commission.amountThb.value!) / Math.log1p(150))), "อัตราและมูลค่าค่าคอมมิชชันจริง"),
    component("margin", w.margin, [p.marginThb], () => Math.log1p(Math.max(0, p.marginThb.value!)) / Math.log1p(500), "กำไรต่อชิ้นที่ทราบ"),
    component("priceFit", w.priceFit, [p.price], ref === null ? null : () => Math.exp(-Math.abs(Math.log(Math.max(1, p.price.value!) / Math.max(1, ref))) / 1.2), "ราคาเทียบกับกำลังซื้อของกลุ่มผู้ชม"),
    component("reviews", w.reviews, [p.reviews.rating, p.reviews.count], () => {
      const r = p.reviews, bayes = (r.rating.value! * r.count.value! + 3.8 * 30) / (r.count.value! + 30);
      return clamp((bayes - 3) / 2) * (known(r.complaintRate) ? 1 - clamp(r.complaintRate.value! * 4) : 1);
    }, "คะแนนรีวิวแบบถ่วงจำนวนรีวิวและข้อร้องเรียน"),
    component("competition", w.competition, [p.contentSaturation], () => 1 - clamp(p.contentSaturation.value!), "ความอิ่มตัวของคอนเทนต์คู่แข่ง (ต่ำดีกว่า)"),
    { key: "audienceFit", weight: w.audienceFit, value: fit === null ? null : round(clamp(fit) * 100, 1), status: fit === null ? "UNKNOWN" : "KNOWN",
      reason: fit === null ? "ยังไม่มีผลจริงของบัญชีนี้กับสินค้าแนวนี้ (UNKNOWN)" : "ความเหมาะกับผู้ชมจากผลโพสต์จริงของบัญชี" },
    component("productionCost", w.productionCost, [p.costPerUsableClipThb], () => clamp(1 - p.costPerUsableClipThb.value! / 10), "ต้นทุนจริงต่อคลิปที่ใช้ได้ (เป้า ≤ 5 บาท)"),
  ];
}

/** How much interesting, truthful advertising can be made from what is actually cleared and verified. */
function creativeComponents(p: ProductIntelInput): Component[] {
  const m = p.media;
  return [
    { key: "clearedMedia", weight: .35, value: round(clamp((m.rightsClearedImages + 2 * m.rightsClearedVideos) / 4) * 100, 1), status: "KNOWN", reason: `สื่อที่ผ่านสิทธิ์: ภาพ ${m.rightsClearedImages} วิดีโอ ${m.rightsClearedVideos}` },
    { key: "operationFootage", weight: .2, value: m.operationFootage > 0 ? 100 : 0, status: "KNOWN", reason: m.operationFootage ? "มีฟุตเทจการใช้งานจริงที่ได้รับสิทธิ์" : "ไม่มีฟุตเทจการใช้งานจริง จึงห้ามอ้างว่าสาธิต" },
    { key: "verifiedFacts", weight: .3, value: round(clamp(p.verifiedFactCount / 3) * 100, 1), status: "KNOWN", reason: `ข้อเท็จจริงที่ยืนยันแล้ว ${p.verifiedFactCount} ข้อ` },
    { key: "claimSafety", weight: .15, value: { LOW: 100, MEDIUM: 60, HIGH: 25 }[p.risk.claimSensitivity], status: "KNOWN", reason: `ความเสี่ยงข้อกล่าวอ้างหมวดนี้: ${p.risk.claimSensitivity}` },
  ];
}

function weighted(components: Component[]) {
  const all = components.reduce((a, c) => a + c.weight, 0), have = components.filter(c => c.value !== null);
  const share = all ? have.reduce((a, c) => a + c.weight, 0) / all : 0;
  const score = have.length ? have.reduce((a, c) => a + c.value! * c.weight, 0) / have.reduce((a, c) => a + c.weight, 0) : null;
  return { score, share };
}

function confidence(p: ProductIntelInput, share: number, now: Date) {
  const observed = [p.price, p.demand.unitsSold30d, p.demand.velocityPerDay, p.commission.rate, p.reviews.rating, p.contentSaturation].filter(known);
  const reliability = observed.length ? observed.reduce((a, o) => a + RELIABILITY[o.reliability ?? "MANUAL_ESTIMATE"], 0) / observed.length : 0;
  const ages = observed.map(o => o.observedAt ? (now.getTime() - Date.parse(o.observedAt)) / DAY : 30).filter(Number.isFinite);
  const freshness = ages.length ? Math.exp(-Math.max(0, Math.max(...ages)) / 14) : 0;
  const value = round(clamp(share * reliability * freshness * (p.identityVerified ? 1 : .5)), 3);
  const reasons = [`ข้อมูลที่ใช้คำนวณครอบคลุม ${Math.round(share * 100)}% ของน้ำหนัก`, `ความน่าเชื่อถือของแหล่ง ${round(reliability, 2)}`,
    ages.length ? `ข้อมูลเก่าสุด ${round(Math.max(...ages), 1)} วัน` : "ไม่มีข้อมูลตลาดที่มีเวลาเก็บ", p.identityVerified ? "ยืนยันตัวตน/รุ่นสินค้าแล้ว" : "ยังไม่ยืนยันรุ่นสินค้า"];
  return { value, label: (value >= .7 ? "HIGH" : value >= .4 ? "MEDIUM" : value > 0 ? "LOW" : "NONE") as ProductIntelligence["dataConfidence"]["label"], reasons };
}

function eligibility(p: ProductIntelInput) {
  const blockers: string[] = [], warnings: string[] = [];
  if (p.stock === "OUT_OF_STOCK" || p.stock === "DISCONTINUED") blockers.push("สินค้าหมดหรือเลิกผลิต");
  if (p.risk.restrictedCategory) blockers.push("หมวดสินค้าที่ถูกจำกัด");
  if (p.risk.counterfeitRisk) blockers.push("เสี่ยงสินค้าปลอม/ไม่ใช่รุ่นแท้");
  if (p.media.rightsClearedImages + p.media.rightsClearedVideos === 0) blockers.push("ยังไม่มีภาพหรือวิดีโอสินค้าที่ผ่านสิทธิ์");
  if (!p.identityVerified) warnings.push("ยังไม่ยืนยันรุ่นสินค้ากับแหล่งทางการ");
  if (p.stock === "UNKNOWN") warnings.push("ไม่ทราบสถานะสต็อก");
  if (p.verifiedFactCount === 0) warnings.push("ยังไม่มีข้อเท็จจริงที่ยืนยัน จึงพูดได้เพียงสิ่งที่เห็นในภาพ");
  if (p.risk.claimSensitivity === "HIGH") warnings.push("หมวดนี้ต้องตรวจข้อกล่าวอ้างเข้มงวด");
  return { eligible: blockers.length === 0, blockers, warnings };
}

export function rankProducts(products: ProductIntelInput[], options: { now?: Date; accountId?: string; weights?: OpportunityWeights; weightsSource?: ProductRankingReport["weightsSource"] } = {}): ProductRankingReport {
  const now = options.now ?? new Date(), weights = options.weights ?? DEFAULT_OPPORTUNITY_WEIGHTS;
  const items = products.map(p => {
    const opp = opportunityComponents(p, weights, options.accountId), o = weighted(opp);
    const cre = creativeComponents(p), c = weighted(cre);
    // Below a third of the weight observed, a number would mostly be the weights talking, not the market.
    const scored = o.score !== null && o.share >= 1 / 3;
    const conf = confidence(p, o.share, now), elig = eligibility(p);
    return { productId: p.id, title: p.title, categoryKey: p.categoryKey, rank: null as number | null,
      opportunity: { score: scored ? round(o.score!, 1) : null, status: scored ? "SCORED" as const : "UNKNOWN" as const, knownWeightShare: round(o.share, 3), components: opp },
      creativePotential: { score: round(c.score ?? 0, 1), components: cre }, dataConfidence: conf, eligibility: elig, explanation: "" };
  });
  // Eligible first; then measured opportunity discounted by how much of it is known; then creative potential.
  const sortKey = (i: ProductIntelligence) => [i.eligibility.eligible ? 1 : 0, i.opportunity.score === null ? -1 : i.opportunity.score * (.4 + .6 * i.dataConfidence.value), i.creativePotential.score];
  const sorted = items.toSorted((a, b) => { const x = sortKey(a), y = sortKey(b); for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return y[k] - x[k]; return a.productId.localeCompare(b.productId); });
  let r = 0;
  for (const item of sorted) {
    if (item.eligibility.eligible) item.rank = ++r;
    const unknownKeys = item.opportunity.components.filter(c => c.status === "UNKNOWN").map(c => c.key);
    item.explanation = [
      item.rank === 1 ? "อันดับ 1 เพราะผ่านเงื่อนไขการขายและ" + (item.opportunity.score === null ? "มีศักยภาพทางครีเอทีฟสูงสุดในชุดนี้ (ข้อมูลตลาดยังไม่พอให้คะแนนโอกาส)" : `มีโอกาสทางตลาด ${item.opportunity.score}/100 ที่ความมั่นใจ ${item.dataConfidence.label}`) : "",
      item.opportunity.score === null ? "คะแนนโอกาสทางตลาด: UNKNOWN (ไม่ใช่ศูนย์)" : `คะแนนโอกาส ${item.opportunity.score}/100 จากข้อมูลที่รู้จริง ${Math.round(item.opportunity.knownWeightShare * 100)}%`,
      `ศักยภาพครีเอทีฟ ${item.creativePotential.score}/100`,
      unknownKeys.length ? `ข้อมูลที่ยังไม่มี: ${unknownKeys.join(", ")}` : "",
      item.eligibility.blockers.length ? `ไม่ผ่าน: ${item.eligibility.blockers.join(" / ")}` : "",
    ].filter(Boolean).join(" · ");
  }
  const eligible = sorted.filter(i => i.eligibility.eligible);
  const mode = !eligible.length ? "NO_ELIGIBLE_PRODUCT" : products.length === 1 ? "SINGLE_PRODUCT_TRIAL" : "RANKED_SET";
  const headline = mode === "SINGLE_PRODUCT_TRIAL" ? `ทดลองกับสินค้าที่มีอยู่ 1 รายการ (${eligible[0].title}) — ไม่ใช่การที่ AI เลือกสินค้าดีที่สุดในตลาด`
    : mode === "NO_ELIGIBLE_PRODUCT" ? "ยังไม่มีสินค้าที่ผ่านเงื่อนไขพอจะผลิตโฆษณา"
    : `จัดอันดับ ${products.length} สินค้าจากข้อมูลที่มีจริง อันดับ 1: ${eligible[0].title}`;
  const caveats = ["คะแนนเป็นการจัดลำดับจากข้อมูลที่สังเกตได้ ไม่ใช่การทำนายยอดขาย",
    ...(sorted.some(i => i.opportunity.status === "UNKNOWN") ? ["สินค้าที่ข้อมูลตลาดไม่พอแสดงคะแนนโอกาสเป็น UNKNOWN"] : [])];
  return { version: PRODUCT_INTELLIGENCE_VERSION, mode, weights, weightsSource: options.weightsSource ?? "DEFAULT_PRIOR", items: sorted, headline, caveats };
}

/** Shifts weights toward components that measured outcomes support. Small, bounded steps and a minimum
 * sample keep a handful of lucky posts from rewriting the ranking. */
export function learnOpportunityWeights(base: OpportunityWeights, evidence: Array<{ key: OpportunityKey; correlation: number; samples: number }>, minSamples = 20): { weights: OpportunityWeights; applied: OpportunityKey[] } {
  const next = { ...base }, applied: OpportunityKey[] = [];
  for (const e of evidence) {
    if (e.samples < minSamples || !Number.isFinite(e.correlation)) continue;
    next[e.key] = base[e.key] * (1 + clamp(e.correlation, -1, 1) * .25 * Math.min(1, e.samples / 100));
    applied.push(e.key);
  }
  const sum = Object.values(next).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(next) as OpportunityKey[]) next[k] = round(next[k] / sum, 4);
  return { weights: next, applied };
}
