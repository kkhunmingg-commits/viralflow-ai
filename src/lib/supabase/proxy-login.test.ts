import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn(() => ({ auth: { getClaims } })) }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-key" } }));

import { updateSession } from "./proxy";

describe("login session routing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("takes an existing session directly to /auto", async () => {
    getClaims.mockResolvedValueOnce({ data: { claims: { sub: "owner" } } });
    const response = await updateSession(new NextRequest("https://viralflow.example/login"));
    expect(response.headers.get("location")).toBe("https://viralflow.example/auto");
  });

  it("preserves unauthenticated access to /login and the OAuth callback", async () => {
    getClaims.mockResolvedValue({ data: { claims: null } });
    const login = await updateSession(new NextRequest("https://viralflow.example/login"));
    const callback = await updateSession(new NextRequest("https://viralflow.example/auth/callback?code=sample"));
    expect(login.headers.get("location")).toBeNull();
    expect(callback.headers.get("location")).toBeNull();
  });

  it("keeps the Terms and Privacy pages public without opening application routes", async () => {
    getClaims.mockResolvedValue({ data: { claims: null } });
    for (const path of ["/terms", "/privacy"]) {
      const response = await updateSession(new NextRequest(`https://viralflow.example${path}`));
      expect(response.headers.get("location")).toBeNull();
    }
    const protectedResponse = await updateSession(new NextRequest("https://viralflow.example/auto"));
    expect(protectedResponse.headers.get("location")).toContain("/login?next=%2Fauto");
  });

  it("requires a server-managed role for internal diagnostics", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "member" } } });
    const internal = await updateSession(new NextRequest("https://viralflow.example/operations"));
    const customer = await updateSession(new NextRequest("https://viralflow.example/accounts"));
    expect(internal.headers.get("location")).toBe("https://viralflow.example/auto");
    expect(customer.headers.get("location")).toBeNull();

    getClaims.mockResolvedValue({ data: { claims: { sub: "admin", app_metadata: { viralflow_role: "admin" } } } });
    const admin = await updateSession(new NextRequest("https://viralflow.example/operations"));
    expect(admin.headers.get("location")).toBeNull();
  });
});
