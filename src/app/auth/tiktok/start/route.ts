import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TikTokOAuthService } from "@/features/tiktok/services";
import type { MockTikTokScenario, TikTokScope } from "@/features/tiktok/types";
import { serverEnv } from "@/lib/server-env";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { requestFingerprint, securityErrorResponse } from "@/lib/security/request";

const scenarios = new Set<MockTikTokScenario>([
  "connected", "partial", "upload_ready", "direct_ready", "private_only",
  "expired", "revoked", "creator_failure",
]);

function requestedScopes(scenario: MockTikTokScenario): TikTokScope[] {
  if (scenario === "connected") return ["user.info.basic"];
  return ["user.info.basic", "video.publish", "video.upload"];
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return NextResponse.redirect(new URL("/login", request.url));
  try {
    await enforceRateLimit({
      scope: "tiktok-oauth-start",
      keyHash: requestFingerprint(request, data.user.id),
      limit: serverEnv.tiktokOAuthRateLimit,
      windowSeconds: 60,
    });
  } catch (securityError) {
    return securityErrorResponse(securityError)
      ?? NextResponse.json({ error: "oauth_temporarily_unavailable" }, { status: 503 });
  }

  const rawScenario = request.nextUrl.searchParams.get("scenario") ?? "connected";
  const scenario = scenarios.has(rawScenario as MockTikTokScenario)
    ? rawScenario as MockTikTokScenario
    : "connected";
  const service = new TikTokOAuthService();
  const authorizationUrl = await service.buildAuthorizationUrl({
    ownerId: data.user.id,
    origin: request.nextUrl.origin,
    requestedScopes: serverEnv.tiktokProvider === "official"
      ? ["user.info.basic", "video.publish", "video.upload",
        ...(serverEnv.tiktokAnalyticsRealMode ? ["video.list" as const] : [])]
      : requestedScopes(scenario),
    mockScenario: serverEnv.tiktokProvider === "official" ? undefined : scenario,
  });
  return NextResponse.redirect(authorizationUrl);
}
