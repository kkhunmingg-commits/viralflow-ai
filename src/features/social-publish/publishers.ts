import type { MetaConfig, SocialPlatform, YouTubeConfig } from "./config";

/**
 * Posting one finished clip to Facebook Page Reels, Instagram Reels and YouTube Shorts, then leaving the product link
 * as the first comment. Each platform is a small state machine advanced once per tick (Instagram and Facebook
 * process the video for a while after upload), so a slow platform never blocks the others and a failure is recorded
 * per platform. Pure apart from the injected fetch; the caller saves the returned state.
 */
export type PostStatus = "PENDING" | "PROCESSING" | "POSTED" | "DONE" | "FAILED";
export interface PlatformPost {
  platform: SocialPlatform; status: PostStatus;
  /** Facebook video id / Instagram media id / YouTube video id. */
  remoteId: string | null;
  /** Instagram media container (before publishing). */
  containerId: string | null;
  url: string | null; commented: boolean; error: string | null; attempts: number; updatedAt: string;
}
export interface PostContext {
  /** Signed HTTPS link to the MP4 (Meta downloads it). */
  videoUrl: string;
  /** The MP4 itself (YouTube is uploaded directly). */
  videoBytes: () => Promise<Uint8Array>;
  caption: string; comment: string; youtubeTitle: string;
  meta: MetaConfig; youtube: YouTubeConfig;
  fetcher?: typeof fetch; now?: Date;
}

export const MAX_TICKS = 40;
export function newPost(platform: SocialPlatform, now = new Date()): PlatformPost {
  return { platform, status: "PENDING", remoteId: null, containerId: null, url: null, commented: false, error: null, attempts: 0, updatedAt: now.toISOString() };
}

class PlatformError extends Error {}
async function call(fetcher: typeof fetch, url: string, init: RequestInit = {}) {
  const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(60_000) });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { body = { raw: text.slice(0, 200) }; }
  if (!response.ok) {
    const error = body.error as { message?: string; code?: number } | undefined;
    throw new PlatformError(`HTTP_${response.status}: ${error?.message ?? JSON.stringify(body).slice(0, 200)}`.slice(0, 300));
  }
  return body;
}
const form = (values: Record<string, string>) => new URLSearchParams(values);

// ---------------------------------------------------------------- Facebook Page Reels

async function facebook(post: PlatformPost, ctx: PostContext, fetcher: typeof fetch): Promise<PlatformPost> {
  const { graphVersion: v, pageId, pageToken } = ctx.meta;
  if (!pageId || !pageToken) throw new PlatformError("NOT_CONFIGURED");
  const graph = `https://graph.facebook.com/${v}`;
  if (post.status === "PENDING") {
    const start = await call(fetcher, `${graph}/${pageId}/video_reels`, { method: "POST", body: form({ upload_phase: "start", access_token: pageToken }) });
    const videoId = String(start.video_id ?? "");
    if (!videoId) throw new PlatformError("NO_VIDEO_ID");
    await call(fetcher, `https://rupload.facebook.com/video-upload/${v}/${videoId}`, { method: "POST", headers: { Authorization: `OAuth ${pageToken}`, file_url: ctx.videoUrl } });
    await call(fetcher, `${graph}/${pageId}/video_reels`, { method: "POST",
      body: form({ upload_phase: "finish", video_id: videoId, video_state: "PUBLISHED", description: ctx.caption, access_token: pageToken }) });
    return { ...post, status: "PROCESSING", remoteId: videoId };
  }
  const id = post.remoteId!;
  const info = await call(fetcher, `${graph}/${id}?fields=status,permalink_url&access_token=${encodeURIComponent(pageToken)}`);
  const status = info.status as { video_status?: string; processing_phase?: { status?: string; error?: { message?: string } } } | undefined;
  if (status?.video_status === "error" || status?.processing_phase?.status === "error") throw new PlatformError(`PROCESSING_FAILED: ${status.processing_phase?.error?.message ?? ""}`);
  const url = typeof info.permalink_url === "string" ? (info.permalink_url.startsWith("http") ? info.permalink_url : `https://www.facebook.com${info.permalink_url}`) : post.url;
  if (status?.video_status !== "ready") return { ...post, status: "PROCESSING", url };
  if (!post.commented) await call(fetcher, `${graph}/${id}/comments`, { method: "POST", body: form({ message: ctx.comment, access_token: pageToken }) });
  return { ...post, status: "DONE", url, commented: true };
}

// ---------------------------------------------------------------- Instagram Reels (through the Page's linked IG account)

async function instagram(post: PlatformPost, ctx: PostContext, fetcher: typeof fetch): Promise<PlatformPost> {
  const { graphVersion: v, igUserId, pageToken } = ctx.meta;
  if (!igUserId || !pageToken) throw new PlatformError("NOT_CONFIGURED");
  const graph = `https://graph.facebook.com/${v}`;
  if (post.status === "PENDING") {
    const container = await call(fetcher, `${graph}/${igUserId}/media`, { method: "POST",
      body: form({ media_type: "REELS", video_url: ctx.videoUrl, caption: ctx.caption.slice(0, 2200), share_to_feed: "true", access_token: pageToken }) });
    return { ...post, status: "PROCESSING", containerId: String(container.id ?? "") || null };
  }
  if (post.status === "PROCESSING") {
    const state = await call(fetcher, `${graph}/${post.containerId}?fields=status_code,status&access_token=${encodeURIComponent(pageToken)}`);
    if (state.status_code === "ERROR" || state.status_code === "EXPIRED") throw new PlatformError(`PROCESSING_FAILED: ${String(state.status ?? state.status_code)}`);
    if (state.status_code !== "FINISHED") return post;
    const published = await call(fetcher, `${graph}/${igUserId}/media_publish`, { method: "POST", body: form({ creation_id: post.containerId!, access_token: pageToken }) });
    // Saved before the comment is tried, so a failing comment can never publish the reel twice.
    return { ...post, status: "POSTED", remoteId: String(published.id ?? "") || null };
  }
  const id = post.remoteId!;
  const link = await call(fetcher, `${graph}/${id}?fields=permalink&access_token=${encodeURIComponent(pageToken)}`).catch(() => ({} as Record<string, unknown>));
  if (!post.commented) await call(fetcher, `${graph}/${id}/comments`, { method: "POST", body: form({ message: ctx.comment, access_token: pageToken }) });
  return { ...post, status: "DONE", commented: true, url: typeof link.permalink === "string" ? link.permalink : post.url };
}

