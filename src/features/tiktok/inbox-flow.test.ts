import { describe, expect, it, vi } from "vitest";
import { officialTikTokRequestedScopes } from "./oauth-scopes";
import { assertInboxAccess, assertInboxMedia, inboxPublicReceipt, refreshInboxReceipt, sendInboxVideo, type InboxReceipt, type InboxStore } from "./inbox-flow";
import type { TikTokPublishingProvider } from "@/features/publishing/provider";

function fixture() {
  let row: InboxReceipt | null = null;
  const store: InboxStore = {
    async reserve(hash, size) {
      if (row) return { receipt: { ...row }, created: false };
      row = { id: "receipt", status: "RESERVED", media_sha256: hash, video_size: size, provider_publish_id: null };
      return { receipt: { ...row }, created: true };
    },
    async update(_id, patch) { row = { ...row!, ...patch } as InboxReceipt; return { ...row }; },
  };
  const provider: TikTokPublishingProvider = {
    name: "tiktok", directPost: vi.fn(),
    uploadDraft: vi.fn().mockResolvedValue({ publishId: "original-publish", uploadUrl: "https://open-upload.tiktokapis.com/signed" }),
    uploadBinary: vi.fn().mockResolvedValue(undefined),
    fetchPublishStatus: vi.fn().mockResolvedValue({ status: "SEND_TO_USER_INBOX", uploadedBytes: 2000, failReason: null, postIds: [], providerError: { code: "ok", logId: "log" } }),
  };
  return { store, provider, token: "test-token", media: new Blob([new Uint8Array(2000)], { type: "video/mp4" }), hash: "hash", consent: true };
}
const access = {
  ownerId: "owner", accountOwner: "owner", authorized: true, mock: false, official: true,
  scopes: ["user.info.basic", "video.publish", "video.upload"], productionApproved: false,
  sandboxEnabled: true, accountIdentity: "real-open-id", sandboxIdentity: "real-open-id",
};

