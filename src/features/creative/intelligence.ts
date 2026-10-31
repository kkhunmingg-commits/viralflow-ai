import type { StoryHistory } from "./storyteller";
import type { CreativeContext } from "./types";
import { analyzeTrendIntelligence, type TrendObservation } from "../growth-manager/topics";
import { analyzeCreativeLearning, type CreativeOutcome } from "../analytics/creative-learning";
import { planCreativeStrategy, type StrategyAsset, type StrategyFact, type ProductionCostAttempt } from "./strategist";
import type { CreativeLearningHistory } from "./self-learning";

export interface CreativeIntelligenceResources {
  ownerId: string; now: Date; optedIn: boolean; affiliateEligible: boolean;
  realAccount: boolean; region?: string; audienceSegments?: string[];
  mechanism?: "COMPLEX" | "SIMPLE" | "UNKNOWN";
  /** These attestations are server/owner-reviewed evidence, never raw catalog assertions. */
  facts: StrategyFact[]; assets: StrategyAsset[];
  trends: TrendObservation[]; outcomes: CreativeOutcome[]; costs?: ProductionCostAttempt[];
  adaptiveHistory?: CreativeLearningHistory[];
  /** Formats, hooks and topics this account was planned with recently, newest first. */
  storyHistory?: StoryHistory;
}

/** Shared orchestration over existing Creative Brain, Trend and Analytics contracts. No API or media submission. */
export function planExistingCreativeContext(context: CreativeContext, resources: CreativeIntelligenceResources) {
  const trend = analyzeTrendIntelligence(resources.trends, {accountId: context.account.id,
    region: resources.region, audienceSegments: resources.audienceSegments,
    productCategoryKey: context.account.mode === "AFFILIATE" ? context.product.category : undefined}, resources.now);
  const learning = analyzeCreativeLearning(resources.outcomes, {ownerId: resources.ownerId,accountId: context.account.id,
    mode: context.account.mode,optedIn: resources.optedIn && resources.realAccount,affiliateEligible: resources.affiliateEligible}, resources.now);
  const strategy = planCreativeStrategy({now: resources.now,
    account: {id: context.account.id,mode: context.account.mode,affiliateEligible: resources.affiliateEligible},
    // Growth is not forced through a dummy product or a commerce CTA.
    product: context.account.mode === "AFFILIATE" || context.assignment.purpose === "OWNER_OFFLINE_PRODUCT" ? {id: context.product.id,title: context.product.title,mechanism: resources.mechanism ?? "UNKNOWN"} : undefined,
    facts: resources.facts,assets: resources.assets,trends: trend,costs: resources.costs,history: resources.storyHistory,
    learning: {accountId: context.account.id,source: resources.realAccount ? "REAL" : "MOCK",evidenceIds: learning.evidenceIds,
      preferredHook: learning.preferredHook,preferredAngle: learning.preferredAngle,confidence: learning.confidence}});
  return {strategy,trend,learning,contextSource: resources.realAccount ? "REAL_ACCOUNT_RECORD" as const : "MOCK_OR_UNVERIFIED_ACCOUNT" as const,
    videoGenerated: false as const,paidCalls: 0 as const,postingCalls: 0 as const,
    humanReview: "PENDING" as const};
}
