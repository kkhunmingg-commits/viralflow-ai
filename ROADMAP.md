# ViralFlow AI roadmap

## Current status

Phase 1 foundation is complete in feature/foundation. The live Supabase project contains the three approved tables with RLS enabled. Production TikTok remains disconnected.

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture and documentation | Approved |
| 1 | Next.js, Supabase, Auth, Git, dashboard shell | Complete |
| 2 | Accounts and multi-account model | Not started |
| 3 | Product Radar and snapshots | Not started |
| 4 | Category intelligence and scoring | Not started |
| 5 | Creative Brain | Not started |
| 6 | Video Factory, variation engine, cost router | Not started |
| 7 | TikTok OAuth and approved publishing | Blocked on platform approval |
| 8 | TikTok Shop Creator APIs and product attachment | Blocked on market/scope approval |
| 9 | Analytics and learning loop | Not started |
| 10 | One-click Auto Mode | Not started |
| 11 | Security, performance, and production review | Not started |

## Phase 1 acceptance evidence

- Package versions and lockfile are pinned.
- Supabase SSR validates sessions with getClaims() in the Next.js proxy.
- Protected pages verify the current user again on the server.
- Client grants and RLS policies isolate all user-owned tables.
- OAuth token values have no plaintext storage column.
- Quality gates are typecheck, lint, test, and build.

## Next gate

The owner must explicitly authorize Phase 2. Before production hosting, select the Vercel account/team and a plan suitable for commercial use.

