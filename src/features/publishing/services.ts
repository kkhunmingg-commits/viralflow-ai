import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logOps } from "../../lib/ops/logger";
import { operationalPage, operationalWindow } from "../../lib/pagination";
import { runPrePublishGate } from "@/features/compliance/services";
import {assertShoppableIntentReady} from "@/features/commerce/services";
import {ownsVideoStoragePath} from "@/features/video/storage";
import { TikTokCreatorService, TikTokTokenService } from "@/features/tiktok/services";
import { serverEnv } from "@/lib/server-env";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertVerifiedPullUrl, buildChunkSource, MockTikTokPublishingProvider, OfficialTikTokPublishingProvider, type TikTokPublishingProvider } from "./provider";
import { deterministicNextDaySlot, remainingPublishSlots } from "./scheduler";
import { assertConsentSnapshot, assertPublishingPermission, consentHash, statusFromProvider } from "./state";
import { parseTikTokPublishWebhook } from "./webhook";
import type { PublishMode, PublishQueueRow, PublishQueueStatus, PublishSettings, PublishSource, SourceInfo, VideoKind } from "./types";

type AdminClient = SupabaseClient;
type Row = Record<string, unknown>;

export class PublishingError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PublishingError";
  }
}

export function createPublishingProvider(): TikTokPublishingProvider {
  if (serverEnv.tiktokPublishingProvider === "mock") return new MockTikTokPublishingProvider();
  if (!serverEnv.tiktokPublishingRealMode) throw new PublishingError("real_publishing_mode_disabled");
  return new OfficialTikTokPublishingProvider(fetch, serverEnv.tiktokAllowedUploadHosts);
}

function string(value: unknown) { return String(value ?? ""); }
export class TikTokPublishingService {
  constructor(
    private readonly admin: AdminClient = createAdminClient(),
    private readonly provider: TikTokPublishingProvider = createPublishingProvider(),
  ) {}

  private async queue(ownerId: string, queueId: string) {
    const { data, error } = await this.admin.from("publishing_queue").select("*")
      .eq("owner_id", ownerId).eq("id", queueId).maybeSingle();
    if (error || !data) throw new PublishingError("publish_queue_not_found");
    return data as PublishQueueRow;
  }

  private async transition(queue: PublishQueueRow, toStatus: PublishQueueStatus, patch: Row = {}, source = "SYSTEM", reasonCode?: string) {
    if (queue.status === toStatus && Object.keys(patch).length === 0) return queue;
    const { data, error } = await this.admin.rpc("transition_publish_queue_atomic", {
      p_owner_id: queue.owner_id,
      p_queue_id: queue.id,
      p_expected_status: queue.status,
      p_to_status: toStatus,
      p_patch: { ...patch, source, reason_code: reasonCode ?? null },
    });
    if (error || !data) throw new PublishingError("publish_transition_conflict");
    logOps({ severity: "INFO", component: "publishing", operation: "transition", owner_id: queue.owner_id,
      account_id: queue.tiktok_account_id, publish_id: queue.id, from_state: queue.status, to_state: toStatus });
    return data as PublishQueueRow;
  }

