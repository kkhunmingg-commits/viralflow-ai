# Product clips from a Shopee / Lazada link

Tab: **สร้างคลิป › คลิปสินค้าจากลิงก์** (`/product-clips`).

1. Paste a Shopee or Lazada product link (affiliate short links such as `https://s.shopee.co.th/…` work; the link is kept exactly as pasted so the affiliate tracking stays).
2. The server tries to read the product page (title, photos, description). Shopee and Lazada usually block servers; then the clip waits and the owner's Flow worker opens the link in its own Chrome profile (`workspace/profiles/_shop`), captures Shopee's product data / the page's JSON-LD and Open Graph tags, downloads up to 4 listing photos, and sends them to `/api/flow-worker/product-lookup` (`readShopPage` in `workers/flow-browser/farm-driver.mjs`, parsed by `src/features/product-links/browser-lookup.ts`). The script and takes then follow by themselves. Shopee shows a sign-in / traffic check to signed-out visitors: the worker then opens a visible Chrome window on that profile once so the owner can sign in to Shopee, and reads the page again after the window is closed. A hand-checked form (pick photos, edit facts) stays available under "อยากเลือกรูปหรือแก้ข้อมูลเองก่อนสร้าง". Later the Affiliate Open API can answer instead (`affiliateApiSource` in `src/features/product-links/source.ts`); nothing else changes.
3. Pick **8 s** (1 take), **16 s** (2 takes: open → close + link), **24 s** (3: open → detail macro → close), **32 s** (4: open → detail → use angle → close) or **40 s** (5: adds a wider shot of the other side). Run `supabase/migrations/20261110020000_product_clip_lengths.sql` once for 24 / 40.
4. The script writer (`src/features/product-links/script.ts`) only repeats facts the owner kept from the product page. It drops superlatives / rankings / "best seller" / 100 %, prices and promotions (they change; viewers are sent to the link), and result or effect claims for beauty, supplements, food, baby and pet products. Supplements never get a spoken benefit. The final text also goes through the existing claim checks (`checkProductTruth`, `claimIssues`).
5. Every take shares one set, light, palette and pair of hands (continuity), while the framing, the hand action and the listing photo used as Flow's reference change take to take, so the product is seen from different sides. Takes are made by the same free Google Flow queue (`flow_clips` kind `PRODUCT_SHOT`).
6. The server cuts the takes into one 720×1280 MP4 with Thai subtitles, a small "สร้างด้วย AI" label and a "ลิงก์สินค้าอยู่ในคอมเมนต์" end card (`flow_clips` kind `PRODUCT_CLIP`). It waits in **คลิปรอตรวจ**; nothing is posted before the owner presses **ผ่าน · โพสต์**.
7. After approval the clip is posted to the chosen platforms that are set up, the caption carries the link, and the link is posted as the first comment. TikTok stays manual (share from phone / draft) because its API cannot attach a product basket.

A failed or skipped take is made again automatically (up to 3 tries; "out of credits" waits for tomorrow's credits without counting). The queue moves on every minute from the Flow worker's poll and whenever the tab is opened.

## Database

Run `supabase/migrations/20261108160000_product_link_clips.sql` once in the Supabase SQL Editor (adds the `PRODUCT_SHOT` / `PRODUCT_CLIP` kinds and the `product_link_clips` table). Until then the tab shows a notice.

## Credentials for automatic posting (Vercel → Project → Settings → Environment Variables, Production)

| Variable | What it is |
| --- | --- |
| `META_PAGE_ID` | The Facebook Page that posts the Reels |
| `META_PAGE_ACCESS_TOKEN` | A **long-lived Page access token** for that Page (also used for Instagram) |
| `META_IG_USER_ID` | The Instagram professional account id linked to that Page |
| `META_GRAPH_VERSION` | Optional, default `v23.0` |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` | OAuth client (type "Web application") from Google Cloud |
| `YOUTUBE_REFRESH_TOKEN` | Refresh token for the channel, scopes `youtube.upload` and `youtube.force-ssl` |
| `YOUTUBE_PRIVACY` | Optional: `public` (default), `unlisted` or `private` |
| `SOCIAL_PUBLISH_OWNER_IDS` | Optional; the web account(s) allowed to post. Defaults to `FLOW_WORKER_OWNER_ID` |

Each platform switches on by itself once its variables are set (redeploy after adding them).

### Meta (Facebook Page Reels + Instagram Reels)

1. Instagram account must be **Professional (Business or Creator)** and linked to the Facebook Page.
2. developers.facebook.com → Create app → type **Business**. Add the products **Facebook Login for Business** and **Instagram (Instagram API with Facebook Login)**.
3. Permissions: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_engagement` (comment), `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `business_management`.
4. While the app is in Development mode it works for accounts that have a role on the app (Lucky's own Page and IG). Advanced Access / App Review is only needed for other people's accounts.
5. Graph API Explorer → choose the app → get a User token with those permissions → exchange it for a long-lived user token → `GET /me/accounts` returns the Page's `access_token` (long-lived Page token) and `id` (`META_PAGE_ID`). Or use a System User token from Business Settings (does not expire).
6. `GET /{page-id}?fields=instagram_business_account` → `META_IG_USER_ID`.

### YouTube Shorts

1. console.cloud.google.com → new project → enable **YouTube Data API v3**.
2. OAuth consent screen: External, add Lucky's Google account as a test user. Scopes `https://www.googleapis.com/auth/youtube.upload` and `https://www.googleapis.com/auth/youtube.force-ssl`.
3. Credentials → OAuth client ID (Web application), redirect URI `https://developers.google.com/oauthplayground`.
4. developers.google.com/oauthplayground → gear → "Use your own OAuth credentials" → authorize the two scopes with the channel's Google account → exchange → copy the **refresh token**.
5. Note: an unverified Google app's uploads are locked to **private** until the app passes Google's API audit (the "YouTube API Services – Audit and Quota Extension" form). Publishing the consent screen to Production also stops the refresh token expiring after 7 days. Daily quota: 10,000 units; one upload costs about 1,600, a comment 50 (≈6 Shorts/day before an increase).

Uploads are marked `containsSyntheticMedia: true` (YouTube's AI disclosure). Captions carry "สร้างด้วย AI" and the affiliate disclosure on every platform.

## Shopee / Lazada affiliate API (later)

When the Shopee Affiliate Open API opens (needs 1,000 sales) or Lazada's Affiliate API is approved, implement `affiliateApiSource.lookup` to return `ProductDetails` from the API (title, images, product URL, the generated offer link) and set `source: "AFFILIATE_API"`. The form, script, review and posting stay the same.
