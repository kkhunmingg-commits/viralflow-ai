# Account × Product Assignment V1

Score version: `account-product-fit-v1`. The implementation lives in
`src/features/assignments/scoring.ts` and `src/features/assignments/planner.ts`.
Every component is normalized to 0–100 and persisted with its evidence and
explanation so a recommendation can be reproduced later.

## Account-product fit

Let `P` be Product Momentum, `C` Category Momentum, `O` Category Commercial
Opportunity, `N` evidence-adjusted account/category affinity, `R` creative
potential, `K` commission quality, `L` price attractiveness, and
`A = clamp100(50 + 40*tanh(sales acceleration))`.

Growth mode prioritizes reach, trend and niche fit. Commission has no direct
weight:

`GrowthFit = 0.30P + 0.20C + 0.30N + 0.12R + 0.08A`

Affiliate mode prioritizes commercial conversion while retaining trend and
account fit:

`AffiliateFit = 0.15P + 0.20O + 0.25N + 0.22K + 0.10L + 0.08A`

Affinity evidence is shrunk toward neutral before use:

`N = 100 * (0.5 + affinityConfidence * (affinity - 0.5))`

## Final Viral Opportunity

Product and category confidence are combined geometrically:

`Q = sqrt(productConfidence * categoryConfidence)`

Freshness uses the older effective signal, with a 24-hour product decay and a
48-hour category decay:

`F = min(exp(-productAgeHours/24), exp(-categoryAgeHours/48))`

Let product competition and category saturation be normalized to 0–1. The
competition penalty is 0.15 in Growth and 0.20 in Affiliate:

`Headroom = 1 - modeCompetitionWeight*competition - 0.15*saturation`

`FinalViralOpportunity = Fit * (0.25 + 0.75Q) * (0.35 + 0.65F) * Headroom`

The result is clamped to 0–100. Eligible low-history pairs (`LOW_DATA` or
combined confidence below 0.40) are capped at 35. Ineligible pairs receive 0.
This keeps uncertainty and stale observations from presenting as strong daily
recommendations while preserving an auditable score.

## Eligibility blockers

A pair is blocked when owner IDs differ, the account is inactive, required
authorization is missing, the product is unavailable, product evidence is older
than 48 hours or below 0.20 confidence, or active category evidence is absent,
older than 72 hours, or below 0.20 confidence. Future-dated evidence is stale.
Affiliate mode also requires at least 1,000 followers, e-commerce permission,
and an enabled cart. Growth does not require Affiliate commerce eligibility.

## Diversification and daily planner

`buildDailyAssignments` scores every account-product pair, then applies one
deterministic global ordering: Final Viral Opportunity descending, account ID,
then product ID. It respects each account's daily target and hard limit,
published posts, existing `SELECTED`/`USED`/`SKIPPED` decisions, and a default
limit of two products from one category per account.

The global winner receives a shared top product first. Other accounts receive
their next-best unused product. One product may be assigned to at most two
accounts, and same-day sharing is allowed only when the score advantage over an
available alternative is at least 15 points. The persisted reason records the
policy decision. Dates use `Asia/Bangkok`.

## Persistence and idempotency

- `account_product_scores` is append-only evidence. A unique
  `(owner_id, run_id, tiktok_account_id, product_id)` key makes an exact
  transport retry a no-op for scores. An intentional new planning run has a new
  `run_id` and creates a new immutable score history.
- `product_assignments` has one row per
  `(owner_id, tiktok_account_id, product_id, assignment_date)`. Candidate rows
  are refreshed with the new score and rank; protected user decisions are not
  overwritten.
- `save_daily_assignments` authenticates the owner, takes an owner/day advisory
  transaction lock, inserts score evidence with `ON CONFLICT DO NOTHING`, and
  upserts the active daily plan atomically.
- Repeating the exact saved payload kept 21 score rows and 6 assignment rows.
  A deliberate second same-day planning run produced 42 score-history rows in
  two runs while retaining 6 active assignments and zero duplicate
  account-product-day rows.

## Deterministic fixtures P1–P7

| Account | Mode | Ranking by Final Viral Opportunity |
|---|---|---|
| A | Growth | P1 80.2287, P2 77.5799, P4 53.2212, P5 51.5224, P6 51.2720, P3 46.6980, P7 0 |
| B | Affiliate | P3 78.6428, P5 59.7818, P4 59.1951, P6 49.7695, P2 41.3188, P1 36.2143, P7 0 |
| C | Affiliate | P5 78.5373, P3 59.8872, P6 49.7695, P2 41.3188, P4 40.8072, P1 36.2143, P7 0 |

P1 and P2 prove that Growth Account A favors Beauty momentum and affinity. P3
beats P4 for Affiliate Account B because commercial quality matters more than
raw momentum. P5 leads for Affiliate Account C. P6 demonstrates that high raw
momentum cannot overcome poor account/category affinity. P7 is a one-snapshot
low-data spike and is blocked for every account.

The diversification fixture assigns a shared best product to Account A, the
strongest-fit account, and gives the other accounts distinct alternatives. With
sharing explicitly enabled and a zero score-gap threshold, the same product is
assigned to two accounts and the policy reason is recorded.

## Verification evidence

- The migration passed rollback validation, was applied once to `viralflow-ai`,
  and RLS accepts owner operations while denying anonymous, cross-owner, and
  forged owner/account/product writes. Score history cannot be updated/deleted.
- `/recommendations`, account recommendations, Product Radar signals,
  explanations, and account/mode/category/min-score filters passed browser
  verification without console errors or warnings.
- The first browser save persisted 21 pair scores and 6 assignments with the
  expected A/B/C ranking. Retry and deliberate re-run behavior match the rules
  above.
- The temporary Phase 5A owner and all cascading verification rows were removed.
  Source-controlled deterministic fixtures remain.

## Scope boundary

Phase 5A ends with recommendation scoring and daily assignment persistence.
Creative generation and Phase 5B have not started.
