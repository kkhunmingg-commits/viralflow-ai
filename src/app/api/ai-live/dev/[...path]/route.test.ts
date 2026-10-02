import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), worker: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/features/ai-live/dev-http", () => ({ handleDevWorkerRequest: mocks.worker }));
import { GET, POST } from "./route";
const ownerId = "e26ed687-b36b-44d9-a8df-38e9545d760c";
const context = { params: Promise.resolve({ path: ["health"] }) };
beforeEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries({ NODE_ENV: "development", APP_ENV: "development", AI_LIVE_DEV_FALLBACK: "true", PRESENTER_PROVIDER: "dev_fallback", VERCEL: "" })) vi.stubEnv(key, value);
  mocks.getUser.mockResolvedValue({ data: { user: { id: ownerId } }, error: null });
  mocks.worker.mockResolvedValue(Response.json({ ready: true }));
});
afterEach(() => { vi.unstubAllEnvs(); });
describe("authenticated local DEV presenter route", () => {
  it("returns 404 in production before accessing auth or the worker", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await GET(new Request("http://localhost:3000/api/ai-live/dev/health"), context)).status).toBe(404);
    expect(mocks.getUser).not.toHaveBeenCalled(); expect(mocks.worker).not.toHaveBeenCalled();
  });
  it("denies missing or failed user authentication without a DEV bypass", async () => {
    for (const auth of [{ data: { user: null }, error: null }, { data: { user: { id: ownerId } }, error: new Error("expired auth") }]) {
      mocks.getUser.mockResolvedValue(auth);
      expect((await POST(new Request("http://localhost:3000/api/ai-live/dev/sessions", { method: "POST" }), context)).status).toBe(401);
    }
    expect(mocks.worker).not.toHaveBeenCalled();
  });
  it("forwards only the freshly authenticated owner identity", async () => {
    const request = new Request("http://localhost:3000/api/ai-live/dev/health", { headers: { "X-ViralFlow-Owner-Id": "attacker" } });
    expect((await GET(request, context)).status).toBe(200);
    expect(mocks.worker).toHaveBeenCalledWith(request, ["health"], ownerId);
  });
});
