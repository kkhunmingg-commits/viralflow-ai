# Product Scoring V1

Version: `product-momentum-v1`. Currency: THB. All formulas live in
`src/features/products/scoring.ts`; provider-specific fields never enter them.
Scores are heuristics for prioritization, not sales forecasts.

## Inputs and units
Commission rate is a fraction (0.18 means 18%); amounts/prices are THB decimals.
Units sold and review count are nonnegative integers. Competition and creative
potential are optional normalized 0–1 signals; null means unknown (neutral 0.5).
Historical total sales has **zero direct weight**.

Let clamp(x) bound x to [0,1]. Intermediate output values are rounded to four
decimals when persisted. An explicit clock makes the algorithm deterministic.

## Velocity
Sort observations by captured time; exclude future rows and collapse duplicate
timestamps deterministically. A requested window is measured backward from the
latest observation, not from page-open time.

For w in {1,6,24} hours:
- Interpolate cumulative sales at the exact window boundary only between existing
  bracketing observations. Reject interpolation gaps larger than max(w,6) hours.
- If there is no baseline, fewer than two points, or the counter drops anywhere
  in the window, that window is unknown (null), never an invented zero.
- v_w = max(0, latest units - interpolated baseline) / w.
- v = weighted average with weights {1h:0.5, 6h:0.3, 24h:0.2}, renormalized over
  known windows. If all windows are unknown, v=0.
- V = 100 * clamp(log(1+v) / log(201)).

This uses absolute sales/hour. A 1→5 spike is four units, not a 400% ranking bonus.

## Acceleration
With both 1h and 6h available:
- prior = max(0, (6*v_6 - v_1)/5)
- a = clamp((v_1-prior)/(prior+10), -3, 3)
- A = 50 + 40*tanh(a), if v>0; otherwise A=0.
When either window is unknown, a=0. The +10 units/hour smoothing prevents
percentage inflation on tiny bases.

## Rating and review confidence
For review count n and rating r (missing r defaults to 3.5):
- R_conf = n/(n+50)
- Bayesian rating = (r*n + 3.5*50)/(n+50)
- R = 100*clamp((Bayesian rating-3)/2)

A 5.0 score with two reviews shrinks toward the prior; 4.8 with thousands is
much more reliable.

## Economics, price and other signals
- ratePart = clamp(commission_rate/0.20)
- amountPart = clamp(log(1+commission_amount)/log(101))
- K = 100*sqrt(ratePart*amountPart)
- economics = sqrt(clamp(commission_rate/0.10)*clamp(commission_amount/30))
- discount = clamp(1-price/original_price) only if original_price > price.
- referencePrice defaults to THB 500 and is an explicit function parameter.
- P = 100 * [0.8*exp(-abs(log(max(price,1)/max(referencePrice,1)))/1.5)
             + 0.2*clamp(discount/0.4)]
- T = 100*(1-competition)
- C = 100*creative_potential

The price reference is a documented V1 fallback in the absence of category
history. This phase does not implement Category Intelligence. Competition and
creative signals are manual/mock estimates, not verified creator statistics.

## Data confidence
Use observations within 24 hours of the latest observation:
- H = observed span in hours
- N = number of distinct timestamps
- D = max(0,last units-first units)
- age = max(0, hours between latest observation and evaluation clock)
- q = 0.30*clamp(H/24) + 0.20*clamp((N-1)/5)
      + 0.35*clamp(sqrt(D/200)) + 0.15*R_conf
- confidence = clamp(q * exp(-age/12) * resetFactor)
- resetFactor = 0.4 if a counter drop is detected, otherwise 1.
- Fewer than two observations => confidence=0.

Missing history and tiny sales samples lose weight. Stale observations decay
even when the user only reads the Radar; no background polling is required.

## Final scores (0–100)
- Momentum = clamp100((0.50*V + 0.25*A + 0.10*R + 0.15*C)
                      * (0.25+0.75*confidence))
- Base Viral Opportunity =
  clamp100((0.55*Momentum + 0.20*K + 0.10*P + 0.10*T + 0.05*C)
           * (0.20+0.80*confidence) * economics)
- Unavailable/discontinued products get zero opportunity.
- Zero commission produces zero opportunity.
- A single observation has confidence zero and no measured velocity; it cannot
  dominate solely on total units or an apparent spike.

