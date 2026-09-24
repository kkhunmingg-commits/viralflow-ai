import { describe, expect, it, vi } from "vitest";

const { signInWithPassword, redirect } = vi.hoisted(() => ({ signInWithPassword: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth: { signInWithPassword } })) }));
vi.mock("next/navigation", () => ({ redirect }));

import { login } from "./actions";

describe("email login", () => {
  function credentials() {
    const form = new FormData();
    form.set("email", "owner@example.test");
    form.set("password", "test-password-123");
    return form;
  }

  it("preserves password sign-in and redirects success to /auto", async () => {
    vi.clearAllMocks();
    signInWithPassword.mockResolvedValueOnce({ error: null });
    await login({ error: null }, credentials());
    expect(signInWithPassword).toHaveBeenCalledExactlyOnceWith({ email: "owner@example.test", password: "test-password-123" });
    expect(redirect).toHaveBeenCalledExactlyOnceWith("/auto");
  });

  it("maps invalid credentials and service failures to safe messages", async () => {
    vi.clearAllMocks();
    signInWithPassword.mockResolvedValueOnce({ error: { code: "invalid_credentials", message: "raw detail" } });
    expect(await login({ error: null }, credentials())).toEqual({ error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
    signInWithPassword.mockRejectedValueOnce(new Error("raw network detail"));
    const failed = await login({ error: null }, credentials());
    expect(failed.error).toContain("กรุณาลองอีกครั้ง");
    expect(failed.error).not.toContain("raw");
    expect(redirect).not.toHaveBeenCalled();
  });
});
