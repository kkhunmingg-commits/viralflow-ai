# Master Auto Account Logic — local validation

Branch: `codex/google-vids-fal-router`. No Production deployment, database change, paid request or TikTok post was made for this work.

## Connected paths

- The existing multi-account worker calls leased account discovery before planning. Every real, visible OAuth-connected account is discovered automatically; pagination and the worker time slice are transport/resource controls, not registration ceilings. New connections require no release.
- Discovery reads the official `/v2/user/info/` endpoint only when existing `user.info.basic` and `user.info.stats` grants permit it. No new OAuth scopes are requested. Tokens stay in the existing server token service. Identity mismatch, future/stale evidence, network errors and missing permissions do not become a follower count of zero.
- The existing Account Brain computes AUTO mode from verified observations: below 1,000 followers is Growth; at/above 1,000 requires real, fresh authorized Shop/commerce capabilities for Affiliate. Unknown follower data retains the classification and disables execution. Confirmed commerce revocation removes Affiliate permission. Evidence has an expiry independent of the polling interval.
- Classification does not enroll accounts. Only explicit `account_automation_settings.enabled` or the selected server allowlisted Pilot can execute. Other accounts' legacy mode/commerce fields are not changed by discovery; factual follower observations are kept separately in the existing analytics ledger.
- Worker generation/submission rechecks opt-in, connection, verified mode and freshness. A project from the old mode is held for review. Pending external operations retain their IDs for reconciliation rather than restarting or creating duplicates. Mock Creative Brain generations cannot authorize real video generation.
- Growth recommendations reuse `analyzeFrequency`, `MultiAccountPublishingScheduler`, Category Intelligence and Growth strategy. Repeated observations, maturity, coverage across days, median performance, known platform limits, cooldown and new evidence govern adjustment. A single viral post does not raise frequency. Unknown watch time, retention, completion, per-post follower attribution and sales data stay UNKNOWN.
- Cold start is an explicitly opted-in small experiment with configurable safety policy, conservative spacing and rotating allowed time bands. This is not a claim that any fixed posting count is safe. Normal scheduling and account registration remain dynamic.
- Topics are chosen server-side from fresh, authorized real Category Intelligence evidence. Stored manual topic configuration is ignored. No authorized topic source means WAIT_FOR_DATA, not invented trends. Existing Shop observations are a commercial/category signal, not proof of a universal TikTok trending feed.
- `/growth/pilot` presents the real account-specific decision, confidence, known/unknown metrics, chosen topic briefs, assisted creation and manual export. It does not expose scopes, tokens or raw IDs. Manual post reports are labeled owner reports; they are not counted as verified API performance.
- Manual post reports are revisited by the existing official TikTok analytics adapter when `video.list` and the current analytics runtime permit it. An owner URL is never turned into a fake PUBLISHED queue entry. Only returned official observations are stored, bound to the account, report and active discovery lease. The 20-video read batch is the API transport bound; rotating read batches prevent unavailable/private old IDs from starving newer reports.
- Prepared SQL rejects new paid reservations for an active Pilot, prevents plans from unverified accounts and preserves reported outcomes during retries/replanning. Pilot has one selected account as experimental authorization, not as an architecture limit.

## Honest execution boundaries

| Stage | Implemented / remaining |
| --- | --- |
| Discovery / follower sync | Official read adapter, scheduled lease/backoff, identity validation and persistence implemented. Real accounts need an already authorized `user.info.stats` grant. Current Login/Posting grants alone do not provide follower counts. |
| Growth / Affiliate classification | Connected to verified followers and existing non-mock Shop profiles; no assumed eligibility based on the 1,000 threshold alone. |
| Topic / creative selection | Authorized Category Intelligence is reused and a source-bound Hook/script plan/prompt brief is prepared. This is not a complete factual script or an executed LLM request. Real external trend/audience sources and provider access are not fabricated. |
| Affiliate production handoff | On a verified switch, the worker automatically reuses only the enrolled account's current Affiliate assignments, rejects stale/mock products, and creates/reuses the existing unique Creative Brain project. Without a real assignment it waits for data. It does not silently enable paid creation or attachment. Live catalog ingestion, complete creative generation and attachment need real Shop authorization/data and validated provider execution. |
| Video Factory | Existing approved creative → router boundary reused. Google Vids remains Assisted; no authorized automated Omni API is claimed. fal paid fallback is not enabled by this work and Pilot reservations are denied in SQL. |
| Scheduling | Existing scheduler/resource admission, per-account opt-in, windows, limits and recovery reused. No new queue engine or fixed global posting quota. |
| Publishing | Existing compliance, originality, quality and per-post TikTok consent gates remain mandatory. Without authorized public API posting, prepare/review/export for manual public posting. No real post was sent. |
| Analytics | Existing verified TikTok Display observations only. Current video query needs `video.list`; account statistics need `user.info.stats`. Unsupported watch/retention/follower attribution/Shop sales metrics remain UNKNOWN. |

This is not certification of fully autonomous paid video generation, public TikTok posting, live Shop attachment, or 24 wall-clock hours on real accounts. No real Pilot account has been configured or activated in Production.

## Verification

- Growth tests: 300/999/1,000/5,000, eligibility pending/revoked, stale/missing/conflicting/mock evidence, missing scopes/network failure, gradual increase, decline, unknown metrics/caps, sparse/cold start, allowed time bands/gaps, restart-stable slots, dynamic pagination beyond 1,000 fixture accounts and source filtering.
- `pnpm exec tsx scripts/verify-multi-account-sql.mjs --growth-manager`: actual prepared SQL on isolated PGlite/PostgreSQL, service-only access, owner binding, 50-account discovery plus a new connection, independent claims/CAS/lease recovery, Pilot paid reservation denial, duplicate prevention and preserved manual outcomes. One local connection, not a distributed cloud load claim. Proof: `test-results/growth-manager/sql-proof.json`.
- Existing scheduler proof still covers variable recommendations, platform caps, duplicate work, restart, worker pooling and SAFE behavior.
- Migrations `20261012094047_growth_manager_pilot.sql` and `20261012100609_auto_account_discovery.sql` are prepared and locally tested only. Production application/activation remains a separate owner-authorized operation.

## Official references

- [User Info fields and granted scopes](https://developers.tiktok.com/docs/en/tiktok-api-v2-get-user-info)
- [Display API scope reference](https://developers.tiktok.com/docs/en/tiktok-api-scopes)
- [Required Content Posting UX / consent](https://developers.tiktok.com/doc/content-sharing-guidelines/)

The 1,000 follower rule is this project's routing requirement; it does not grant TikTok Shop or posting eligibility.
