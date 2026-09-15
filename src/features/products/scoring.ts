import type { Explanation, ProductMetrics, ProductScore, ProductSnapshot, Trend } from "./types";
export const SCORE_VERSION = "product-momentum-v1";
const HOUR = 3_600_000;
export const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : 0));
const round = (n: number) => Math.round(n * 10000) / 10000;

function history(rows: ProductSnapshot[], now: Date) {
  return rows.filter(r => Number.isFinite(Date.parse(r.captured_at)) && Date.parse(r.captured_at) <= now.getTime())
    .toSorted((a,b) => Date.parse(a.captured_at) - Date.parse(b.captured_at) || a.id.localeCompare(b.id))
    .filter((r,i,all) => i === all.length - 1 || r.captured_at !== all[i+1].captured_at);
}

export function calculateSalesVelocity(rows: ProductSnapshot[], hours: number, now: Date): number | null {
  if (hours <= 0) return null;
  const sorted = history(rows, now);
  const end = sorted.at(-1);
  if (!end || sorted.length < 2) return null;
  const cutoff = Date.parse(end.captured_at) - hours * HOUR;
  const before = sorted.filter(r => Date.parse(r.captured_at) <= cutoff).at(-1);
  if (!before) return null;
  const after = sorted.find(r => Date.parse(r.captured_at) >= cutoff);
  if (!after) return null;
  const gap = Date.parse(after.captured_at) - Date.parse(before.captured_at);
  // Do not invent short-window velocity across sparse observations.
  if (gap > Math.max(hours, 6) * HOUR) return null;
  const fraction = gap === 0 ? 0 : (cutoff - Date.parse(before.captured_at)) / gap;
  const baseline = before.units_sold + fraction * (after.units_sold - before.units_sold);
  const window = sorted.filter(r => Date.parse(r.captured_at) >= Date.parse(before.captured_at));
  if (window.some((r,i) => i > 0 && r.units_sold < window[i-1].units_sold)) return null;
  return Math.max(0, (end.units_sold - baseline) / hours);
}

export function calculateSalesAcceleration(rows: ProductSnapshot[], now: Date): number {
  const recent = calculateSalesVelocity(rows, 1, now);
  const six = calculateSalesVelocity(rows, 6, now);
  if (recent === null || six === null) return 0;
  const prior = Math.max(0, (six * 6 - recent) / 5);
  return clamp((recent - prior) / (prior + 10), -3, 3);
}

export function calculateDataConfidence(rows: ProductSnapshot[], now: Date): number {
  const sorted = history(rows, now);
  const last = sorted.at(-1);
  if (!last || sorted.length < 2) return 0;
  const recent = sorted.filter(r => Date.parse(r.captured_at) >= Date.parse(last.captured_at) - 24 * HOUR);
  const first = recent[0];
  const span = (Date.parse(last.captured_at) - Date.parse(first.captured_at)) / HOUR;
  const delta = Math.max(0, last.units_sold - first.units_sold);
  const reset = recent.some((r,i) => i > 0 && r.units_sold < recent[i-1].units_sold);
  const age = Math.max(0, (now.getTime() - Date.parse(last.captured_at)) / HOUR);
  const coverage = .30 * clamp(span / 24) + .20 * clamp((recent.length - 1) / 5)
    + .35 * clamp(Math.sqrt(delta / 200)) + .15 * last.review_count / (last.review_count + 50);
  return round(clamp(coverage * Math.exp(-age / 12) * (reset ? .4 : 1)));
}

export function calculateProductMomentum(velocity: number, acceleration: number, rating: number, creative: number, confidence: number) {
  return round(clamp((.50 * velocity + .25 * acceleration + .10 * rating + .15 * creative)
    * (.25 + .75 * confidence), 0, 100));
}

export function calculateBaseViralOpportunity(momentum: number, commission: number, price: number, competition: number, creative: number, confidence: number, economics: number) {
  return round(clamp((.55 * momentum + .20 * commission + .10 * price + .10 * competition + .05 * creative)
    * (.20 + .80 * confidence) * economics, 0, 100));
}

