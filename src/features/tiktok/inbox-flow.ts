import { buildChunkSource, TikTokStatusRequestError, type TikTokPublishingProvider } from "@/features/publishing/provider";

export const INBOX_MAX_BYTES = 4_000_000;
export type InboxStatus = "RESERVED" | "INITIALIZED" | "UPLOADED" | "SEND_TO_USER_INBOX" | "PUBLISH_COMPLETE" | "FAILED" | "RECONCILIATION_REQUIRED";
export interface InboxReceipt {
  id: string;
  status: InboxStatus;
  media_sha256: string;
  video_size: number;
  provider_publish_id: string | null;
}
export interface InboxStore {
  reserve(hash: string, size: number): Promise<{ receipt: InboxReceipt; created: boolean }>;
  update(id: string, patch: Record<string, string | number | null>): Promise<InboxReceipt>;
}

export function assertInboxAccess(input: {
  ownerId: string; accountOwner: string; authorized: boolean; mock: boolean;
  scopes: string[]; official: boolean; productionApproved: boolean;
  sandboxEnabled: boolean; accountIdentity: string | null; sandboxIdentity: string | null;
}) {
  if (input.ownerId !== input.accountOwner || !input.authorized || input.mock || !input.official) throw new Error("account_unavailable");
  if (!input.scopes.includes("video.upload")) throw new Error("inbox_reconnect_required");
  const sandboxAllowed = input.sandboxEnabled && !!input.accountIdentity && input.accountIdentity === input.sandboxIdentity;
  if (!input.productionApproved && !sandboxAllowed) throw new Error("inbox_not_available");
}

export function assertInboxMedia(bytes: Uint8Array, type: string) {
  if (bytes.length < 1000 || bytes.length > INBOX_MAX_BYTES || type !== "video/mp4"
    || String.fromCharCode(...bytes.slice(4, 8)) !== "ftyp") throw new Error("invalid_mp4");
}

// Reservation precedes the external operation. An uncertain operation is never re-created.
export async function sendInboxVideo(input: {
  store: InboxStore; provider: TikTokPublishingProvider; token: string;
  media: Blob; hash: string; consent: boolean;
}) {
  if (!input.consent) throw new Error("consent_required");
  if (input.provider.name !== "tiktok") throw new Error("official_required");
  const { receipt, created } = await input.store.reserve(input.hash, input.media.size);
  if (receipt.media_sha256 !== input.hash || receipt.video_size !== input.media.size) throw new Error("idempotency_conflict");
  if (!created) return receipt;
  const source = buildChunkSource(input.media.size);
  try {
    const initialized = await input.provider.uploadDraft(input.token, source);
    if (!initialized.uploadUrl) throw new Error("upload_url_missing");
    await input.store.update(receipt.id, { status: "INITIALIZED", provider_publish_id: initialized.publishId });
    await input.provider.uploadBinary(initialized.uploadUrl, input.media, source);
    return await input.store.update(receipt.id, { status: "UPLOADED", uploaded_bytes: input.media.size });
  } catch (error) {
    // Do not expose upstream messages, signed URLs or tokens, or blindly retry init/PUT.
    return input.store.update(receipt.id, { status: "RECONCILIATION_REQUIRED",
      error_code: error instanceof TikTokStatusRequestError ? error.code : "delivery_uncertain",
      log_id: error instanceof TikTokStatusRequestError ? error.logId : null });
  }
}

export async function refreshInboxReceipt(store: InboxStore, provider: TikTokPublishingProvider, token: string, receipt: InboxReceipt) {
  // Delivery is not publication: allow an explicit status refresh of the same
  // publish_id after delivery, without initializing or uploading another video.
  if (["PUBLISH_COMPLETE", "FAILED"].includes(receipt.status) || !receipt.provider_publish_id) return receipt;
  const result = await provider.fetchPublishStatus(token, receipt.provider_publish_id);
  const status = result.status === "SEND_TO_USER_INBOX" || result.status === "PUBLISH_COMPLETE" || result.status === "FAILED"
    ? result.status : receipt.status;
  return store.update(receipt.id, {
    status, uploaded_bytes: result.uploadedBytes, fail_reason: result.failReason?.slice(0, 200) ?? null,
    error_code: result.providerError?.code ?? null, log_id: result.providerError?.logId ?? null,
  });
}

export function inboxPublicReceipt(receipt: InboxReceipt) {
  return { receipt: receipt.id, status: receipt.status };
}
