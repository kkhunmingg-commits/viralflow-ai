# TikTok creator info and readiness

## Creator info contract

`TikTokCreatorService.queryCreatorInfo()` calls `POST https://open.tiktokapis.com/v2/post/publish/creator_info/query/` with a server-only bearer token. It requires `video.publish` and returns `creator_username`, `creator_nickname`, `creator_avatar_url`, `privacy_level_options`, interaction-disable flags, and `max_video_post_duration_sec`. ViralFlow validates and persists only returned values. See [Query Creator Info](https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info).

TikTok documents 20 creator-info requests per minute per user access token. ViralFlow caches success for `TIKTOK_CREATOR_CACHE_TTL_SECONDS` (default five minutes), refreshes on connect, permits a guarded manual refresh, and is ready for a future pre-Direct-Post freshness check. It does not poll.

## Readiness mapping

| Status | Meaning |
|---|---|
| `CONNECTED` | All scopes requested for that flow were granted, but no posting capability is ready. |
| `PARTIAL` | One or more requested scopes were not granted. |
| `READY_FOR_UPLOAD` | App approval and user authorization for `video.upload` exist. |
| `PRIVATE_ONLY` | Direct Post prerequisites exist, but the client is not audited. |
| `READY_FOR_DIRECT_POST` | `video.publish`, app approval, fresh creator info, and audited client status exist. |
| `REAUTH_REQUIRED` | Token is expired, invalid, or revoked. |
| `DISCONNECTED` | No active credential remains. |

Unaudited Direct Post is `PRIVATE_ONLY`. TikTok restricts unaudited clients to `SELF_ONLY`; ViralFlow does not reinterpret privacy options as public-post permission. See [Content Sharing Guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines).

`video.upload` is separate: it prepares a future flow where the creator finishes posting inside TikTok. Phase 7A calls neither upload nor publish endpoints. See [Upload Content](https://developers.tiktok.com/doc/content-posting-api-get-started-upload-content).

Creator limits are authoritative only when returned by TikTok. Missing scope, stale cache, token failure, or creator-info error prevents Direct Post readiness.
