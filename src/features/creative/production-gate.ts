import {assertHumanProductionReview, CREATIVE_STRATEGY_VERSION, strategyEvidenceDigest, type CreativeStrategyPlan} from "./strategist";

type Review = NonNullable<Parameters<typeof assertHumanProductionReview>[1]>;
type Row = Record<string, unknown>;
export interface StoredProductionStrategy {
  plan: CreativeStrategyPlan; conceptId: string; productId: string; scriptDigest: string; review: Review | null;
}
export function creativeScriptDigest(script: Row) {
  return strategyEvidenceDigest([script.hook_text,script.voice_script,script.cta_text,
    script.caption,script.scene_plan_json,script.overlay_text_json]);
}
export function storedProductionStrategy(angle: Row): StoredProductionStrategy | null {
  const metadata = angle.score_explanation_json as Row | null;
  const stored = metadata?.productionStrategy;
  if (stored === undefined) return null; // Preserve unmodified legacy creative flows.
  if (!stored || typeof stored !== "object" || (stored as StoredProductionStrategy).plan?.version !== CREATIVE_STRATEGY_VERSION) throw new Error("CREATIVE_STRATEGY_INVALID");
  return stored as StoredProductionStrategy;
}
/** Called again at Video Factory/provider execution; selecting a draft is not approval. */
export function reviewedProductionMethod(source: {angle: Row;script: Row;account: Row;product: Row}, owner: string) {
  return reviewedProductionConcept(source, owner)?.production.method ?? null;
}
/** The human-reviewed concept, including the evidence ids the reviewer saw. */
export function reviewedProductionConcept(source: {angle: Row;script: Row;account: Row;product: Row}, owner: string) {
  const stored = storedProductionStrategy(source.angle);
  if (!stored) {
    // A strategy script remains gated even if its angle metadata was accidentally
    // removed or replaced. Missing evidence is not permission to use legacy mocks.
    if (source.script.version === CREATIVE_STRATEGY_VERSION) throw new Error("CREATIVE_STRATEGY_INVALID");
    return null;
  }
  if (stored.productId !== source.product.id || stored.plan.accountId !== source.account.id ||
      stored.scriptDigest !== creativeScriptDigest(source.script) || stored.review?.reviewedBy !== owner ||
      stored.review.conceptId !== stored.conceptId) throw new Error("HUMAN_CREATIVE_REVIEW_REQUIRED");
  return assertHumanProductionReview(stored.plan, stored.review);
}
