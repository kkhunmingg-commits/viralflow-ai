# ViralFlow AI roadmap

## Current status

Phases 1–10 are complete at foundation level. The final video-provider integration adds a server-only Google Veo 3.1 contract, evidence-based CostRouter, Flow manual-reference path, and master/variation cost planning. Paid providers, real TikTok calls, real publishing, and production deployment remain disabled.

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
| 6B | Real video AI provider benchmark | Infrastructure complete — real media/key/approval required |
| 6C | TikTok compliance, originality, account health, and publish eligibility | Complete |
| 7A | TikTok OAuth, secure tokens, creator info, permission sync | Foundation complete — real app setup required |
| 7B | Publishing queue, Upload Draft, Direct Post, consent, status foundation | Foundation complete — real calls remain disabled pending approval |
| 7C | TikTok Shop authorization/readiness, Affiliate commerce eligibility, shoppable intent | Foundation complete — real Shop calls and attachment remain approval-gated |
| 8 | Analytics, winner detection, and bounded learning loop | Foundation complete — real analytics access remains approval-gated |
| 8B | Real TikTok Shop Creator APIs and product attachment | Blocked on app/category/scope approval and separate authorization |
| 9 | Growth Learning Engine | Complete — real analytics and commerce rechecks remain approval-gated |
| 10 | Full Auto Mode orchestration | Complete — mock/local execution only; external calls remain disabled |
| Video provider finalization | Google Veo 3.1, Flow manual reference, evidence-based routing and cost forecasts | Infrastructure complete — no paid benchmark run |
| 11 | Security, performance, and production review | Not started |

## Google Veo provider boundary

`GoogleVeoProvider` implements the official Gemini API long-running operation and download flow for Veo 3.1 Lite, Fast, and Standard. Lite is the default cost-first candidate, but no model becomes the production winner until real Beauty, Home, and Gadget outputs pass technical quality 85 and the owner's Flow comparison. Missing credentials yield `WAITING_FOR_PROVIDER`; missing budget yields the existing fail-closed `BLOCKED` state with `WAIT_FOR_BUDGET`.

Google Flow remains `MANUAL_BENCHMARK_ONLY`. Flow credits and subscription allowances are never treated as Gemini API dollars or Auto Mode capacity. The near-term plan creates 15–20 paid masters/day for three accounts and 40–50 masters/day for ten accounts, then generates meaningful local variations through the existing FFmpeg and Phase 6C gates.

The Phase 6 schema already stores provider/model, request/output metadata, attempts, cost evidence, master/variation metadata, and private owner-scoped media. No migration is required for this provider addition.

## Phase 6 boundary

Video Factory consumes the selected Creative Brain timeline without replacing its creative logic. It stores private owner-scoped media, one reusable master per creative project, deterministic controlled variations, generation history, quality explanations, and append-only cost evidence. See `VIDEO_FACTORY.md` and `COST_ROUTER.md` for interfaces, formulas, thresholds, storage, idempotency, budgets, and future-provider gates. The Phase 6 migration, rollback validation, live RLS/storage tests, real FFmpeg output, authenticated browser flow, unit checks, lint, type check, and production build pass. The temporary verification user, rows, and storage objects were removed. Future paid-provider activation and TikTok production integration require separate authorization.

## Phase 6B status

The real-provider benchmark is isolated on `feature/video-provider-benchmark`. Meta AI/Vibes is listed first as `MANUAL_BENCHMARK_ONLY`: an owner-supplied clip can be normalized and scored, while the lack of a supported public video API and verified commercial automation terms keeps it out of Auto Mode. Executable Stage 1 tests direct fal Wan 2.2 Turbo, direct PixVerse V6, and Runway Gen-4 Turbo in ascending cost order across three products with one initial run. Its lowest published-equivalent consumption is $2.46 and its conservative hard-cap forecast is $3.66. A second sample is allowed only after the first passes the automated 85-point gate, is judged Flow-comparable beside the owner's reference, and remains within budget. Five Runway candidates remain available for comparison; TikTok Symphony is `NOT_RUN` pending legitimate approved API access and pricing. No provider is selected and no paid routing is enabled until licensed inputs, the owner's Flow AI reference clip, server-only keys, and explicit spending authorization are available.

## Phase 6C boundary

Phase 6C inserts deterministic compliance, product-truth, AIGC disclosure, originality, account-health, creator-limit, shop-permission, Video Factory quality, and owner-approval gates before any future publisher. Compliance and originality evidence is append-only and owner-isolated. Generation volume remains independent from effective publish capacity; overflow is queued and never bypasses a gate. The phase records local account state only and makes no TikTok API call. TikTok OAuth, authoritative creator/shop sync, product attachment, and publishing remain Phase 7–8 work requiring separate authorization.

