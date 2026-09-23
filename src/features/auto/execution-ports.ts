import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createProjectFromAssignment, generateCreativeProject, getCreativeProjectDetail, selectCreative } from "@/features/creative/services";
import { buildMasterVideo } from "@/features/video/services";
import { generateAutoFalMaster, reverifyAutoFalMaster } from "@/features/video/auto-fal";
import { PaidGenerationUncertainError } from "@/features/video/budget-ledger";
import { falAutoModeAvailability } from "@/features/video/provider-routing";
import { serverEnv } from "@/lib/server-env";
import { getLatestVideoGate, runPrePublishGate } from "@/features/compliance/services";
import { TikTokPublishingService } from "@/features/publishing/services";
import type { TikTokPublishingProvider } from "@/features/publishing/provider";
import { calculateWinner, defaultBaseline } from "@/features/analytics/scoring";
import { persistVideoEvaluation } from "@/features/analytics/services";
import { createProductionAnalyticsIngestion } from "@/features/analytics/production-runtime";
import type { ProductionAnalyticsIngestion } from "@/features/analytics/production-ingestion";
import { recordAutoLearning } from "@/features/analytics/auto-learning";
import { assignmentDate } from "@/features/assignments/planner";
import type { VideoAnalyticsObservation } from "@/features/analytics/provider";
import type { FrameVisionProvider } from "@/features/video/frame-verification";
import { autoPublishMode, autoVideoQualityOutcome } from "./execution-policy";
import { stableAutoKey } from "./engine";
import type { ExecutionClaim, ExecutionPorts, StageOutcome } from "./processor";

function id(claim: ExecutionClaim, key: string) {
  const value = claim.checkpoint[key];
  if (typeof value !== "string" || !value) throw new Error(`auto_${key}_missing`);
  return value;
}
function wait(state: Extract<StageOutcome, { kind: "WAIT" }>["state"], reason: string): StageOutcome {
  return { kind: "WAIT", state, reason };
}
function must(error: { message: string } | null, code: string) {
  if (error) throw new Error(`${code}: ${error.message}`);
}
async function runIsActive(admin: SupabaseClient, claim: ExecutionClaim) {
  const { data, error } = await admin.from("auto_runs").select("state")
    .eq("owner_id", claim.ownerId).eq("id", claim.runId).maybeSingle();
  must(error, "auto_run_read_failed");
  return data?.state === "RUNNING";
}

export interface AutoExecutionBoundaries {
  falProvider?: Parameters<typeof generateAutoFalMaster>[2];
  visionProvider?: FrameVisionProvider;
  publishingProvider?: TikTokPublishingProvider;
  analyticsIngestion?: ProductionAnalyticsIngestion;
}

