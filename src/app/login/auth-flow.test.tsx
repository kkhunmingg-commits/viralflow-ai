import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { googleSignInOnce, googleSignInErrorMessage, googleProviderAvailable, loginErrorMessage } from "./auth-flow";

vi.mock("./actions", () => ({ login: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-key" } }));

import { LoginForm } from "./login-form";

describe("login UI and OAuth boundary", () => {
  it("keeps email/password fields and renders Google and password visibility controls", () => {
    const html = renderToStaticMarkup(<LoginForm />);
    expect(html).toContain("Continue with Google");
    expect(html).toContain('name="email"');
    expect(html).toContain('name="password"');
    expect(html).toContain('aria-label="แสดงรหัสผ่าน"');
    expect(html).toContain("Sign In");
  });

  it("renders a safe callback error without leaking provider details", () => {
    const html = renderToStaticMarkup(<LoginForm initialError={loginErrorMessage("cancelled")} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("ยกเลิกการเข้าสู่ระบบด้วย Google");
  });

  it("starts the official Google OAuth flow with a fixed same-origin callback", async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({ error: null });
    const lock = { current: false };
    await expect(googleSignInOnce({ signInWithOAuth } as never, "https://viralflow.example", lock, async () => true)).resolves.toBe(true);
    expect(signInWithOAuth).toHaveBeenCalledExactlyOnceWith({
      provider: "google",
      options: { redirectTo: "https://viralflow.example/auth/callback" },
    });
    expect(lock.current).toBe(true);
  });

  it("blocks concurrent and repeated OAuth requests", async () => {
    let release!: (value: { error: null }) => void;
    const signInWithOAuth = vi.fn().mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const lock = { current: false };
    const first = googleSignInOnce({ signInWithOAuth } as never, "http://localhost:3000", lock, async () => true);
    await expect(googleSignInOnce({ signInWithOAuth } as never, "http://localhost:3000", lock, async () => true)).resolves.toBe(false);
    release({ error: null });
    await expect(first).resolves.toBe(true);
    await expect(googleSignInOnce({ signInWithOAuth } as never, "http://localhost:3000", lock, async () => true)).resolves.toBe(false);
    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
  });

  it("releases the lock and shows friendly errors if Google is unavailable", async () => {
    const lock = { current: false };
    const error = { code: "provider_disabled", message: "raw upstream detail" };
    const signInWithOAuth = vi.fn().mockResolvedValue({ error });
    await expect(googleSignInOnce({ signInWithOAuth } as never, "http://localhost:3000", lock, async () => true)).rejects.toEqual(error);
    expect(lock.current).toBe(false);
    expect(googleSignInErrorMessage(error)).toContain("อีเมลและรหัสผ่าน");
    expect(googleSignInErrorMessage(error)).not.toContain(error.message);
  });

  it("checks public Auth settings and refuses a disabled Google provider", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ external: { google: false } }) });
    expect(await googleProviderAvailable("https://example.supabase.co", "public-key", request)).toBe(false);
    expect(request).toHaveBeenCalledWith(new URL("https://example.supabase.co/auth/v1/settings"), {
      headers: { apikey: "public-key" }, cache: "no-store",
    });
    const signInWithOAuth = vi.fn();
    const lock = { current: false };
    await expect(googleSignInOnce({ signInWithOAuth } as never, "http://localhost:3000", lock, async () => false)).rejects.toMatchObject({ code: "provider_disabled" });
    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(lock.current).toBe(false);
  });
});
