# ViralFlow AI roadmap

## Current status

Phases 1–6 are complete. Phase 6 turns a selected SAFE Creative Brain project into a reusable master and controlled variations through local FFmpeg, private Supabase media storage, deterministic quality and similarity gates, retry-safe jobs, and a zero-cost-first router. Authenticated browser verification produced and played a real vertical MP4, exercised approval/rejection/retry, and confirmed zero provider cost. Paid providers, TikTok production APIs, and production deployment remain outside this phase.

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture and documentation | Approved |
| 1 | Next.js, Supabase, Auth, Git, dashboard shell | Complete |
| 2 | Multi-account modes, readiness, stats, affinity, UI | Complete |
| 3 | Product Radar, snapshots and Product Momentum V1 | Complete |
| 4 | Category intelligence and scoring | Complete |
| 5A | Product × Category × Account Assignment | Complete |
| 5B | Creative Brain | Complete |
| 6 | Video Factory, variation engine, cost router | Complete |
| 6B | Real video AI provider benchmark | In progress — harness ready; real media/key required |
| 7 | TikTok OAuth and approved publishing | Blocked on platform approval |
| 8 | TikTok Shop Creator APIs and product attachment | Blocked on market/scope approval |
| 9 | Analytics and learning loop | Not started |
| 10 | One-click Auto Mode | Not started |
| 11 | Security, performance, and production review | Not started |

## Phase 6 boundary

Video Factory consumes the selected Creative Brain timeline without replacing its creative logic. It stores private owner-scoped media, one reusable master per creative project, deterministic controlled variations, generation history, quality explanations, and append-only cost evidence. See `VIDEO_FACTORY.md` and `COST_ROUTER.md` for interfaces, formulas, thresholds, storage, idempotency, budgets, and future-provider gates. The Phase 6 migration, rollback validation, live RLS/storage tests, real FFmpeg output, authenticated browser flow, unit checks, lint, type check, and production build pass. The temporary verification user, rows, and storage objects were removed. Future paid-provider activation and TikTok production integration require separate authorization.

## Phase 6B status

The real-provider benchmark is isolated on `feature/video-provider-benchmark`. Meta AI/Vibes is listed first as `MANUAL_BENCHMARK_ONLY`: an owner-supplied clip can be normalized and scored, while the lack of a supported public video API and verified commercial automation terms keeps it out of Auto Mode. Executable Stage 1 tests direct fal Wan 2.2 Turbo, direct PixVerse V6, and Runway Gen-4 Turbo in ascending cost order across three products with one initial run. Its lowest published-equivalent consumption is $2.46 and its conservative hard-cap forecast is $3.66. A second sample is allowed only after the first passes the automated 85-point gate, is judged Flow-comparable beside the owner's reference, and remains within budget. Five Runway candidates remain available for comparison; TikTok Symphony is `NOT_RUN` pending legitimate approved API access and pricing. No provider is selected and no paid routing is enabled until licensed inputs, the owner's Flow AI reference clip, server-only keys, and explicit spending authorization are available.

