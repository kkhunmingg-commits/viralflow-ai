import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ user: null as null | { id: string }, path: "", fields: {} as Record<string, unknown>, sign: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
  from: () => { const query = { select: () => query, eq: (key: string, value: unknown) => { state.fields[key] = value; return query; },
    maybeSingle: async () => ({ error: null, data: state.path ? { storage_path: state.path } : null }) }; return query; },
  storage: { from: () => ({ createSignedUrl: state.sign }) },
}) }));
import { GET } from "./route";
const id = "7cf76d65-3f85-488a-9cc1-63c533c365ea", owner = "eaf76d65-3f85-488a-9cc1-63c533c365ea";
const context = { params: Promise.resolve({ id }) };
const request = () => new Request(`https://app.test/api/post/clips/${id}/video?kind=MASTER`);
beforeEach(() => { state.user = null; state.path = `owner/${owner}/masters/${id}/final.mp4`; state.fields = {}; state.sign.mockReset();
  state.sign.mockResolvedValue({ data: { signedUrl: "https://storage.test/short-lived-preview" }, error: null }); });
describe("customer video preview owner boundary", () => {
  it("requires an authenticated owner", async () => { expect((await GET(request(), context)).status).toBe(401); expect(state.sign).not.toHaveBeenCalled(); });
  it("authorizes row and storage path before issuing a private short-lived preview", async () => {
    state.user = { id: owner };
    const response = await GET(request(), context);
    expect(response.status).toBe(307); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(state.fields).toEqual({ owner_id: owner, id }); expect(state.sign).toHaveBeenCalledWith(state.path, 300);
  });
  it("never signs another owner's media or arbitrary table/invalid locator", async () => {
    state.user = { id: owner }; state.path = "owner/another-user/masters/clip.mp4";
    expect((await GET(request(), context)).status).toBe(404); expect(state.sign).not.toHaveBeenCalled();
    expect((await GET(new Request("https://app.test/api/post/clips/x/video?kind=credentials"), context)).status).toBe(404);
    expect((await GET(request(), { params: Promise.resolve({ id: "invalid" }) })).status).toBe(404);
  });
});
