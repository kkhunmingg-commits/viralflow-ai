# Compliance database integration preflight

Read-only hosted preflight inspection: **8 October 2026, 19:08–19:13 Asia/Bangkok**. Subsequent applications and hosted postchecks are recorded separately below. No production policy became active.

## Existing project

- Supabase project `nbtshqmtspgzrfzkqjxx`, `viralflow-ai`: `ACTIVE_HEALTHY`, PostgreSQL 17.6.
- Hosted history contains **28 migrations**, ending with `post_multi_account_schedules` and `post_supabase_cron_safe_scheduler`.
- The first 26 hosted migration timestamps differ from local filenames, but their migration names correspond. A generic `db push --include-all` must not replay these old files; it would misclassify already-created historical objects as missing.
- The integrated repository contains **30 migrations**. Two names are absent from hosted history: `fal_generation_budget_guards` and `compliance_brain_foundation`. No hosted Compliance Brain table/function exists; the fal guard marker is absent.
- Existing composite unique keys `products(owner_id,id)` and `tiktok_accounts(owner_id,id)` satisfy Compliance Brain foreign keys. The existing `profiles`, `private` schema and `auth.uid()` prerequisites exist.
- Aggregate preflight only: **4 profiles, 10 TikTok accounts, 0 products, 0 auto runs, 0 generation jobs, 0 budget reservations, 0 publishing queue rows**. No customer payload or credential was read or copied into this document.

## SAFE scheduling remains active

- `private.post_scheduler_runtime`: `execution_mode=SAFE`, `enabled=true`, capacity **3**, last error **null**.
- `viralflow-post-account-automation`: active, every minute, command equals `SELECT public.tick_post_account_automation();`.
- The last-hour hosted `cron.job_run_details` inspection recorded **60 succeeded runs** and no other status.
- The cron command contains no outbound HTTP call. SAFE scheduling evidence does not establish Creative/Video/EXPORT completion or real paid generation.
- The previous Vercel recovery cron assertion was obsolete. `scheduler.test.ts` now checks the deliberately empty Vercel cron configuration and the existing database-owned SAFE schedule; recovery authentication/duplicate tests remain unchanged. **5 tests passed**; no scheduler/runtime/config change was made.

## Backward compatibility and access controls

- Compliance Brain only creates new namespaced tables, indexes, triggers and functions. It enables RLS and grants on those new objects. It performs no customer data backfill, update or delete and does not replace an existing domain RPC.
- `node scripts/verify-compliance-integration-sql.mjs` applies **28 prior migrations**, creates ten-account and crash/recovery scheduling fixtures plus a product, a legacy fal generation job and reserved financial liability. It then applies fal guards and confirms those existing jobs/reservations, cron configuration and original POST claim body are unchanged. Next it snapshots the full existing project and applies Compliance Brain.
- Result: **25 integration checks and 86 account/scheduler checks passed** on PGlite PostgreSQL 18.3. All **74 existing tables** retained their rows; existing columns, constraints, policies, table grants, indexes, function bodies and cron configuration stayed identical after Compliance Brain. SAFE mode stayed active.
- New evidence/claims reference actual existing fixture product/account rows. Owner reads pass, cross-owner reads return zero rows, anon reads and customer mutations/RPC invocations fail. All **8 new tables** have RLS; technical verdict columns remain denied.
- `node scripts/verify-compliance-brain-sql.mjs`: **70 isolated checks passed**, including immutable decisions, scoped verification, atomic audit/feedback rollback, signed-policy persistence rules, activation/rollback and learning counters.
- `node scripts/verify-post-multi-account-sql.mjs`: **30 migrations applied, 92 checks passed**, including populated replay of the existing POST migrations.
- The isolated engine uses role/auth and pg_cron contract stubs. Hosted Supabase runs PostgreSQL 17.6, so isolated execution is not a substitute for hosted post-apply verification. No actual credential was stored in any test.

## Application strategy