  async queueVideo(input: {
    ownerId: string;
    accountId: string;
    videoId: string;
    videoKind: VideoKind;
    publishMode: PublishMode;
    sourceMethod?: PublishSource;
    pullFromUrl?: string;
    caption?: string;
    priority?: number;
    scheduledFor?: string;
    idempotencyKey: string;
  }) {
    const existing = await this.admin.from("publishing_queue").select("*")
      .eq("owner_id", input.ownerId).eq("idempotency_key", input.idempotencyKey).maybeSingle();
    if (existing.error) throw new PublishingError("queue_idempotency_check_failed");
    if (existing.data) return existing.data as PublishQueueRow;

    const table = input.videoKind === "MASTER" ? "master_videos" : "video_variations";
    const [{ data: video, error: videoError }, { data: account, error: accountError }] = await Promise.all([
      this.admin.from(table).select("id,tiktok_account_id,status,quality_status,storage_path").eq("owner_id", input.ownerId).eq("id", input.videoId).maybeSingle(),
      this.admin.from("tiktok_accounts").select("id").eq("owner_id", input.ownerId).eq("id", input.accountId).maybeSingle(),
    ]);
    if (videoError || !video) throw new PublishingError("video_not_found");
    if (accountError || !account) throw new PublishingError("account_not_found");
    if (video.tiktok_account_id !== input.accountId) throw new PublishingError("video_account_mismatch");
    if (video.quality_status !== "PASS" || !["READY", "APPROVED"].includes(video.status) || !video.storage_path) {
      throw new PublishingError("video_not_publishable");
    }
    const sourceMethod = input.sourceMethod ?? "FILE_UPLOAD";
    const pullFromUrl = sourceMethod === "PULL_FROM_URL"
      ? assertVerifiedPullUrl(input.pullFromUrl ?? "", serverEnv.tiktokAllowedPullHosts)
      : null;
    const { data, error } = await this.admin.rpc("enqueue_publish_atomic", {
      p_owner_id: input.ownerId,
      p_tiktok_account_id: input.accountId,
      p_video_id: input.videoId,
      p_video_kind: input.videoKind,
      p_publish_mode: input.publishMode,
      p_source_method: sourceMethod,
      p_pull_from_url: pullFromUrl,
      p_caption: input.caption ?? "",
      p_priority: input.priority ?? 50,
      p_scheduled_for: input.scheduledFor ?? null,
      p_idempotency_key: input.idempotencyKey,
      p_external_operation_key: `tiktok:${input.idempotencyKey}`,
    });
    if (error || !data) throw new PublishingError("queue_create_failed");
    return data as PublishQueueRow;
  }

  private async accountAndMedia(queue: PublishQueueRow, refreshCreator: boolean) {
    if (refreshCreator && queue.publish_mode === "DIRECT_POST") {
      await new TikTokCreatorService(this.admin).queryCreatorInfo(queue.owner_id, queue.tiktok_account_id, true);
    }
    const table = queue.video_kind === "MASTER" ? "master_videos" : "video_variations";
    const [{ data: account, error: accountError }, { data: video, error: videoError }] = await Promise.all([
      this.admin.from("tiktok_accounts").select("*").eq("owner_id", queue.owner_id).eq("id", queue.tiktok_account_id).maybeSingle(),
      this.admin.from(table).select("*").eq("owner_id", queue.owner_id).eq("id", queue.video_id).maybeSingle(),
    ]);
    if (accountError || !account) throw new PublishingError("account_not_found");
    if (videoError || !video) throw new PublishingError("video_not_found");
    if (video.quality_status !== "PASS" || !video.storage_path) throw new PublishingError("video_quality_not_passed");
    if (Number(video.duration_seconds) > Number(account.creator_max_video_duration ?? 600)) throw new PublishingError("video_duration_exceeds_creator_limit");
    if (Number(video.fps) < 23 || Number(video.fps) > 60) throw new PublishingError("video_fps_unsupported");
    const { data: asset, error: assetError } = await this.admin.from("media_assets").select("*")
      .eq("owner_id", queue.owner_id).eq("storage_path", video.storage_path).eq("asset_type", "VIDEO").maybeSingle();
    if (assetError || !asset || !["video/mp4", "video/quicktime", "video/webm"].includes(asset.mime_type)) {
      throw new PublishingError("video_media_invalid");
    }
    if (!ownsVideoStoragePath(queue.owner_id, String(video.storage_path))) {
      throw new PublishingError("video_storage_path_invalid");
    }
    return { account, video, asset };
  }

