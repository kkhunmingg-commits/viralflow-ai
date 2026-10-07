import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OfficialTikTokPublishingProvider } from "@/features/publishing/provider";
import type { ExecutionClaim } from "./processor";

vi.mock("server-only", () => ({}));
const config = vi.hoisted(() => ({ tiktokPublishingRealMode: true, tiktokPublishingProvider: "official",
  tiktokVideoPublishApproved: true, tiktokVideoUploadApproved: true, tiktokAnalyticsProvider: "official", postAutomationExecutionMode: "LIVE" }));
vi.mock("@/lib/server-env", () => ({ serverEnv: config }));
vi.mock("@/features/tiktok/services", () => ({ TikTokTokenService: class { async getAccessToken() { return "network-contract-token"; } } }));
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_post_contract_fixture");
const { createAutoExecutionPorts } = await import("./execution-ports");
const { buildAuthorizedPostPackage, createPostPackageZip } = await import("./export-package");
const { ensurePostOutput } = await import("./post-outputs");
const { readPostReview, postReviewSettingsSchema } = await import("./post-review");

type Row = Record<string, unknown>;
function database(tables: Record<string, Row[]>) {
  const download = vi.fn(async () => ({ data: new Blob(["valid-fixture-media"], { type: "video/mp4" }), error: null }));
  const rpc = vi.fn(async (name: string, args: Row) => {
    if (name === "get_post_automation_execution_mode") return { data: "LIVE", error: null };
    if (name === "transition_publish_queue_atomic") {
      const row = tables.publishing_queue.find(item => item.owner_id === args.p_owner_id && item.id === args.p_queue_id)!;
      Object.assign(row, args.p_patch, { status: args.p_to_status });
      return { data: row, error: null };
    }
    if (name === "enqueue_publish_atomic") {
      const row = { id: "queue-a", owner_id: args.p_owner_id, tiktok_account_id: args.p_tiktok_account_id,
        video_id: args.p_video_id, publish_mode: args.p_publish_mode, status: "DRAFT" };
      tables.publishing_queue.push(row); return { data: row, error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  const client = { from(table: string) {
    const filters: Array<(row: Row) => boolean> = []; let patch: Row | null = null;
    const result = () => {
      const rows = (tables[table] ?? []).filter(row => filters.every(test => test(row)));
      if (patch) for (const row of rows) Object.assign(row, patch);
      return { data: rows, error: null };
    };
    const query = { select: () => query, order: () => query, limit: () => query,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      neq: (key: string, value: unknown) => { filters.push(row => row[key] !== value); return query; },
      update: (value: Row) => { patch = value; return query; },
      upsert: async (value: Row) => {
        const found = (tables[table] ?? []).some(row => row.owner_id === value.owner_id && row.auto_run_id === value.auto_run_id && row.tiktok_account_id === value.tiktok_account_id && row.item_index === value.item_index);
        if (!found) (tables[table] ??= []).push({ id: "output-a", ...value });
        return { data: null, error: null };
      },
      maybeSingle: async () => ({ data: result().data[0] ?? null, error: null }),
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  }, rpc, storage: { from: () => ({ download }) } } as unknown as SupabaseClient;
  return { client, rpc, download };
}
function fixture(mode = "EXPORT") {
  const owner = "owner-a", account = "account-a";
  const tables: Record<string, Row[]> = {
    auto_runs: [{ id: "run-a", owner_id: owner, tiktok_account_id: account, posting_mode: mode, state: "RUNNING" }],
    tiktok_accounts: [{ id: account, owner_id: owner, is_mock: false, authorization_status: "authorized", audit_status: "AUDITED",
      direct_post_status: "READY", upload_status: "READY", granted_scopes: ["video.publish", "video.upload"] }],
    master_videos: [{ id: "video-a", owner_id: owner, tiktok_account_id: account, product_id: "product-a", selected_script_id: "script-a",
      storage_path: "owner/owner-a/masters/video-a/video.mp4", status: "READY", quality_status: "PASS", quality_score: 92, quality_explanation_json: {}, provider: "local" }],
    products: [{ id: "product-a", owner_id: owner, title: "สินค้าจริง", product_url: "https://example.com/product" }],
    scripts: [{ id: "script-a", owner_id: owner, caption: "คำบรรยายสินค้า", hashtags_json: ["สินค้า"] }],
    content_compliance_checks: [{ owner_id: owner, video_id: "video-a", overall_status: "PASS" }],
    originality_checks: [{ owner_id: owner, video_id: "video-a", originality_status: "ORIGINAL" }],
    publish_eligibility_checks: [{ owner_id: owner, video_id: "video-a", final_status: "ACCOUNT_BLOCKED" }],
    media_assets: [{ owner_id: owner, storage_path: "owner/owner-a/masters/video-a/video.mp4", asset_type: "VIDEO", mime_type: "video/mp4",
      checksum: createHash("sha256").update("valid-fixture-media").digest("hex") }],
    publishing_queue: [], post_outputs: [],
  };
  const claim: ExecutionClaim = { ownerId: owner, accountId: account, runId: "run-a", mode: "GROWTH", itemIndex: 1, dailyTarget: 1,
    step: "QUEUE_PUBLISH", attempt: 1, leaseToken: "lease-a", operationKey: "operation-a", checkpoint: { videoId: "video-a", productId: "product-a" } };
  return { tables, claim, ...database(tables) };
}
beforeEach(() => { Object.assign(config, { tiktokPublishingRealMode: true, tiktokPublishingProvider: "official",
  tiktokVideoPublishApproved: true, tiktokVideoUploadApproved: true, postAutomationExecutionMode: "LIVE" }); });

describe("account POST production boundaries", () => {
  it("finishes EXPORT through the production ports and creates a real downloadable package without a TikTok adapter", async () => {
    config.tiktokPublishingRealMode = false; config.tiktokPublishingProvider = "mock";
    config.postAutomationExecutionMode = "SAFE";
    const f = fixture(), network = vi.fn(), provider = new OfficialTikTokPublishingProvider(network as typeof fetch);
    f.tables.tiktok_accounts[0].authorization_status = "revoked";
    const ports = createAutoExecutionPorts(f.client, { publishingProvider: provider });
    expect(await ports.COMPLIANCE_CHECK(f.claim)).toMatchObject({ kind: "ADVANCE" });
    const queued = await ports.QUEUE_PUBLISH(f.claim);
    expect(queued).toMatchObject({ kind: "ADVANCE", evidence: { postingMode: "EXPORT", publishStatus: "READY" } });
    expect(await ports.PUBLISH(f.claim)).toMatchObject({ kind: "ADVANCE", evidence: { publishStatus: "READY" } });
    const analytics = await ports.COLLECT_ANALYTICS(f.claim);
    expect(analytics).toMatchObject({ kind: "ADVANCE", evidence: { analyticsDeferred: true } });
    expect(await ports.LEARN({ ...f.claim, checkpoint: { ...f.claim.checkpoint, analyticsDeferred: true } })).toMatchObject({ kind: "ADVANCE", evidence: { learningDeferred: true } });
    const zip = await buildAuthorizedPostPackage(f.client, "owner-a", "output-a");
    expect(zip.readUInt32LE()).toBe(0x04034b50);
    expect(zip.toString()).toContain("video.mp4"); expect(zip.toString()).toContain("คำบรรยายสินค้า");
    expect(zip.toString()).not.toMatch(/owner-a|account-a|video-a|network-contract-token|storage_path|provider|model/);
    expect(f.tables.post_outputs).toHaveLength(1);
    expect(f.tables.post_outputs[0].status).toBe("READY"); expect(f.rpc).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
  it("keeps owner/account isolation and cannot export a rejected or visually unverified clip", async () => {
    const f = fixture(); await ensurePostOutput(f.client, f.claim, "EXPORT");
    await expect(buildAuthorizedPostPackage(f.client, "owner-b", "output-a")).rejects.toThrow();
    f.tables.master_videos[0].tiktok_account_id = "account-b";
    await expect(buildAuthorizedPostPackage(f.client, "owner-a", "output-a")).rejects.toThrow();
    f.tables.master_videos[0].tiktok_account_id = "account-a"; f.tables.content_compliance_checks[0].overall_status = "REJECT";
    await expect(buildAuthorizedPostPackage(f.client, "owner-a", "output-a")).rejects.toThrow();
    f.tables.content_compliance_checks[0].overall_status = "PASS"; f.tables.master_videos[0].provider = "fal";
    await expect(buildAuthorizedPostPackage(f.client, "owner-a", "output-a")).rejects.toThrow();
    expect(f.download).not.toHaveBeenCalled();
  });
  it("resumes an accepted DRAFT using the real official status endpoint without submitting another upload", async () => {
    const f = fixture("DRAFT");
    f.tables.publishing_queue.push({ id: "queue-a", owner_id: "owner-a", tiktok_account_id: "account-a", video_id: "video-a",
      publish_mode: "DRAFT_UPLOAD", status: "PROCESSING", provider_publish_id: "v_inbox_existing", external_state: "SUBMITTED" });
    await ensurePostOutput(f.client, f.claim, "DRAFT", "queue-a");
    const network = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input; void init;
      return Response.json({ data: { status: "SEND_TO_USER_INBOX", uploaded_bytes: 18 }, error: { code: "ok" } });
    });
    const ports = createAutoExecutionPorts(f.client, { publishingProvider: new OfficialTikTokPublishingProvider(network as typeof fetch) });
    const claim = { ...f.claim, checkpoint: { ...f.claim.checkpoint, queueId: "queue-a" } };
    const result = await ports.PUBLISH(claim);
    expect(result).toMatchObject({ kind: "ADVANCE", evidence: { publishStatus: "DRAFT_DELIVERED" } });
    expect(network).toHaveBeenCalledOnce(); expect(network.mock.calls[0]?.[0]).toBe("https://open.tiktokapis.com/v2/post/publish/status/fetch/");
    expect(f.tables.post_outputs[0].status).toBe("DRAFT_UPLOADED");
    await ports.COLLECT_ANALYTICS({ ...claim, checkpoint: { ...claim.checkpoint, publishStatus: "DRAFT_DELIVERED" } });
    expect(f.tables.post_outputs[0].status).toBe("WAITING_FOR_USER");
    expect(f.tables.post_outputs[0].status).not.toBe("PUBLISHED");
  });
  it("never resubmits an uncertain submission or borrows another account queue", async () => {
    const f = fixture("AUTO"), network = vi.fn();
    f.tables.publishing_queue.push({ id: "queue-a", owner_id: "owner-a", tiktok_account_id: "account-a", video_id: "video-a",
      publish_mode: "DIRECT_POST", status: "WAITING_FOR_RECONCILIATION", external_state: "SUBMITTED_UNKNOWN" });
    const ports = createAutoExecutionPorts(f.client, { publishingProvider: new OfficialTikTokPublishingProvider(network as typeof fetch) });
    const claim = { ...f.claim, checkpoint: { ...f.claim.checkpoint, queueId: "queue-a" } };
    expect(await ports.PUBLISH(claim)).toMatchObject({ kind: "RECONCILE" }); expect(network).not.toHaveBeenCalled();
    f.tables.publishing_queue[0].tiktok_account_id = "account-b";
    await expect(ports.PUBLISH(claim)).rejects.toThrow("auto_publish_queue_missing");
  });
  it("blocks AUTO and DRAFT when current production flags are unavailable instead of using a mock adapter", async () => {
    const f = fixture("AUTO"); config.tiktokPublishingRealMode = false;
    expect(await createAutoExecutionPorts(f.client).QUEUE_PUBLISH(f.claim)).toMatchObject({ kind: "WAIT", reason: "PUBLISHING_NOT_APPROVED" });
    config.tiktokPublishingRealMode = true; config.tiktokVideoPublishApproved = false;
    expect(await createAutoExecutionPorts(f.client).QUEUE_PUBLISH(f.claim)).toMatchObject({ kind: "WAIT", reason: "PUBLISHING_NOT_APPROVED" });
    const draft = fixture("DRAFT"); config.tiktokVideoUploadApproved = false;
    expect(await createAutoExecutionPorts(draft.client).QUEUE_PUBLISH(draft.claim)).toMatchObject({ kind: "WAIT", reason: "DRAFT_CAPABILITY_REQUIRED" });
    expect(f.rpc.mock.calls.every(([name]) => name === "get_post_automation_execution_mode")).toBe(true);
    expect(draft.rpc.mock.calls.every(([name]) => name === "get_post_automation_execution_mode")).toBe(true);
  });
  it("does not publish before the account schedule is due and defers immature analytics without fabricating observations", async () => {
    const f = fixture("AUTO");
    f.tables.publishing_queue.push({ id: "queue-a", owner_id: "owner-a", tiktok_account_id: "account-a", video_id: "video-a",
      publish_mode: "DIRECT_POST", status: "APPROVED", consent_id: "consent-a", scheduled_for: "2099-01-01T00:00:00Z" });
    await ensurePostOutput(f.client, f.claim, "AUTO", "queue-a");
    const network = vi.fn(), collect = vi.fn(async () => ({ status: "WAITING_FOR_DATA", reason: "ANALYTICS_MATURATION_PENDING" }));
    const ports = createAutoExecutionPorts(f.client, { publishingProvider: new OfficialTikTokPublishingProvider(network as typeof fetch),
      analyticsIngestion: { collect } as never });
    const claim = { ...f.claim, checkpoint: { ...f.claim.checkpoint, queueId: "queue-a" } };
    expect(await ports.PUBLISH(claim)).toMatchObject({ kind: "WAIT", reason: "SCHEDULE_NOT_DUE" });
    expect(f.tables.post_outputs[0].status).toBe("SCHEDULED"); expect(network).not.toHaveBeenCalled();
    expect(await ports.COLLECT_ANALYTICS(claim)).toMatchObject({ kind: "ADVANCE", evidence: { analyticsDeferred: true } });
  });
  it("reuses an output snapshot after a crash instead of duplicating or replacing its caption", async () => {
    const f = fixture(); const first = await ensurePostOutput(f.client, f.claim, "EXPORT");
    f.tables.scripts[0].caption = "ใหม่";
    expect(await ensurePostOutput(f.client, f.claim, "EXPORT")).toMatchObject({ id: first.id, caption: "คำบรรยายสินค้า" });
    expect(f.tables.post_outputs).toHaveLength(1);
    await expect(ensurePostOutput(f.client, { ...f.claim, checkpoint: { ...f.claim.checkpoint, videoId: "video-b" } }, "EXPORT")).rejects.toThrow();
  });
  it("refuses a stored video changed after its quality evidence was recorded", async () => {
    const f = fixture(); await ensurePostOutput(f.client, f.claim, "EXPORT");
    f.download.mockResolvedValue({ data: new Blob(["changed-media"], { type: "video/mp4" }), error: null });
    await expect(buildAuthorizedPostPackage(f.client, "owner-a", "output-a")).rejects.toThrow("post_export_media_changed");
  });
  it("bounds status polls across restarts and timeouts without resubmitting or fabricating a failure", async () => {
    const f = fixture("AUTO");
    f.tables.publishing_queue.push({ id: "queue-a", owner_id: "owner-a", tiktok_account_id: "account-a", video_id: "video-a",
      publish_mode: "DIRECT_POST", status: "PROCESSING", provider_publish_id: "v_pub_existing", external_state: "SUBMITTED" });
    const network = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input; void init; return Response.json({ data: { status: "PROCESSING_UPLOAD", uploaded_bytes: 18 }, error: { code: "ok" } });
    });
    const provider = new OfficialTikTokPublishingProvider(network as typeof fetch);
    const claim = { ...f.claim, checkpoint: { ...f.claim.checkpoint, queueId: "queue-a", publishPollCount: 23,
      publishPollingStartedAt: new Date().toISOString() } };
    const result = await createAutoExecutionPorts(f.client, { publishingProvider: provider }).PUBLISH(claim);
    expect(result).toMatchObject({ kind: "WAIT", evidence: { publishPollCount: 24 } });
    expect(network).toHaveBeenCalledOnce();
    // A new worker instance consumes the durable checkpoint, not a process-local counter.
    const checkpoint = { ...claim.checkpoint, ...result.evidence };
    expect(await createAutoExecutionPorts(f.client, { publishingProvider: provider }).PUBLISH({ ...claim, checkpoint }))
      .toMatchObject({ kind: "RECONCILE", reason: "PUBLISH_RESULT_UNCONFIRMED" });
    expect(await createAutoExecutionPorts(f.client, { publishingProvider: provider }).PUBLISH({ ...claim,
      checkpoint: { ...claim.checkpoint, publishPollCount: 1, publishPollingStartedAt: new Date(Date.now() - 2 * 3600_000 - 1).toISOString() } }))
      .toMatchObject({ kind: "RECONCILE" });
    expect(network).toHaveBeenCalledOnce(); expect(f.tables.publishing_queue[0].status).toBe("PROCESSING");
  });
  it("creates a well formed empty fixed-entry ZIP central directory", () => {
    const zip = createPostPackageZip([{ name: "caption.txt", bytes: new Uint8Array() }]);
    const end = zip.length - 22;
    expect(zip.readUInt32LE(end)).toBe(0x06054b50); expect(zip.readUInt16LE(end + 10)).toBe(1);
    expect(zip.readUInt32LE(zip.readUInt32LE(end + 16))).toBe(0x02014b50);
  });
  it("projects a review only for its owner, account and video without internal diagnostics", async () => {
    const f = fixture("AUTO");
    f.tables.publishing_queue.push({ id: "queue-a", owner_id: "owner-a", tiktok_account_id: "account-a", video_id: "video-a",
      publish_mode: "DIRECT_POST", status: "REVIEW_REQUIRED", caption_snapshot: "คำบรรยาย", is_aigc: true,
      provider_publish_id: "internal-provider-id", secret: "must-not-leak" });
    f.tables.tiktok_accounts[0].privacy_level_options = ["SELF_ONLY", "PUBLIC_TO_EVERYONE"];
    await ensurePostOutput(f.client, f.claim, "AUTO", "queue-a");
    const value = (await readPostReview(f.client, "owner-a", "output-a")).customer;
    expect(value).toMatchObject({ caption: "คำบรรยาย", aiDisclosureRequired: true, requiresPrivacy: true });
    expect(JSON.stringify(value)).not.toMatch(/owner-a|account-a|video-a|internal-provider-id|secret/);
    await expect(readPostReview(f.client, "owner-b", "output-a")).rejects.toThrow();
    f.tables.publishing_queue[0].tiktok_account_id = "account-b";
    await expect(readPostReview(f.client, "owner-a", "output-a")).rejects.toThrow();
    expect(postReviewSettingsSchema.safeParse({ caption: "ok", privacyLevel: "SELF_ONLY", disableComment: true,
      disableDuet: true, disableStitch: true, isAigc: true, commercialContent: {}, ownerId: "owner-b" }).success).toBe(false);
  });
});
