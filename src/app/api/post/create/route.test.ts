import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), start: vi.fn(), advance: vi.fn(), list: vi.fn(), stop: vi.fn(), review: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.auth } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceOwnerMutationRateLimit: async () => undefined }));
vi.mock("@/features/content-export/service", () => ({ startContentRun: mocks.start, advanceContentRun: mocks.advance, listContentRuns: mocks.list, stopContentRun: mocks.stop, reviewContentRun: mocks.review }));
import { GET, POST } from "./route";
const owner = "10000000-0000-4000-8000-000000000001", id = "10000000-0000-4000-8000-000000000002";
const req = (body: unknown, origin = "https://app.example") => new Request("https://app.example/api/post/create", { method: "POST", headers: { Origin: origin }, body: JSON.stringify(body) });
describe("authenticated paid creation entry point", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ data: { user: { id: owner } }, error: null }); mocks.list.mockResolvedValue([]); });
  it("rejects anonymous access and never reaches paid code", async () => {
    mocks.auth.mockResolvedValue({ data: { user: null }, error: null });
    expect((await GET()).status).toBe(401); expect((await POST(req({ command: "START" }))).status).toBe(401);
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.advance).not.toHaveBeenCalled();
  });
  it("blocks cross-origin mutation", async () => {
    expect((await POST(req({ command: "ADVANCE", id }, "https://evil.test"))).status).toBe(403); expect(mocks.advance).not.toHaveBeenCalled();
  });
  it("rejects missing consent before any provider action", async () => {
    expect((await POST(req({ command: "START", accountId: id, mode: "GROWTH", budgetUsd: .5, requestKey: id }))).status).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("uses the authenticated owner, never an owner supplied by the browser", async () => {
    mocks.advance.mockResolvedValue({ status: "GENERATING" });
    expect((await POST(req({ command: "ADVANCE", id, ownerId: "other" }))).status).toBe(200);
    expect(mocks.advance).toHaveBeenCalledWith({}, owner, id);
  });
  it("requires review consent and strips raw provider errors", async () => {
    expect((await POST(req({ command: "REVIEW", id, consent: false }))).status).toBe(400);
    mocks.advance.mockRejectedValue(new Error("internal api-token secret"));
    const response = await POST(req({ command: "ADVANCE", id }));
    expect(await response.text()).not.toContain("secret");
  });
});