Accounts requested as `AUTO` remain effectively `GROWTH` while followers are below 1,000 or ecommerce/cart permission is unavailable. Growth follow, save, comment, share, and engagement CTAs stay eligible; Affiliate/cart/shop claims stay blocked until capability exists. A full Growth Learning Engine is deferred to the next learning phase and is not part of Phase 6C.

## Phase 7A boundary

Phase 7A adds official TikTok Login Kit and creator-info foundations without sending media. OAuth state is owner-bound, expiring, and one-time. Tokens are AES-GCM encrypted in a service-only table and never returned to the browser. App approval, user grants, Direct Post audit status, creator-info freshness, upload readiness, and private-only readiness remain separate facts. The deterministic mock provider covers local verification without TikTok credentials or network calls.

Connection does not change business mode. Accounts still use the Phase 2/6C AUTO/GROWTH/AFFILIATE rules, and missing follower, ecommerce, or cart capability still preserves effective GROWTH. Actual upload, Direct Post, TikTok Shop, and public posting remain outside Phase 7A.

## Phase 7B boundary

Phase 7B connects approved Video Factory output to an owner-isolated queue. It re-runs Phase 6C and authoritative creator checks before sending, requires explicit settings-bound consent, respects the current `effective_publish_cap`, and keeps overflow visible as `WAITING_FOR_SLOT`. Upload Draft delivery and a published Direct Post are separate states.

The official provider follows current TikTok endpoints, `is_aigc`, media chunking, status polling, and signed webhook contracts, but mock mode remains the default and this phase performs no real upload or publish call. TikTok Shop, product attachment, paid providers, audit completion, verified pull domains, and production credentials remain owner actions.

## Phase 7C boundary

Phase 7C keeps TikTok Login separate from creator/seller Shop authorization and treats every Affiliate capability as an observed permission. `AUTO` and requested `AFFILIATE` fall back to effective `GROWTH` until follower, Shop creator, ecommerce, cart, authorization, product, region, and attachment facts all pass. Growth content remains valid without Shop; fake cart/shop claims remain blocked.

Product Radar and assignment scores are preserved. Commerce evaluation separately records `CONTENT_FIT` and `COMMERCE_ELIGIBLE`, verifies title, price, discount, features, seller/product status, and creates metadata-only shoppable intent after a pass. The real provider is `APPROVAL_REQUIRED`, makes no request, and stores no token. Real Shop calls, real product attachment, Analytics/Learning, and paid provider calls require later separately authorized work.

The Growth learning roadmap remains: optimize follower gain in Growth, reach the applicable threshold, re-check current authoritative commerce permissions, and enter Affiliate only when truly eligible.

## Phase 8 boundary

Phase 8 stores raw observations and normalized winner evidence without inventing unavailable values. Growth and Affiliate scores use the same account's baseline, explicit confidence, sample-size handling, and freshness decay. Delayed affiliate events append new evidence instead of mutating the earlier decision. Learning signals stay account-local, decay over time, and can only create bounded adjustments or one-axis experiments guarded by Phase 6C originality.

The TikTok Display and Shop Analytics adapters remain `APPROVAL_REQUIRED`; mock providers are the default. Auto Mode, real publishing, real Shop product attachment, and paid generation remain disabled.

## Phase 9 boundary

Phase 9 uses Phase 8 evidence to optimize follower efficiency, engagement, categories, hooks, angles, scenes, CTAs, templates, variations, and timing per account. Explore/exploit allocation is configurable; experiments change one axis and retain the Phase 6C originality gate. Follower milestones trigger a Phase 7C commerce recheck but never imply Affiliate readiness.

Creative Brain receives advisory Growth context, Product Radar remains useful without Shop, and Growth publishing still requires compliance, originality, account health, cap, and consent. Phase 9 does not orchestrate Auto Mode or call any real publishing or paid-provider endpoint.

## Phase 10 boundary

Phase 10 coordinates existing decisions through durable runs, owner-scoped account states, append-only step/action/failure/checkpoint evidence, stable idempotency keys, budget gates, bounded retries, fair scheduling, and human approval. It resumes from the last safe checkpoint after interruption and never repeats a completed generation or publish action.

The verified runtime uses mock/local execution only. Real TikTok posting, paid provider routing, silent consent bypass, anti-detection timing, and production deployment remain disabled.

