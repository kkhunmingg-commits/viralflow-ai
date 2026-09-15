# ViralFlow AI roadmap

## Current status

Phases 1–5B are complete. Phase 5B Creative Brain is implemented and verified on `feature/creative-brain`, with structured eight-second concepts, mode-aware strategy, versioned prompts, provider abstraction, deterministic scoring and diversity, risk checks, cost history, and verified owner isolation. Authenticated browser verification passed for Growth and Affiliate workflows using the deterministic mock provider, and the temporary auth user plus all cascading test data were removed. Production TikTok, video rendering, and Vercel deployment remain outside this phase.

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture and documentation | Approved |
| 1 | Next.js, Supabase, Auth, Git, dashboard shell | Complete |
| 2 | Multi-account modes, readiness, stats, affinity, UI | Complete |
| 3 | Product Radar, snapshots and Product Momentum V1 | Complete |
| 4 | Category intelligence and scoring | Complete |
| 5A | Product × Category × Account Assignment | Complete |
| 5B | Creative Brain | Complete |
| 6 | Video Factory, variation engine, cost router | Not started |
| 7 | TikTok OAuth and approved publishing | Blocked on platform approval |
| 8 | TikTok Shop Creator APIs and product attachment | Blocked on market/scope approval |
| 9 | Analytics and learning loop | Not started |
| 10 | One-click Auto Mode | Not started |
| 11 | Security, performance, and production review | Not started |

## Phase 5B boundary

Creative Brain converts an eligible daily assignment into five validated and diverse eight-second concepts for the assigned account mode. It stores the project, angles, editable scripts, selection state, and append-only provider/cost evidence under `creative-brain-v1`. Development defaults to the deterministic mock provider, while the OpenAI adapter remains environment-controlled. See `CREATIVE_BRAIN.md` for the provider contract, schema, score, diversity thresholds, risk rules, and fixture expectations. The migration, RLS, rollback, authenticated browser flow, unit, lint, type, and production-build checks pass. The browser run covered Growth and Affiliate generation plus select, edit, reject, and regenerate with an empty final warning/error log. The supported Auth Admin API removed the temporary verified user and all related application rows. One legacy malformed auth user still cannot be loaded or deleted by GoTrue and requires owner/Supabase Support action. Phase 6 Video Factory has not started.

