# ViralFlow AI roadmap

## Current status

Phases 1–2 are complete. Phase 3 Product Radar is implemented on `feature/product-radar`, with live Supabase persistence, immutable observations, Product Momentum V1 and verified owner isolation. Production TikTok and Vercel deployment remain outside this phase.

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture and documentation | Approved |
| 1 | Next.js, Supabase, Auth, Git, dashboard shell | Complete |
| 2 | Multi-account modes, readiness, stats, affinity, UI | Complete |
| 3 | Product Radar, snapshots and Product Momentum V1 | Complete |
| 4 | Category intelligence and scoring | Not started |
| 5 | Creative Brain | Not started |
| 6 | Video Factory, variation engine, cost router | Not started |
| 7 | TikTok OAuth and approved publishing | Blocked on platform approval |
| 8 | TikTok Shop Creator APIs and product attachment | Blocked on market/scope approval |
| 9 | Analytics and learning loop | Not started |
| 10 | One-click Auto Mode | Not started |
| 11 | Security, performance, and production review | Not started |

## Phase 3 boundary

ProductProvider uses normalized mock observations with real Supabase persistence. The TikTok Shop adapter is explicitly disabled. Development fixtures require authenticated ownership and an opt-in development flag. Temporary browser data has been removed; migrations and required fixtures remain. See PRODUCT_SCORING.md for formulas, A–I results and migration mapping. Phase 4 Category Intelligence has not started.
