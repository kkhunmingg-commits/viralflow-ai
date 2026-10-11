import { beforeEach, describe, expect, it, vi } from "vitest";
const { getUser, pack } = vi.hoisted(() => ({ getUser: vi.fn(), pack: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser } }) }));
vi.mock("@/features/manual-post/services", () => ({ buildStoredClipPackage: pack }));
import { GET } from "./route";
const id = "425421af-b9ee-458e-8c94-839b3b4e8bb1";
const call = (value = id) => GET(new Request("https://example.com/api/post/clips/" + value + "/download"), { params: Promise.resolve({ id: value }) });
beforeEach(() => { vi.clearAllMocks(); getUser.mockResolvedValue({ data: { user: { id: "owner" } }, error: null }); pack.mockResolvedValue(new Uint8Array([80,75,3,4])); });
describe("manual download API", () => {
  it("requires authentication", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await call()).status).toBe(401); expect(pack).not.toHaveBeenCalled();
  });
  it("returns generic not-found for invalid or unavailable clips without exposing errors", async () => {
    expect((await call("invalid")).status).toBe(404); expect(pack).not.toHaveBeenCalled();
    pack.mockRejectedValue(new Error("private diagnostic token"));
    const response = await call(); expect(response.status).toBe(404); expect(await response.text()).not.toContain("private diagnostic");
  });
  it("downloads a private ZIP scoped to authenticated owner", async () => {
    const response = await call(); expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(pack).toHaveBeenCalledWith(expect.anything(), "owner", id);
  });
});
