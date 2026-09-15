# ViralFlow AI roadmap

## Current status

Phases 1–4 and Phase 5A are complete. Phase 5A Product × Category × Account Assignment is implemented on `feature/account-product-assignment`, with versioned score evidence, daily recommendations, diversification, retry-safe persistence, and verified owner isolation. Production TikTok and Vercel deployment remain outside this phase.

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture and documentation | Approved |
| 1 | Next.js, Supabase, Auth, Git, dashboard shell | Complete |
| 2 | Multi-account modes, readiness, stats, affinity, UI | Complete |
| 3 | Product Radar, snapshots and Product Momentum V1 | Complete |
| 4 | Category intelligence and scoring | Complete |
| 5A | Product × Category × Account Assignment | Complete |
| 5B | Creative Brain | Not started |
| 6 | Video Factory, variation engine, cost router | Not started |
| 7 | TikTok OAuth and approved publishing | Blocked on platform approval |
| 8 | TikTok Shop Creator APIs and product attachment | Blocked on market/scope approval |
| 9 | Analytics and learning loop | Not started |
| 10 | One-click Auto Mode | Not started |
| 11 | Security, performance, and production review | Not started |

## Phase 5A boundary

Account-product assignment combines Product Momentum, Category Intelligence, account affinity, mode economics, confidence, freshness, competition, and saturation into `account-product-fit-v1`. The deterministic planner applies posting and diversification limits and stores retry-safe daily decisions linked to immutable score evidence. Development fixtures remain source-controlled tests; temporary browser data has been removed. See `ACCOUNT_PRODUCT_ASSIGNMENT.md` for formulas, P1–P7 results, planner policy, and idempotency. Phase 5B Creative Brain has not started.
