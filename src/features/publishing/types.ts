export const PUBLISH_QUEUE_STATUSES = [
  "DRAFT", "REVIEW_REQUIRED", "APPROVED", "QUEUED", "WAITING_FOR_SLOT",
  "UPLOADING", "PROCESSING", "DRAFT_DELIVERED", "PUBLISHED", "RETRYING",
  "FAILED", "CANCELLED", "REJECTED", "WAITING_FOR_RECONCILIATION",
] as const;

export type PublishQueueStatus = (typeof PUBLISH_QUEUE_STATUSES)[number];
export type PublishMode = "DRAFT_UPLOAD" | "DIRECT_POST";
export type PublishSource = "FILE_UPLOAD" | "PULL_FROM_URL";
export type VideoKind = "MASTER" | "VARIATION";
export type PublishExternalState = "READY" | "RESERVING" | "SUBMITTING" | "SUBMITTED_UNKNOWN" | "SUBMITTED" | "CONFIRMED" | "FAILED_RETRYABLE" | "FAILED_FINAL";

export interface PublishSettings {
  caption: string;
  privacyLevel: string | null;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  isAigc: boolean;
  commercialContent: Record<string, boolean>;
}

export interface SourceInfo {
  source: PublishSource;
  videoSize?: number;
  chunkSize?: number;
  totalChunkCount?: number;
  videoUrl?: string;
}

export interface PublishInitResult {
  publishId: string;
  uploadUrl: string | null;
}

export interface TikTokPublishStatus {
  status: "PROCESSING_UPLOAD" | "PROCESSING_DOWNLOAD" | "SEND_TO_USER_INBOX" | "PUBLISH_COMPLETE" | "FAILED";
  failReason: string | null;
  postIds: string[];
  uploadedBytes: number;
}

export interface PublishQueueRow {
  id: string;
  owner_id: string;
  tiktok_account_id: string;
  video_id: string;
  video_kind: VideoKind;
  publish_mode: PublishMode;
  source_method: PublishSource;
  pull_from_url: string | null;
  scheduled_for: string | null;
  priority: number;
  status: PublishQueueStatus;
  caption_snapshot: string;
  privacy_level: string | null;
  disable_comment: boolean;
  disable_duet: boolean;
  disable_stitch: boolean;
  is_aigc: boolean;
  commercial_content_json: Record<string, boolean>;
  compliance_check_id: string | null;
  originality_check_id: string | null;
  eligibility_check_id: string | null;
  shoppable_content_intent_id: string | null;
  consent_id: string | null;
  provider_publish_id: string | null;
  provider_status: string | null;
  retry_count: number;
  max_retries: number;
  idempotency_key: string;
  external_operation_key: string;
  external_state: PublishExternalState;
  lease_token: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  reconciliation_required_at: string | null;
}

export interface QueueCandidate {
  id: string;
  accountId: string;
  priority: number;
  createdAt: string;
}
