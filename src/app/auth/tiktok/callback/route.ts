import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TikTokOAuthService } from "@/features/tiktok/services";

function resultUrl(request: NextRequest, parameters: Record<string, string>) {
  const url = new URL("/accounts/connect/tiktok", request.url);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return url;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) return NextResponse.redirect(new URL("/login", request.url));

  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const providerError = request.nextUrl.searchParams.get("error");
  const service = new TikTokOAuthService();
  if (!state) return NextResponse.redirect(resultUrl(request, { error: "oauth_state_missing" }));

  try {
    if (providerError || !code) {
      await service.consumeState(data.user.id, state);
      return NextResponse.redirect(resultUrl(request, { error: providerError ?? "authorization_code_missing" }));
    }
    const result = await service.completeCallback({ ownerId: data.user.id, code, state });
    return NextResponse.redirect(new URL(`/accounts/${result.accountId}?connected=${result.connectionStatus}`, request.url));
  } catch (error) {
    const code = error instanceof Error ? error.message : "oauth_callback_failed";
    return NextResponse.redirect(resultUrl(request, { error: code.slice(0, 80) }));
  }
}
