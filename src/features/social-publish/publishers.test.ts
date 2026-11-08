import { describe, expect, it } from "vitest";
import { advancePost, newPost, type PostContext } from "./publishers";

function fakeApi(routes: Array<[RegExp, (url: string, init?: RequestInit) => Response]>) {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input); calls.push(`${init?.method ?? "GET"} ${url.split("?")[0]}`);
    const route = routes.find(([re]) => re.test(url));
    return route ? route[1](url, init) : new Response(JSON.stringify({ error: { message: "no route" } }), { status: 404 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const ctx = (fetcher: typeof fetch): PostContext => ({
  videoUrl: "https://storage.example/clip.mp4?token=x", videoBytes: async () => new Uint8Array([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70]),
  caption: "แคปชัน https://s.shopee.co.th/abc", comment: "🛒 ลิงก์สินค้า: https://s.shopee.co.th/abc", youtubeTitle: "ขวดน้ำ #Shorts",
  meta: { graphVersion: "v23.0", pageId: "PAGE", pageToken: "TOKEN", igUserId: "IG" },
  youtube: { clientId: "id", clientSecret: "secret", refreshToken: "refresh", privacy: "public" }, fetcher,
});

describe("social publishers", () => {
  it("Facebook: start, upload by URL, finish; comment the link once the reel is ready", async () => {
    let ready = false;
    const api = fakeApi([
      [/video_reels/, () => json({ video_id: "V1", success: true })],
      [/rupload\.facebook\.com/, () => json({ success: true })],
      [/\/V1\/comments/, () => json({ id: "C1" })],
      [/\/V1\?fields/, () => json({ status: { video_status: ready ? "ready" : "processing" }, permalink_url: "/reel/V1" })],
    ]);
    let post = await advancePost(newPost("FACEBOOK"), ctx(api.fetcher));
    expect(post).toMatchObject({ status: "PROCESSING", remoteId: "V1" });
    post = await advancePost(post, ctx(api.fetcher));
    expect(post.status).toBe("PROCESSING");
    ready = true;
    post = await advancePost(post, ctx(api.fetcher));
    expect(post).toMatchObject({ status: "DONE", commented: true, url: "https://www.facebook.com/reel/V1" });
    expect(api.calls.filter(c => c.includes("comments"))).toHaveLength(1);
  });

  it("Instagram: container → wait → publish (saved) → comment; a failed comment never republishes", async () => {
    let finished = false, commentOk = false;
    const api = fakeApi([
      [/\/IG\/media_publish/, () => json({ id: "M1" })],
      [/\/IG\/media/, () => json({ id: "K1" })],
      [/\/K1\?fields/, () => json({ status_code: finished ? "FINISHED" : "IN_PROGRESS" })],
      [/\/M1\?fields/, () => json({ permalink: "https://www.instagram.com/reel/M1/" })],
      [/\/M1\/comments/, () => commentOk ? json({ id: "C" }) : json({ error: { message: "temporarily" } }, 500)],
    ]);
    let post = await advancePost(newPost("INSTAGRAM"), ctx(api.fetcher));
    expect(post).toMatchObject({ status: "PROCESSING", containerId: "K1" });
    post = await advancePost(post, ctx(api.fetcher));
    expect(post.status).toBe("PROCESSING");
    finished = true;
    post = await advancePost(post, ctx(api.fetcher));
    expect(post).toMatchObject({ status: "POSTED", remoteId: "M1" });
    post = await advancePost(post, ctx(api.fetcher));
    expect(post).toMatchObject({ status: "DONE", commented: false });
    expect(post.error).toMatch(/COMMENT_FAILED/);
    expect(api.calls.filter(c => c.includes("media_publish"))).toHaveLength(1);
    commentOk = true;
  });

  it("YouTube: refresh token, resumable upload as a Short marked synthetic, then the link comment", async () => {
    let metadata: Record<string, unknown> = {};
    const api = fakeApi([
      [/oauth2\.googleapis\.com\/token/, () => json({ access_token: "AT" })],
      [/upload\/youtube\/v3\/videos/, (_, init) => { metadata = JSON.parse(String(init?.body)); return json({}, 200, { location: "https://upload.example/session1" }); }],
      [/upload\.example\/session1/, () => json({ id: "YT1" })],
      [/commentThreads/, () => json({ id: "T1" })],
    ]);
    let post = await advancePost(newPost("YOUTUBE"), ctx(api.fetcher));
    expect(post).toMatchObject({ status: "POSTED", remoteId: "YT1", url: "https://www.youtube.com/shorts/YT1" });
    expect(metadata).toMatchObject({ status: { containsSyntheticMedia: true, selfDeclaredMadeForKids: false } });
    post = await advancePost(post, ctx(api.fetcher));
    expect(post).toMatchObject({ status: "DONE", commented: true });
  });

  it("a platform refusal is final and recorded; missing credentials say so", async () => {
    const api = fakeApi([[/video_reels/, () => json({ error: { message: "(#200) permission" } }, 403)]]);
    const post = await advancePost(newPost("FACEBOOK"), ctx(api.fetcher));
    expect(post.status).toBe("FAILED");
    expect(post.error).toMatch(/HTTP_403/);
    const unset = await advancePost(newPost("INSTAGRAM"), { ...ctx(api.fetcher), meta: { graphVersion: "v23.0", pageId: null, pageToken: null, igUserId: null } });
    expect(unset).toMatchObject({ status: "FAILED", error: "NOT_CONFIGURED" });
  });
});
