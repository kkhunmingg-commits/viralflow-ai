import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const loginWithError = (error: string) => NextResponse.redirect(new URL(`/login?error=${error}`, url.origin));

  if (url.searchParams.has("error")) {
    return loginWithError(url.searchParams.get("error") === "access_denied" ? "cancelled" : "unavailable");
  }

  const code = url.searchParams.get("code");
  if (!code) return loginWithError("callback");

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return loginWithError("session");

    const { data, error: userError } = await supabase.auth.getUser();
    if (userError || !data.user) return loginWithError("session");

    return NextResponse.redirect(new URL("/auto", url.origin));
  } catch {
    return loginWithError("session");
  }
}
