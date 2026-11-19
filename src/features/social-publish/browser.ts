import type { SocialPlatform } from "./config";
import type { PlatformPost } from "./publishers";

/**
 * Posts made by the ViralFlow Chrome extension in the user's own Chrome (19 Nov, Lucky: ordinary users cannot set up
 * Meta/Google keys in Vercel; they sign in to Facebook, Instagram and YouTube in their Chrome and the extension posts
 * for them, like a person would). The server only hands out one post at a time and records what Chrome reported.
 *
 * PENDING  → handed to a Chrome (claimed): PROCESSING with the claim time in updatedAt
 * PROCESSING → DONE / FAILED as Chrome reports. A claim that never reports back is not handed out again (it may have
 * been posted already): it fails as BROWSER_UNKNOWN so the user checks the app before posting twice.
 */
export const CLAIM_STALE_MS = 20 * 60_000;
export const PENDING_STALE_MS = 24 * 3600_000;

export const isBrowserPost = (post: PlatformPost) => post.via === "BROWSER";

/** Gives up on browser posts nobody picked up for a day, or that Chrome never finished. Returns null when nothing changed. */
export function expireBrowserPosts(posts: PlatformPost[], now = new Date()): PlatformPost[] | null {
  let changed = false;
  const next = posts.map(post => {
    if (!isBrowserPost(post)) return post;
    const age = now.getTime() - Date.parse(post.updatedAt);
    if (post.status === "PENDING" && age > PENDING_STALE_MS) { changed = true; return { ...post, status: "FAILED" as const, error: "BROWSER_NOT_OPEN", updatedAt: now.toISOString() }; }
    if (post.status === "PROCESSING" && age > CLAIM_STALE_MS) { changed = true; return { ...post, status: "FAILED" as const, error: "BROWSER_UNKNOWN", updatedAt: now.toISOString() }; }
    return post;
  });
  return changed ? next : null;
}

/** The next browser post to hand to Chrome (first pending one), already marked as claimed; null when none waits. */
export function claimBrowserPost(posts: PlatformPost[], now = new Date()) {
  const index = posts.findIndex(p => isBrowserPost(p) && p.status === "PENDING");
  // One at a time per clip: a second Chrome never starts the next platform while one is still posting.
  if (index < 0 || posts.some(p => isBrowserPost(p) && p.status === "PROCESSING")) return null;
  const claimed: PlatformPost = { ...posts[index], status: "PROCESSING", attempts: posts[index].attempts + 1, error: null, updatedAt: now.toISOString() };
  return { platform: claimed.platform, posts: posts.map((p, i) => i === index ? claimed : p) };
}

export interface BrowserResult { platform: SocialPlatform; ok: boolean; url?: string | null; error?: string | null }
/** Records what Chrome reported for a claimed post. Returns null when that post was not waiting for a report. */
export function finishBrowserPost(posts: PlatformPost[], result: BrowserResult, now = new Date()): PlatformPost[] | null {
  const index = posts.findIndex(p => isBrowserPost(p) && p.platform === result.platform && p.status === "PROCESSING");
  if (index < 0) return null;
  const url = result.url && /^https:\/\/([a-z0-9-]+\.)*(facebook\.com|instagram\.com|youtube\.com|youtu\.be)\//i.test(result.url) ? result.url.slice(0, 500) : null;
  const error = result.ok ? null : `BROWSER_${(result.error ?? "UI").replace(/^BROWSER_/, "")}`.slice(0, 300);
  // The product link goes in the caption/description (a browser cannot reliably leave the first comment).
  const done: PlatformPost = { ...posts[index], status: result.ok ? "DONE" : "FAILED", url, commented: result.ok, error, updatedAt: now.toISOString() };
  return posts.map((p, i) => i === index ? done : p);
}

/** Caption for a browser post: the clip's caption with the product link line under it. */
export function browserCaption(caption: string, comment: string) {
  return comment && !caption.includes(comment) ? `${caption.trim()}\n\n${comment.trim()}` : caption.trim();
}
