# Zero-cost readiness audit — 2026-10-12

Baseline: `ece5439174b7d5aaa971c64fe25d3b6ce681d94a`. Development branch: `codex/google-vids-fal-router`.

## Necessary fixes

1. The old one-minute setting was only an init-rate floor. Independent jitter could bunch neighbouring slots. Planning now requires at least half the account's measured cadence interval as well as its configured minimum. The transactional send gate also checks the current account window and cadence-derived spacing against reservations and legacy sends for the same TikTok creator. This prevents overdue queues/midnight/replanning from bypassing spacing. No fixed daily clip or account ceiling was introduced. Official init limit is six requests/token/minute; posting capacity and creator health remain separate constraints.
2. Unlabelled `account_daily_stats` were not trustworthy production frequency evidence. The new projection uses owned, non-mock account `TIKTOK_DISPLAY` observations only, with positive confidence, known publication time, maturation, freshness and latest-per-post deduplication. MOCK, future and stale observations are excluded. At least three independent observed days are required; this is an evidence threshold, not a quota. Accounts with insufficient evidence remain in preparation/waiting mode, with zero automatic generation/publication. Existing manual content preparation/review remains available; no fabricated cold-start history is inserted.
3. The planner no longer treats a default effective health cap as a known TikTok cap when `observed_platform_cap` is absent. Unknown permission/capacity blocks automatic publishing. Produced/published day counts now follow the account timezone. Financial ledger days remain UTC, consistently with the existing budget ledger.
4. Reviewed inventory already in the publishing queue now satisfies demand instead of triggering replacement purchases. Published videos are excluded. No consent or default privacy is manufactured.

Migration `20261012082042_multi_account_readiness_guards.sql` is additive and tested locally only. It preserves existing records and SAFE runtime settings. Private helper execution is service-only; new public RPCs are revoked from anon/authenticated. It has **not** been applied to Production.

## Proof and limits

- Run `pnpm exec tsx scripts/verify-multi-account-sql.mjs --simulate-day`. PGlite executes the actual SQL migration/claim/finish/RLS functions. A test-only virtual clock replaces SQL `now()` inside this isolated process; it is not deployed or exposed as an application API.
- Dynamic SQL proof: 1/3/10/20/50 accounts with differing recommendations, 247 tasks, duplicate prevention, per-account leases, CAS fencing, owner/cross-owner/anon/private-column authorization, audited/unaudited creator limits, windows, spacing, unknown caps and source filtering. Vitest additionally checks 73 accounts, 1,251-row pagination and resource backpressure. These are examples, never architecture ceilings.
- 24 virtual hours: three fixture accounts with different cadences 2/5/9, 16 tasks. Actual Product Radar scoring, Assignment planner, local MockAIProvider, compliance/eligibility functions and isolated publishing queue persistence are exercised. VIDEO/QUALITY are explicitly mock boundaries. Fifteen reach REVIEW_REQUIRED queue rows without consent; one persistent provider failure parks under bounded retries. Network failure, expired lease/restart and empty final work queue are verified.
- This is a local integration proof, **not** certification of 24-hour host uptime, real generated-video quality, three real accounts' eligibility, cloud multi-connection throughput, paid generation or TikTok publication. One PGlite connection serializes SQL. The worker entry point has bounded network retry/backoff and requires an independently supervised host for continuous operation. No supervisor was activated.
- Existing provider/budget isolated SQL proof remains passing. SAFE worker ports short-circuit before database/provider/TikTok I/O. Paid API calls = 0; TikTok posting/upload calls = 0.

## Provider findings

### Google Vids Omni

The existing adapter explicitly has `automated=false`, rejects automatic submit with `GOOGLE_VIDS_ASSISTED_ONLY`, prepares a brief and imports a user-created MP4. Its status is owner-reported; actual quota and throughput are unknown. Thus the current integration is **Assisted**, not unattended automatic video generation. Google's Gemini API has official video generation documentation, but that does not establish authorized API access to a user's Google Vids subscription quota. No private Vids endpoint, browser scraping or paid API was used or added.

Official references checked:
- https://workspace.google.com/blog/product-announcements/introducing-gemini-omni-flash-in-google-vids
- https://ai.google.dev/gemini-api/docs/video

### fal.ai Billing

Read-only existing key: pricing HTTP 200 for all three configured models; billing-events HTTP 403. Billing endpoint requires **all** `billing:usage:read`, `auth:keys:read`, `account:users:read`; documented presets include BILLING/FULL. A 403 establishes insufficient endpoint permissions, not a funding shortfall, and does not identify which subset is missing. No key was changed or enumerated. Actual receipts/costs remain unknown and budget holds remain conservative; catalog prices are not actual billing results. Secrets stayed in memory and are absent from artifacts.

Official references:
- https://fal.ai/docs/platform-apis/v1/models/billing-events
- https://fal.ai/docs/api-reference/platform-apis/authentication
- https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post
- https://developers.tiktok.com/docs/en/content-sharing-guidelines

## Before real activation

**Code/runtime validation:** apply prepared migrations only after separate authorization and full-schema compatibility validation; configure an existing/free supervised worker host; validate real media and provider throughput with an explicitly approved test budget. All remain outside this zero-cost audit. No new infrastructure is required by the architecture.

**Account/provider permissions or inputs:** real account history and safe creative inventory; official analytics access (current ingestion needs `video.list`, which this task must not add); observed creator capacity; TikTok approval, verified pull-URL ownership and per-post consent; fal billing read permissions/real receipts; an authorized Google automation transport if unattended Vids operation is required. Existing OAuth/scopes/approval/config were preserved. Lack of history or permissions must not be replaced by mock decisions.

No Production database write, deployment, new Supabase project, paid infrastructure, key rotation or TikTok configuration change occurred.

## Checks completed

- Full Vitest suite: **598 passed, 2 skipped** (remote DB/browser checks requiring a separately configured environment); relevant subset: 147 passed, 1 skipped.
- Isolated scheduler SQL/RLS: **301 checks passed**; virtual-day pipeline/recovery: **100 checks passed**; existing provider/budget SQL: **31 checks passed**.
- Typecheck passed. Lint: **0 errors, 8 pre-existing warnings** in video benchmark/fal test files. Optimized production build passed locally, using non-secret public compile placeholders only; `.env.local` was unchanged.
- Machine-readable results: `test-results/multi-account/sql-proof.json`, `readiness-day.json`, `fal-readonly.json`. No real-user or 24-hour wall-clock certification is inferred from these fixture proofs.
