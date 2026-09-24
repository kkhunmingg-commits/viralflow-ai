import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getUser, serviceConstructor, rateLimit } = vi.hoisted(() => ({
  getUser: vi.fn(), serviceConstructor: vi.fn(), rateLimit: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser } })),
}));
vi.mock("@/features/tiktok/services", () => ({ TikTokOAuthService: serviceConstructor }));
vi.mock("@/lib/server-env", () => ({
  serverEnv: { tiktokProvider: "official", tiktokOAuthRateLimit: 20 },
  tiktokOfficialSetupMissing: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_REDIRECT_URI"],
}));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: rateLimit }));
vi.mock("@/lib/security/request", () => ({
  RequestSecurityError: class extends Error {}, requestFingerprint: vi.fn(), securityErrorResponse: vi.fn(),
}));

import { GET as startOAuth } from "./start/route";
import { GET as completeOAuth } from "./callback/route";

describe("incomplete TikTok production configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "owner" } }, error: null });
  });

  it("keeps OAuth start local and does not create an authorization service", async () => {
    const response = await startOAuth(new NextRequest("http://localhost:3000/auth/tiktok/start"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/accounts/connect/tiktok?error=tiktok_setup_required");
    expect(serviceConstructor).not.toHaveBeenCalled();
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("rejects a callback without state before constructing a provider", async () => {
    const response = await completeOAuth(new NextRequest("http://localhost:3000/auth/tiktok/callback?code=code"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/accounts/connect/tiktok?error=oauth_state_missing");
    expect(serviceConstructor).not.toHaveBeenCalled();
  });

  it("keeps an incomplete callback local without exposing the code", async () => {
    const response = await completeOAuth(new NextRequest("http://localhost:3000/auth/tiktok/callback?state=state&code=sensitive-code"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/accounts/connect/tiktok?error=tiktok_setup_required");
    expect(response.headers.get("location")).not.toContain("sensitive-code");
    expect(serviceConstructor).not.toHaveBeenCalled();
  });
});
