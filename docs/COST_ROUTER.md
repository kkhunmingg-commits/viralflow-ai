# Cost Router V1

`CostRouter` selects the lowest-cost allowed strategy that can satisfy the requested quality. Phase 6 executes only local/template rendering; future provider branches are represented but disabled.

## Decision order

1. `REUSE_MASTER` when a compatible approved master exists: estimated marginal cost $0.
2. `LOCAL_TEMPLATE` when usable product assets exist: estimated provider cost $0.
3. `FREE_CREDIT` when a configured legitimate credit is available: estimated provider cost $0.
4. `AI_IMAGE_TO_VIDEO` only when a low-cost provider is available, paid calls are explicitly enabled, and the $0.04 estimate fits every budget.
5. `PREMIUM_AI_VIDEO` only for a quality requirement of at least 95, explicit paid enablement, provider availability, and a $0.35 estimate within every budget.

If no paid option is allowed, routing returns the local deterministic fallback. It never attempts to bypass provider limits or quotas.

## Budget gates

Each account stores:

- `max_cost_per_video_usd`
- `daily_video_budget_usd`
- `monthly_video_budget_usd`

A paid estimate is blocked when any expression is true:

```text
Estimate > MaxCostPerVideo
SpentToday + Estimate > DailyBudget
SpentMonth + Estimate > MonthlyBudget
```

Zero-cost reuse and local operations remain available after a paid budget is exhausted. Defaults are zero, so paid routing starts disabled. Recorded `generation_costs` rows provide cost per job; joins to master/variation, product, and account provide cost per output, product, account, and day.

## Audit rules

Every executed render records provider, model, quantity, unit, unit rate, total USD cost, and generation job. Phase 6 records `local-ffmpeg / ffmpeg-template-v1`, one `RENDER`, and `$0.000000`. Ledger rows are owner-isolated, insert/select-only for authenticated clients, and unique by owner, job, provider, model, and unit. Retrying an already completed output does not add a cost line.

## Future providers

The reserved low-cost, TikTok Symphony, and premium adapters fail closed and cannot call an external provider. Enabling one later requires explicit configuration, paid-call authorization, a real cost estimate, budget checks before the request, provider response auditing, quality evaluation after the request, and fallback to an allowed cheaper strategy. Phase 6 makes no paid request and purchases no credit.
