import type { SupabaseClient } from "@supabase/supabase-js";
import { appendGrowthSnapshot } from "../growth/persistence";
import { boundedAdjustment, learningDecision } from "./learning";
import { evidenceHash } from "./scoring";
import type { AnalyticsMode, WinnerResult } from "./types";

export async function recordAutoLearning(admin: SupabaseClient, input: {
  ownerId: string; accountId: string; winnerScoreId: string; productId: string; mode: AnalyticsMode;
}) {
  const score = await admin.from("winner_scores")
    .select("id,decision,confidence,final_score,evaluated_at,video_snapshot_id")
    .eq("owner_id", input.ownerId).eq("tiktok_account_id", input.accountId)
    .eq("id", input.winnerScoreId).maybeSingle();
  if (score.error) throw new Error("auto_learning_read_failed");
  if (!score.data) return null;
  const decision = learningDecision({ decision: score.data.decision,
    confidence: Number(score.data.confidence) } as WinnerResult);
  const hash = evidenceHash({ winnerScoreId: input.winnerScoreId, decision, productId: input.productId });
  const { error } = await admin.from("learning_decisions").upsert({
    owner_id: input.ownerId, tiktok_account_id: input.accountId, winner_score_id: input.winnerScoreId,
    decision_type: decision, target_brain: "PRODUCT", target_key: input.productId,
    adjustment: boundedAdjustment((Number(score.data.final_score ?? 50) - 50) / 50, Number(score.data.confidence), 1),
    confidence: Number(score.data.confidence), rationale: "winner-detection-v1 evidence",
    evidence_hash: hash, decided_at: new Date().toISOString(),
  }, { onConflict: "owner_id,tiktok_account_id,target_brain,target_key,decision_version,evidence_hash",
    ignoreDuplicates: true });
  if (error) throw new Error("auto_learning_write_failed");
  const saved = await admin.from("learning_decisions").select("id")
    .eq("owner_id", input.ownerId).eq("tiktok_account_id", input.accountId)
    .eq("target_brain", "PRODUCT").eq("target_key", input.productId)
    .eq("decision_version", "learning-loop-v1").eq("evidence_hash", hash).single();
  if (saved.error || !saved.data) throw new Error("auto_learning_readback_failed");
  if (input.mode === "GROWTH") {
    const account = await admin.from("tiktok_accounts").select("follower_count")
      .eq("owner_id", input.ownerId).eq("id", input.accountId).maybeSingle();
    if (account.error) throw new Error("auto_growth_account_read_failed");
    await appendGrowthSnapshot(admin, { ownerId: input.ownerId, accountId: input.accountId,
      snapshotAt: score.data.evaluated_at, followerCount: account.data?.follower_count ?? null,
      followerDelta: null, views: null, engagement: null, attributionConfidence: 0,
      categoryPerformance: {}, availability: { followerDelta: "UNKNOWN" }, source: "PHASE_8_ANALYTICS",
      // growth_account_snapshots.source_snapshot_id references account analytics,
      // while this winner is backed by a video analytics snapshot.
      sourceSnapshotId: null });
  }
  return { learningDecisionId: saved.data.id as string, learningDecision: decision };
}
