import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runPrePublishGate } from "@/features/compliance/services";
import {assertShoppableIntentReady} from "@/features/commerce/services";
import {ownsVideoStoragePath} from "@/features/video/storage";
import { TikTokCreatorService, TikTokTokenService } from "@/features/tiktok/services";
import { serverEnv } from "@/lib/server-env";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertVerifiedPullUrl, buildChunkSource, MockTikTokPublishingProvider, OfficialTikTokPublishingProvider, type TikTokPublishingProvider } from "./provider";
import { deterministicNextDaySlot, remainingPublishSlots, retryDelaySeconds } from "./scheduler";
import { assertConsentSnapshot, assertPublishingPermission, consentHash, publishAttemptKey, statusFromProvider } from "./state";
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
    const { data, error } = await this.admin.from("publishing_queue").update({ status: toStatus, ...patch })
      .eq("owner_id", queue.owner_id).eq("id", queue.id).eq("status", queue.status).select("*").maybeSingle();
    if (error) throw new PublishingError("queue_transition_failed");
    if (!data) return this.queue(queue.owner_id, queue.id);
    const { error: eventError } = await this.admin.from("publish_status_events").insert({
      owner_id: queue.owner_id,
      publishing_queue_id: queue.id,
      source,
      from_status: queue.status,
      to_status: toStatus,
      reason_code: reasonCode ?? null,
      provider_status: patch.provider_status ?? null,
      metadata_json: {},
    });
    if (eventError) throw new PublishingError("status_event_write_failed");
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
    const { data, error } = await this.admin.from("publishing_queue").insert({
      owner_id: input.ownerId,
      tiktok_account_id: input.accountId,
      video_id: input.videoId,
      video_kind: input.videoKind,
      publish_mode: input.publishMode,
      source_method: sourceMethod,
      pull_from_url: pullFromUrl,
      caption_snapshot: input.caption ?? "",
      priority: input.priority ?? 50,
      scheduled_for: input.scheduledFor ?? null,
      status: "REVIEW_REQUIRED",
      idempotency_key: input.idempotencyKey,
    }).select("*").single();
    if (error || !data) throw new PublishingError("queue_create_failed");
    await this.admin.from("publish_status_events").insert({ owner_id: input.ownerId, publishing_queue_id: data.id, source: "USER", from_status: "DRAFT", to_status: "REVIEW_REQUIRED", reason_code: "QUEUED_FOR_REVIEW" });
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

    const attemptNumber = queue.retry_count + 1;
    const operation = expectedMode === "DIRECT_POST" ? "INIT_UPLOAD" : "INIT_UPLOAD";
    const attemptKey = publishAttemptKey(queue.id, operation, attemptNumber);
    const { data: attempt, error: attemptError } = await this.admin.from("publish_attempts").insert({
      owner_id: ownerId, publishing_queue_id: queue.id, attempt_number: attemptNumber, operation,
      provider: this.provider.name, idempotency_key: attemptKey, request_json: { mode: expectedMode, source: queue.source_method }, status: "STARTED",
    }).select("id").single();
    if (attemptError || !attempt) throw new PublishingError("publish_attempt_create_failed");
    queue = await this.transition(queue, "UPLOADING", { started_at: new Date().toISOString(), claimed_at: new Date().toISOString() }, "SYSTEM", "PROVIDER_INIT_STARTED");
    try {
      const { source, media } = await this.mediaSource(queue, string(video.storage_path), string(asset.mime_type));
      const accessToken = await this.accessToken(queue);
      const initialized = expectedMode === "DIRECT_POST"
        ? await this.provider.directPost(accessToken, this.settings(queue), source)
        : await this.provider.uploadDraft(accessToken, source);
      const persisted = await this.admin.from("publishing_queue").update({
        provider_publish_id: initialized.publishId,
        provider_status: source.source === "FILE_UPLOAD" ? "PROCESSING_UPLOAD" : "PROCESSING_DOWNLOAD",
      }).eq("owner_id", ownerId).eq("id", queue.id).eq("status", "UPLOADING").select("*").maybeSingle();
      if (persisted.error || !persisted.data) throw new PublishingError("provider_publish_id_persist_failed");
      queue = persisted.data as PublishQueueRow;
      if (source.source === "FILE_UPLOAD") {
        if (!media || !initialized.uploadUrl) throw new PublishingError("upload_url_missing");
        await this.uploadBinary(initialized.uploadUrl, media, source);
      }
      await this.admin.from("publish_attempts").update({ status: "SUCCEEDED", response_json: { publish_id: initialized.publishId }, completed_at: new Date().toISOString() }).eq("owner_id", ownerId).eq("id", attempt.id);
      return this.transition(queue, "PROCESSING", { provider_publish_id: initialized.publishId, provider_status: source.source === "FILE_UPLOAD" ? "PROCESSING_UPLOAD" : "PROCESSING_DOWNLOAD" }, "TIKTOK_API", "MEDIA_TRANSFER_ACCEPTED");
    } catch (error) {
      const code = error instanceof PublishingError ? error.code : error instanceof Error ? error.message : "publishing_unknown_error";
      const retryable = /429|5\d\d|internal|network|timeout/i.test(code) && queue.retry_count < queue.max_retries;
      await this.admin.from("publish_attempts").update({ status: retryable ? "RETRYABLE" : "FAILED", error_code: code, completed_at: new Date().toISOString() }).eq("owner_id", ownerId).eq("id", attempt.id);
      return this.transition(queue, retryable ? "RETRYING" : "FAILED", {
        retry_count: queue.retry_count + 1,
        next_retry_at: retryable ? new Date(Date.now() + retryDelaySeconds(queue.retry_count) * 1000).toISOString() : null,
        last_error_code: code,
      }, "TIKTOK_API", code);
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
    const { error: eventError } = await this.admin.from("publish_status_events").insert({
      owner_id: queue.owner_id, publishing_queue_id: queue.id, source: "TIKTOK_WEBHOOK",
      from_status: queue.status, to_status: parsed.target, provider_event_id: eventId,
      provider_status: parsed.envelope.event, reason_code: parsed.content.reason ?? null,
      metadata_json: { post_id: parsed.content.post_id ?? null, publish_type: parsed.content.publish_type ?? null },
      occurred_at: new Date(parsed.envelope.create_time * 1000).toISOString(),
    });
    if (eventError?.code === "23505") return { accepted: true, matched: true, duplicate: true };
    if (eventError) throw new PublishingError("webhook_event_write_failed");
    const postIds = parsed.content.post_id ? [String(parsed.content.post_id)] : queue.published_post_ids_json;
    const { error: updateError } = await this.admin.from("publishing_queue").update({
      status: parsed.target, provider_status: parsed.envelope.event,
      published_post_ids_json: postIds, last_error_code: parsed.content.reason ?? null,
      completed_at: ["FAILED", "DRAFT_DELIVERED", "PUBLISHED"].includes(parsed.target) ? new Date().toISOString() : null,
    }).eq("owner_id", queue.owner_id).eq("id", queue.id);
    if (updateError) throw new PublishingError("webhook_queue_update_failed");
    return { accepted: true, matched: true, duplicate: false };
  }

  async cancelQueuedPublish(ownerId: string, queueId: string) {
    const queue = await this.queue(ownerId, queueId);
    if (["UPLOADING", "PROCESSING", "DRAFT_DELIVERED", "PUBLISHED", "CANCELLED"].includes(queue.status)) throw new PublishingError("queue_cannot_be_cancelled");
    return this.transition(queue, "CANCELLED", { cancelled_at: new Date().toISOString() }, "USER", "USER_CANCELLED");
  }

  async retryPublish(ownerId: string, queueId: string) {
    const queue = await this.queue(ownerId, queueId);
    if (!['FAILED', 'RETRYING'].includes(queue.status)) throw new PublishingError("queue_not_retryable");
    if (queue.retry_count >= queue.max_retries) throw new PublishingError("retry_limit_reached");
    if (queue.provider_publish_id) return this.fetchPublishStatus(ownerId, queueId);
    const reset = await this.transition(queue, "RETRYING", { provider_publish_id: null, provider_status: null, next_retry_at: null }, "USER", "RETRY_REQUESTED");
    return reset.publish_mode === "DIRECT_POST" ? this.directPost(ownerId, queueId) : this.uploadDraft(ownerId, queueId);
  }
}