## Trend
In order:
1. confidence <0.4 => LOW_DATA
2. a >0.25 => ACCELERATING
3. a <-0.15 => FALLING
4. a >0.05 => RISING
5. otherwise STABLE

Default ordering is opportunity descending; product UUID ascending breaks ties.
All requested sort/filter fields are handled in the service layer.

## Persistence, retries and versioning
`ingestProducts` validates normalized observations, then invokes
`ingest_product_observation` with the caller's authenticated session.
The RPC is SECURITY INVOKER: RLS remains active. A transaction lock serializes
each owner's provider/product. Product upsert and snapshot append are atomic.
A late event never overwrites newer current product facts.

Snapshot identity is owner/product/event; captured time is additionally unique.
Identical retries return the original observation. Reusing an event with changed
payload/time raises an error. Clients have no update/delete privileges on
snapshots or scores.

After each append, the service reads history through that snapshot and appends
a score with source snapshot UUID and algorithm version. The unique
owner/snapshot/version key prevents duplicate scoring. A failed score write can
be retried after the snapshot is already committed. Ingestion is atomic per
observation, not for an entire provider batch.

Persisted scores are an immutable audit at their calculation time. Radar/detail
reads recompute V1 against the same history with the current clock to apply
freshness decay without altering the audit. Both views show version, confidence,
trend and explanations; detail also shows persisted scores in source-time order.

## Deterministic fixtures
Fixtures use six points at -24,-12,-6,-2,-1,0 hours. Unit clock:
2026-09-15T00:00:00Z. Developer seed chooses an initial current-hour anchor and
persists it in normalized metadata, reusing it across retries.

| Case | Scenario | Verified behavior |
|---|---|---|
| A | 100,000+ historical sales, slowing | Below B; FALLING |
| B | 100→650, accelerating, 18% / THB90 commission | Strongest opportunity |
| C | 1→5 units | Far below B; tiny delta reduces confidence |
| D | Healthy steady seller | STABLE, below B |
| E | Previously strong, now decelerating | FALLING, below B |
| F | High commission, almost no sales | Below B despite 50% commission |
| G | Same sales as B, 0.1% / THB0.50 commission | Strong momentum but heavily penalized opportunity |
| H | 5.0 with 2 reviews | Lower rating quality/confidence than I |
| I | 4.8 with 5,000 reviews | More reliable than H |

Additional tests cover zero values, stale/future history, duplicate/out-of-order
observations, resets, deterministic explanations, invalid provider data, filters,
and disabled production adapter.

## Operational scope and limits
- MockProductProvider is functional. TikTokShopProductProvider fails explicitly
  without making network requests.
- Development seeding requires both NODE_ENV=development and
  ALLOW_DEV_MOCK_SEED=true, with an authenticated owner.
- No production auto-seeding, deployment, live TikTok APIs, or Phase 4 work.
- V1 fetches owner-scoped rows in 500-row pages before ranking, avoiding silent
  API row limits. For large production histories, incremental rollups and
  database-side ranking/pagination remain future optimization work.
- Money uses PostgreSQL decimal storage; ranking and presentation use JavaScript
  numbers, not an accounting ledger.


## Phase 3 verification evidence (15 September 2026)
- Live browser fixture order: B > I > D > E > A > H > F > C > G.
  These are relative results; current-view values decay with observation age.
- Verified 9 products, 54 immutable snapshots and 54 versioned scores. A second
  ingestion kept those counts unchanged; B remained first.
- Browser checks passed for protected access, category/commission filters,
  product details, history, explanations and score audit; no console errors.
- The temporary browser owner and its products/snapshots/scores were removed
  after logout. All five owner-scoped counts (including auth/profile) are zero.
  Source-code development fixtures remain available behind the existing gate.
- Live owner/cross-owner/anonymous RLS and immutable-history checks passed before
  cleanup. No schema or policy changes followed; unnecessary tests were not repeated.
- Security Advisor after cleanup: no findings.
- Local migration: `20260914170656_phase_3_product_radar.sql` (one file).
  Supabase history: `phase_3_product_radar`, version `20260914171647` (one entry).
  The management API assigned the remote version; the migration was not reapplied.

Precision: confidence is rounded to four decimals before score composition;
Momentum is rounded before Opportunity composition. Component signals are used
at full precision inside the formulas, then rounded for returned/persisted fields.
Log denotes the natural logarithm. `clamp100` bounds to [0,100]; the acceleration
clamp explicitly uses [-3,3]. The reset penalty examines the latest 24-hour history.
