import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/server-env";
import { TikTokQrAuthorization, TIKTOK_QR_COOKIE, openQrSession, parseQrConfirmation } from "@/features/tiktok/qr-authorization";
import { TikTokOAuthService } from "@/features/tiktok/services";

function clearSession(response: NextResponse) {
  response.cookies.set(TIKTOK_QR_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/auth/tiktok/qr",
    maxAge: 0,
  });
  return response;
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (serverEnv.tiktokProvider !== "official" || !serverEnv.tiktokClientKey || !serverEnv.tiktokClientSecret || !serverEnv.tiktokRedirectUri) {
    return NextResponse.json({ error: "tiktok_setup_required" }, { status: 503 });
  }
  const secret = serverEnv.tiktokTokenEncryptionKey ?? serverEnv.supabaseSecretKey;
  const cookie = request.cookies.get(TIKTOK_QR_COOKIE)?.value;
  if (!secret) return NextResponse.json({ error: "tiktok_setup_required" }, { status: 503 });
  if (!cookie) return NextResponse.json({ status: "expired" }, { headers: { "Cache-Control": "no-store" } });

  try {
    const session = openQrSession(cookie, secret);
    if (session.ownerId !== data.user.id) throw new Error("qr_owner_mismatch");
    const status = await new TikTokQrAuthorization({
      clientKey: serverEnv.tiktokClientKey,
      clientSecret: serverEnv.tiktokClientSecret,
    }).check(session.token);
    if (status.status === "expired" || status.status === "utilised") {
      return clearSession(NextResponse.json({ status: "expired" }, { headers: { "Cache-Control": "no-store" } }));
    }
    if (status.status !== "confirmed") {
      return NextResponse.json({ status: status.status }, { headers: { "Cache-Control": "no-store" } });
    }
    const code = parseQrConfirmation(status, session, serverEnv.tiktokRedirectUri);
    const result = await new TikTokOAuthService().completeCallback({
      ownerId: data.user.id, code, state: session.state, requireNewAccount: true,
    });
    return clearSession(NextResponse.json({
      status: "connected",
      accountPath: `/accounts/${result.accountId}?connected=${result.connectionStatus}`,
    }, { headers: { "Cache-Control": "no-store" } }));
  } catch (caught) {
    if (caught instanceof Error && ["qr_session_expired", "tiktok_qr_token_expire", "tiktok_qr_token_expired"].includes(caught.message)) {
      return clearSession(NextResponse.json({ status: "expired" }, { headers: { "Cache-Control": "no-store" } }));
    }
    const error = caught instanceof Error && caught.message === "tiktok_account_already_added"
      ? "tiktok_account_already_added" : "qr_authorization_failed";
    return clearSession(NextResponse.json({ error }, { status: 400 }));
  }
}
