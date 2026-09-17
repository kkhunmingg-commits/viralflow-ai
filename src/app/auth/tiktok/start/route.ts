import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TikTokOAuthService } from "@/features/tiktok/services";
import type { MockTikTokScenario, TikTokScope } from "@/features/tiktok/types";

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

  const rawScenario = request.nextUrl.searchParams.get("scenario") ?? "connected";
  const scenario = scenarios.has(rawScenario as MockTikTokScenario)
    ? rawScenario as MockTikTokScenario
    : "connected";
  const service = new TikTokOAuthService();
  const authorizationUrl = await service.buildAuthorizationUrl({
    ownerId: data.user.id,
    origin: request.nextUrl.origin,
    requestedScopes: requestedScopes(scenario),
    mockScenario: process.env.TIKTOK_PROVIDER === "official" ? undefined : scenario,
  });
  return NextResponse.redirect(authorizationUrl);
}