  private async capacity(queue: PublishQueueRow, target = new Date()) {
    const start = new Date(target); start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const scheduleFilter = start.getTime() === today.getTime()
      ? `scheduled_for.is.null,and(scheduled_for.gte.${start.toISOString()},scheduled_for.lt.${end.toISOString()})`
      : `and(scheduled_for.gte.${start.toISOString()},scheduled_for.lt.${end.toISOString()})`;
    const [{ data: health, error: healthError }, { count, error: countError }] = await Promise.all([
      this.admin.from("account_publish_health").select("*").eq("owner_id", queue.owner_id).eq("tiktok_account_id", queue.tiktok_account_id).maybeSingle(),
      this.admin.from("publishing_queue").select("id", { count: "exact", head: true }).eq("owner_id", queue.owner_id).eq("tiktok_account_id", queue.tiktok_account_id)
        .in("status", ["APPROVED", "QUEUED", "UPLOADING", "PROCESSING"])
        .neq("id", queue.id)
        .or(scheduleFilter),
    ]);
    if (healthError || !health) throw new PublishingError("account_health_unavailable");
    if (countError) throw new PublishingError("queue_capacity_unavailable");
    const posts = start.getTime() === today.getTime() ? Number(health.posts_today) : 0;
    return { health, remaining: remainingPublishSlots(Number(health.effective_publish_cap), posts, count ?? 0) };
  }

  private async latestGateRows(queue: PublishQueueRow) {
    const latest = (table: string, order: string) => this.admin.from(table).select("*").eq("owner_id", queue.owner_id).eq("video_id", queue.video_id).order(order, { ascending: false }).limit(1).maybeSingle();
    const [compliance, originality, eligibility] = await Promise.all([
      latest("content_compliance_checks", "checked_at"), latest("originality_checks", "created_at"), latest("publish_eligibility_checks", "created_at"),
    ]);
    for (const result of [compliance, originality, eligibility]) if (result.error || !result.data) throw new PublishingError("phase_6c_evidence_missing");
    return { compliance: compliance.data, originality: originality.data, eligibility: eligibility.data };
  }

  async preparePublish(ownerId: string, queueId: string) {
    let queue = await this.queue(ownerId, queueId);
    const { account } = await this.accountAndMedia(queue, true);
    if(queue.shoppable_content_intent_id)await assertShoppableIntentReady(this.admin,ownerId,queue.shoppable_content_intent_id);
    try {
      assertPublishingPermission({ mode: queue.publish_mode, authorizationStatus: account.authorization_status, grantedScopes: account.granted_scopes, directPostStatus: account.direct_post_status, uploadStatus: account.upload_status });
    } catch (error) {
      throw new PublishingError(error instanceof Error ? error.message : "publishing_permission_not_ready");
    }

    const gate = await runPrePublishGate(this.admin, ownerId, queue.video_kind === "MASTER" ? "master" : "variation", queue.video_id, false);
    const rows = await this.latestGateRows(queue);
    if (["REJECT", "REGENERATE", "ACCOUNT_BLOCKED"].includes(gate.eligibility.finalStatus)) {
      return this.transition(queue, "REJECTED", {
        compliance_check_id: rows.compliance.id, originality_check_id: rows.originality.id, eligibility_check_id: rows.eligibility.id,
        last_error_code: gate.eligibility.finalStatus,
      }, "SYSTEM", gate.eligibility.finalStatus);
    }
    const capacity = await this.capacity(queue);
    if (capacity.remaining <= 0 || gate.eligibility.finalStatus === "QUEUED_NEXT_DAY") {
      return this.transition(queue, "WAITING_FOR_SLOT", {
        compliance_check_id: rows.compliance.id, originality_check_id: rows.originality.id, eligibility_check_id: rows.eligibility.id,
        scheduled_for: deterministicNextDaySlot(queue.id),
      }, "SYSTEM", "EFFECTIVE_CAP_REACHED");
    }
    const privacy = account.audit_status === "AUDITED" ? queue.privacy_level : "SELF_ONLY";
    queue = await this.transition(queue, "REVIEW_REQUIRED", {
      compliance_check_id: rows.compliance.id, originality_check_id: rows.originality.id, eligibility_check_id: rows.eligibility.id,
      privacy_level: privacy,
      is_aigc: Boolean((rows.compliance.explanation_json as Row)?.aigc && (((rows.compliance.explanation_json as Row).aigc as Row).ai_generated || ((rows.compliance.explanation_json as Row).aigc as Row).ai_modified)),
      last_error_code: null, last_error_message: null,
    }, "SYSTEM", "READY_FOR_EXPLICIT_CONSENT");
    return queue;
  }

