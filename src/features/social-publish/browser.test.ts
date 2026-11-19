import { describe, expect, it } from "vitest";
import { advancePost, newPost, postErrorLabel } from "./publishers";
import { browserCaption, claimBrowserPost, CLAIM_STALE_MS, expireBrowserPosts, finishBrowserPost, PENDING_STALE_MS } from "./browser";

const t0 = new Date("2026-11-19T10:00:00Z");
const later = (ms: number) => new Date(t0.getTime() + ms);

describe("posting from the user's Chrome", () => {
  it("hands out one browser post at a time and records what Chrome reported", () => {
    const posts = [newPost("FACEBOOK", t0, "BROWSER"), newPost("YOUTUBE", t0, "BROWSER"), newPost("INSTAGRAM", t0, "API")];
    const first = claimBrowserPost(posts, later(1000))!;
    expect(first.platform).toBe("FACEBOOK");
    expect(first.posts[0]).toMatchObject({ status: "PROCESSING", attempts: 1 });
    // Facebook is still posting: YouTube waits (never two tabs for one clip).
    expect(claimBrowserPost(first.posts, later(2000))).toBeNull();
    const done = finishBrowserPost(first.posts, { platform: "FACEBOOK", ok: true, url: "https://www.facebook.com/reel/1" }, later(3000))!;
    expect(done[0]).toMatchObject({ status: "DONE", url: "https://www.facebook.com/reel/1", commented: true, error: null });
    expect(claimBrowserPost(done, later(4000))!.platform).toBe("YOUTUBE");
    // A report for a post that was not handed out changes nothing.
    expect(finishBrowserPost(done, { platform: "YOUTUBE", ok: true }, later(5000))).toBeNull();
  });

  it("keeps failures readable and drops links to other sites", () => {
    const claimed = claimBrowserPost([newPost("INSTAGRAM", t0, "BROWSER")], t0)!.posts;
    const failed = finishBrowserPost(claimed, { platform: "INSTAGRAM", ok: false, error: "LOGIN" }, later(1000))!;
    expect(failed[0]).toMatchObject({ status: "FAILED", error: "BROWSER_LOGIN" });
    expect(postErrorLabel(failed[0].error)).toMatch(/ล็อกอิน/);
    const odd = finishBrowserPost(claimed, { platform: "INSTAGRAM", ok: true, url: "https://evil.example/x" }, later(1000))!;
    expect(odd[0].url).toBeNull();
  });

  it("never posts twice: a claim that never reported fails as unknown, unclaimed posts expire after a day", () => {
    const claimed = claimBrowserPost([newPost("FACEBOOK", t0, "BROWSER"), newPost("YOUTUBE", t0, "BROWSER")], t0)!.posts;
    expect(expireBrowserPosts(claimed, later(CLAIM_STALE_MS - 1000))).toBeNull();
    const expired = expireBrowserPosts(claimed, later(CLAIM_STALE_MS + 1000))!;
    expect(expired[0]).toMatchObject({ status: "FAILED", error: "BROWSER_UNKNOWN" });
    expect(expired[1].status).toBe("PENDING");
    expect(expireBrowserPosts(expired, later(PENDING_STALE_MS + 1000))![1]).toMatchObject({ status: "FAILED", error: "BROWSER_NOT_OPEN" });
  });

  it("the server never posts a browser post itself", async () => {
    const post = newPost("FACEBOOK", t0, "BROWSER");
    const fetcher = (() => { throw new Error("must not call"); }) as unknown as typeof fetch;
    expect(await advancePost(post, { videoUrl: "", videoBytes: async () => new Uint8Array(), caption: "", comment: "", youtubeTitle: "", fetcher,
      meta: { graphVersion: "v23.0", pageId: null, pageToken: null, igUserId: null }, youtube: { clientId: null, clientSecret: null, refreshToken: null, privacy: "public" } })).toBe(post);
  });

  it("puts the product link under the caption once", () => {
    expect(browserCaption("ของดี #shopee", "🛒 พิกัด: https://s.shopee.co.th/a")).toBe("ของดี #shopee\n\n🛒 พิกัด: https://s.shopee.co.th/a");
    expect(browserCaption("ของดี https://s.shopee.co.th/a", "https://s.shopee.co.th/a")).toBe("ของดี https://s.shopee.co.th/a");
  });
});