Apply only the reviewed missing migration through the existing Supabase migration API in one transaction. Do not repair/rewrite historical versions, replay already-applied migrations, push vault settings, activate policies or mutate customer records. The separately reviewed fal migration may remain local if not selected for this release; its guard must continue to fail closed until applied.

After application, execute `supabase/tests/compliance_brain_post_apply_readonly.sql` and compare the recorded aggregate baseline. Verify table/index/constraint/RPC creation, RLS and grants, migration history, cron activity and SAFE mode. Inspect only Compliance Brain advisory notices; unrelated findings belong to their existing workstreams.

No production policy or verified product claim can be inferred from this preflight. Hosted products are currently empty. An official policy pack still needs owner-authorized review/signing/trust provisioning, and genuine product evidence must be supplied before proof-requiring claims can pass.

## Hosted Compliance application and post-apply verification

The root agent applied the exact reviewed Compliance SQL through the existing migration API successfully. Hosted migration history now records **`20261008121446_compliance_brain_foundation`**. The local migration filename and the two SQL verifier references were aligned to that hosted version without changing the SQL payload. File SHA-256: `e30aa53f8f8632e29b3c51b3478b61639cc1d21ade7080e536a49ebcde6a11ee`.

Read-only post-apply inspection at **19:17–19:18 Asia/Bangkok, 8 October 2026** confirmed:

- **29 hosted migrations** immediately after Compliance application; fal guards were subsequently applied as recorded below.
- **8 tables, 22 indexes, 97 constraints, 12 functions** created for Compliance Brain.
- Every new table enables RLS. `anon` has no table read grant; `authenticated` has no INSERT/UPDATE/DELETE grant. Four ledger/decision/media SELECT policies are owner-scoped; the separate active-policy SELECT policy intentionally shares published policy content.
- All 12 new trigger/RPC functions use `SECURITY INVOKER`; anon/authenticated cannot execute them. Raw `reasons` and `rewrites_json` decision columns remain denied to customers.
- Aggregate customer counts remain **4 profiles, 10 accounts, 0 products, 0 runs**. New policy/active-policy/claim/evidence counts are **0**. Application did not fabricate product evidence or activate authority.
- Cron remains active with the original SAFE database tick, enabled SAFE runtime, no last error and **60 succeeded cron runs in the preceding hour**.
- Security advisors report **three INFO entries** for the private audit/feedback/learning tables having RLS but no customer policy. This is intentional denial: service-role access only. No Compliance Brain WARN/ERROR finding was returned. An existing Auth leaked-password protection warning is unrelated and unchanged; see [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). The advisor explanation for intentional private-table denial is [RLS enabled without policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Hosted inspection verifies object/grant/policy shape and preserved aggregates. Owner-versus-cross-owner row behavior is established by isolated populated SQL tests; no customer token or credential was collected and no hosted fixture row was created in this database verification.

## Hosted fal database application

`AtomicBudgetLedger.reserve()` checks `fal_budget_guard_version()` before any fal reservation. The root agent subsequently applied the exact reviewed fal guard SQL successfully as **`20261008122111_fal_generation_budget_guards`**, bringing hosted history to **30 migrations**. Its local filename/test references were aligned without SQL payload changes. The full sorted local migration execution also passed in the actual hosted order, Compliance before fal guards. File SHA-256: `6d996d10fdea1945167c7050daf2c0e9455ba98040354e5adcbc2502e197640f`.

Read-only hosted verification confirmed the marker returns `fal-generation-budget-guards-v1`, all seven affected RPCs remain `SECURITY INVOKER` and service-only, and the three fal job customer-write policies are restrictive. Customer aggregate counts remain unchanged, generation jobs/reservations remain zero, and Cron remains active with SAFE execution. Applying the database guard does not enable paid execution or a production provider.

The isolated fal RPC suite passed identity/replay/reopen, cumulative clip caps, two-attempt limits, unknown charge preservation, settlement/cost replay, atomic master persistence, stale-result rejection and legacy client-write restrictions. The populated integration test above also preserves pre-existing reserved liability. No paid request or TikTok posting request was made.
