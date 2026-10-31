import { beforeEach, describe, expect, it, vi } from "vitest";

const exchangeCodeForSession = vi.fn();
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { exchangeCodeForSession, getUser } })),
}));

import { GET } from "./route";

describe("Google OAuth callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exchangeCodeForSession.mockResolvedValue({ error: null });
    getUser.mockResolvedValue({ data: { user: { id: "owner" } }, error: null });
  });

  it("exchanges an auth code, checks the user, and redirects to /auto", async () => {
    const response = await GET(new Request("https://viralflow.example/auth/callback?code=sample&next=https://evil.example"));
    expect(exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith("sample");
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(response.headers.get("location")).toBe("https://viralflow.example/auto");
  });

  it("handles cancelled or unavailable OAuth without code exchange", async () => {
    const cancelled = await GET(new Request("https://viralflow.example/auth/callback?error=access_denied"));
    const unavailable = await GET(new Request("https://viralflow.example/auth/callback?error=server_error"));
    expect(cancelled.headers.get("location")).toBe("https://viralflow.example/login?error=cancelled");
    expect(unavailable.headers.get("location")).toBe("https://viralflow.example/login?error=unavailable");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("rejects a missing or invalid code safely", async () => {
    const missing = await GET(new Request("https://viralflow.example/auth/callback?next=//evil.example"));
    expect(missing.headers.get("location")).toBe("https://viralflow.example/login?error=callback");
    exchangeCodeForSession.mockResolvedValueOnce({ error: { message: "raw session failure" } });
    const invalid = await GET(new Request("https://viralflow.example/auth/callback?code=expired"));
    expect(invalid.headers.get("location")).toBe("https://viralflow.example/login?error=session");
  });

  it("does not complete sign-in without a verified Supabase user", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const response = await GET(new Request("https://viralflow.example/auth/callback?code=sample"));
    expect(response.headers.get("location")).toBe("https://viralflow.example/login?error=session");
  });
});
