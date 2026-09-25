import type { TikTokScope } from "./types";

export type TikTokOAuthScopeMode = "basic" | "publishing";

export function officialTikTokRequestedScopes(
  mode: TikTokOAuthScopeMode,
): TikTokScope[] {
  if (mode === "basic") return ["user.info.basic"];
  return ["user.info.basic", "video.publish"];
}
