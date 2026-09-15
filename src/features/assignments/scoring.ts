import type { TikTokAccount } from "@/features/accounts/types";
import { DEFAULT_POLICY, SCORE_VERSION } from "./types";
import type { AffinityEvidence, AssignmentInput, Blocker, CategoryEvidence, PairScore, Policy, ProductEvidence } from "./types";

const clamp = (n: number, max = 1) => Math.min(max, Math.max(0, Number.isFinite(n) ? n : 0));
const rounded = (n: number) => Math.round(n * 10000) / 10000;
const hours = (now: string, then: string) => (Date.parse(now) - Date.parse(then)) / 3600000;
export const GROWTH_WEIGHTS = { product: .30, category: .20, affinity: .30, creative: .12, acceleration: .08 };
export const AFFILIATE_WEIGHTS = { product: .15, categoryCommercial: .20, affinity: .25, commission: .22, price: .10, acceleration: .08 };

export function resolvePolicy(overrides: Partial<Policy> = {}): Policy {
  const policy = { ...DEFAULT_POLICY, ...overrides };
  for (const key of ["maxAccountsPerProduct", "maxProductsPerCategoryPerAccount"] as const)
    if (!Number.isInteger(policy[key]) || policy[key] < 1) throw new Error("Invalid diversification limit");
  for (const key of ["sharingScoreGap", "maxProductAgeHours", "maxCategoryAgeHours", "minProductConfidence", "minCategoryConfidence"] as const)
    if (!Number.isFinite(policy[key]) || policy[key] < 0) throw new Error("Invalid assignment policy");
  if (policy.minProductConfidence > 1 || policy.minCategoryConfidence > 1) throw new Error("Invalid confidence threshold");
  return policy;
}
export function getEligibleProductAccounts(account: TikTokAccount, product: ProductEvidence, category: CategoryEvidence | undefined, now: string, policy = DEFAULT_POLICY): Blocker[] {
  const blockers: Blocker[] = [];
  const add = (code: string, reason: string) => blockers.push({ code, reason });
  if (account.owner_id !== product.product.owner_id) add("OWNER_MISMATCH", "Account and product belong to different owners.");
  if (account.account_status !== "active") add("ACCOUNT_INACTIVE", "Account is not active.");
  if (policy.requireConnection && account.authorization_status !== "authorized") add("ACCOUNT_DISCONNECTED", "Publishing requires account authorization.");
  if (account.effective_mode === "AFFILIATE") {
    if (account.follower_count < 1000) add("AFFILIATE_FOLLOWERS", "Affiliate requires at least 1,000 followers.");
    if (account.ecommerce_permission !== true) add("ECOMMERCE_NOT_READY", "E-commerce permission is missing.");
    if (account.cart_enabled !== true) add("CART_NOT_READY", "Product cart is not enabled.");
  }
  if (product.product.status !== "available") add("PRODUCT_UNAVAILABLE", "Product is unavailable or discontinued.");
  const age = hours(now, product.observedAt);
  if (!Number.isFinite(age) || age < 0 || age > policy.maxProductAgeHours) add("PRODUCT_STALE", "Product observation is missing, in the future, or too old.");
  if (!Number.isFinite(product.confidence) || product.confidence < policy.minProductConfidence) add("PRODUCT_LOW_CONFIDENCE", "Product evidence is insufficient.");
  if (!category || !category.active) add("CATEGORY_MISSING", "Active category evidence is required.");
  if (category) {
    if (category.confidence < policy.minCategoryConfidence || !Number.isFinite(category.confidence)) add("CATEGORY_LOW_CONFIDENCE", "Category evidence is insufficient.");
    const categoryAge = hours(now, category.observedAt);
    if (!Number.isFinite(categoryAge) || categoryAge < 0 || categoryAge > policy.maxCategoryAgeHours) add("CATEGORY_STALE", "Category observation is too old or in the future.");
  }
  return blockers;
}
interface FitSignals { product: number; category: number; categoryCommercial: number; affinity: number; creative: number; commission: number; price: number; acceleration: number }
export function calculateGrowthAccountProductFit(s: FitSignals) {
  return rounded(clamp(.30*s.product + .20*s.category + .30*s.affinity + .12*s.creative + .08*s.acceleration, 100));
}
export function calculateAffiliateAccountProductFit(s: FitSignals) {
  return rounded(clamp(.15*s.product + .20*s.categoryCommercial + .25*s.affinity + .22*s.commission + .10*s.price + .08*s.acceleration, 100));
}
export function calculateFinalViralOpportunity(fit: number, confidence: number, freshness: number, competition: number, saturation: number, mode: string, lowData: boolean) {
  const uncertainty = .25 + .75 * clamp(confidence);
  const ageFactor = .35 + .65 * clamp(freshness);
  const headroom = 1 - (mode === "GROWTH" ? .15 : .20)*clamp(competition) - .15*clamp(saturation);
  const adjusted = fit * uncertainty * ageFactor * headroom;
  return rounded(clamp(Math.min(adjusted, lowData ? 35 : 100), 100));
}
export function calculateAccountProductFit(account: TikTokAccount, p: ProductEvidence, c: CategoryEvidence | undefined, affinity: AffinityEvidence | undefined, now: string, policy = DEFAULT_POLICY): PairScore {
  const blockers = getEligibleProductAccounts(account, p, c, now, policy);
  // Evidence confidence shrinks niche affinity toward neutral, never toward zero.
  const affinityValue = .5 + clamp(affinity?.confidence ?? 0) * (clamp(affinity?.score ?? .5) - .5);
  const signals: FitSignals = {
    product: clamp(p.momentum,100), category: clamp(c?.momentum ?? 0,100),
    categoryCommercial: clamp(c?.commercial ?? 0,100), affinity: 100*affinityValue,
    creative: clamp(p.creative,100), commission: clamp(p.commission,100),
    price: clamp(p.price,100), acceleration: clamp(50 + 40*Math.tanh(p.acceleration),100),
  };
  const mode = account.effective_mode;
  const fit = mode === "GROWTH" ? calculateGrowthAccountProductFit(signals) : calculateAffiliateAccountProductFit(signals);
  const confidence = Math.sqrt(clamp(p.confidence) * clamp(c?.confidence ?? 0));
  const productAge = hours(now,p.observedAt), categoryAge = hours(now,c?.observedAt ?? "");
  const freshness = Math.min(Math.exp(-Math.max(0,productAge)/24),Math.exp(-Math.max(0,categoryAge)/48));
  const final = blockers.length ? 0 : calculateFinalViralOpportunity(fit,confidence,freshness,p.competition,c?.saturation ?? 1,mode,p.trend==="LOW_DATA" || confidence < .4);
  const weights = mode === "GROWTH" ? GROWTH_WEIGHTS : AFFILIATE_WEIGHTS;
  return {
    accountId: account.id, productId: p.product.id, categoryId: c?.id ?? null, categoryKey: p.product.category_key,
    mode, calculated_at: now, score_version: SCORE_VERSION, account_product_fit_score: fit,
    final_viral_opportunity_score: final, eligible: !blockers.length, blockers,
    product_component: signals.product, category_component: signals.category,
    account_category_component: rounded(signals.affinity), commercial_component: signals.commission,
    mode_fit_component: fit, confidence_component: rounded(confidence*100),
    freshness_component: rounded(clamp(freshness)*100), competition_component: rounded(100*(1-clamp(p.competition))),
    explanation_json: {
      whyProduct: `${p.product.title}: momentum ${signals.product.toFixed(1)}, creative ${signals.creative.toFixed(1)}, commission quality ${signals.commission.toFixed(1)}.`,
      whyAccount: `${account.display_name} uses ${mode}; evidence-adjusted niche affinity ${(affinityValue*100).toFixed(1)}%.`,
      whyNow: `Product age ${productAge.toFixed(1)}h; category age ${categoryAge.toFixed(1)}h; combined confidence ${(confidence*100).toFixed(1)}%.`,
      weights: {...weights}, inputs: {...signals, mode, productObservedAt:p.observedAt, categoryObservedAt:c?.observedAt??"", categoryKey:p.product.category_key},
      adjustments: { confidence:rounded(confidence), freshness:rounded(clamp(freshness)), competition:p.competition, saturation:c?.saturation??1 },
      blockers,
    },
  };
}
export function scorePairs(input: AssignmentInput, policy = DEFAULT_POLICY): PairScore[] {
  if (!Number.isFinite(Date.parse(input.now))) throw new Error("Invalid planning time");
  return input.accounts.flatMap(account => input.products.map(product => calculateAccountProductFit(
    account, product,
    input.categories.find(c => c.key===product.product.category_key && c.provider===product.product.external_provider),
    input.affinities.find(a => a.accountId===account.id && a.categoryKey===product.product.category_key),
    input.now, policy,
  )));
}
