# TikTok Publishing Foundation

Phase 7B adds a fail-closed adapter for TikTok Content Posting without enabling real publishing by default. `TIKTOK_PUBLISHING_PROVIDER=mock` is the default. The official adapter can be constructed only when `TIKTOK_PUBLISHING_PROVIDER=official` and `TIKTOK_PUBLISHING_REAL_MODE=true`; production credentials remain server-only.

## Official contracts

- Upload Draft uses `POST /v2/post/publish/inbox/video/init/` and requires `video.upload`.
- Direct Post uses `POST /v2/post/publish/video/init/` and requires `video.publish`.
- Status polling uses `POST /v2/post/publish/status/fetch/`.
- `FILE_UPLOAD` sends sequential `PUT` chunks with `Content-Length` and `Content-Range`. Videos up to 64 MiB use one chunk; larger videos use 10 MiB chunks with the remainder merged into the final chunk.
- `PULL_FROM_URL` accepts HTTPS URLs only when their exact hostname is listed in `TIKTOK_ALLOWED_PULL_HOSTS`; the same domain or prefix must be verified in TikTok Developer Portal.
- Phase 6C AIGC evidence maps only to TikTok's current `post_info.is_aigc` field. No invented provider fields are sent.
- Webhooks verify the raw request with `TikTok-Signature`, HMAC-SHA256, the app client secret, and a bounded timestamp. Duplicate deliveries are ignored by a unique event hash.

## Direct Post guards

Immediately before every Direct Post, the service checks the connection, `video.publish`, a fresh creator-info response, creator privacy and interaction options, duration, media metadata, Phase 6C compliance/originality/quality, current account health, dynamic effective publish cap, and an exact explicit-consent snapshot. An unaudited client is forced to `SELF_ONLY`.

Upload Draft requires `video.upload` and the same media, Phase 6C, capacity, and consent controls. `DRAFT_DELIVERED` means TikTok sent the creator an inbox notification; it is never represented as `PUBLISHED`.

## Safety boundary

The service never changes `AUTO`, `GROWTH`, or `AFFILIATE` mode. Growth content remains publishable without shop/cart permission when its content does not contain an Affiliate CTA. Affiliate CTA and shop claims still pass through the Phase 6C capability gate. TikTok Shop, product attachment, and paid video providers are outside Phase 7B.
