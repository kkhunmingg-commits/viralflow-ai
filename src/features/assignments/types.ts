import type { EffectiveMode, TikTokAccount } from "@/features/accounts/types";
import type { Product } from "@/features/products/types";

export const SCORE_VERSION = "account-product-fit-v1";
export interface ProductEvidence {
  product: Product;
  momentum: number; creative: number; commission: number; price: number;
  acceleration: number; confidence: number; observedAt: string;
  competition: number; trend: string;
}
export interface CategoryEvidence {
  id: string; key: string; provider: string; active: boolean;
  momentum: number; commercial: number; confidence: number;
  saturation: number; observedAt: string;
}
export interface AffinityEvidence { accountId: string; categoryKey: string; score: number; confidence: number }
export interface AssignmentInput {
  accounts: TikTokAccount[]; products: ProductEvidence[]; categories: CategoryEvidence[];
  affinities: AffinityEvidence[]; now: string;
  publishedToday?: Record<string, number>;
  existing?: ExistingAssignment[];
}
export interface ExistingAssignment {
  tiktok_account_id: string; product_id: string; category_key: string;
  assignment_date: string; rank_for_account: number; final_score: number;
  status: AssignmentStatus;
}
export type AssignmentStatus = "CANDIDATE" | "SELECTED" | "SKIPPED" | "BLOCKED" | "USED" | "EXPIRED";
export interface Policy {
  maxAccountsPerProduct: number; maxProductsPerCategoryPerAccount: number;
  avoidSameProductSameDayAcrossAccounts: boolean;
  allowSharedProductWhenScoreAdvantageIsLarge: boolean; sharingScoreGap: number;
  requireConnection: boolean; maxProductAgeHours: number; maxCategoryAgeHours: number;
  minProductConfidence: number; minCategoryConfidence: number;
}
export const DEFAULT_POLICY: Policy = {
  maxAccountsPerProduct: 2, maxProductsPerCategoryPerAccount: 2,
  avoidSameProductSameDayAcrossAccounts: true,
  allowSharedProductWhenScoreAdvantageIsLarge: true, sharingScoreGap: 15,
  requireConnection: true, maxProductAgeHours: 48, maxCategoryAgeHours: 72,
  minProductConfidence: 0.2, minCategoryConfidence: 0.2,
};
export interface Blocker { code: string; reason: string }
export interface Components {
  product_component: number; category_component: number; account_category_component: number;
  commercial_component: number; mode_fit_component: number; confidence_component: number;
  freshness_component: number; competition_component: number;
}
export interface PairScore extends Components {
  accountId: string; productId: string; categoryId: string | null; categoryKey: string;
  mode: EffectiveMode; calculated_at: string; score_version: string;
  account_product_fit_score: number; final_viral_opportunity_score: number;
  eligible: boolean; blockers: Blocker[]; explanation_json: {
    whyProduct: string; whyAccount: string; whyNow: string;
    weights: Record<string, number>; inputs: Record<string, number | string>;
    adjustments: Record<string, number>; blockers: Blocker[];
  };
}
export interface PlannedAssignment {
  score: PairScore; rank: number; status: "CANDIDATE"; reason: string;
}
export interface DailyPlan {
  date: string; policy: Policy; scores: PairScore[]; assignments: PlannedAssignment[];
  omitted: { accountId: string; productId: string; reason: string }[];
}
