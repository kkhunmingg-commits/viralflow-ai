# ViralFlow AI tasks

Updated 14 September 2026.

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

## Stop gate

Phase 3 Product Radar is not authorized and has not started.