  async recordConsent(ownerId: string, queueId: string, settings: PublishSettings) {
    let queue = await this.queue(ownerId, queueId);
    if (!queue.eligibility_check_id) queue = await this.preparePublish(ownerId, queueId);
    if (queue.status !== "REVIEW_REQUIRED") throw new PublishingError("queue_not_awaiting_consent");
    const { account } = await this.accountAndMedia(queue, queue.publish_mode === "DIRECT_POST");
    if (settings.caption.length > 2200) throw new PublishingError("caption_too_long");
    const privacy = account.audit_status === "AUDITED" ? settings.privacyLevel : "SELF_ONLY";
    if (queue.publish_mode === "DIRECT_POST" && (!privacy || !(account.privacy_level_options as string[]).includes(privacy))) throw new PublishingError("privacy_level_not_allowed");
    if (settings.disableComment === false && account.comment_disabled) throw new PublishingError("comments_not_allowed");
    if (settings.disableDuet === false && account.duet_disabled) throw new PublishingError("duet_not_allowed");
    if (settings.disableStitch === false && account.stitch_disabled) throw new PublishingError("stitch_not_allowed");
    const exact = { ...settings, privacyLevel: privacy, isAigc: queue.is_aigc || settings.isAigc };
    const hash = consentHash(exact);
    const { count } = await this.admin.from("publish_consents").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).eq("publishing_queue_id", queueId);
    const { data: consent, error } = await this.admin.from("publish_consents").insert({
      owner_id: ownerId, publishing_queue_id: queueId, tiktok_account_id: queue.tiktok_account_id,
      consent_version: (count ?? 0) + 1, explicit_consent: true,
      caption_snapshot: exact.caption, privacy_level: exact.privacyLevel,
      interaction_settings_json: { disable_comment: exact.disableComment, disable_duet: exact.disableDuet, disable_stitch: exact.disableStitch },
      commercial_content_json: exact.commercialContent, is_aigc: exact.isAigc, consent_hash: hash,
    }).select("id").single();
    if (error || !consent) throw new PublishingError("consent_write_failed");
    return this.transition(queue, "APPROVED", {
      consent_id: consent.id, caption_snapshot: exact.caption, privacy_level: exact.privacyLevel,
      disable_comment: exact.disableComment, disable_duet: exact.disableDuet, disable_stitch: exact.disableStitch,
      is_aigc: exact.isAigc, commercial_content_json: exact.commercialContent,
    }, "USER", "EXPLICIT_CONSENT_RECORDED");
  }

  private settings(queue: PublishQueueRow): PublishSettings {
    return { caption: queue.caption_snapshot, privacyLevel: queue.privacy_level, disableComment: queue.disable_comment, disableDuet: queue.disable_duet, disableStitch: queue.disable_stitch, isAigc: queue.is_aigc, commercialContent: queue.commercial_content_json };
  }

  private async mediaSource(queue: PublishQueueRow, storagePath: string, mimeType: string) {
    if (queue.source_method === "PULL_FROM_URL") {
      return { source: { source: "PULL_FROM_URL", videoUrl: assertVerifiedPullUrl(queue.pull_from_url ?? "", serverEnv.tiktokAllowedPullHosts) } as SourceInfo, media: null };
    }
    const { data, error } = await this.admin.storage.from("video-assets").download(storagePath);
    if (error || !data) throw new PublishingError("video_download_failed");
    const media = new Blob([await data.arrayBuffer()], { type: mimeType });
    if (media.size < 1 || media.size > 52_428_800) {
      throw new PublishingError("video_size_invalid");
    }
    return { source: buildChunkSource(media.size), media };
  }

  private async accessToken(queue: PublishQueueRow) {
    return this.provider.name === "mock" ? "mock-access-token" : new TikTokTokenService(this.admin).getAccessToken(queue.owner_id, queue.tiktok_account_id);
  }

  async uploadDraft(ownerId: string, queueId: string) { return this.publish(ownerId, queueId, "DRAFT_UPLOAD"); }
  async directPost(ownerId: string, queueId: string) { return this.publish(ownerId, queueId, "DIRECT_POST"); }
  async uploadBinary(uploadUrl: string, media: Blob, source: SourceInfo) {
    return this.provider.uploadBinary(uploadUrl, media, source);
  }

  async schedulePublish(ownerId: string, queueId: string, scheduledFor: string) {
    const queue = await this.queue(ownerId, queueId);
    if (queue.status !== "APPROVED") throw new PublishingError("queue_not_approved");
    const scheduled = new Date(scheduledFor);
    if (Number.isNaN(scheduled.getTime())) throw new PublishingError("schedule_invalid");
    const capacity = await this.capacity(queue, scheduled);
    return capacity.remaining > 0
      ? this.transition(queue, "QUEUED", { scheduled_for: scheduled.toISOString() }, "USER", "USER_SCHEDULED")
      : this.transition(queue, "WAITING_FOR_SLOT", { scheduled_for: deterministicNextDaySlot(queue.id, scheduled) }, "SYSTEM", "EFFECTIVE_CAP_REACHED");
  }

  private async publish(ownerId: string, queueId: string, expectedMode: PublishMode) {
    let queue = await this.queue(ownerId, queueId);
    if (queue.publish_mode !== expectedMode) throw new PublishingError("publish_mode_mismatch");
    if (queue.provider_publish_id) return queue;
    if (queue.status !== "APPROVED" && queue.status !== "QUEUED" && queue.status !== "RETRYING") throw new PublishingError("queue_not_approved");
    if(queue.shoppable_content_intent_id)await assertShoppableIntentReady(this.admin,ownerId,queue.shoppable_content_intent_id);
    const { account, video, asset } = await this.accountAndMedia(queue, expectedMode === "DIRECT_POST");
    const gate = await runPrePublishGate(this.admin, ownerId, queue.video_kind === "MASTER" ? "master" : "variation", queue.video_id, true);
    if (gate.eligibility.finalStatus !== "READY_TO_PUBLISH") throw new PublishingError(`phase_6c_${gate.eligibility.finalStatus.toLowerCase()}`);
    const capacity = await this.capacity(queue);
    if (capacity.remaining <= 0) return this.transition(queue, "WAITING_FOR_SLOT", { scheduled_for: deterministicNextDaySlot(queue.id) }, "SYSTEM", "EFFECTIVE_CAP_REACHED");
    if (!queue.consent_id) throw new PublishingError("explicit_consent_required");
    const { data: consent } = await this.admin.from("publish_consents").select("consent_hash").eq("owner_id", ownerId).eq("id", queue.consent_id).maybeSingle();
    try { assertConsentSnapshot(queue.consent_id, consent?.consent_hash ?? null, this.settings(queue)); }
    catch (error) { throw new PublishingError(error instanceof Error ? error.message : "explicit_consent_required"); }
    if (expectedMode === "DIRECT_POST" && account.audit_status !== "AUDITED" && queue.privacy_level !== "SELF_ONLY") throw new PublishingError("unaudited_direct_post_must_be_private");
    try {
      assertPublishingPermission({ mode: expectedMode, authorizationStatus: account.authorization_status, grantedScopes: account.granted_scopes, directPostStatus: account.direct_post_status, uploadStatus: account.upload_status });
    } catch (error) {
      throw new PublishingError(error instanceof Error ? error.message : "publishing_permission_not_ready");
    }

    const { source, media } = await this.mediaSource(queue, string(video.storage_path), string(asset.mime_type));
    const accessToken = await this.accessToken(queue);
    const claim = await this.admin.rpc("claim_publish_operation", {
      p_owner_id: ownerId,
      p_queue_id: queue.id,
      p_worker_id: `publish:${randomUUID()}`,
      p_lease_seconds: 90,
    });
    if (claim.error || !claim.data) throw new PublishingError("publish_claim_failed");
    const claimed = claim.data as {
      claimed: boolean;
      reason?: string;
      leaseToken?: string;
      attemptId?: string;
      queue: PublishQueueRow;
    };
    if (!claimed.claimed || !claimed.leaseToken || !claimed.attemptId) {
      if (claimed.reason === "RECONCILE_OR_COMPLETE") return claimed.queue;
      throw new PublishingError(claimed.reason === "LEASE_HELD" ? "publish_already_claimed" : "publish_not_claimable");
    }
    queue = claimed.queue;
    const leaseToken = claimed.leaseToken;
    const attemptId = claimed.attemptId;
    let submissionStarted = false;
    try {
      const begun = await this.admin.rpc("begin_publish_submission", {
        p_owner_id: ownerId, p_queue_id: queue.id, p_lease_token: leaseToken,
      });
      if (begun.error || !begun.data) throw new PublishingError("publish_lease_lost");
      submissionStarted = true;
      const initialized = expectedMode === "DIRECT_POST"
        ? await this.provider.directPost(accessToken, this.settings(queue), source)
        : await this.provider.uploadDraft(accessToken, source);
      const providerStatus = source.source === "FILE_UPLOAD" ? "PROCESSING_UPLOAD" : "PROCESSING_DOWNLOAD";
      const persisted = await this.admin.rpc("record_publish_submission", {
        p_owner_id: ownerId,
        p_queue_id: queue.id,
        p_lease_token: leaseToken,
        p_attempt_id: attemptId,
        p_provider_publish_id: initialized.publishId,
        p_provider_status: providerStatus,
      });
      if (persisted.error || !persisted.data) throw new PublishingError("provider_publish_id_persist_failed");
      queue = persisted.data as PublishQueueRow;
      if (source.source === "FILE_UPLOAD") {
        if (!media || !initialized.uploadUrl) throw new PublishingError("upload_url_missing");
        await this.uploadBinary(initialized.uploadUrl, media, source);
      }
      return queue;
    } catch (error) {
      const code = error instanceof PublishingError ? error.code : error instanceof Error ? error.message : "publishing_unknown_error";
      if (queue.provider_publish_id) throw error;
      if (submissionStarted) {
        const unknown = await this.admin.rpc("record_publish_unknown", {
          p_owner_id: ownerId,
          p_queue_id: queue.id,
          p_lease_token: leaseToken,
          p_attempt_id: attemptId,
          p_error_code: code,
        });
        if (unknown.error || !unknown.data) throw new PublishingError("publish_reconciliation_required");
        return unknown.data as PublishQueueRow;
      }
      const retryable = /429|5\d\d|internal|network|timeout/i.test(code) && queue.retry_count < queue.max_retries;
      const failed = await this.admin.rpc("record_publish_failure", {
        p_owner_id: ownerId,
        p_queue_id: queue.id,
        p_lease_token: leaseToken,
        p_attempt_id: attemptId,
        p_error_code: code,
        p_retryable: retryable,
      });
      if (failed.error || !failed.data) throw new PublishingError("publish_failure_record_failed");
      return failed.data as PublishQueueRow;
    }
  }

  async fetchPublishStatus(ownerId: string, queueId: string) {
    const queue = await this.queue(ownerId, queueId);
    if (!queue.provider_publish_id) throw new PublishingError("provider_publish_id_missing");
    const result = await this.provider.fetchPublishStatus(await this.accessToken(queue), queue.provider_publish_id);
    return this.transition(queue, statusFromProvider(result.status, queue.publish_mode), {
      provider_status: result.status, uploaded_bytes: result.uploadedBytes,
      published_post_ids_json: result.postIds, last_error_code: result.failReason,
      completed_at: ["FAILED", "PUBLISH_COMPLETE", "SEND_TO_USER_INBOX"].includes(result.status) ? new Date().toISOString() : null,
    }, "TIKTOK_API", result.failReason ?? result.status);
  }

  async handlePublishWebhook(rawBody: string) {
    const parsed = parseTikTokPublishWebhook(rawBody, serverEnv.tiktokClientKey);
    const { data: queue, error } = await this.admin.from("publishing_queue").select("*").eq("provider_publish_id", parsed.content.publish_id).maybeSingle();
    if (error || !queue) return { accepted: true, matched: false, duplicate: false };
    const eventId = createHash("sha256").update(rawBody).digest("hex");
    const result = await this.admin.rpc("apply_publish_webhook_atomic", {
      p_queue_id: queue.id,
      p_event_id: eventId,
      p_to_status: parsed.target,
      p_provider_status: parsed.envelope.event,
      p_reason_code: parsed.content.reason ?? null,
      p_post_id: parsed.content.post_id ? String(parsed.content.post_id) : null,
      p_occurred_at: new Date(parsed.envelope.create_time * 1000).toISOString(),
    });
    if (result.error || !result.data) throw new PublishingError("webhook_atomic_apply_failed");
    return { accepted: true, ...(result.data as { matched: boolean; duplicate: boolean }) };
  }

  async cancelQueuedPublish(ownerId: string, queueId: string) {
    const queue = await this.queue(ownerId, queueId);
    if (["UPLOADING", "PROCESSING", "DRAFT_DELIVERED", "PUBLISHED", "CANCELLED"].includes(queue.status)) throw new PublishingError("queue_cannot_be_cancelled");
    return this.transition(queue, "CANCELLED", { cancelled_at: new Date().toISOString() }, "USER", "USER_CANCELLED");
  }

  async retryPublish(ownerId: string, queueId: string) {
    const queue = await this.queue(ownerId, queueId);
    if (queue.external_state === "SUBMITTED_UNKNOWN") {
      if (queue.provider_publish_id) return this.fetchPublishStatus(ownerId, queueId);
      throw new PublishingError("publish_reconciliation_required");
    }
    if (!['FAILED', 'RETRYING'].includes(queue.status)) throw new PublishingError("queue_not_retryable");
    if (queue.retry_count >= queue.max_retries) throw new PublishingError("retry_limit_reached");
    if (queue.provider_publish_id) return this.fetchPublishStatus(ownerId, queueId);
    return queue.publish_mode === "DIRECT_POST" ? this.directPost(ownerId, queueId) : this.uploadDraft(ownerId, queueId);
  }
}

