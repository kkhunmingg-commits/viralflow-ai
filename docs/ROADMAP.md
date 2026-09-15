# ViralFlow AI roadmap

## Current status

Phases 1–4 are complete. Phase 4 Category Intelligence is implemented on `feature/category-intelligence`, with live Supabase persistence, immutable category observations, `category-momentum-v1`, mode-aware account affinity, and verified owner isolation. Production TikTok and Vercel deployment remain outside this phase.

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture and documentation | Approved |
| 1 | Next.js, Supabase, Auth, Git, dashboard shell | Complete |
| 2 | Multi-account modes, readiness, stats, affinity, UI | Complete |
| 3 | Product Radar, snapshots and Product Momentum V1 | Complete |
| 4 | Category intelligence and scoring | Complete |
| 5 | Creative Brain | Not started |
| 6 | Video Factory, variation engine, cost router | Not started |
| 7 | TikTok OAuth and approved publishing | Blocked on platform approval |
| 8 | TikTok Shop Creator APIs and product attachment | Blocked on market/scope approval |
| 9 | Analytics and learning loop | Not started |
| 10 | One-click Auto Mode | Not started |
| 11 | Security, performance, and production review | Not started |

## Phase 4 boundary

Category Intelligence aggregates normalized Product Radar observations into owner-scoped category snapshots and versioned scores. Development fixtures remain source-controlled tests; temporary browser data has been removed. See `CATEGORY_SCORING.md` for formulas, thresholds, A–F results, and account-mode behavior. Phase 5 Creative Brain has not started.
