/** Ad learning loop: ties real posted results back to the product, concept format, hook, provider, quality
 * verdict and cost that produced them, and turns them into cautious preferences for the next plan.
 * Only owner-imported or API-sourced results count; nothing here fabricates views, orders or win rates.
 * Comparisons use rates normalised by exposure and are withheld until both sides have enough posts. */
import type { AdFormat } from "../creative/category-insight";

export const AD_LEARNING_VERSION = "ad-learning-v1";
export interface AdOutcome {
  videoId: string; productId: string; conceptFormat: AdFormat; hook: string; provider: string;
  qualityDecision: "READY_FOR_OWNER_REVIEW" | "REVISE_STORYBOARD_OR_EDIT" | "REJECT" | null;
  costThb: number | null; source: "OWNER_REPORT_IMPORT" | "TIKTOK_DISPLAY" | "TIKTOK_SHOP_ANALYTICS";
  publishedAt: string; observedAt: string;
  views: number | null; avgWatchSeconds: number | null; completionRate: number | null; engagements: number | null;
  productClicks: number | null; orders: number | null; commissionThb: number | null;
}
export interface FormatLearning { format: AdFormat; samples: number; views: number; completion: number | null; engagementRate: number | null; clickRate: number | null; liftVsAccount: number; evidence: "SUFFICIENT" | "INSUFFICIENT" }
export interface AdLearningReport {
  version: string; usable: number; excluded: Array<{ videoId: string; reason: string }>;
  formats: FormatLearning[]; costPerUsableClipThb: number | null; notes: string[];
}

const MIN_AGE_HOURS = 48, MIN_SAMPLES = 5, MIN_VIEWS = 300;
const rate = (num: number | null, den: number) => (num === null || den <= 0 ? null : num / den);
const avg = (xs: Array<number | null>) => { const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

export function learnFromAdOutcomes(rows: AdOutcome[], now = new Date()): AdLearningReport {
  const excluded: AdLearningReport["excluded"] = [], usable: AdOutcome[] = [];
  for (const r of rows) {
    const age = (Date.parse(r.observedAt) - Date.parse(r.publishedAt)) / 3_600_000;
    if (!Number.isFinite(age) || Date.parse(r.observedAt) > now.getTime()) excluded.push({ videoId: r.videoId, reason: "INVALID_TIMESTAMPS" });
    else if (age < MIN_AGE_HOURS) excluded.push({ videoId: r.videoId, reason: "TOO_EARLY_TO_COMPARE" });
    else if (r.views === null) excluded.push({ videoId: r.videoId, reason: "NO_VIEW_DATA" });
    else usable.push(r);
  }
  // Account baseline: the share-of-attention score below, averaged over every usable post.
  const score = (r: AdOutcome) => {
    const completion = r.completionRate ?? null, engagement = rate(r.engagements, r.views!), clicks = rate(r.productClicks, r.views!);
    return avg([completion, engagement === null ? null : Math.min(1, engagement * 10), clicks === null ? null : Math.min(1, clicks * 20)]);
  };
  const baseline = avg(usable.map(score)) ?? 0;
  const byFormat = new Map<AdFormat, AdOutcome[]>();
  for (const r of usable) byFormat.set(r.conceptFormat, [...(byFormat.get(r.conceptFormat) ?? []), r]);
  const formats = [...byFormat.entries()].map(([format, list]) => {
    const views = list.reduce((a, r) => a + (r.views ?? 0), 0), s = avg(list.map(score));
    const sufficient = list.length >= MIN_SAMPLES && views >= MIN_VIEWS * list.length;
    // Shrink toward the account baseline by sample size so a couple of lucky posts move little.
    const shrunk = s === null ? baseline : (s * list.length + baseline * MIN_SAMPLES) / (list.length + MIN_SAMPLES);
    return { format, samples: list.length, views, completion: avg(list.map(r => r.completionRate)), engagementRate: rate(list.reduce((a, r) => a + (r.engagements ?? 0), 0), views),
      clickRate: list.every(r => r.productClicks === null) ? null : rate(list.reduce((a, r) => a + (r.productClicks ?? 0), 0), views),
      liftVsAccount: sufficient && baseline > 0 ? +((shrunk - baseline) / baseline).toFixed(3) : 0, evidence: sufficient ? "SUFFICIENT" as const : "INSUFFICIENT" as const };
  }).toSorted((a, b) => b.liftVsAccount - a.liftVsAccount);
  const costs = rows.map(r => r.costThb).filter((c): c is number => c !== null), usableClips = rows.filter(r => r.qualityDecision === "READY_FOR_OWNER_REVIEW").length;
  return { version: AD_LEARNING_VERSION, usable: usable.length, excluded, formats,
    costPerUsableClipThb: costs.length && usableClips ? +(costs.reduce((a, b) => a + b, 0) / usableClips).toFixed(2) : null,
    notes: ["เปรียบเทียบเฉพาะโพสต์อายุ ≥ 48 ชม. และรูปแบบที่มี ≥ 5 โพสต์", "ผลเป็นสหสัมพันธ์จากโพสต์จริง ไม่ใช่การพิสูจน์เหตุและผล", "ต้นทุนต่อคลิปที่ใช้ได้รวมต้นทุนของคลิปที่ไม่ผ่านด้วย"] };
}

/** Director input: only formats with sufficient evidence are passed on. */
export const directorLearning = (report: AdLearningReport) => report.formats.filter(f => f.evidence === "SUFFICIENT").map(f => ({ format: f.format, liftVsAccount: f.liftVsAccount, samples: f.samples }));
