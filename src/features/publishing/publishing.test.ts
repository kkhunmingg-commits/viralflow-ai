import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildChunkSource, MockTikTokPublishingProvider, OfficialTikTokPublishingProvider, assertTikTokUploadUrl, assertVerifiedPullUrl } from "./provider";
import { deterministicNextDaySlot, remainingPublishSlots, retryDelaySeconds, scheduleCandidates } from "./scheduler";
import { assertConsentSnapshot, assertPublishingPermission, consentHash, publishAttemptKey, statusFromProvider } from "./state";
import { parseTikTokPublishWebhook, verifyTikTokWebhookSignature } from "./webhook";

describe("Phase 7B publishing foundation", () => {
  it("builds official FILE_UPLOAD chunk metadata", () => {
    expect(buildChunkSource(4_000_000)).toEqual({ source: "FILE_UPLOAD", videoSize: 4_000_000, chunkSize: 4_000_000, totalChunkCount: 1 });
    const large = buildChunkSource(70 * 1024 * 1024);
    expect(large.chunkSize).toBe(10 * 1024 * 1024);
    expect(large.totalChunkCount).toBe(7);
  });

  it("allows PULL_FROM_URL only for configured verified HTTPS hosts", () => {
    expect(assertVerifiedPullUrl("https://media.example.com/video.mp4", ["media.example.com"])).toBe("https://media.example.com/video.mp4");
    expect(() => assertVerifiedPullUrl("http://media.example.com/video.mp4", ["media.example.com"])).toThrow("pull_url_not_verified");
    expect(() => assertVerifiedPullUrl("https://evil.example/video.mp4", ["media.example.com"])).toThrow("pull_url_not_verified");
    expect(() => assertVerifiedPullUrl("https://user:pass@media.example.com/video.mp4", ["media.example.com"])).toThrow("pull_url_not_verified");
    expect(() => assertVerifiedPullUrl("https://127.0.0.1/video.mp4", ["127.0.0.1"])).toThrow("pull_url_not_verified");
    expect(() => assertVerifiedPullUrl("https://[::ffff:127.0.0.1]/video.mp4", ["[::ffff:7f00:1]"])).toThrow("pull_url_not_verified");
    expect(() => assertVerifiedPullUrl("https://media.example.com:8443/video.mp4", ["media.example.com"])).toThrow("pull_url_not_verified");
    expect(() => assertVerifiedPullUrl("not-a-url", ["media.example.com"])).toThrow("pull_url_not_verified");
    expect(assertTikTokUploadUrl("https://open-upload.tiktokapis.com/video?id=1", ["open-upload.tiktokapis.com"])).toContain("open-upload.tiktokapis.com");
  });

  it("uses the official upload-draft endpoint and never marks delivery as published", async () => {
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => { void input; void init; return new Response(JSON.stringify({ data: { publish_id: "v_inbox_1", upload_url: "https://upload.example/video" }, error: { code: "ok" } }), { status: 200 }); });
    const provider = new OfficialTikTokPublishingProvider(request as typeof fetch, ["upload.example"]);
    await provider.uploadDraft("secret-token", buildChunkSource(4_000_000));
    expect(request.mock.calls[0]?.[0]).toBe("https://open.tiktokapis.com/v2/post/publish/inbox/video/init/");
    expect(statusFromProvider("SEND_TO_USER_INBOX", "DRAFT_UPLOAD")).toBe("DRAFT_DELIVERED");
    expect(statusFromProvider("PUBLISH_COMPLETE", "DRAFT_UPLOAD")).toBe("PUBLISHED");
  });

  it("maps AIGC to the official is_aigc direct-post field", async () => {
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => { void input; void init; return new Response(JSON.stringify({ data: { publish_id: "v_pub_1", upload_url: "https://upload.example/video" }, error: { code: "ok" } }), { status: 200 }); });
    const provider = new OfficialTikTokPublishingProvider(request as typeof fetch, ["upload.example"]);
    await provider.directPost("secret-token", { caption: "caption", privacyLevel: "SELF_ONLY", disableComment: true, disableDuet: true, disableStitch: true, isAigc: true, commercialContent: {} }, buildChunkSource(1_000_000));
    const body = JSON.parse(String((request.mock.calls[0]?.[1] as RequestInit).body));
    expect(request.mock.calls[0]?.[0]).toBe("https://open.tiktokapis.com/v2/post/publish/video/init/");
    expect(body.post_info.is_aigc).toBe(true);
  });

  it("reports the real TikTok Direct Post error code", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ error: { code: "unaudited_client_can_only_post_to_private_accounts" } }), { status: 403 }));
    const provider = new OfficialTikTokPublishingProvider(request as typeof fetch);
    await expect(provider.directPost("token", { caption: "", privacyLevel: "SELF_ONLY", disableComment: true, disableDuet: true, disableStitch: true, isAigc: false, commercialContent: {} }, buildChunkSource(100_000)))
      .rejects.toThrow("unaudited_client_can_only_post_to_private_accounts");
  });

  it("uploads binary chunks sequentially with Content-Range", async () => {
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => { void input; void init; return new Response(null, { status: 206 }); });
    const provider = new OfficialTikTokPublishingProvider(request as typeof fetch, ["upload.example"]);
    const size = 70 * 1024 * 1024;
    await provider.uploadBinary("https://upload.example/video", new Blob([new Uint8Array(size)], { type: "video/mp4" }), buildChunkSource(size));
    expect(request).toHaveBeenCalledTimes(7);
    expect((request.mock.calls[0]?.[1] as RequestInit).redirect).toBe("error");
    expect((request.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ "Content-Range": `bytes 0-${10 * 1024 * 1024 - 1}/${size}` });
    expect((request.mock.calls[6]?.[1] as RequestInit).headers).toMatchObject({ "Content-Range": `bytes ${60 * 1024 * 1024}-${size - 1}/${size}` });
  });

  it("rejects provider-supplied upload URLs outside the allowlist", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ data: { publish_id: "v_1", upload_url: "https://127.0.0.1/internal" }, error: { code: "ok" } }), { status: 200 }));
    const provider = new OfficialTikTokPublishingProvider(request as typeof fetch, ["open-upload.tiktokapis.com"]);
    await expect(provider.uploadDraft("secret-token", buildChunkSource(4_000_000))).rejects.toThrow("upload_url_not_allowed");
  });

  it("keeps mock publishing deterministic and separates draft from direct post", async () => {
    const provider = new MockTikTokPublishingProvider();
    const source = buildChunkSource(1_000_000);
    const draft = await provider.uploadDraft("mock", source);
    const direct = await provider.directPost("mock", { caption: "", privacyLevel: "SELF_ONLY", disableComment: false, disableDuet: false, disableStitch: false, isAigc: false, commercialContent: {} }, source);
    expect(draft.publishId).toBe("v_inbox_file_upload_mock_1");
    expect(direct.publishId).toBe("v_pub_file_upload_mock_2");
    expect((await provider.fetchPublishStatus("mock", draft.publishId)).status).toBe("SEND_TO_USER_INBOX");
    expect((await provider.fetchPublishStatus("mock", direct.publishId)).status).toBe("PUBLISH_COMPLETE");
  });

  it("binds consent to the exact caption, privacy, interactions, commercial settings, and AIGC", () => {
    const settings = { caption: "A", privacyLevel: "SELF_ONLY", disableComment: false, disableDuet: true, disableStitch: true, isAigc: true, commercialContent: { brand_organic_toggle: true } };
    expect(consentHash(settings)).toHaveLength(64);
    expect(consentHash({ ...settings, caption: "B" })).not.toBe(consentHash(settings));
    expect(consentHash({ ...settings, privacyLevel: "PUBLIC_TO_EVERYONE" })).not.toBe(consentHash(settings));
    expect(() => assertConsentSnapshot(null, null, settings)).toThrow("explicit_consent_required");
    expect(() => assertConsentSnapshot("consent-1", consentHash({ ...settings, caption: "B" }), settings)).toThrow("consent_snapshot_mismatch");
  });

  it("fails closed when the account or requested permission is unavailable", () => {
    expect(() => assertPublishingPermission({ mode: "DIRECT_POST", authorizationStatus: "authorized", grantedScopes: ["video.upload"], directPostStatus: "MISSING_SCOPE", uploadStatus: "READY" })).toThrow("publishing_scope_not_ready");
    expect(() => assertPublishingPermission({ mode: "DRAFT_UPLOAD", authorizationStatus: "expired", grantedScopes: ["video.upload"], directPostStatus: "UNAVAILABLE", uploadStatus: "READY" })).toThrow("publishing_connection_not_ready");
    expect(() => assertPublishingPermission({ mode: "DIRECT_POST", authorizationStatus: "authorized", grantedScopes: ["video.publish"], directPostStatus: "PRIVATE_ONLY", uploadStatus: "UNAVAILABLE" })).not.toThrow();
  });

  it("verifies official TikTok webhook signatures and rejects replayed timestamps", () => {
    const rawBody = JSON.stringify({ client_key: "client", event: "post.publish.inbox_delivered", create_time: 1000, user_openid: "open", content: JSON.stringify({ publish_id: "v_1", publish_type: "INBOX_SHARE" }) });
    const signature = createHmac("sha256", "client-secret").update(`1000.${rawBody}`).digest("hex");
    expect(verifyTikTokWebhookSignature({ rawBody, signatureHeader: `t=1000,s=${signature}`, clientSecret: "client-secret", nowSeconds: 1100 })).toBe(true);
    expect(verifyTikTokWebhookSignature({ rawBody, signatureHeader: `t=1000,s=${signature}`, clientSecret: "client-secret", nowSeconds: 1400 })).toBe(false);
    expect(verifyTikTokWebhookSignature({ rawBody, signatureHeader: "t=1000,s=not-hex", clientSecret: "client-secret", nowSeconds: 1100 })).toBe(false);
    expect(verifyTikTokWebhookSignature({ rawBody, signatureHeader: `t=1000,t=1000,s=${signature}`, clientSecret: "client-secret", nowSeconds: 1100 })).toBe(false);
    expect(parseTikTokPublishWebhook(rawBody, "client").target).toBe("DRAFT_DELIVERED");
    expect(() => parseTikTokPublishWebhook(rawBody, "another-client")).toThrow("webhook_client_key_mismatch");
    expect(() => parseTikTokPublishWebhook(JSON.stringify({ ...JSON.parse(rawBody), unexpected: true }), "client")).toThrow();
  });

  it("uses real effective capacity and deterministic overflow for 10 accounts / 200 candidates", () => {
    const capacities = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`account-${index}`, 15]));
    const candidates = Array.from({ length: 200 }, (_, index) => ({ id: `candidate-${String(index).padStart(3, "0")}`, accountId: `account-${index % 10}`, priority: 50, createdAt: "2026-09-18T00:00:00.000Z" }));
    const scheduled = scheduleCandidates(candidates, capacities);
    expect(scheduled.filter(item => item.status === "QUEUED")).toHaveLength(150);
    expect(scheduled.filter(item => item.status === "WAITING_FOR_SLOT")).toHaveLength(50);
    expect(scheduleCandidates(candidates, capacities)).toEqual(scheduled);
    expect(remainingPublishSlots(15, 12, 2)).toBe(1);
    expect(deterministicNextDaySlot("queue-a", new Date("2026-09-18T10:00:00Z"))).toBe(deterministicNextDaySlot("queue-a", new Date("2026-09-18T10:00:00Z")));
  });

  it("caps retries with a deterministic backoff table", () => {
    expect([retryDelaySeconds(0), retryDelaySeconds(1), retryDelaySeconds(2), retryDelaySeconds(20)]).toEqual([60, 300, 900, 900]);
    expect(publishAttemptKey("queue-1", "INIT_UPLOAD", 2)).toBe(publishAttemptKey("queue-1", "INIT_UPLOAD", 2));
  });
});
