import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestSecurityError } from "@/lib/security/request";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceOwnerMutationRateLimit: mocks.rate }));
import { GET } from "./route";

const ownerId = "e26ed687-b36b-44d9-a8df-38e9545d760c";
const active = { enabled: true, status: "active", deviceLimit: 1, expiresAt: new Date(Date.now() + 3600_000).toISOString() };
let user: { id: string; app_metadata: Record<string, unknown>; user_metadata?: Record<string, unknown> };
beforeEach(() => {
  vi.clearAllMocks();
  user = { id: ownerId, app_metadata: { ai_live: { ...active } } };
  mocks.getUser.mockImplementation(async () => ({ data: { user }, error: null }));
  mocks.rate.mockResolvedValue(undefined);
});

describe("current AI LIVE membership endpoint", () => {
  it("checks authenticated server membership and returns no diagnostics or internal authorization data", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ supported: true });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.rate).toHaveBeenCalledWith("ai-live-entitlement-read", ownerId);
  });
  it.each([
    ["inactive", { ...active, status: "inactive" }],
    ["revoked", { ...active, status: "revoked" }],
    ["revoked timestamp", { ...active, revokedAt: new Date().toISOString() }],
    ["disabled", { ...active, enabled: false }],
    ["expired", { ...active, expiresAt: new Date(Date.now() - 1000).toISOString() }],
    ["missing device permission", { ...active, deviceLimit: 0 }],
    ["missing feature", undefined],
  ])("denies %s membership", async (_description, membership) => {
    user.app_metadata = { ai_live: membership };
    user.user_metadata = { ai_live: active };
    expect(await (await GET()).json()).toEqual({ supported: false });
  });
  it("requires fresh authentication and fails closed on Auth/rate-limit failure without leaking messages", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await GET()).status).toBe(401);
    expect(mocks.rate).not.toHaveBeenCalled();
    mocks.getUser.mockResolvedValue({ data: { user }, error: new Error("secret auth detail") });
    expect((await GET()).status).toBe(401);
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    mocks.rate.mockRejectedValue(new RequestSecurityError("rate_limited", 429));
    const response = await GET();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    mocks.rate.mockRejectedValue(new Error("private debug error"));
    const unavailable = await GET();
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain("private debug");
  });
});
