# Analytics Engine

Phase 8 stores observations as immutable, owner-scoped snapshots. A missing metric is `NULL`/`UNKNOWN`; it is never rewritten as zero. This distinction matters because zero orders means a measured outcome while `NULL` means the source, scope, or attribution window did not provide orders.

## Official data contracts

`TikTokAnalyticsProvider` targets TikTok Display API v2. `video.list`/`video.query` can supply video identity, publish time, duration, and view/like/comment/share totals. `favorites_count` is not part of the normal Display API contract and remains `NULL`. Account totals require `user.info.stats`; follower delta is derived only from two valid snapshots. The provider remains `APPROVAL_REQUIRED` until the app and user grants exist.

`TikTokShopAnalyticsProvider` targets Shop Analytics `202605`, including shop video and product performance. It requires seller authorization and `data.shop_analytics.public.read`. The source is T-1 rather than realtime, so `source_snapshot_at` and attribution windows are preserved. Affiliate order events arrive separately and may update a decision later. The real provider is disabled in Phase 8.

## Normalization and availability

- `engagement_rate = (likes + comments + shares) / views`
- `share_rate = shares / views`
- `favorite_rate = favorites / views`
- `click_rate = clicks / views`
- `conversion_rate = orders / clicks`
- `gmv_per_1000 = gmv × 1000 / views`
- `commission_per_1000 = commission × 1000 / views`

Every division returns `NULL` if either input is unavailable or the denominator is zero. Components with `NULL` are excluded and the remaining weights are renormalized. `availability_json` records why each field is present or absent.

## Storage and idempotency

Video, account, and product observations are unique by owner, source, identity, and source timestamp. Affiliate events are unique by owner, source, and external event ID. Replaying the same fetch therefore has no second effect. A delayed order uses a new provider event/evidence hash and produces a new winner row without editing the earlier row.

The scale envelope is 10 accounts × 150 published videos/day × 30 days = 45,000 video observations before retries. Owner-first indexes cover account/time, video/time, product/time, decisions, and signal dimensions. Candidate generation remains compatible with 200 candidates/day because the learning layer reads bounded latest evidence rather than rescoring every historical row.

## Official references

- [TikTok Display API overview](https://developers.tiktok.com/docs/en/display-api-overview)
- [TikTok video query fields](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-query)
- [TikTok scopes overview](https://developers.tiktok.com/docs/en/scopes-overview)
- [TikTok Shop video performance 202605](https://partner.tiktokshop.com/docv2/page/get-shop-video-performance-list-202605)
- [TikTok Shop Affiliate integration](https://partner.tiktokshop.com/docv2/page/affiliate-integration)
- [TikTok Shop rate limits](https://partner.tiktokshop.com/docv2/page/rate-limits)

## Security

All eight Phase 8 tables enable RLS. Authenticated clients receive owner-only `SELECT`; ingestion and learning writes require the server/admin client. Snapshots, events, scores, signals, and decisions have no browser update/delete grant. Raw credentials and access tokens are never stored in analytics tables.