export function calculateProductScore(rows: ProductSnapshot[], now: Date, referencePrice = 500): ProductScore {
  const sorted = history(rows, now);
  const latest = sorted.at(-1);
  if (!latest) throw new Error("A non-future snapshot is required");
  const recent = sorted.filter(r => Date.parse(r.captured_at) >= Date.parse(latest.captured_at) - 24 * HOUR);
  const velocities = {
    "1h": calculateSalesVelocity(sorted, 1, now),
    "6h": calculateSalesVelocity(sorted, 6, now),
    "24h": calculateSalesVelocity(sorted, 24, now),
  };
  let weight = 0; let weighted = 0;
  for (const [key,w] of [["1h",.5],["6h",.3],["24h",.2]] as const) {
    if (velocities[key] !== null) { weight += w; weighted += velocities[key]! * w; }
  }
  const velocity = weight ? weighted / weight : 0;
  const velocityScore = 100 * clamp(Math.log1p(velocity) / Math.log1p(200));
  const acceleration = calculateSalesAcceleration(sorted, now);
  const accelerationScore = velocity > 0 ? 50 + 40 * Math.tanh(acceleration) : 0;
  const confidence = calculateDataConfidence(sorted, now);
  const reviewConfidence = latest.review_count / (latest.review_count + 50);
  const bayesianRating = ((latest.rating ?? 3.5) * latest.review_count + 3.5 * 50) / (latest.review_count + 50);
  const ratingScore = 100 * clamp((bayesianRating - 3) / 2);
  const rate = clamp(latest.commission_rate / .20);
  const amount = clamp(Math.log1p(latest.commission_amount) / Math.log1p(100));
  const commission = 100 * Math.sqrt(rate * amount);
  const economics = Math.sqrt(clamp(latest.commission_rate / .10) * clamp(latest.commission_amount / 30));
  const discount = latest.original_price && latest.original_price > latest.price
    ? clamp(1 - latest.price / latest.original_price) : 0;
  const price = 100 * (.8 * Math.exp(-Math.abs(Math.log(Math.max(latest.price,1) / Math.max(referencePrice,1))) / 1.5) + .2 * clamp(discount / .4));
  const competition = 100 * (1 - (latest.competition ?? .5));
  const creative = 100 * (latest.creative_potential ?? .5);
  const momentum = calculateProductMomentum(velocityScore, accelerationScore, ratingScore, creative, confidence);
  const opportunity = latest.status !== "available" ? 0 : calculateBaseViralOpportunity(momentum,commission,price,competition,creative,confidence,economics);
  const trend: Trend = confidence < .4 ? "LOW_DATA" : acceleration > .25 ? "ACCELERATING"
    : acceleration < -.15 ? "FALLING" : acceleration > .05 ? "RISING" : "STABLE";
  const explanation: Explanation = {
    signals: {
      salesVelocity: { score: round(velocityScore), reason: `Absolute recent sales: ${round(velocity)} units/hour; log scale, 200/hour reference.` },
      salesAcceleration: { score: round(accelerationScore), reason: `Latest hour versus previous five hours, +10 units/hour smoothing; ratio ${round(acceleration)}.` },
      commission: { score: round(commission), reason: `Joint rate/value score; economics multiplier ${round(economics)}.` },
      price: { score: round(price), reason: `Reference price THB ${referencePrice}; log-distance plus verified discount.` },
      rating: { score: round(ratingScore), reason: `Bayesian rating ${round(bayesianRating)} with 50-review prior at 3.5.` },
      competition: { score: round(competition), reason: latest.competition === null ? "Unknown competition: neutral 50." : "Normalized manual/provider saturation estimate; not measured TikTok creator competition." },
      creative: { score: round(creative), reason: latest.creative_potential === null ? "Unknown creative potential: neutral 50." : "Normalized manual/provider short-video suitability estimate." },
    },
    confidence, historyHours: round((Date.parse(latest.captured_at) - Date.parse(recent[0].captured_at)) / HOUR),
    salesDelta: Math.max(0, latest.units_sold - recent[0].units_sold),
    staleHours: round(Math.max(0,(now.getTime() - Date.parse(latest.captured_at)) / HOUR)),
    counterReset: recent.some((r,i) => i > 0 && r.units_sold < recent[i-1].units_sold),
    velocities, acceleration: round(acceleration), trend,
    assumptions: ["THB price reference is a configurable V1 fallback, not Category Intelligence.", "No production TikTok data.", "Total historical sales do not directly contribute to ranking."],
  };
  return {
    calculated_at: now.toISOString(), score_version: SCORE_VERSION,
    sales_velocity: round(velocity), sales_acceleration: round(acceleration),
    price_attractiveness: round(price), commission_score: round(commission),
    rating_score: round(ratingScore), review_confidence: round(reviewConfidence),
    competition_score: round(competition), creative_potential_score: round(creative),
    data_confidence: confidence, product_momentum_score: momentum,
    viral_opportunity_base_score: opportunity, explanation_json: explanation,
  };
}

export function validateMetrics(m: ProductMetrics) {
  const nonnegative = [m.price,m.commission_amount,m.review_count,m.units_sold];
  if (nonnegative.some(n => !Number.isFinite(n) || n < 0) || !Number.isInteger(m.units_sold) || !Number.isInteger(m.review_count)) throw new Error("Invalid product metrics");
  if (!Number.isFinite(m.commission_rate) || m.commission_rate < 0 || m.commission_rate > 1) throw new Error("Commission rate must be a fraction from 0 to 1");
}
