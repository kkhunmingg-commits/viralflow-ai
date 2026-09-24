"use client";

import { useActionState, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { env } from "@/lib/env";
import { login, type LoginState } from "./actions";
import { googleProviderAvailable, googleSignInErrorMessage, googleSignInOnce } from "./auth-flow";

const initialState: LoginState = { error: null };

export function LoginForm({ initialError = null }: { initialError?: string | null }) {
  const [state, action, pending] = useActionState(login, initialState);
  const [googlePending, setGooglePending] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const googleInFlight = useRef(false);

  async function handleGoogleSignIn() {
    if (googleInFlight.current || pending) return;
    setGooglePending(true);
    setGoogleError(null);
    try {
      await googleSignInOnce(createClient().auth, window.location.origin, googleInFlight,
        () => googleProviderAvailable(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY));
      // Supabase navigates to Google. Keep this button locked until unload.
    } catch (error) {
      setGooglePending(false);
      setGoogleError(googleSignInErrorMessage(error));
    }
  }

  const busy = googlePending || pending;

  return (
    <div className="auth-form-content">
      <button className="auth-google-button" type="button" onClick={handleGoogleSignIn} disabled={busy}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="21" height="21">
          <path fill="#4285F4" d="M21.35 12.25c0-.82-.07-1.42-.23-2.05H12v3.73h5.35a4.62 4.62 0 0 1-1.99 3.03v2.52h3.24c1.9-1.75 2.75-4.33 2.75-7.23Z" />
          <path fill="#34A853" d="M12 21.5c2.7 0 4.97-.9 6.6-2.45l-3.24-2.52c-.9.6-2.05.95-3.36.95-2.58 0-4.77-1.75-5.55-4.1H3.1v2.6A9.98 9.98 0 0 0 12 21.5Z" />
          <path fill="#FBBC05" d="M6.45 13.38a6.02 6.02 0 0 1 0-3.76v-2.6H3.1a10.02 10.02 0 0 0 0 8.96l3.35-2.6Z" />
          <path fill="#EA4335" d="M12 6.52c1.47 0 2.78.5 3.81 1.5l2.86-2.86C16.96 3.57 14.69 2.5 12 2.5a9.98 9.98 0 0 0-8.9 5.52l3.35 2.6c.78-2.35 2.97-4.1 5.55-4.1Z" />
        </svg>
        <span>{googlePending ? "กำลังเชื่อมต่อ Google…" : "Continue with Google"}</span>
      </button>

      <div className="auth-divider"><span>หรือเข้าสู่ระบบด้วยอีเมล</span></div>

      <form action={action} className="auth-login-form" aria-busy={pending}>
        <label htmlFor="login-email">อีเมล</label>
        <input id="login-email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required disabled={busy} />

        <label htmlFor="login-password">รหัสผ่าน</label>
        <div className="auth-password-wrap">
          <input id="login-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="กรอกรหัสผ่าน" minLength={8} required disabled={busy} />
          <button type="button" aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)} disabled={busy}>{showPassword ? "ซ่อน" : "แสดง"}</button>
        </div>

        {googleError || state.error || initialError ? <p className="auth-form-error" role="alert">{googleError ?? state.error ?? initialError}</p> : null}

        <button className="auth-submit" type="submit" disabled={busy}><span>{pending ? "กำลังเข้าสู่ระบบ…" : "Sign In"}</span><span aria-hidden="true">↗</span></button>
      </form>
    </div>
  );
}

