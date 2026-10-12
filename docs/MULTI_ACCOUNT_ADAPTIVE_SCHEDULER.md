# Adaptive multi-account automation (development branch)

The user's latest requirement supersedes the earlier 15–20-per-account target. No fixed account count, minimum daily clip count, maximum daily clip count, or global clip quota is imposed by this module. 1/3/10/20/50/73 accounts and 211/220/1,250 clips in regression inputs are examples, not capacity promises.

## What changed

- Removed the newly introduced minimum=15 / maximum=20 and arbitrary 1,000-clip validation. Also removed the legacy AUTO minimum-15 candidate floor and maximum-20 input validation; manual production requests are separated from the account's real publishing capacity. Large account arrays no longer produce negative database priorities.
- `analyzeFrequency` uses owned published-history observations, response trend, permitted windows/spacing, ready pool, selected creative inventory, budget/quote, measured successful provider throughput and account health. It is an explainable local planning policy, **not a claimed trained AI predictor or a paid LLM invocation**. Insufficient real observations produce a waiting state; it does not invent a daily target for a new account.
- `MultiAccountPublishingScheduler` plans each account independently over its IANA timezone (including 23/25-hour DST days), owner-permitted windows and actual measured audience minutes where supplied. Randomized timing is seeded once per account/day in isolated storage. Restart/replanning retains that seed and existing external operations. Timing randomization is for distribution, never to evade TikTok restrictions.
- Account configuration has enable/pause, categories, timezone/windows, spacing, priority, budget and restrictive provider preferences. Preferences cannot grant paid permission. The dashboard has no fixed-quota controls.
- CPU occupancy is sampled; available parallelism, container-aware RAM, process RSS, queue depth and observed accepted provider operations control work admission. Unknown provider/job capacity starts conservatively. Resource overload returns concurrency=0 and keeps durable jobs waiting; it never prevents connecting more accounts. Estimates are not provider capacity certification.

## Durable queues and background runtime

The migration is additive, owner-isolated, service-write-only and disabled/SAFE by default. It adds account configuration, separate GENERATE/PUBLISH/RECONCILE tasks, planner cursor/lease, worker heartbeats, day seeds and rolling publish reservations. The previous provider-router migration must be present first.

Short planner leases rotate a durable account cursor so a bounded server tick cannot always start at the first account. `FOR UPDATE`/`SKIP LOCKED`, per-account active leases, expiry/CAS fencing and owner/project/queue identity indexes protect concurrency and restart. An independent host can run `pnpm worker:multi-account`; it invokes only the exact dedicated bearer-authenticated route. Dashboard polling is read-only and never starts a worker. No existing Cron was modified.

The worker host needs its own lifecycle/supervisor; the web process does not guarantee 24/7 uptime. No such service was activated or certified for 24 hours in this work. Tick, transport timeouts, retry/backoff and reconciliation are bounded. Unknown provider submission stays under review rather than buying a replacement. Known paid operations can be reconciled after account pause/removal without purchasing again. Existing disconnect/revoke clears tokens; the new private trigger pauses only the affected account and preserves history/external-operation evidence.

Generation reuses actual Product Radar assignments, Creative Brain projects/selected scripts, Video Factory and the Google/fal router. If a safe creative does not exist, it prepares the existing no-spend project boundary and waits for real creative input. It does **not** silently generate a fake script or call paid text AI. Google remains Assisted; an unstarted deadline miss can use fal only under existing explicit paid permission and atomic owner/account/provider budgets. An unknown Google handoff never triggers fallback.

Files with unverified quality are never counted as ready. Passed files still go through existing final compliance and into the original queue in review state. The scheduler does not manufacture consent, choose default privacy or alter captions after consent.

## TikTok restrictions (official documentation checked 2026-10-12)

Sources:
- https://developers.tiktok.com/docs/en/content-sharing-guidelines
- https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post

The documented unaudited **5 active creators in a rolling 24 hours** is a platform publishing constraint, **not a maximum number of accounts that ViralFlow can register**. Unaudited posting stays private/SELF_ONLY. Audited app-wide capacity is unknown until a real approved value is supplied; unknown blocks init. TikTok's per-creator posting cap varies (the guidelines describe roughly 15 as typical, not guaranteed). Production targets do not authorize extra posting.

The existing publisher retains authorization/token refresh, scopes, fresh creator information/privacy/duration, quality/compliance, consent snapshots, official transports, webhooks/status and exactly-once submission. New reservations additionally respect shared creator identity, rolling app/account limits and conservative init spacing (official init limit: six per token/minute). Server-hosted background media requires existing verified PULL_FROM_URL ownership; it cannot exploit FILE_UPLOAD as a workaround. Existing direct/manual flows retain their own gates; centralized reservations added here govern this scheduler, not an assertion that unrelated callers share its runtime lock.

No TikTok publishing, upload or token API was called in these tests. No approval flags, credentials or scopes changed.

## Verification and remaining activation requirements

- Regression inputs include 1/3/10/20/50 accounts, 73 accounts beyond the examples, distinct per-account frequencies, >200 clip examples, timezone/DST/windows, random seed restart stability, spacing, CPU/RAM/provider admission, budget/caps/health, SAFE no-IO/no-spend, deadline bounds and private worker route authorization.
- Isolated PGlite runs the actual new SQL functions and actual pooled worker implementation with simulated generation outcomes. It validates duplicate prevention, independent account claims, stale lease fencing, process restart, owner/cross-owner/anon RLS, private columns, planner lease, shared creator caps, unknown audit capacity and safe removal. One PGlite connection serializes SQL; this is **not** a multi-connection cloud load certification. See `test-results/multi-account/sql-proof.json` for real timings and query plan.
- Desktop/mobile browser checks render the actual component/CSS with explicitly labelled fixture data; they do not certify authenticated deployed routes or save actions. Optional environment paths supply the local browser runtime without adding a browser installation dependency to the application. Results/screenshots are local in `test-results/multi-account`.
- Existing provider-router isolated SQL proof still runs independently; its 31 checks cover atomic budget reservations and duplicate spend protection.
- Read-only fal verification returned pricing HTTP 200 for all three existing models; billing returned **403**. No paid generation. Actual billed usable cost and actual daily video throughput remain unverified; catalog quotes are not billing results.
- Only existing Production schema names/columns were read for compatibility. **No remote database migration/write, new Supabase project/paid staging, Production deploy or Cron/feature-flag activation.** The prepared migrations remain local.
- No actual Google Vids output file was supplied for this task, so a real Assisted import was not claimed.

Before activation: validate against a separate free/local full Supabase environment, provide real account history/creative inventory and a real Google file, resolve Billing permission if actual accounting is needed, benchmark verified media/provider throughput within an explicitly authorized budget, and choose a supervised worker host. TikTok app approval, real platform caps, verified pull ownership and per-content consent remain required. This branch is not evidence that autonomous public publishing or arbitrary clip throughput has passed.
