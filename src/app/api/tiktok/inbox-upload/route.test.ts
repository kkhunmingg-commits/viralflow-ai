import { beforeEach, describe, expect, it, vi } from "vitest";
const { getUser, context, rateLimit, readReceipt, provider } = vi.hoisted(() => ({
  getUser: vi.fn(), context: vi.fn(), rateLimit: vi.fn(), readReceipt: vi.fn(),
  provider: { name: "tiktok", uploadDraft: vi.fn(), uploadBinary: vi.fn(), fetchPublishStatus: vi.fn() },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server-env", () => ({ serverEnv: { appUrl: "https://viralflow.example" } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser } }) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceOwnerMutationRateLimit: rateLimit }));
vi.mock("@/features/tiktok/inbox-service", () => ({ inboxContext: context }));
import { GET, POST } from "./route";
const account = "425421af-b9ee-458e-8c94-839b3b4e8bb1";
const receipt = "8e8d5ad4-0de1-4419-aa54-bb821ba1a002";
const key = "8e8d5ad4-0de1-4419-aa54-bb821ba1a003";
function post(origin = "https://viralflow.example", consent = "yes") {
  const bytes = new Uint8Array(2000); bytes.set([102,116,121,112], 4);
  const form = new FormData(); form.set("account", account); form.set("key", key);
  form.set("consent", consent); form.set("video", new File([bytes], "clip.mp4", { type: "video/mp4" }));
  const raw = new Request("https://viralflow.example/api/tiktok/inbox-upload", { method: "POST", headers: { origin }, body: form });
  raw.headers.set("content-length", "2500"); return raw;
}
beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "authenticated-owner" } }, error: null });
  rateLimit.mockResolvedValue(undefined);
  context.mockResolvedValue({ token: "private-test-token", provider, receipt: readReceipt });
});
describe("Inbox API owner boundary", () => {
  it("denies anon before accessing server credentials or TikTok", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await POST(post())).status).toBe(400);
    expect(context).not.toHaveBeenCalled();
    expect(provider.uploadDraft).not.toHaveBeenCalled();
  });
  it("rejects foreign origin and missing consent without initiating upload", async () => {
    expect((await POST(post("https://attacker.example"))).status).toBe(400);
    expect((await POST(post(undefined, "no"))).status).toBe(400);
    expect(context).not.toHaveBeenCalled();
  });
  it("uses authenticated owner and refuses inaccessible accounts without exposing errors", async () => {
    context.mockRejectedValue(new Error("secret database details"));
    const response = await POST(post());
    expect(context).toHaveBeenCalledWith("authenticated-owner", account, key);
    expect(await response.text()).not.toContain("secret database details");
    expect(provider.uploadDraft).not.toHaveBeenCalled();
  });
  it("resumes only an owner-scoped receipt and rejects arbitrary publish ids", async () => {
    readReceipt.mockRejectedValue(new Error("receipt_not_owned"));
    const request = new Request(`https://viralflow.example/api/tiktok/inbox-upload?account=${account}&receipt=${receipt}`, { headers: { "sec-fetch-site": "same-origin" } });
    expect((await GET(request)).status).toBe(400);
    expect(readReceipt).toHaveBeenCalledWith(receipt);
    expect(provider.fetchPublishStatus).not.toHaveBeenCalled();
    expect((await GET(new Request(`https://viralflow.example/api/tiktok/inbox-upload?account=${account}&receipt=v_inbox_arbitrary`, { headers: { "sec-fetch-site": "same-origin" } }))).status).toBe(400);
  });
  it("rechecks a delivered owner receipt with no upload or init call", async () => {
    const row = { id: receipt, status: "SEND_TO_USER_INBOX", media_sha256: "hash", video_size: 2000, provider_publish_id: "existing-inbox-publish" };
    const update = vi.fn().mockImplementation(async (_id, patch) => ({ ...row, ...patch }));
    readReceipt.mockResolvedValue(row);
    provider.fetchPublishStatus.mockResolvedValue({ status: "SEND_TO_USER_INBOX", uploadedBytes: 2000, failReason: null, postIds: [], providerError: { code: "ok", logId: "fresh-log" } });
    context.mockResolvedValue({ token: "private-test-token", provider, receipt: readReceipt, store: { update } });
    const response = await GET(new Request(`https://viralflow.example/api/tiktok/inbox-upload?account=${account}&receipt=${receipt}`, { headers: { "sec-fetch-site": "same-origin" } }));
    expect(response.status).toBe(200);
    expect(context).toHaveBeenCalledWith("authenticated-owner", account);
    expect(provider.fetchPublishStatus).toHaveBeenCalledWith("private-test-token", "existing-inbox-publish");
    expect(update).toHaveBeenCalledWith(receipt, expect.objectContaining({ status: "SEND_TO_USER_INBOX", log_id: "fresh-log" }));
    expect(await response.json()).toEqual({ receipt, status: "SEND_TO_USER_INBOX" });
    expect(provider.uploadDraft).not.toHaveBeenCalled();
    expect(provider.uploadBinary).not.toHaveBeenCalled();
  });
});