export async function listPublishingQueue(client: SupabaseClient, ownerId: string, page = 1) {
  const { from, to } = operationalWindow(page);
  const [queue, accounts] = await Promise.all([
    client.from("publishing_queue").select("id,tiktok_account_id,video_id,video_kind,publish_mode,priority,source_method,scheduled_for,consent_id,status,created_at").eq("owner_id", ownerId).order("priority", { ascending: false }).order("created_at").order("id").range(from, to),
    client.from("tiktok_accounts").select("id,display_name,username,connection_status,audit_status,effective_mode").eq("owner_id", ownerId),
  ]);
  for (const result of [queue, accounts]) if (result.error) throw new PublishingError("publishing_queue_read_failed");
  const accountMap = new Map((accounts.data ?? []).map(row => [row.id, row]));
  return operationalPage((queue.data ?? []).map(row => ({ ...row, account: accountMap.get(row.tiktok_account_id) })), page);
}

export async function getPublishingDetail(client: SupabaseClient, ownerId: string, queueId: string) {
  const { data: queue, error } = await client.from("publishing_queue").select("*").eq("owner_id", ownerId).eq("id", queueId).maybeSingle();
  if (error || !queue) throw new PublishingError("publish_queue_not_found");
  const [account, attempts, events, consents, intents, shopProducts] = await Promise.all([
    client.from("tiktok_accounts").select("*").eq("owner_id", ownerId).eq("id", queue.tiktok_account_id).single(),
    client.from("publish_attempts").select("*").eq("owner_id", ownerId).eq("publishing_queue_id", queueId).order("created_at", { ascending: false }).limit(100),
    client.from("publish_status_events").select("*").eq("owner_id", ownerId).eq("publishing_queue_id", queueId).order("occurred_at", { ascending: false }).limit(100),
    client.from("publish_consents").select("*").eq("owner_id", ownerId).eq("publishing_queue_id", queueId).order("consented_at", { ascending: false }).limit(100),
    client.from("shoppable_content_intents").select("*").eq("owner_id",ownerId).eq("publishing_queue_id",queueId).order("created_at",{ascending:false}).limit(100),
    client.from("shop_products").select("*").eq("owner_id",ownerId).eq("product_status","ACTIVE").eq("audit_status","APPROVED").limit(200),
  ]);
  for (const result of [account, attempts, events, consents,intents,shopProducts]) if (result.error) throw new PublishingError("publishing_detail_read_failed");
  return { queue, account: account.data, attempts: attempts.data ?? [], events: events.data ?? [], consents: consents.data ?? [],intents:intents.data??[],shopProducts:shopProducts.data??[] };
}