export async function listPublishingQueue(client: SupabaseClient, ownerId: string) {
  const [queue, accounts, masters, variations, attempts] = await Promise.all([
    client.from("publishing_queue").select("*").eq("owner_id", ownerId).order("priority", { ascending: false }).order("created_at"),
    client.from("tiktok_accounts").select("id,display_name,username,connection_status,audit_status,effective_mode").eq("owner_id", ownerId),
    client.from("master_videos").select("id,product_id,storage_path").eq("owner_id", ownerId),
    client.from("video_variations").select("id,master_video_id,product_id,storage_path").eq("owner_id", ownerId),
    client.from("publish_attempts").select("publishing_queue_id,status,created_at").eq("owner_id", ownerId).order("created_at", { ascending: false }),
  ]);
  for (const result of [queue, accounts, masters, variations, attempts]) if (result.error) throw new PublishingError("publishing_queue_read_failed");
  const accountMap = new Map((accounts.data ?? []).map(row => [row.id, row]));
  const videoMap = new Map([...(masters.data ?? []), ...(variations.data ?? [])].map(row => [row.id, row]));
  const latestAttempt = new Map<string, Row>();
  for (const row of attempts.data ?? []) if (!latestAttempt.has(row.publishing_queue_id)) latestAttempt.set(row.publishing_queue_id, row);
  return (queue.data ?? []).map(row => ({ ...row, account: accountMap.get(row.tiktok_account_id), video: videoMap.get(row.video_id), latest_attempt: latestAttempt.get(row.id) }));
}

