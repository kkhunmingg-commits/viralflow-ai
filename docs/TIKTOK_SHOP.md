# TikTok Shop foundation

Phase 7C is a mock-first foundation. It does not call TikTok Shop, attach a product, or create a shoppable post. The real provider fails closed until Partner Center approval, app configuration, creator authorization, required scopes, and the explicit real-mode flag are all present.

## Verified official contract

The contract was checked against current TikTok Shop Partner Center documentation on 18 September 2026. Endpoint reference pages remain authoritative for the exact version and market.

| Capability | Official status | ViralFlow status |
|---|---|---|
| Creator authorization and creator token | Available to approved apps; separate from seller authorization and TikTok Login | `APPROVAL_REQUIRED` |
| Get Creator Profile / affiliate creator information | Listed under Affiliate Information | `APPROVAL_REQUIRED` |
| Creator Search Open Collaboration Product | Official `creator.affiliate_collaboration.read` API; same-region search only | `APPROVAL_REQUIRED` |
| Seller product list/detail and product status webhooks | Available through authorized seller Product APIs | `APPROVAL_REQUIRED` |
| Get Shop Products, Check Anchor Content, Check Anchor Prerequisites | Listed under Affiliate Information | `APPROVAL_REQUIRED`; no guessed endpoint implemented |
| Showcase and affiliate collaboration operations | Creator/seller authorization plus approved scopes required | `APPROVAL_REQUIRED` |
| Real product attachment to a publishing request | No Phase 7C implementation; exact approved posting contract must be confirmed before use | `NOT_AVAILABLE` in ViralFlow |
| Development Shop and API Testing Tool | Available; creator test accounts are beta-managed through the App Store Manager | Owner setup required |
| Webhooks | Supported for configured event topics with signature verification and retry handling | Deferred until real integration |

Affiliate API access is inactive by default. TikTok requires an Affiliate app/category application and Account Manager or Partner Manager approval. Authorization success is not enough: each feature must check the token's current `granted_scopes`, and creator and seller tokens cannot be interchanged.

Official references:

- [Affiliate integration](https://partner.tiktokshop.com/docv2/page/affiliate-integration)
- [Creator authorization guide](https://partner.tiktokshop.com/docv2/page/creator-authorization-guide)
- [Creator Search Open Collaboration Product](https://partner.tiktokshop.com/docv2/page/creator-search-open-collaboration-product-202405)
- [Products API overview](https://partner.tiktokshop.com/docv2/page/products-api-overview)
- [Regions and languages](https://partner.tiktokshop.com/docv2/page/regions-and-languages)
- [Test your app](https://partner.tiktokshop.com/docv2/page/test-your-app)
- [Rate limits](https://partner.tiktokshop.com/docv2/page/rate-limits)

## Authorization and regions

TikTok Login from Phase 7A proves a TikTok identity and Content Posting scopes. It does not grant TikTok Shop creator or seller access. Shop creator authorization uses its own OAuth-based flow, credentials, scopes, expiration, reauthorization, and deauthorization lifecycle. The database therefore stores Shop connection state separately from the account's Login Kit connection.

Thailand is listed as region `TH` with locale `th-TH`, and Thailand is included in the creator authorization country list. Product discovery is still region-bound: an affiliate creator may search open collaboration products only in the region in which that creator is registered. Market availability does not waive app approval, creator eligibility, collaboration, product audit, or attachment permission checks.

TikTok documents dynamic rate limiting rather than one universal QPS. A future adapter must honor each endpoint's current reference, react to throttling with bounded exponential backoff, and never convert an unknown response into readiness.

## Provider and data boundary

`TikTokShopProvider` normalizes authorization, creator commerce profile, product discovery, product detail, eligibility, attachment permission, and shoppable intent creation. `MockTikTokShopProvider` supplies deterministic verification data. `TikTokShopApprovalRequiredProvider` throws `tiktok_shop_api_approval_required` for every operation, so an unapproved real integration cannot silently fall back to fabricated capability.

The seven owner-scoped tables store sanitized connection metadata, commerce facts, normalized products, immutable product snapshots, account-product permission, immutable eligibility evidence, and metadata-only shoppable intent. Browser roles can read only their owner's rows. Server code performs synchronization and writes. Shop access/refresh tokens are not stored in these tables; a future adapter must reuse the Phase 7A AES-GCM server-only credential pattern. App and shop secrets stay in server environment variables and never reach client bundles.

## Real integration gate

Before enabling `TIKTOK_SHOP_PROVIDER=official`, the owner must obtain Affiliate API approval, configure the exact current scopes and callback, authorize each creator or seller identity as required, validate `granted_scopes`, configure encrypted token storage and refresh, verify Development Shop behavior, register signed webhooks, and complete a separately reviewed real attachment implementation. `TIKTOK_SHOP_REAL_MODE=true` is an additional deliberate gate; it is not proof of approval.

