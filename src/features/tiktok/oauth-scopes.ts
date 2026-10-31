import type { TikTokScope } from "./types";

export type TikTokOAuthScopeMode = "basic" | "publishing";

export function officialTikTokRequestedScopes(
  mode: TikTokOAuthScopeMode,
  inbox = false,
): TikTokScope[] {
  if (inbox) return ["user.info.basic", "video.publish", "video.upload"];
  if (mode === "basic") return ["user.info.basic"];
  return ["user.info.basic", "video.publish"];
}
