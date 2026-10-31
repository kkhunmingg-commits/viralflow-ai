# Affiliate commerce behavior

Phase 7C separates content opportunity from commerce permission. A product can be valuable content while remaining impossible to attach. Product Momentum and account-product scoring formulas are unchanged.

## Mode resolution

`GROWTH` always remains `GROWTH`. `AUTO` and requested `AFFILIATE` become effective `AFFILIATE` only when every authoritative fact is true:

1. followers meet the configured internal threshold;
2. the account is an eligible TikTok Shop creator;
3. Shop creator authorization is current;
4. affiliate and ecommerce permissions are present;
5. cart and product attachment capabilities are present.

Otherwise the effective business mode is `GROWTH`. A follower count alone never creates Affiliate readiness. Revoked authorization produces `REAUTH_REQUIRED` and cannot be treated as a cached success.

The internal 1,000-follower check preserves the existing ViralFlow rule but is not a claim that a Thailand account qualifies for TikTok Shop Affiliate. Current official documentation describes a 5,000-follower rule for UK/SEA. Production eligibility must come from the current Shop creator capability for that account and market, so a stricter platform threshold automatically keeps the account in Growth.

Growth accounts may publish normal content and use follow, save, comment, share, and other engagement calls to action. Missing Shop access does not block Growth content or reduce a good content opportunity to zero. Product attachment, affiliate-only claims, cart calls to action, and fake shop claims remain blocked.

## Account-product decision

The evaluator records these facts independently:

- `content_fit`: the existing Radar/Assignment content decision;
- `account_ready`: current creator commerce readiness;
- `product_eligible`: active, approved product in an open or targeted collaboration;
- `region_match`: creator and product regions match;
- `attachment_allowed`: current account-product permission explicitly allows attachment;
- `commerce_eligible`: all commerce gates pass together.

Affiliate scoring uses existing commerce requirements as a hard gate. Growth scoring stays based on content signals and is not rewritten. Blocker reasons remain attached to each immutable evaluation so `CONTENT_ONLY` cannot be confused with `ELIGIBLE`.

## Product truth and shoppable intent

Before a shoppable intent can be ready for review, ViralFlow compares the Radar product with the Shop source for identity/title, current and original price, discount representation, active seller and product status, audit status, and claimed features. A mismatch yields `REJECT`.

The resulting `shoppable_content_intents` row is metadata only. It identifies the account, normalized Shop product, publishing queue item, truth result, eligibility evidence, region, price, and blocker set. Its metadata explicitly records `attachmentPerformed: false`. Phase 7C does not tag a product on TikTok and the publishing service rejects a linked intent unless it remains `READY_FOR_REVIEW` with product truth `PASS`.

## Deterministic states

| Fixture | Expected behavior |
|---|---|
| A — Growth below threshold | `GROWTH`, normal content allowed, no attachment |
| B — follower-ready without commerce | `FOLLOWER_READY_NO_COMMERCE`, effective `GROWTH` |
| C — authorized/ecommerce but no cart | `COMMERCE_BLOCKED`, effective `GROWTH` |
| D — fully ready | `AFFILIATE_READY`, eligible products may produce intent metadata |
| E — unavailable product | commerce blocked |
| F — product not allowed | commerce blocked with permission reason |
| G — region mismatch | commerce blocked |
| H — eligible product | eligible only for a ready account with attachment permission |
| I — revoked Shop authorization | `REAUTH_REQUIRED` |

The scale fixture uses ten accounts: four Growth, three follower-ready but commerce-blocked, and three Affiliate-ready. All ten keep content opportunities; only the three ready accounts can receive attachable products. There is no readiness inference or bypass.

## Growth learning roadmap

The future path is: Growth content optimizes follower gain, the account reaches the relevant threshold, ViralFlow re-checks actual current commerce permissions, and only a truly eligible account enters Affiliate mode. Phase 7C stores the readiness boundary but does not build Analytics or the Growth Learning Engine.
