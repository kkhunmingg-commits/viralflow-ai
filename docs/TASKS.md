# ViralFlow AI tasks

Updated 16 September 2026.

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

## Phase 4 — Category Intelligence

- [x] Add owner-isolated `categories`, immutable `category_snapshots`, and versioned `category_scores`.
- [x] Extend account/category affinity with mode-aware performance signals and confidence shrinkage.
- [x] Implement `category-momentum-v1`, commercial opportunity, saturation, state classification, and A–F fixtures.
- [x] Connect `/categories`, `/categories/[id]`, filters, sorting, account fit, and Product Radar category signals to Supabase.
- [x] Verify new account creation after granting authenticated execution of `private.account_effective_mode`.
- [x] Verify live RLS: owner access succeeds; cross-owner and anonymous access fail; snapshot and score history is immutable.
- [x] Verify browser flows and a clean console, including the placeholder-image loading fix.
- [x] Remove the temporary Phase 4 verification owner and all cascading account, product, and category records.
- [x] Confirm one Phase 4 migration entry and no Supabase Security Advisor findings.
- [x] Document exact formulas, thresholds, confidence rules, account-mode differences, and fixture expectations in `CATEGORY_SCORING.md`.

## Phase 5A — Product × Category × Account Assignment

- [x] Add owner-isolated, immutable `account_product_scores` and daily `product_assignments`.
- [x] Implement Growth and Affiliate fit formulas, confidence/freshness adjustments, competition and saturation handling, and eligibility blockers.
- [x] Implement a deterministic daily planner with post limits, preserved decisions, and cross-account diversification.
- [x] Add `/recommendations`, account recommendation panels, Product Radar account signals, explanations, and account/mode/category/min-score filters.
- [x] Verify deterministic P1–P7 rankings, low-data blocking, and strongest-fit-first diversification.
- [x] Verify live RLS, including forged cross-owner IDs, and immutable score history.
- [x] Verify exact retry and intentional same-day re-run idempotency: no duplicate scores for one run and no duplicate active account-product-day assignments.
- [x] Verify browser flows with a clean console and persist 21 scores / 6 assignments during the controlled test.
- [x] Remove only the temporary Phase 5A owner and cascading verification rows; preserve source-controlled fixtures.
- [x] Confirm one Phase 5A migration entry and no Supabase Security Advisor findings.
- [x] Document formulas, planner policy, idempotency, and verification evidence in `ACCOUNT_PRODUCT_ASSIGNMENT.md`.

## Phase 5B — Creative Brain

- [x] Add owner-isolated Creative Projects, angles, scripts, and append-only generation audit history.
- [x] Implement compact account/product/category/assignment context and mode-specific Growth and Affiliate strategies.
- [x] Add provider-independent structured generation with deterministic mock output, optional OpenAI Responses adapter, Zod validation, and one repair attempt.
- [x] Implement exact eight-second plans, `creative-concept-v1` scoring, deterministic diversity gates, and baseline policy-risk checks.
- [x] Connect Recommendations to one-click Creative creation and build `/creative-studio` plus `/creative-studio/[id]` workflows for generate, select, edit, reject, and regenerate.
- [x] Store prompt/provider/model/token/cost metadata under prompt version `creative-brain-v1`.
- [x] Verify deterministic Growth Beauty, Affiliate Home, Affiliate Gadget, blocked low-data, lifecycle, cost, schema, diversity, and risk fixtures.
- [x] Apply the Phase 5B migration once and verify owner access, cross-owner/forged-owner denial, anonymous denial, and immutable generation history.
- [x] Complete authenticated browser verification using a temporary verified user created and removed through the supported Supabase Auth Admin API.
- [x] Verify Growth and Affiliate generation, generate/select/edit/reject/regenerate, exact eight-second scene timing, diversity, SAFE browser output, provider/model/token/cost metadata, and a clean final browser console.
- [x] Confirm browser verification used only `MockAIProvider` (`viralflow-deterministic-v1`, US$0.0000); `OpenAIProvider` was not called.
- [x] Remove the temporary Phase 5B auth user and all cascading application data; verify zero remaining profile, account, product, category, snapshot, score, assignment, project, angle, script, and generation rows.
- [x] Retry deletion of legacy malformed auth user `d5b4c23d-4fbe-4ed8-9197-456fdd6df55e` once through `auth.admin.deleteUser()` only; GoTrue still returns `Database error loading user`, so owner action remains required.
- [x] Run the final Security Advisor and quality suite; record the project-level leaked-password-protection warning for the owner.
- [x] Commit and push `feature/creative-brain` without starting Phase 6.

## Stop gate

Phase 5B scope ends here. Phase 6 Video Factory has not started and requires separate authorization.

