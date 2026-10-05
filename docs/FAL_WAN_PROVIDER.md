# fal production video integration

Updated 5 October 2026. `FalWanVideoProvider` remains the existing server adapter; its name is retained for compatibility. It now supports reviewed LTX, Wan and Kling contracts. Catalog suitability is not proof of product fidelity or a benchmark win.

## Current activation status

- Manual Video Factory and AUTO share the real generation, budget, composition and persistence path.
- Real benchmark: **NOT_RUN — FAL_KEY unavailable** in the accessible process/user/machine environment. No paid generation was submitted: cost $0, outputs 0, observed success/usable rate and latency unavailable.
- PRIMARY/FALLBACK defaults are provisional candidates. `FAL_VIDEO_ENABLED=false`; exact model approval list is empty by default.
- `20261003190554_fal_generation_budget_guards.sql` is validated in isolated PostgreSQL and **not applied remotely by this task**. Spending requires the `fal_budget_guard_version` handshake.
- TikTok approval/OAuth/scopes/publishing configuration and AI LIVE are unchanged. No merge or production deployment.

## Real provider boundary

Upload a licensed real product image, make exactly one paid queue POST with server retries disabled, durably record its request ID, then perform bounded read-only status/result retrieval. Per-instance `FAL_KEY` stays server-side and never enters customer props.

Queue `COMPLETED` with `error`/`error_type` is confirmed terminal failure. Timeout, lost submit response or cancellation acknowledgement is not proof of non-billing: retain reservation and block another paid attempt until reconciliation. Recovery uses the existing request ID and original settings. Media downloads require approved HTTPS fal output locations, bounded size/time and no redirects.

Metadata records endpoint/native settings, request ID, estimated/reserved cost, provider-recorded charge when available, cost basis, queue/generation/total time and paid retry count. Missing billing is `recordedCostUsd=null`, not an invented invoice; the conservative estimate remains a liability.

## Shared Video Factory / AUTO path

```text
Selected existing product + SAFE concept/script
 -> real product reference, full-image portrait COPY
 -> real narration and visual evaluator preflight
 -> immutable job policy + model approval / kill switch
 -> atomic budget reservation
 -> PRIMARY single submission or recorded-ID recovery
 -> preserve original provider MP4
 -> compose separate 8/10-second H.264/AAC copy with real narration/captions
 -> actual frame evidence + existing quality evaluation
 -> PASS: persist master for existing compliance/publishing path
    REVIEW: stop for human action
    confirmed failure / insufficient quality: FALLBACK once
 -> second failure: REVIEW_REQUIRED, no third automatic generation
```

Missing real narration or visual evaluation stops before spending. Production does not use mock product, voice or video providers. Variations reuse actual generated footage. Short source video is not stretched to invent content. Customer pages show progress, clip counts, spend/remaining budget and review actions; provider/model/raw error payloads stay in server records.

Video Factory detail provides authenticated product-photo and narration uploads for a master awaiting review. JPEG/PNG/WebP and WAV/MP3/M4A/OGG files are limited to 750,000 bytes each, below the existing server-action body limit. The server checks owner/master/project/product/account identity, file signatures and actual decoded media before saving original bytes in private owned storage. New filenames are generated server-side; unsuccessful metadata writes remove only their new object. Uploading an asset does not call a generation provider. The latest owned upload is used by the existing pipeline on review/retry.

## Server configuration

| Variable | Default / rule |
|---|---|
| `FAL_KEY` | Owner secret, never committed |
| `FAL_WAN_PROVIDER_STATE` | Existing `PRIMARY_CANDIDATE`; explicit owner approval required |
| `FAL_VIDEO_ENABLED` | `false`, immediate kill switch |
| `FAL_VIDEO_APPROVED_MODELS` | Empty; comma-separated exact endpoint allowlist |
| `FAL_VIDEO_PRIMARY_MODEL` | `fal-ai/ltxv-13b-098-distilled/image-to-video`, provisional |
| `FAL_VIDEO_FALLBACK_MODEL` | `wan/v2.6/image-to-video/flash`, provisional |
| `FAL_VIDEO_QUALITY_THRESHOLD` | `85`, permitted 85–100 |
| `FAL_VIDEO_MAX_ATTEMPTS` | `2`, permitted 1–2 |
| `FAL_VIDEO_PER_CLIP_CAP_USD` | `1`, cumulative primary + fallback |
| `FAL_VIDEO_PER_JOB_CAP_USD` | `1`, cumulative job spend/holds |
| `FAL_VIDEO_DAILY_CAP_USD` | `5`, combined with stricter existing account/run limits |
| `FAL_VIDEO_DURATION_SECONDS` | `8`, permitted 8 or 10 |
| `FAL_VIDEO_RESOLUTION` | `720p`, permitted 720p or 1080p |
| `VIDEO_PRODUCT_IMAGE_ALLOWED_HOSTS` | Optional exact external image hosts; prefer owned private storage |

Each job snapshots settings, threshold and caps. Environment changes do not silently reconfigure submitted jobs. Enabled/model approval gates also apply to recovery. A model with a higher native resolution uses that source resolution and composes to target; unsupported source policies fail clearly.

The SQL guard serializes reservations per owner, limits fal jobs to two operation slots, counts cumulative held/settled cost, retains ambiguous submissions, accumulates same-model costs without replay double counting, and prevents late callbacks/cancelled work from overwriting the final master. Guard/finalization RPCs are service-role-only; ownership RLS is preserved. Restrictive fal job write policies additionally prevent authenticated clients from modifying policy snapshots or changing a fal job's provider, while retaining owner reads and existing non-fal permissions.

## Owner activation actions

1. Create a key at [fal dashboard](https://fal.ai/dashboard/keys), configure server/benchmark `FAL_KEY` and fund billing. Do not send the key in chat.
2. Run the minimal comparison and review actual outputs using [the benchmark workflow](VIDEO_PROVIDER_BENCHMARK.md). Select by all-attempt cost per usable clip; no premium default is justified yet.
3. Apply the reviewed guard migration through the normal database release process before enabling generation.
4. Supply real product/narration assets and the existing visual evaluator; set account/run budgets to cover policy. An existing $0.10 per-video cap correctly blocks an approximately $0.161 primary.
5. Approve exact endpoints, set existing provider state `PRODUCTION_APPROVED`, and then enable the fal switch in the intended environment. Benchmark success alone does not activate production.

## Final verification (5 October 2026)

- Focused provider/model/pricing/pipeline/upload/budget/benchmark/policy tests: 145 passed; upload tests also passed after the final test-only lint cleanup.
- Full TypeScript suite: 667 passed, 1 skipped, 1 pre-existing failure. `src/features/operations/scheduler.test.ts:12` expects the recovery Cron entry in `vercel.json`, but both files at the starting HEAD already have the mismatch (`vercel.json` is `{}`). Scheduler/configuration are deliberately unchanged.
- Typecheck passed. Lint passed with no errors; seven existing unused mock-argument warnings remain in `fal-wan.test.ts`.
- Production build passed with temporary, non-secret public Supabase placeholder values in the build process only. This proves compilation, not live backend connectivity. Without those values the local build stops because the required public Supabase environment is absent; `.env.local` was not inspected or modified by this task.
- Isolated real PostgreSQL validation passed for budget caps, two attempts, ambiguous liability, replay, atomic finalization, owner isolation and service-only writes. Remote migration application remains pending.
- No-cost default/full benchmark plans validated the $1.560834/$4.682502 reservations and generated readable 720×1280 reference copies. No generation provider, deployment or live database mutation was performed.