// ---------------------------------------------------------------- YouTube Shorts

async function youtubeToken(cfg: YouTubeConfig, fetcher: typeof fetch) {
  const token = await call(fetcher, "https://oauth2.googleapis.com/token", { method: "POST",
    body: form({ client_id: cfg.clientId!, client_secret: cfg.clientSecret!, refresh_token: cfg.refreshToken!, grant_type: "refresh_token" }) });
  if (typeof token.access_token !== "string") throw new PlatformError("NO_ACCESS_TOKEN");
  return token.access_token;
}

async function youtube(post: PlatformPost, ctx: PostContext, fetcher: typeof fetch): Promise<PlatformPost> {
  const cfg = ctx.youtube;
  if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) throw new PlatformError("NOT_CONFIGURED");
  const token = await youtubeToken(cfg, fetcher);
  if (post.status === "PENDING") {
    const bytes = await ctx.videoBytes();
    const init = await fetcher("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST", signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(bytes.byteLength) },
      body: JSON.stringify({
        snippet: { title: ctx.youtubeTitle.slice(0, 100), description: ctx.caption.slice(0, 4900), categoryId: "22" },
        // AI-made product footage: YouTube's altered/synthetic content disclosure is set on upload.
        status: { privacyStatus: cfg.privacy, selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
      }),
    });
    const location = init.headers.get("location");
    if (!init.ok || !location) throw new PlatformError(`UPLOAD_INIT_${init.status}: ${(await init.text()).slice(0, 200)}`);
    const uploaded = await call(fetcher, location, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4" }, body: Buffer.from(bytes) });
    const id = String(uploaded.id ?? "");
    if (!id) throw new PlatformError("NO_VIDEO_ID");
    // Saved before the comment is tried, so a failing comment can never upload the video twice.
    return { ...post, status: "POSTED", remoteId: id, url: `https://www.youtube.com/shorts/${id}` };
  }
  if (!post.commented) {
    await call(fetcher, "https://www.googleapis.com/youtube/v3/commentThreads?part=snippet", { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ snippet: { videoId: post.remoteId, topLevelComment: { snippet: { textOriginal: ctx.comment } } } }) });
  }
  return { ...post, status: "DONE", commented: true };
}

const RUNNERS: Record<SocialPlatform, (post: PlatformPost, ctx: PostContext, fetcher: typeof fetch) => Promise<PlatformPost>> = { FACEBOOK: facebook, INSTAGRAM: instagram, YOUTUBE: youtube };

/**
 * One step for one platform. A comment that fails after the video is up does not fail the post: the video stays
 * posted (status DONE, commented false) and the error says to add the link by hand.
 */
export async function advancePost(post: PlatformPost, ctx: PostContext): Promise<PlatformPost> {
  if (post.status === "DONE" || post.status === "FAILED") return post;
  const now = (ctx.now ?? new Date()).toISOString(), fetcher = ctx.fetcher ?? fetch;
  const attempts = post.attempts + 1;
  try {
    const next = await RUNNERS[post.platform](post, ctx, fetcher);
    if (next.status !== "DONE" && attempts >= MAX_TICKS) return { ...next, status: "FAILED", attempts, error: "TIMED_OUT_WAITING_FOR_PLATFORM", updatedAt: now };
    return { ...next, attempts, error: null, updatedAt: now };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "POST_FAILED";
    // The video is already up; only the comment is missing.
    if (post.remoteId && (post.status === "POSTED" || (post.status === "PROCESSING" && post.platform === "FACEBOOK" && attempts >= 3)))
      return { ...post, status: "DONE", attempts, commented: false, error: `COMMENT_FAILED: ${message}`, updatedAt: now };
    // Network blips get another tick; a refusal from the platform (4xx) is final.
    const final = /^HTTP_4\d\d|NOT_CONFIGURED|PROCESSING_FAILED|NO_VIDEO_ID|UPLOAD_INIT_4/.test(message) || attempts >= 3;
    return { ...post, status: final ? "FAILED" : post.status, attempts, error: message, updatedAt: now };
  }
}

export function postErrorLabel(error: string | null) {
  if (!error) return null;
  if (/NOT_CONFIGURED/.test(error)) return "ยังไม่ได้ตั้งค่าบัญชีแพลตฟอร์มนี้";
  if (/COMMENT_FAILED/.test(error)) return "โพสต์คลิปแล้ว แต่คอมเมนต์ลิงก์ไม่สำเร็จ ใส่ลิงก์เองในคอมเมนต์";
  if (/HTTP_401|HTTP_403|OAuth|token/i.test(error)) return "สิทธิ์/โทเคนหมดอายุหรือไม่พอ ตรวจการตั้งค่า (ดูคู่มือ)";
  if (/TIMED_OUT/.test(error)) return "แพลตฟอร์มประมวลผลนานเกินไป ตรวจในแอปว่าคลิปขึ้นหรือยัง";
  return error;
}
