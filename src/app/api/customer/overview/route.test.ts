import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ user: null as null | { id: string }, fail: false, read: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user }, error: null }) } }) }));
vi.mock("@/features/control-center/customer-data", () => ({ readCustomerRecords: state.read }));
import { GET } from "./route";
describe("authenticated customer overview", () => {
  beforeEach(() => {
    state.user = null; state.read.mockReset();
    state.read.mockResolvedValue({ accounts: [], masters: [], variations: [], queues: [], snapshots: [], jobs: [], products: [], runs: [], states: [] });
  });
  it("requires authentication and reads only the actual session owner", async () => {
    expect((await GET(new Request("https://app.test/api/customer/overview"))).status).toBe(401);
    expect(state.read).not.toHaveBeenCalled();
    state.user = { id: "authenticated-owner" };
    const response = await GET(new Request("https://app.test/api/customer/overview?period=7d&owner=wrong"));
    expect(state.read.mock.calls[0][1]).toBe("authenticated-owner");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect((await response.json()).period).toBe("7d");
  });
  it("returns a friendly failure without database, token or internal diagnostics", async () => {
    state.user = { id: "owner" }; state.read.mockRejectedValue(new Error("secret/internal SQL"));
    const response = await GET(new Request("https://app.test/api/customer/overview"));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("SQL");
  });
});
