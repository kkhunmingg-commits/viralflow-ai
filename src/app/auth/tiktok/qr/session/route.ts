import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverEnv, tiktokOfficialSetupMissing } from "@/lib/server-env";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { requestFingerprint, securityErrorResponse } from "@/lib/security/request";
import { officialTikTokRequestedScopes } from "@/features/tiktok/oauth-scopes";
import { TikTokQrAuthorization, TIKTOK_QR_COOKIE, TIKTOK_QR_MAX_AGE_SECONDS, sealQrSession } from "@/features/tiktok/qr-authorization";
import { TikTokOAuthService } from "@/features/tiktok/services";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (serverEnv.tiktokProvider !== "official" || tiktokOfficialSetupMissing.length) {
    return NextResponse.json({ error: "tiktok_setup_required" }, { status: 503 });
  }
  const secret = serverEnv.tiktokTokenEncryptionKey ?? serverEnv.supabaseSecretKey;
  if (!secret || !serverEnv.tiktokClientKey || !serverEnv.tiktokClientSecret) {
    return NextResponse.json({ error: "tiktok_setup_required" }, { status: 503 });
  }
  try {
    await enforceRateLimit({
      scope: "tiktok-qr-start",
      keyHash: requestFingerprint(request, data.user.id),
      limit: 5,
      windowSeconds: 60,
    });
    const scopes = officialTikTokRequestedScopes(serverEnv.tiktokOAuthScopeMode);
    const state = await new TikTokOAuthService().createAuthorizationState({
      ownerId: data.user.id,
      requestedScopes: scopes,
    });
    const qr = await new TikTokQrAuthorization({
      clientKey: serverEnv.tiktokClientKey,
      clientSecret: serverEnv.tiktokClientSecret,
    }).create(scopes, state);
    const expiresAt = Date.now() + TIKTOK_QR_MAX_AGE_SECONDS * 1000;
    const response = NextResponse.json({ image: qr.image, status: "new", expiresAt }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(TIKTOK_QR_COOKIE, sealQrSession({
      ownerId: data.user.id,
      token: qr.token,
      ticket: qr.ticket,
      state,
      expiresAt,
    }, secret), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/auth/tiktok/qr",
      maxAge: TIKTOK_QR_MAX_AGE_SECONDS,
    });
    return response;
  } catch (caught) {
    const securityResponse = securityErrorResponse(caught);
    if (securityResponse) return securityResponse;
    return NextResponse.json({ error: "qr_start_failed" }, { status: 502 });
  }
}
