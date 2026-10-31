import type { TikTokScope } from "./types";

export type TikTokOAuthScopeMode = "basic" | "publishing";

export function officialTikTokRequestedScopes(
  mode: TikTokOAuthScopeMode,
  inbox = false,
  stats = false,
): TikTokScope[] {
  // Stats: read the profile's videos and their counts so the clip learning loop can see what people watch.
  const extra: TikTokScope[] = stats ? ["video.list", "user.info.stats"] : [];
  if (inbox) return ["user.info.basic", "video.publish", "video.upload", ...extra];
  if (stats) return ["user.info.basic", "video.publish", ...extra];
  if (mode === "basic") return ["user.info.basic"];
  return ["user.info.basic", "video.publish"];
}