export async function getPublishingDetail(client: SupabaseClient, ownerId: string, queueId: string) {
  const { data: queue, error } = await client.from("publishing_queue").select("*").eq("owner_id", ownerId).eq("id", queueId).maybeSingle();
  if (error || !queue) throw new PublishingError("publish_queue_not_found");
  const [account, attempts, events, consents, intents, shopProducts] = await Promise.all([
    client.from("tiktok_accounts").select("*").eq("owner_id", ownerId).eq("id", queue.tiktok_account_id).single(),
    client.from("publish_attempts").select("*").eq("owner_id", ownerId).eq("publishing_queue_id", queueId).order("created_at", { ascending: false }),
    client.from("publish_status_events").select("*").eq("owner_id", ownerId).eq("publishing_queue_id", queueId).order("occurred_at", { ascending: false }),
    client.from("publish_consents").select("*").eq("owner_id", ownerId).eq("publishing_queue_id", queueId).order("consented_at", { ascending: false }),
    client.from("shoppable_content_intents").select("*").eq("owner_id",ownerId).eq("publishing_queue_id",queueId).order("created_at",{ascending:false}),
    client.from("shop_products").select("*").eq("owner_id",ownerId).eq("product_status","ACTIVE").eq("audit_status","APPROVED"),
  ]);
  for (const result of [account, attempts, events, consents,intents,shopProducts]) if (result.error) throw new PublishingError("publishing_detail_read_failed");
  return { queue, account: account.data, attempts: attempts.data ?? [], events: events.data ?? [], consents: consents.data ?? [],intents:intents.data??[],shopProducts:shopProducts.data??[] };
}
