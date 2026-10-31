# Growth Learning Engine

Version: `growth-strategy-v1`. Phase 9 optimizes sustainable account growth, not sales. It consumes Phase 8 evidence and never fabricates unavailable fields.

## Growth Optimization Score

Available components are renormalized:

- follower efficiency: 25%
- engagement rate: 16%
- share rate: 14%
- comment rate: 10%
- view velocity relative to the account: 12%
- account-relative improvement: 15%
- category improvement: 8%

`sample_factor = clamp(sqrt(views / 1500), 0, 1)`

`freshness = clamp(0.5 ^ (age_hours / 168), 0.20, 1)`

`confidence = source_confidence × sample_factor × freshness × coverage × attribution_factor`

`growth_score = 50 + (raw_score - 50) × confidence`

At least three observations and confidence 0.18 are required. A single viral video is shrunk toward neutral and cannot permanently define strategy.

## Account-specific learning

Signals are weighted in this order: account `1.0`, category `0.35`, global `0.15`. The final weight also includes confidence, time decay, and sample size. A hook that wins on Account A can remain weak on Account B.

Patterns are classified as `WINNING`, `PROMISING`, `NEUTRAL`, `WEAK`, or `INSUFFICIENT_DATA`. Dimensions include category, hook, angle, opening, scene, CTA, voice/script style, template, variation, and publish timing.

## State machine

States are `NEW`, `LEARNING`, `GROWING`, `ACCELERATING`, `PLATEAU`, `COMMERCE_RECHECK`, `COMMERCE_READY`, and `COMMERCE_BLOCKED`. `COMMERCE_READY` requires authoritative Phase 7C facts: authorization, Affiliate eligibility, ecommerce, cart, and attachment permission. Follower count alone cannot produce that state.

## Integrations

- Creative Brain receives preferred category, hook, angle, CTA, experiment axis, confidence, and source evidence without changing its existing formulas.
- Product Radar remains useful for Growth content even when Shop is unavailable; commerce eligibility stays separate.
- Growth publishing requires compliance, originality, account health, cap, and consent. It does not require cart or Shop authorization.
- Outputs are advisory `NEXT_GROWTH_ACTION` values. Phase 9 does not orchestrate Auto Mode.

## Deterministic fixtures A-L

| Fixture | Expected behavior |
| --- | --- |
| A | New account returns `INSUFFICIENT_DATA`; missing follower attribution stays unknown. |
| B | Steady account receives a usable Growth score and `GROWING` behavior. |
| C | Viral reach without follower lift receives zero follower-efficiency credit. |
| D | Moderate reach with strong follower lift scores above fixture B. |
| E | The same question hook is `WINNING` for Account A and `WEAK` for Account B. |
| F | Negative account/category improvement produces plateau or reduction evidence. |
| G | A successful new category experiment earns expansion evidence without locking the account permanently. |
| H | An old winning hook decays to `INSUFFICIENT_DATA`. |
| I | Reaching the internal 1,000-follower milestone triggers `COMMERCE_RECHECK`; it does not prove eligibility. |
| J | Authoritative commerce facts permit `COMMERCE_READY` and `TRANSITION_ELIGIBLE`. |
| K | Revoked authorization keeps a follower-ready account `COMMERCE_BLOCKED` with `REAUTH_REQUIRED`. |
| L | A Growth account without Shop can publish when compliance, originality, health, cap, and consent gates pass. |

The scale fixture simulates 10 isolated accounts over 30 days and verifies a mix of `PLATEAU`, `GROWING` or `ACCELERATING`, and `COMMERCE_RECHECK` outcomes. It also verifies that no follower-only Affiliate transition occurs.
