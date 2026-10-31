# TikTok OAuth foundation

Phase 7A implements TikTok Login Kit authorization and credential lifecycle only. It does not upload or publish media.

## Official contract

- Authorization: `https://www.tiktok.com/v2/auth/authorize/`
- Exchange and refresh: `POST https://open.tiktokapis.com/v2/oauth/token/`
- Revoke: `POST https://open.tiktokapis.com/v2/oauth/revoke/`
- Basic identity: `GET https://open.tiktokapis.com/v2/user/info/`

References: [Login Kit for Web](https://developers.tiktok.com/doc/login-kit-web), [User Access Token Management](https://developers.tiktok.com/doc/oauth-user-access-token-management), and [Get User Info](https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info).

`TIKTOK_CLIENT_KEY` maps to TikTok's `client_key`. `TIKTOK_CLIENT_SECRET` maps to `client_secret`. The registered `TIKTOK_REDIRECT_URI` must exactly match the redirect used for exchange.

```dotenv
SUPABASE_SECRET_KEY=sb_secret_your_server_key
TIKTOK_PROVIDER=official
TIKTOK_CLIENT_KEY=your_client_key
TIKTOK_CLIENT_SECRET=your_client_secret
TIKTOK_REDIRECT_URI=https://your-domain.example/auth/tiktok/callback
TIKTOK_TOKEN_ENCRYPTION_KEY=at-least-32-random-characters
TIKTOK_VIDEO_PUBLISH_APPROVED=false
TIKTOK_VIDEO_UPLOAD_APPROVED=false
TIKTOK_DIRECT_POST_AUDIT_STATUS=UNAUDITED
TIKTOK_CREATOR_CACHE_TTL_SECONDS=300
```

Never prefix these names with `NEXT_PUBLIC_`. Do not put real values in source control or logs.

## Scope and approval model

- `user.info.basic`: `open_id`, `union_id`, display name, and avatar.
- `video.publish`: creator info and future Direct Post authorization.
- `video.upload`: สิทธิ์สำหรับ draft upload ที่ flow Direct Post ปัจจุบันไม่ร้องขอ.

TikTok app approval and each creator's user grant are independent. `username` is persisted only when returned by `creator_info`; `follower_count` remains unchanged because it requires `user.info.stats`, which Phase 7A intentionally does not request.

## Security and lifecycle

The server generates 256-bit random OAuth state, stores only its SHA-256 hash, binds it to `owner_id`, expires it after ten minutes, and consumes it atomically. Replay, wrong-owner callbacks, and expired state fail closed. A partial unique index on `open_id` prevents one TikTok identity from being attached to multiple ViralFlow owners.

Access and refresh tokens are AES-256-GCM encrypted before persistence in `tiktok_oauth_credentials`. `anon` and `authenticated` have no privileges and no RLS policy on that table; only server code using `service_role` can access ciphertext. Tokens never enter client-facing account serialization.

Access tokens refresh within a five-minute buffer. The complete returned set replaces the prior set because TikTok may rotate refresh tokens. Invalid, expired, or revoked credentials set `REAUTH_REQUIRED`. Disconnect attempts official revoke, clears active credentials, and preserves account and content history.

`TIKTOK_PROVIDER=mock` makes no TikTok request. `/accounts/connect/tiktok` exposes deterministic scenarios. Production must switch explicitly to `official` and pass server environment validation.

OAuth status is independent from `AUTO`, `GROWTH`, and `AFFILIATE`. Missing follower threshold, ecommerce permission, or cart permission keeps effective `GROWTH`; connecting TikTok never upgrades it automatically.
