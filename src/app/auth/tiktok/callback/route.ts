import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TikTokOAuthService } from "@/features/tiktok/services";
import { serverEnv, tiktokOfficialSetupMissing } from "@/lib/server-env";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { RequestSecurityError, requestFingerprint } from "@/lib/security/request";

const publicOAuthErrors = new Set([
  "oauth_state_invalid_or_replayed",
  "oauth_identity_mismatch",
]);

function publicOAuthError(error: unknown) {
  if (error instanceof RequestSecurityError) {
    return error.code === "rate_limited" ? "rate_limited" : "oauth_temporarily_unavailable";
  }
  const code = error instanceof Error ? error.message : "";
  return publicOAuthErrors.has(code) ? code : "oauth_callback_failed";
}

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
  if (!state) return NextResponse.redirect(resultUrl(request, { error: "oauth_state_missing" }));
  if (tiktokOfficialSetupMissing.length) {
    return NextResponse.redirect(resultUrl(request, { error: "tiktok_setup_required" }));
  }
  const service = new TikTokOAuthService();

  try {
    await enforceRateLimit({
      scope: "tiktok-oauth-callback",
      keyHash: requestFingerprint(request, data.user.id),
      limit: serverEnv.tiktokOAuthRateLimit,
      windowSeconds: 60,
    });
    if (providerError || !code) {
      await service.consumeState(data.user.id, state);
      return NextResponse.redirect(resultUrl(request, {
        error: providerError ? "provider_authorization_denied" : "authorization_code_missing",
      }));
    }
    const result = await service.completeCallback({ ownerId: data.user.id, code, state });
    return NextResponse.redirect(new URL(`/accounts/${result.accountId}?connected=${result.connectionStatus}`, request.url));
  } catch (error) {
    return NextResponse.redirect(resultUrl(request, { error: publicOAuthError(error) }));
  }
}
