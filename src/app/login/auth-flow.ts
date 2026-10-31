import type { SupabaseClient } from "@supabase/supabase-js";

type OAuthAuth = Pick<SupabaseClient["auth"], "signInWithOAuth">;

export class GoogleProviderUnavailableError extends Error {
  code = "provider_disabled";
}

export async function googleProviderAvailable(
  supabaseUrl: string,
  publishableKey: string,
  request: typeof fetch = fetch,
): Promise<boolean> {
  const response = await request(new URL("/auth/v1/settings", supabaseUrl), {
    headers: { apikey: publishableKey },
    cache: "no-store",
  });
  if (!response.ok) throw new GoogleProviderUnavailableError();
  const settings: unknown = await response.json();
  return typeof settings === "object" && settings !== null && "external" in settings &&
    typeof settings.external === "object" && settings.external !== null &&
    "google" in settings.external && settings.external.google === true;
}

export async function googleSignIn(auth: OAuthAuth, origin: string) {
  const { error } = await auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: new URL("/auth/callback", origin).toString() },
  });
  if (error) throw error;
}

export async function googleSignInOnce(auth: OAuthAuth, origin: string, lock: { current: boolean }, isAvailable: () => Promise<boolean>) {
  if (lock.current) return false;
  lock.current = true;
  try {
    if (!await isAvailable()) throw new GoogleProviderUnavailableError();
    await googleSignIn(auth, origin);
    return true;
  } catch (error) {
    lock.current = false;
    throw error;
  }
}

export function loginErrorMessage(code: string | undefined): string | null {
  switch (code) {
    case "cancelled": return "ยกเลิกการเข้าสู่ระบบด้วย Google แล้ว";
    case "callback": return "ลิงก์เข้าสู่ระบบไม่ถูกต้อง กรุณาลองอีกครั้ง";
    case "session": return "ไม่สามารถสร้างเซสชันได้ กรุณาลองอีกครั้ง";
    case "unavailable": return "ยังไม่สามารถเข้าสู่ระบบด้วย Google ได้ กรุณาใช้อีเมลและรหัสผ่าน";
    default: return null;
  }
}

export function googleSignInErrorMessage(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (["validation_failed", "provider_disabled", "unsupported_provider"].includes(code)) return loginErrorMessage("unavailable")!;
  return "ไม่สามารถเข้าสู่ระบบด้วย Google ได้ในขณะนี้ กรุณาลองอีกครั้งหรือใช้อีเมล";
}
