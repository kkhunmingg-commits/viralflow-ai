# Winner Detection V1

Score version: `winner-detection-v1`.

## Account-relative components

Each normalized metric is compared with the same account's baseline:

`relative(x, baseline) = clamp(50 + 50 × (x - baseline) / max(baseline, ε), 0, 100)`

This prevents a large established account from setting an unrealistic global threshold for a small account. Available weights are renormalized when a legitimate source metric is unavailable.

Growth raw score:

`0.25 views + 0.25 engagement + 0.20 shares + 0.10 favorites + 0.10 follower gain + 0.10 category-relative performance`

Affiliate raw score:

`0.30 conversion + 0.25 GMV/1,000 views + 0.20 commission/1,000 views + 0.15 clicks + 0.10 views`

Affiliate score is `NULL` when authoritative commerce data is unavailable. Growth never uses sales as a hidden substitute.

## Confidence, sample size, and freshness

`sample_factor = clamp(sqrt(views / 1000), 0, 1)`

`freshness_factor = clamp(0.5 ^ (age_hours / 72), 0.25, 1)`

`confidence = source_confidence × sample_factor × freshness_factor`

`final_score = 50 + (raw_score - 50) × confidence`

Decision rules require at least 200 views, two hours of observation, confidence 0.20, and an available mode score:

- `SCALE`: final score ≥ 62
- `WATCH`: 38 ≤ final score < 62
- `STOP`: final score < 38
- `INSUFFICIENT_DATA`: a minimum evidence rule fails

These decisions are account-relative. Each row stores its baseline, components, explanation, version, and evidence hash. New attribution appends a new evaluation.

## Fixtures A–J

| Fixture | Expected result |
|---|---|
| A | Growth winner: strong engagement/share/follow evidence → `SCALE` |
| B | Growth underperformer → `STOP` |
| C | Affiliate winner: strong click/order/GMV/commission → `SCALE` |
| D | Traffic without commerce outcome → `STOP` |
| E | Early low-volume video → `INSUFFICIENT_DATA` |
| F | Commerce metrics unavailable → Affiliate `INSUFFICIENT_DATA` |
| G | Account B is evaluated against Account B baseline; missing favorites does not become zero |
| H | Early/weak affiliate attribution stays below scale |
| I | Delayed attributed orders append evidence and score above H |
| J | Old evidence is reduced by freshness decay and scores below A |