export function createAutoExecutionPorts(admin: SupabaseClient, boundaries: AutoExecutionBoundaries = {}): ExecutionPorts {
  const publishing = new TikTokPublishingService(admin, boundaries.publishingProvider);
  return {
    async FIND_OPPORTUNITY(claim) {
      const { data, error } = await admin.from("product_assignments").select("id,product_id,effective_mode,status")
        .eq("owner_id", claim.ownerId).eq("tiktok_account_id", claim.accountId)
        .eq("assignment_date", assignmentDate(new Date().toISOString()))
        .in("status", ["CANDIDATE", "SELECTED", "USED"])
        .eq("rank_for_account", claim.itemIndex).maybeSingle();
      must(error, "auto_assignment_read_failed");
      if (!data) return wait("WAITING_FOR_DATA", "ASSIGNMENT_REQUIRED");
      if (data.effective_mode !== claim.mode) return wait("BLOCKED", "MODE_MISMATCH");
      return { kind: "ADVANCE", evidence: { assignmentId: data.id, productId: data.product_id } };
    },
    async CREATE_CREATIVE(claim) {
      const assignmentId = id(claim, "assignmentId");
      const project = await createProjectFromAssignment(admin, claim.ownerId, assignmentId);
      let detail = await getCreativeProjectDetail(admin, claim.ownerId, project.id);
      if (!detail.scripts.length) {
        const account = await admin.from("tiktok_accounts").select("is_mock")
          .eq("owner_id", claim.ownerId).eq("id", claim.accountId).maybeSingle();
        must(account.error, "auto_account_read_failed");
        if (!account.data) throw new Error("auto_account_missing");
        await generateCreativeProject(admin, claim.ownerId, project.id, { forceMock: account.data.is_mock, forAutoWorker: true });
        detail = await getCreativeProjectDetail(admin, claim.ownerId, project.id);
      }
      if (!detail.project.selected_script_id) {
        const safe = detail.angles.find((angle) => angle.policy_status === "SAFE");
        const script = detail.scripts.find((row) => row.creative_angle_id === safe?.id && row.status !== "REJECTED");
        if (!safe || !script) return { kind: "SKIP_ITEM", reason: "CREATIVE_RISK_REJECTED" };
        await selectCreative(admin, claim.ownerId, project.id, safe.id, script.id);
        return { kind: "ADVANCE", evidence: { projectId: project.id, scriptId: script.id } };
      }
      return { kind: "ADVANCE", evidence: { projectId: project.id, scriptId: detail.project.selected_script_id } };
    },
    async GENERATE_VIDEO(claim) {
      const { data: account, error } = await admin.from("tiktok_accounts").select("is_mock")
        .eq("owner_id", claim.ownerId).eq("id", claim.accountId).maybeSingle();
      must(error, "auto_account_read_failed");
      if (!account) throw new Error("auto_account_missing");
      if (!account.is_mock) {
        const gate = falAutoModeAvailability({ keyPresent: Boolean(serverEnv.falKey), state: serverEnv.falWanProviderState });
        if (!gate.providerAvailable) return wait("WAITING_FOR_PROVIDER", "PROVIDER_UNAVAILABLE");
        try {
          const video = await generateAutoFalMaster(admin, { ownerId: claim.ownerId, runId: claim.runId,
            accountId: claim.accountId, projectId: id(claim, "projectId"), operationKey: claim.operationKey },
          boundaries.falProvider, boundaries.visionProvider);
          return { kind: "ADVANCE", evidence: { videoId: video.id, videoKind: "MASTER", videoProvider: "fal" } };
        } catch (failure) {
          if (failure instanceof PaidGenerationUncertainError) {
            return failure.providerRequestId
              ? wait("WAITING_FOR_DATA", "PROVIDER_RESULT_PENDING")
              : { kind: "RECONCILE", reason: "RECONCILIATION_REQUIRED" };
          }
          if (failure instanceof Error && ["product_image_required", "product_image_download_failed"].includes(failure.message)) {
            return wait("WAITING_FOR_DATA", "PRODUCT_IMAGE_REQUIRED");
          }
          if (failure instanceof Error && /budget_exceeded/.test(failure.message)) return wait("BLOCKED", "BUDGET_EXCEEDED");
          throw failure;
        }
      }
      if (process.env.NODE_ENV !== "development") return wait("WAITING_FOR_PROVIDER", "MOCK_ACCOUNT_DISABLED");
      const video = await buildMasterVideo(admin, claim.ownerId, id(claim, "projectId"));
      return { kind: "ADVANCE", evidence: { videoId: video.id, videoKind: "MASTER", videoProvider: "local-ffmpeg" } };
    },
    async QUALITY_CHECK(claim) {
      const { data, error } = await admin.from("master_videos").select("id,quality_status,quality_score,quality_explanation_json,provider,status")
        .eq("owner_id", claim.ownerId).eq("id", id(claim, "videoId")).maybeSingle();
      must(error, "auto_quality_read_failed");
      const explanation = data?.quality_explanation_json;
      if (data?.provider === "fal" && data.quality_status === "RETRY"
        && explanation && typeof explanation === "object" && "visualVerificationReason" in explanation
        && ["VISION_PROVIDER_UNAVAILABLE", "VISION_PROVIDER_ERROR"].includes(String(explanation.visualVerificationReason))
        && (boundaries.visionProvider || serverEnv.openAIApiKey)) {
        const verified = await reverifyAutoFalMaster(admin, { ownerId: claim.ownerId,
          accountId: claim.accountId, projectId: id(claim, "projectId"), videoId: data.id }, boundaries.visionProvider);
        return autoVideoQualityOutcome(verified);
      }
      return autoVideoQualityOutcome(data);
    },
    async COMPLIANCE_CHECK(claim) {
      const videoId = id(claim, "videoId");
      let gate = await getLatestVideoGate(admin, claim.ownerId, videoId);
      if (!gate.eligibility) {
        await runPrePublishGate(admin, claim.ownerId, "master", videoId, false);
        gate = await getLatestVideoGate(admin, claim.ownerId, videoId);
      }
      const status = String(gate.eligibility?.final_status ?? "ACCOUNT_BLOCKED");
      if (["REJECT", "REGENERATE"].includes(status)) return { kind: "SKIP_ITEM", reason: `COMPLIANCE_${status}` };
      if (status === "ACCOUNT_BLOCKED") return wait("BLOCKED", "ACCOUNT_HEALTH");
      if (status === "QUEUED_NEXT_DAY") return wait("WAITING_FOR_SLOT", "PUBLISH_CAP");
      if (status === "HOLD") return wait("WAITING_FOR_APPROVAL", "COMPLIANCE_REVIEW");
      if (!["READY_FOR_REVIEW", "READY_TO_PUBLISH"].includes(status)) return wait("BLOCKED", "COMPLIANCE_UNKNOWN");
      return { kind: "ADVANCE", evidence: { eligibilityStatus: status, complianceCheckId: gate.eligibility?.id } };
    },
    async QUEUE_PUBLISH(claim) {
      const account = await admin.from("tiktok_accounts")
        .select("is_mock,authorization_status,audit_status,direct_post_status,granted_scopes")
        .eq("owner_id", claim.ownerId).eq("id", claim.accountId).maybeSingle();
      must(account.error, "auto_publish_account_read_failed");
      if (!account.data) throw new Error("auto_publish_account_missing");
      const publishMode = autoPublishMode(account.data, process.env.NODE_ENV === "development");
      if (!publishMode) return wait("WAITING_FOR_DATA", "DIRECT_POST_APPROVAL_REQUIRED");
      const queued = await publishing.queueVideo({
        ownerId: claim.ownerId, accountId: claim.accountId, videoId: id(claim, "videoId"),
        videoKind: "MASTER", publishMode,
        idempotencyKey: stableAutoKey(claim.runId, claim.accountId, claim.itemIndex, "QUEUE_PUBLISH"),
      });
      return { kind: "ADVANCE", evidence: { queueId: queued.id, publishMode } };
    },
    async PUBLISH(claim) {
      const queueId = id(claim, "queueId");
      const { data, error } = await admin.from("publishing_queue").select("id,status,external_state,consent_id,provider_publish_id,publish_mode")
        .eq("owner_id", claim.ownerId).eq("id", queueId).maybeSingle();
      must(error, "auto_publish_read_failed");
      if (!data) throw new Error("auto_publish_queue_missing");
      if (data.publish_mode !== "DIRECT_POST" && !(process.env.NODE_ENV === "development" && data.publish_mode === "DRAFT_UPLOAD")) {
        return wait("WAITING_FOR_DATA", "DIRECT_POST_REQUIRED");
      }
      if (["PUBLISHED", "DRAFT_DELIVERED"].includes(data.status)) return { kind: "ADVANCE", evidence: { publishStatus: data.status } };
      if (data.provider_publish_id) {
        try {
          const refreshed = await publishing.fetchPublishStatus(claim.ownerId, queueId);
          if (["FAILED", "REJECTED", "CANCELLED"].includes(refreshed.status)) {
            return { kind: "SKIP_ITEM", reason: `PUBLISH_${refreshed.status}` };
          }
          return ["DRAFT_DELIVERED", "PUBLISHED"].includes(refreshed.status)
            ? { kind: "ADVANCE", evidence: { publishStatus: refreshed.status } }
            : wait("WAITING_FOR_DATA", "PUBLISH_RESULT_PENDING");
        } catch {
          return wait("WAITING_FOR_DATA", "PUBLISH_RESULT_PENDING");
        }
      }
      if (data.status === "WAITING_FOR_RECONCILIATION" || data.external_state === "SUBMITTED_UNKNOWN") {
        return { kind: "RECONCILE", reason: "RECONCILIATION_REQUIRED", evidence: { queueId } };
      }
      if (data.status === "WAITING_FOR_SLOT") return wait("WAITING_FOR_SLOT", "PUBLISH_CAP");
      if (["REJECTED", "FAILED", "CANCELLED"].includes(data.status)) return { kind: "SKIP_ITEM", reason: `PUBLISH_${data.status}` };
      if (data.status === "DRAFT") {
        const prepared = await publishing.preparePublish(claim.ownerId, queueId);
        if (prepared.status === "WAITING_FOR_SLOT") return wait("WAITING_FOR_SLOT", "PUBLISH_CAP");
        if (prepared.status === "REJECTED") return { kind: "SKIP_ITEM", reason: "PUBLISH_GATE_REJECTED" };
      }
      if (!data.consent_id) return wait("WAITING_FOR_APPROVAL", "CONSENT");
      if (!await runIsActive(admin, claim)) return wait("WAITING_FOR_APPROVAL", "RUN_NOT_ACTIVE");
      const result = data.publish_mode === "DIRECT_POST"
        ? await publishing.directPost(claim.ownerId, queueId)
        : await publishing.uploadDraft(claim.ownerId, queueId);
      if (["DRAFT_DELIVERED", "PUBLISHED"].includes(result.status)) {
        return { kind: "ADVANCE", evidence: { publishStatus: result.status } };
      }
      if (result.provider_publish_id) {
        try {
          const refreshed = await publishing.fetchPublishStatus(claim.ownerId, queueId);
          if (["FAILED", "REJECTED", "CANCELLED"].includes(refreshed.status)) {
            return { kind: "SKIP_ITEM", reason: `PUBLISH_${refreshed.status}` };
          }
          if (["DRAFT_DELIVERED", "PUBLISHED"].includes(refreshed.status)) {
            return { kind: "ADVANCE", evidence: { publishStatus: refreshed.status } };
          }
        } catch {
          // The provider operation ID is durable; a later poll must not resubmit it.
          return wait("WAITING_FOR_DATA", "PUBLISH_RESULT_PENDING");
        }
      }
      if (result.status === "WAITING_FOR_RECONCILIATION" || result.external_state === "SUBMITTED_UNKNOWN") {
        return { kind: "RECONCILE", reason: "RECONCILIATION_REQUIRED", evidence: { queueId } };
      }
      return wait("WAITING_FOR_DATA", "PUBLISH_RESULT_PENDING");
    },
    async COLLECT_ANALYTICS(claim) {
      const videoId = id(claim, "videoId");
      if (serverEnv.tiktokAnalyticsProvider === "official" || boundaries.analyticsIngestion) {
        const ingested = await (boundaries.analyticsIngestion ?? createProductionAnalyticsIngestion(admin)).collect({
          ownerId: claim.ownerId, accountId: claim.accountId, queueId: id(claim, "queueId"),
          videoId, videoKind: "MASTER", mode: claim.mode, productId: id(claim, "productId"),
        });
        return ingested.status === "READY"
          ? { kind: "ADVANCE", evidence: { winnerScoreId: ingested.winnerScoreId, winnerDecision: ingested.winnerDecision } }
          : wait("WAITING_FOR_DATA", ingested.reason);
      }
      const account = await admin.from("tiktok_accounts").select("is_mock")
        .eq("owner_id", claim.ownerId).eq("id", claim.accountId).maybeSingle();
      must(account.error, "auto_analytics_account_read_failed");
      if (!account.data?.is_mock || process.env.NODE_ENV !== "development") {
        return wait("WAITING_FOR_PROVIDER", "ANALYTICS_PROVIDER_UNAVAILABLE");
      }
      const existing = await admin.from("winner_scores").select("id,decision,confidence,final_score")
        .eq("owner_id", claim.ownerId).eq("tiktok_account_id", claim.accountId)
        .eq("video_id", videoId).eq("mode", claim.mode)
        .order("evaluated_at", { ascending: false }).limit(1).maybeSingle();
      must(existing.error, "auto_winner_read_failed");
      if (existing.data) return { kind: "ADVANCE", evidence: { winnerScoreId: existing.data.id, winnerDecision: existing.data.decision } };
      const snapshot = await admin.from("video_analytics_snapshots").select("*")
        .eq("owner_id", claim.ownerId).eq("video_id", videoId).order("source_snapshot_at", { ascending: false }).limit(1).maybeSingle();
      must(snapshot.error, "auto_analytics_read_failed");
      if (!snapshot.data) return wait("WAITING_FOR_DATA", "ANALYTICS_STALE");
      const row = snapshot.data;
      const baseline = defaultBaseline();
      const observation: VideoAnalyticsObservation = {
        externalVideoId: row.external_video_id, capturedAt: row.source_snapshot_at, source: row.source,
        sourceConfidence: Number(row.source_confidence), views: row.views, likes: row.likes,
        comments: row.comments, shares: row.shares, favorites: row.favorites,
        clicks: row.clicks, orders: row.orders, gmv: row.gmv, commission: row.commission,
      };
      const result = calculateWinner({ ...observation, id: videoId, accountId: claim.accountId,
        mode: claim.mode, ageHours: Math.max(0, (Date.now() - Date.parse(row.source_snapshot_at)) / 3_600_000),
        commerceAvailable: claim.mode === "AFFILIATE" && row.orders !== null, baseline });
      const saved = await persistVideoEvaluation(admin, { ownerId: claim.ownerId, accountId: claim.accountId,
        videoId, videoKind: "MASTER", mode: claim.mode, observation, result, baseline, productId: id(claim, "productId") });
      return { kind: "ADVANCE", evidence: { winnerScoreId: saved.winnerScoreId, winnerDecision: result.decision } };
    },
    async LEARN(claim) {
      const saved = await recordAutoLearning(admin, { ownerId: claim.ownerId, accountId: claim.accountId,
        winnerScoreId: id(claim, "winnerScoreId"), productId: id(claim, "productId"), mode: claim.mode });
      return saved ? { kind: "ADVANCE", evidence: saved } : wait("WAITING_FOR_DATA", "WINNER_SCORE_MISSING");
    },
  };
}