describe("opt-in TikTok Inbox flow", () => {
  it("preserves Direct Post scopes and only expands on explicit Inbox selection", () => {
    expect(officialTikTokRequestedScopes("publishing")).toEqual(["user.info.basic", "video.publish"]);
    expect(officialTikTokRequestedScopes("basic")).toEqual(["user.info.basic"]);
    expect(officialTikTokRequestedScopes("publishing", true)).toEqual(["user.info.basic", "video.publish", "video.upload"]);
  });
  it("requires owner, real authorization, upload grant and configured sandbox identity", () => {
    expect(() => assertInboxAccess(access)).not.toThrow();
    for (const patch of [{ ownerId: "other" }, { authorized: false }, { mock: true }, { official: false },
      { scopes: ["video.publish"] }, { sandboxEnabled: false }, { accountIdentity: "other" }, { sandboxIdentity: null }]) {
      expect(() => assertInboxAccess({ ...access, ...patch })).toThrow();
    }
    expect(() => assertInboxAccess({ ...access, sandboxEnabled: false, productionApproved: true })).not.toThrow();
  });
  it("validates actual MP4 header, size and type", () => {
    const bytes = new Uint8Array(2000); bytes.set([102, 116, 121, 112], 4);
    expect(() => assertInboxMedia(bytes, "video/mp4")).not.toThrow();
    expect(() => assertInboxMedia(bytes, "text/plain")).toThrow();
    expect(() => assertInboxMedia(new Uint8Array(2000), "video/mp4")).toThrow();
    expect(() => assertInboxMedia(new Uint8Array(4_000_001), "video/mp4")).toThrow();
  });
  it("concurrent and repeated sends initialize/upload once and never Direct Post", async () => {
    const f = fixture();
    await Promise.all([sendInboxVideo(f), sendInboxVideo(f)]);
    const receipt = await sendInboxVideo(f);
    expect(f.provider.uploadDraft).toHaveBeenCalledTimes(1);
    expect(f.provider.uploadBinary).toHaveBeenCalledTimes(1);
    expect(f.provider.directPost).not.toHaveBeenCalled();
    expect(receipt.status).toBe("UPLOADED");
    expect(receipt.provider_publish_id).toBe("original-publish");
    expect(f.provider.uploadBinary).toHaveBeenCalledWith("https://open-upload.tiktokapis.com/signed", f.media, expect.objectContaining({ source: "FILE_UPLOAD" }));
  });
  it("requires consent and rejects changed media under same reservation", async () => {
    const f = fixture();
    await expect(sendInboxVideo({ ...f, consent: false })).rejects.toThrow("consent_required");
    expect(f.provider.uploadDraft).not.toHaveBeenCalled();
    await sendInboxVideo(f);
    await expect(sendInboxVideo({ ...f, hash: "different" })).rejects.toThrow("idempotency_conflict");
  });
  it("does not restart ambiguous init, even after request recovery", async () => {
    const f = fixture(); vi.mocked(f.provider.uploadDraft).mockRejectedValue(new Error("network"));
    expect((await sendInboxVideo(f)).status).toBe("RECONCILIATION_REQUIRED");
    expect((await sendInboxVideo(f)).status).toBe("RECONCILIATION_REQUIRED");
    expect(f.provider.uploadDraft).toHaveBeenCalledTimes(1);
    expect(f.provider.uploadBinary).not.toHaveBeenCalled();
  });
  it("persists publish_id before PUT and resumes uncertain transfer by status only", async () => {
    const f = fixture(); vi.mocked(f.provider.uploadBinary).mockRejectedValue(new Error("network"));
    const uncertain = await sendInboxVideo(f);
    expect(uncertain.provider_publish_id).toBe("original-publish");
    await sendInboxVideo(f);
    const delivered = await refreshInboxReceipt(f.store, f.provider, f.token, uncertain);
    expect(delivered.status).toBe("SEND_TO_USER_INBOX");
    expect(delivered.status).not.toBe("PUBLISH_COMPLETE");
    expect(f.provider.fetchPublishStatus).toHaveBeenCalledWith(f.token, "original-publish");
    expect(f.provider.uploadDraft).toHaveBeenCalledTimes(1);
    expect(f.provider.uploadBinary).toHaveBeenCalledTimes(1);
    expect(inboxPublicReceipt(delivered)).toEqual({ receipt: "receipt", status: "SEND_TO_USER_INBOX" });
  });
  it("retains processing state and final failure without recreating a post", async () => {
    const f = fixture(); const row = await sendInboxVideo(f);
    vi.mocked(f.provider.fetchPublishStatus).mockResolvedValueOnce({ status: "PROCESSING_UPLOAD", uploadedBytes: 1000, failReason: null, postIds: [] });
    expect((await refreshInboxReceipt(f.store, f.provider, f.token, row)).status).toBe("UPLOADED");
    vi.mocked(f.provider.fetchPublishStatus).mockResolvedValueOnce({ status: "FAILED", uploadedBytes: 2000, failReason: "spam_risk", postIds: [] });
    const failed = await refreshInboxReceipt(f.store, f.provider, f.token, row);
    expect(failed.status).toBe("FAILED");
    await refreshInboxReceipt(f.store, f.provider, f.token, failed);
    expect(f.provider.fetchPublishStatus).toHaveBeenCalledTimes(2);
    expect(f.provider.uploadDraft).toHaveBeenCalledTimes(1);
  });
  it("refreshes an already delivered Inbox item using only its original publish id", async () => {
    const f = fixture();
    const uploaded = await sendInboxVideo(f);
    const delivered = await refreshInboxReceipt(f.store, f.provider, f.token, uploaded);
    vi.mocked(f.provider.fetchPublishStatus).mockResolvedValueOnce({ status: "PROCESSING_UPLOAD", uploadedBytes: 2000, failReason: null, postIds: [] });
    expect((await refreshInboxReceipt(f.store, f.provider, f.token, delivered)).status).toBe("SEND_TO_USER_INBOX");
    vi.mocked(f.provider.fetchPublishStatus).mockResolvedValueOnce({ status: "PUBLISH_COMPLETE", uploadedBytes: 2000, failReason: null, postIds: [] });
    const published = await refreshInboxReceipt(f.store, f.provider, f.token, delivered);
    expect(published.status).toBe("PUBLISH_COMPLETE");
    await refreshInboxReceipt(f.store, f.provider, f.token, published);
    expect(f.provider.fetchPublishStatus).toHaveBeenCalledTimes(3);
    for (const call of vi.mocked(f.provider.fetchPublishStatus).mock.calls) expect(call).toEqual([f.token, "original-publish"]);
    expect(f.provider.uploadDraft).toHaveBeenCalledTimes(1);
    expect(f.provider.uploadBinary).toHaveBeenCalledTimes(1);
    expect(f.provider.directPost).not.toHaveBeenCalled();
  });
  it("records a later TikTok failure after delivery without sending again", async () => {
    const f = fixture();
    const delivered = await refreshInboxReceipt(f.store, f.provider, f.token, await sendInboxVideo(f));
    vi.mocked(f.provider.fetchPublishStatus).mockResolvedValueOnce({ status: "FAILED", uploadedBytes: 2000, failReason: "internal", postIds: [], providerError: { code: "ok", message: "", logId: "later-log" } });
    const failed = await refreshInboxReceipt(f.store, f.provider, f.token, delivered);
    expect(failed.status).toBe("FAILED");
    await refreshInboxReceipt(f.store, f.provider, f.token, failed);
    expect(f.provider.fetchPublishStatus).toHaveBeenCalledTimes(2);
    expect(f.provider.uploadDraft).toHaveBeenCalledTimes(1);
    expect(f.provider.uploadBinary).toHaveBeenCalledTimes(1);
  });
});
