# ViralFlow AI tasks

Updated 15 September 2026.

## Phase 1 — Foundation

- [x] Next.js App Router, TypeScript, Tailwind, Supabase SSR, authentication, protected routes, navigation, settings, migrations, RLS, environment validation, tests, lint, and production build.

## Phase 2 — Multi-Account Brain

- [x] Extend `tiktok_accounts` with AUTO/GROWTH/AFFILIATE mode, effective mode, posting limits, authorization, categories, notes, sync state, and mock marker.
- [x] Add owner-isolated `account_daily_stats` and `account_category_affinity` models.
- [x] Add centralized account mode, readiness, affinity, performance, and dashboard services.
- [x] Add mock account create, edit, delete, mode, target, and category controls.
- [x] Add `/accounts/[id]` with live Supabase account, stats, affinity, and blocker data.
- [x] Replace dashboard placeholders with account and daily-stat aggregation.
- [x] Add an opt-in development-only mock seed path for A, B, C, and blocked scenarios.
- [x] Add unit and database tests for mode rules, readiness, aggregation, and RLS policy coverage.
- [ ] Connect real TikTok OAuth and production account sync (Phase 7–8).

## Phase 3 — Product Radar

- [x] Add products, immutable product_snapshots and versioned product_scores.
- [x] Apply Phase 3 migration once; verify live owner isolation and immutable history.
- [x] Implement normalized ProductProvider, deterministic mock provider and disabled TikTok Shop adapter.
- [x] Implement Product Momentum V1, confidence/freshness handling, explanations and ranking fixtures A–I.
- [x] Connect Radar filters/sorting and product detail/history to Supabase.
- [x] Verify browser authentication, filters, details, duplicate ingestion and clean console.
- [x] Remove only the temporary verification owner and its 9 products / 54 snapshots / 54 scores; verify zero remaining.
- [x] Confirm migration history has one Phase 3 entry and final Security Advisor has no findings.
- [x] Document exact scoring formulas and verification evidence in PRODUCT_SCORING.md.

- [x] Final pnpm typecheck, lint, tests (34/34 across 4 files) and production build passed on 15 September 2026.

## Stop gate

Phase 3 scope ends here. Phase 4 Category Intelligence has not started and requires separate authorization.
