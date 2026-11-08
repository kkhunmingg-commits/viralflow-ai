import "server-only";

/**
 * Credentials for posting finished clips outside TikTok. Each platform switches on by itself once its variables are
 * set in Vercel; nothing is posted for a platform that is not configured. See docs/PRODUCT_LINK_CLIPS.md.
 */
export type SocialPlatform = "FACEBOOK" | "INSTAGRAM" | "YOUTUBE";
export const SOCIAL_PLATFORMS: SocialPlatform[] = ["FACEBOOK", "INSTAGRAM", "YOUTUBE"];
export const SOCIAL_LABEL: Record<SocialPlatform, string> = { FACEBOOK: "Facebook Reels", INSTAGRAM: "Instagram Reels", YOUTUBE: "YouTube Shorts" };

const value = (key: string) => process.env[key]?.trim() || null;

export interface MetaConfig { graphVersion: string; pageId: string | null; pageToken: string | null; igUserId: string | null }
export interface YouTubeConfig { clientId: string | null; clientSecret: string | null; refreshToken: string | null; privacy: "public" | "unlisted" | "private" }

export function metaConfig(): MetaConfig {
  return { graphVersion: value("META_GRAPH_VERSION") ?? "v23.0", pageId: value("META_PAGE_ID"), pageToken: value("META_PAGE_ACCESS_TOKEN"), igUserId: value("META_IG_USER_ID") };
}
export function youtubeConfig(): YouTubeConfig {
  const privacy = value("YOUTUBE_PRIVACY");
  return { clientId: value("YOUTUBE_CLIENT_ID"), clientSecret: value("YOUTUBE_CLIENT_SECRET"), refreshToken: value("YOUTUBE_REFRESH_TOKEN"),
    privacy: privacy === "unlisted" || privacy === "private" ? privacy : "public" };
}

/** Only these web accounts may post through the page/channel credentials (they belong to one owner). */
export function socialOwnerAllowed(owner: string) {
  const list = (value("SOCIAL_PUBLISH_OWNER_IDS") ?? value("FLOW_WORKER_OWNER_ID") ?? "").split(",").map(v => v.trim()).filter(Boolean);
  return list.includes(owner);
}

/** Which platforms can post right now, and which variables are still missing for the others. */
export function socialReadiness(owner?: string) {
  const meta = metaConfig(), yt = youtubeConfig();
  const missing: Record<SocialPlatform, string[]> = {
    FACEBOOK: [!meta.pageId && "META_PAGE_ID", !meta.pageToken && "META_PAGE_ACCESS_TOKEN"].filter(Boolean) as string[],
    INSTAGRAM: [!meta.igUserId && "META_IG_USER_ID", !meta.pageToken && "META_PAGE_ACCESS_TOKEN"].filter(Boolean) as string[],
    YOUTUBE: [!yt.clientId && "YOUTUBE_CLIENT_ID", !yt.clientSecret && "YOUTUBE_CLIENT_SECRET", !yt.refreshToken && "YOUTUBE_REFRESH_TOKEN"].filter(Boolean) as string[],
  };
  const ownerOk = owner ? socialOwnerAllowed(owner) : true;
  const ready = SOCIAL_PLATFORMS.filter(p => !missing[p].length && ownerOk);
  return { ready, missing, ownerOk };
}
