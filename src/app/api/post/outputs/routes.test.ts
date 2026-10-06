import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ user: vi.fn(), client: vi.fn(), admin: vi.fn(), download: vi.fn(), review: vi.fn(), approve: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/features/auto/export-package", () => ({ buildAuthorizedPostPackage: mocks.download }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceOwnerMutationRateLimit: mocks.rate }));
vi.mock("@/features/auto/post-review", async (original) => ({ ...await original<typeof import("@/features/auto/post-review")>(),
  readPostReview: mocks.review, approvePostOutput: mocks.approve }));
const { GET: download } = await import("./[id]/download/route");
const { GET: review, POST: approve } = await import("./[id]/review/route");
const id = "f6bfce81-0e1c-437e-8b29-fd224f08d92a";
const context = { params: Promise.resolve({ id }) };
const settings = { caption: "คำบรรยาย", privacyLevel: "SELF_ONLY", disableComment: true,
  disableDuet: true, disableStitch: true, isAigc: true, commercialContent: {} };
function mutation(body: unknown = settings, origin = "https://app.example") {
  return new Request(`https://app.example/api/post/outputs/${id}/review`, { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ data: { user: { id: "owner-a" } }, error: null });
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.user } }); mocks.admin.mockReturnValue({});
  mocks.download.mockResolvedValue(Buffer.from("zip")); mocks.review.mockResolvedValue({ customer: { caption: "คำบรรยาย", privacyOptions: ["SELF_ONLY"] } });
});
describe("authenticated customer POST outputs", () => {
  it("downloads only via fresh authenticated owner and never caches the package", async () => {
    const response = await download(new Request("https://app.example"), context);
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Disposition")).toBe("attachment; filename=viralflow-ready-to-post.zip");
    expect(mocks.download).toHaveBeenCalledWith(expect.anything(), "owner-a", id);
  });
  it("denies anonymous or missing owner output without raw errors", async () => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    expect((await download(new Request("https://app.example"), context)).status).toBe(401);
    expect(mocks.download).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue({ data: { user: { id: "owner-a" } }, error: null });
    mocks.download.mockRejectedValue(new Error("internal_db_secret"));
    const response = await download(new Request("https://app.example"), context);
    expect(response.status).toBe(404); expect(await response.text()).not.toContain("internal_db_secret");
  });
  it("projects safe review fields and requires same-origin exact settings for consent", async () => {
    expect((await review(new Request("https://app.example"), context)).status).toBe(200);
    expect((await approve(mutation(), context)).status).toBe(200);
    expect(mocks.rate).toHaveBeenCalledWith("post-review", "owner-a");
    expect(mocks.approve).toHaveBeenCalledWith(expect.anything(), expect.anything(), "owner-a", id, settings);
    mocks.approve.mockClear();
    expect((await approve(mutation(settings, "https://evil.example"), context)).status).toBe(403);
    expect((await approve(mutation({ ...settings, tiktok_account_id: "account-b" }), context)).status).toBe(400);
    expect(mocks.approve).not.toHaveBeenCalled();
  });
  it("does not expose technical consent failure or permit anonymous mutation", async () => {
    mocks.approve.mockRejectedValue(new Error("scope_key_internal"));
    const response = await approve(mutation(), context);
    expect(response.status).toBe(409); expect(await response.text()).not.toContain("scope_key_internal");
    mocks.approve.mockClear(); mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    expect((await approve(mutation(), context)).status).toBe(401); expect(mocks.approve).not.toHaveBeenCalled();
  });
});
