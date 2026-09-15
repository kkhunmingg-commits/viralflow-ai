# Category Intelligence V1

Version: `category-momentum-v1`. The implementation is in
`src/features/categories/scoring.ts`. Category totals are never used directly
as a ranking shortcut; the model favors current breadth, velocity and evidence.

## Robust category aggregation

At one evaluation timestamp, group each owner's products by `category_key` and
use each product's current `product-momentum-v1` score and history. Future rows
are already excluded by Product Radar. Let `clamp(x)` bound a value to [0,1].
Returned and persisted values are rounded to four decimals.

- Momentum center `M = 0.60 * median(product momentum) + 0.40 * p75(product momentum)`.
- Category velocity uses the mean of per-product velocity after each value is
  capped at `max(10, 2 * p75(velocity))`. This winsorization prevents one giant
  product from controlling a category.
- Category acceleration is the median product acceleration.
- `acceleratingShare = accelerating products / products`.
- `risingShare = (ACCELERATING + RISING products) / products`.
- Breadth `B = 100 * (0.70 * acceleratingShare + 0.30 * risingShare)`.
- Velocity component `V = 100 * clamp(log(1 + robustVelocity) / log(101))`.
- Acceleration component `A = 50 + 40 * tanh(medianAcceleration)`.
- Creative component `C` is the mean normalized product creative score.
- Data confidence `Q = mean(product data confidence) * n/(n+3)`.

The `n/(n+3)` factor shrinks categories with little history. A one-product
category cannot be HOT even if that product is viral.

## CategoryMomentumScore

`CategoryMomentum = 100 * clamp((0.30*M + 0.25*B + 0.15*V + 0.15*A + 0.15*C) / 100 * (0.25 + 0.75*Q))`

Median, upper quartile and breadth together carry 55% before confidence. Total
historical sales has no direct weight. The aggregate stores a 24-hour sales
delta for explanation and auditing only.

## Saturation

Let `density = n/(n+12)`, `competition` be the mean product competition proxy,
`highVelocity = clamp(log(1+robustVelocity)/log(101))`, and
`slowing = highVelocity * clamp(-medianAcceleration)`.

`Saturation = clamp(0.35*density + 0.30*competition + 0.20*slowing + 0.15*(1-creative))`

The proxy therefore rises with product crowding, provider competition, strong
volume that is slowing, and limited creative headroom. Provider-specific creator
metrics can replace or enrich competition later without changing the interface.

## Commercial opportunity

- Product commercial quality is the category mean of
  `100 * sqrt(product commission score/100 * product base opportunity/100)`.
- Price component is mean Product V1 price attractiveness.
- Conversion proxy is the mean of
  `100 * sqrt(product Bayesian rating score/100 * review confidence)`.
- Competition headroom `K = 100 * (1 - competition)`.

`CommercialOpportunity = 100 * clamp((0.40*CategoryMomentum + 0.25*commercialQuality + 0.10*price + 0.10*conversionProxy + 0.10*K + 0.05*B) / 100 * (0.20 + 0.80*Q) * (1 - 0.25*Saturation))`

This score remains separate from momentum so a trend with poor affiliate
economics can still be useful to Growth accounts without topping Affiliate Mode.

## State thresholds

Rules run in this order:

1. `product_count < 3` or `Q < 0.35` → `LOW_DATA`.
2. saturation ≥ 0.68 and (acceleration < -0.10 or breadth < 0.30) → `SATURATED`.
3. momentum ≥ 60, acceleration > 0.15 and breadth ≥ 0.50 → `HOT`.
4. momentum ≥ 50, acceleration > 0.03 and breadth ≥ 0.35 → `RISING`.
5. acceleration < -0.12 or falling share ≥ 0.50 → `FALLING`.
6. Otherwise → `STABLE`.

## Account affinity

Affinity is calculated independently for each account/category. For `n` samples
and `views`, confidence is `n/(n+12) * views/(views+5000)`.

Growth raw affinity:

`G = 0.45*clamp(engagementRate/0.12) + 0.55*clamp(followConversion/0.02)`

Affiliate raw affinity:

`F = 0.20*clamp(CTR/0.08) + 0.35*clamp(orderConversion/0.08) + 0.30*clamp(commissionPer1000Views/120) + 0.15*clamp(GMVPerOrder/800)`

Final `affinity = 0.5 + confidence * (rawAffinity - 0.5)`. Low samples shrink
toward neutral 0.5, so one lucky video cannot permanently dominate.

## Account/category fit

Growth base is `0.75*CategoryMomentum + 0.25*CommercialOpportunity`.
Affiliate base is `0.15*CategoryMomentum + 0.85*CommercialOpportunity`.

Let `adjustedAffinity = 0.5 + affinityConfidence*(affinity-0.5)`.

`Fit = clamp100(base * (0.20 + 1.60*adjustedAffinity) * (0.50 + 0.50*categoryConfidence))`

Fit confidence is `sqrt(affinityConfidence * categoryConfidence)`.

## Deterministic fixtures

| Fixture | Scenario | Momentum | Commercial | State |
|---|---|---:|---:|---|
| A | One giant + 20 weak products | 17.5705 | 24.0176 | STABLE |
| B | 12 accelerating mid-size products | 67.2427 | 51.4573 | HOT |
| C | High-volume, slowing and crowded | 32.0398 | 28.9228 | SATURATED |
| D | One strong product only | 38.5514 | 24.4506 | LOW_DATA |
| E | Strong trend, poor affiliate economics | 64.0397 | 36.4890 | HOT |
| F | Moderate trend, excellent economics | 41.1403 | 45.6900 | STABLE |

Momentum order is B > E > F > D > C > A. B beats A because breadth and robust
statistics outweigh one outlier. F beats E commercially despite lower momentum.

Account fixtures verify: Growth Account A selects Beauty (76.2141 fit versus
30.9190 for Home); Affiliate Account B selects Home (72.9524 versus 21.6312 for
low-affinity Gadgets); Affiliate Account C selects Gadgets (60.0190 versus
26.2925 for low-affinity Home). A single lucky affiliate sample returns only
0.5007 affinity at 0.0015 confidence.

## Scope

All reads and writes remain owner-scoped by RLS. Category snapshots and scores
are append-only audit records. Phase 4 uses development/mock observations and
pluggable competition proxies. It does not connect TikTok production APIs,
deploy production, or implement Creative Brain.

## Verification evidence

- The Phase 4 migration is present and applied once.
- Live RLS accepts owner reads/writes and rejects cross-owner and anonymous access;
  category snapshot and score history cannot be updated or deleted.
- `/categories`, `/categories/[id]`, filter/sort controls, account creation, and
  Product Radar category signals passed browser verification with no console
  errors or app warnings.
- The temporary verification owner and every cascading account, product,
  snapshot, score, affinity, and category row were removed after verification.
