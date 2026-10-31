import { createHash } from "node:crypto";
import type { PublishMode, PublishQueueStatus, PublishSettings, TikTokPublishStatus } from "./types";

export function statusFromProvider(status: TikTokPublishStatus["status"], mode: PublishMode): PublishQueueStatus {
  void mode;
  if (status === "FAILED") return "FAILED";
  if (status === "SEND_TO_USER_INBOX") return "DRAFT_DELIVERED";
  if (status === "PUBLISH_COMPLETE") return "PUBLISHED";
  return "PROCESSING";
}

export function consentHash(settings: PublishSettings) {
  return createHash("sha256").update(JSON.stringify({
    caption: settings.caption,
    privacyLevel: settings.privacyLevel,
    disableComment: settings.disableComment,
    disableDuet: settings.disableDuet,
    disableStitch: settings.disableStitch,
    isAigc: settings.isAigc,
    commercialContent: Object.fromEntries(Object.entries(settings.commercialContent).sort(([a], [b]) => a.localeCompare(b))),
  })).digest("hex");
}

export function assertPublishingPermission(input: {
  mode: PublishMode;
  authorizationStatus: string;
  grantedScopes: readonly string[];
  directPostStatus: string;
  uploadStatus: string;
}) {
  if (input.authorizationStatus !== "authorized") throw new Error("publishing_connection_not_ready");
  const scope = input.mode === "DIRECT_POST" ? "video.publish" : "video.upload";
  if (!input.grantedScopes.includes(scope)) throw new Error("publishing_scope_not_ready");
  if (input.mode === "DIRECT_POST" && ["UNAVAILABLE", "MISSING_SCOPE"].includes(input.directPostStatus)) throw new Error("direct_post_not_ready");
  if (input.mode === "DRAFT_UPLOAD" && input.uploadStatus !== "READY") throw new Error("draft_upload_not_ready");
}

export function assertConsentSnapshot(consentId: string | null, storedHash: string | null, settings: PublishSettings) {
  if (!consentId) throw new Error("explicit_consent_required");
  if (!storedHash || storedHash !== consentHash(settings)) throw new Error("consent_snapshot_mismatch");
}

export function publishAttemptKey(queueId: string, operation: string, attemptNumber: number) {
  return `${queueId}:${operation}:${attemptNumber}`;
}
