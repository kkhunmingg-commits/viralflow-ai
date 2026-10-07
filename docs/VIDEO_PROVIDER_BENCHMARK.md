# Real Video AI Provider Benchmark

Updated 7 October 2026. The current task extends the existing harness for an 8–10-second fal-only production comparison. Earlier Stage B/C notes below are historical; the current policy and budgets in this section supersede their routing/forecast assumptions.

## Current results and approvals

**NOT_RUN — BILLING_CONFIRMATION_REQUIRED.** The owner supplied `FAL_KEY` in the ignored local environment; authenticated pricing works, but the read-only account billing request returned HTTP403. No credential is recorded in this document, source, artifacts, or client code. Real generations 0, paid spend $0, outputs 0. Success rate, usable rate, invoice cost and generation latency are not measured. PRIMARY/FALLBACK are not selected from real evidence yet; no model becomes `PRODUCTION_APPROVED` from a dry plan. Original Beauty/Home/Gadget assets remain ignored and unchanged. A real owner Flow reference is optional for commercial/technical evaluation, but required for any Flow-equivalence label.

The current owner-authorized matrix uses three shared fixtures from `benchmarks/fal-commerce-fixtures.json`: a fictional labelled carton, the existing skincare bottle, and the existing gadget with a single human button-press prompt. The carton is reproducible native SVG artwork rasterized locally; no stock or paid image generation is involved. All source JPGs are1254×1254. `scripts/create-fal-benchmark-fixtures.mjs` records creation methods, image/prompt hashes, and integrity under ignored `benchmark-assets/`. Each fixture receives the same reference and prompt across models. No overlays are rendered into outputs.

Selected models are LTX Distilled, LTX Fast, and Wan Flash. The authenticated pricing response confirmed USD rates of0.02,0.06, and0.05 per second respectively. Conservative native-setting reserves total **$3.422502 for nine attempts**, below the authorized **$5 hard cap**. Wan's audio-off discount is an estimate, not a recorded bill. These are forecasts only; invoice cost and usable cost remain unknown until real outputs and billing evidence exist. The current ignored no-cost plan is `.video-benchmark/fal-production-20261007/report.json`.

## Reviewed candidates (5 October 2026)

| Candidate / endpoint | Native settings | Estimated / reserved USD |
|---|---|---:|
| LTX Distilled: `fal-ai/ltxv-13b-098-distilled/image-to-video` | 193 frames at24fps (~8.0417s), 720p9:16, detail off | 0.160834 / 0.160834 |
| Kling Standard: `fal-ai/kling-video/v2.5-turbo/standard/image-to-video` | 10s; portrait inherited from reference | 0.42 / 0.42 |
| LTX Fast: `fal-ai/ltx-2.3/image-to-video/fast` | 8s,1080p9:16, audio off | 0.48 / 0.48 |
| Wan Flash: `wan/v2.6/image-to-video/flash` | 10s,720p, audio off; portrait inherited | 0.25 inferred / 0.50 |

Official pages: [LTX Distilled](https://fal.ai/models/fal-ai/ltxv-13b-098-distilled/image-to-video), [Kling Standard](https://fal.ai/models/fal-ai/kling-video/v2.5-turbo/standard/image-to-video), [LTX Fast](https://fal.ai/models/fal-ai/ltx-2.3/image-to-video/fast), [Wan Flash](https://fal.ai/models/wan/v2.6/image-to-video/flash/api). These endpoints are catalogued for commercial inference. Output fidelity, runtime, exact source geometry and bill are verified from real results, not assumed from labels.

Wan2.2Turbo stays implemented but has no documented duration/frame input: it is not eligible in this8–10-second policy comparison without measured evidence. Non-Turbo Wan2.2(~$0.645), newer/premium Kling(~$0.672 for8s) and LTX2.5(~$0.72 for8s) are higher-cost comparisons, not justified defaults. Legacy LTX preview/research endpoint is excluded. LongCat distilled's lower advertised rate does not supply sufficiently documented portrait composition for this contract; do not silently use it as a winner.

## Minimal run and cumulative cap

Default `--fal-production` uses the first fixture only across four candidates, sorted by conservative cost. Forecast **$1.560834 reserved**, **$1.310834 minimum estimated**. Only models with a technically and commercially passing first sample can proceed to the other products using `--all-fixtures --resume`. All four models ×3products reserve **$4.682502**. Total hard benchmark cap is **$5**, including failed and unresolved attempts; a configured smaller cap is respected. There are no paid retries, repeat samples, or cross-provider calls.

`--matrix` is a separate explicit opt-in for the owner's three-product comparison. It requires at least three fixtures and retains the same full-forecast, per-request reserve, hard-cap, exclusive-lock, and one-attempt-per-model/fixture guards. It does not invent first-sample scores or permit an automatic second generation.

Before `--execute`, read-only authenticated [pricing](https://fal.ai/docs/platform-apis/v1/models/pricing) and [estimate](https://fal.ai/docs/platform-apis/v1/models/pricing/estimate) calls verify current USD billing units. Missing/ambiguous price, invalid forecast or cap excess stops before paid submit.

The same full-image reference is padded into a hash-addressed720×1280COPY for every model, preserving product packaging. Sources remain unchanged. All models receive the same licensed synthetic product intent; providers lacking an explicit aspect field receive the same portrait reference. Original output remains `*-source.mp4`; normalization creates a separate copy. Native portrait geometry and7.88–10.2s source duration are required, so post-normalization padding cannot disguise a landscape/short source.

```text
# No-cost preparation/forecast (does not read .env.local)
pnpm benchmark:video -- --fal-production --manifest scripts/fixtures/fal-commerce-benchmark.json

# Current authorized three-model / three-product matrix: preparation only
pnpm benchmark:video -- --fal-production --matrix --manifest benchmarks/fal-commerce-fixtures.json --models fal_ltx_distilled,fal_ltx_2_3_fast,fal_wan_2_6_flash --report .video-benchmark/fal-production-20261007/report.json --output .video-benchmark/fal-production-20261007/outputs

# Owner configures server FAL_KEY, VIDEO_BENCHMARK_ALLOW_PAID=true,
# VIDEO_BENCHMARK_MAX_USD=5 before explicitly enabling a real run.
pnpm benchmark:video -- --fal-production --manifest scripts/fixtures/fal-commerce-benchmark.json --execute --resume

# Import visual review without another generation:
pnpm benchmark:video -- --fal-production --commerce-scores /absolute/path/reviews.json

# Only passing models, same journal and cap, remaining two products:
pnpm benchmark:video -- --fal-production --manifest scripts/fixtures/fal-commerce-benchmark.json --models fal_ltx_distilled,fal_wan_2_6_flash --all-fixtures --execute --resume

# Read-only recovery: same matrix, journal and original provider request IDs
pnpm benchmark:video -- --fal-production --matrix --manifest benchmarks/fal-commerce-fixtures.json --models fal_ltx_distilled,fal_ltx_2_3_fast,fal_wan_2_6_flash --report .video-benchmark/fal-production-20261007/report.json --output .video-benchmark/fal-production-20261007/outputs --recover --resume
```

Last command is illustrative: models must actually pass first-sample review. A no-cost whole-plan forecast may use `--all-fixtures` without `--execute`. All generated files/reviews/journal are under ignored `.video-benchmark/fal-production/`; product images are under ignored `benchmark-assets/`. Never commit credentials or media.

Durable `benchmark-journal.json` records liability, original endpoint/native settings, input path, and planned source/copy paths before submit, then request ID after acceptance. Exclusive lock rejects simultaneous processes. Completed/failed attempts are not resubmitted on paid resume; changed inputs or any reserved/submitted/unknown liability require reconciliation. `--recover --resume` requires a server-only key and positive original cap, uses only read-only retrieval of saved fal request IDs, and cannot submit or upload new references. It skips price re-quoting and restores original settings/reservations. Rows with no request ID remain unresolved. Do not remove locks/journal to retry an ambiguous call. Estimates remain reserves unless the provider exposes a valid recorded charge. Valid charges exceeding the reserve are persisted before the run stops; they must never be hidden by a guard exception.

Only the minimal shared POST execution-mode contract is carried onto this branch: external creative/video/quality/publishing/analytics boundaries require both server `POST_AUTOMATION_EXECUTION_MODE=LIVE` and the existing database mode RPC to return LIVE. Default SAFE, a missing RPC, database errors, or a missing server opt-in remain no-spend. No scheduler, account schema, migrations, TikTok configuration, production flags, or credentials are changed.

## Quality and metadata

Each attempt records endpoint/native settings, source and normalized durations/resolution/codec/integrity, original/reference/output paths, queue/generation/total latency, conservative estimate, recorded cost (nullable), paid attempts and retry count. The technical gate requires all checks and score>=85. Commercial score is identity30%, packaging20%, motion15%, temporal15%, appeal10%, composition10%; total>=85, identity>=90, packaging/temporal>=85, human anatomy>=85 when present.

Commercial reviews are keyed by sample ID (for example `fal_ltx_distilled:beauty:1`) with fields `productIdentity`, `packagingFidelity`, `motion`, `anatomy` (null when absent), `temporalConsistency`, `commercialAppeal`, `composition`, `notes`, `reviewedBy` (`OWNER` or `CODEX_VISUAL_REVIEW`). Reviews must come from inspecting actual videos.

Selection uses total attempted cost including failures divided by usable clips; lowest usable cost wins, measured latency breaks ties. Require all observed samples to pass and retain preliminary-sample limits in reporting. Output state is `BENCHMARK_PASS_PENDING_OWNER_REVIEW`, never automatic production approval or a fabricated Flow rating. PREMIUM remains unset unless observed evidence justifies it. See [cost strategy](VIDEO_COST_STRATEGY.md) and [activation gates](FAL_WAN_PROVIDER.md).

---

## Historical Stage B/C record (not current fal policy)


### Previous Real Video AI Provider Benchmark V1

Updated 19 September 2026. fal Wan 2.2 Turbo is the primary production candidate. Google Veo remains implemented but disabled as a premium fallback. No provider may enter Auto Mode until real evidence and owner approval exist.

## Primary stage

| Order | Candidate | State | 720p nominal cost | Role |
|---:|---|---|---:|---|
| 1 | Reusable approved master | Ready | $0 | Reuse before generation |
| 2 | Legitimate automatable local/free source | Conditional | $0 plus operations | Use only when genuinely automatable |
| 3 | fal Wan 2.2 Turbo | `PRIMARY_CANDIDATE` | $0.10/video | First real paid benchmark |
| 4 | Google Veo 3.1 Lite | `FALLBACK_DISABLED` | $0.40/8 sec | Premium fallback retained |
| 5 | PixVerse V6 | Fallback | Package-dependent | Run only if fal fails |
| 6 | Runway Gen-4 Turbo | Fallback | $0.40/8 sec | Run only if cheaper candidates fail |

Meta/Vibes remains `MANUAL_BENCHMARK_ONLY`. TikTok Symphony remains `NOT_RUN`. Other Runway models remain available as quality comparisons. This stage must not call Veo, PixVerse, Runway, Meta, or Symphony.

## Verified fal contract

Official sources: [fal Wan 2.2 Turbo API](https://fal.ai/models/fal-ai/wan/v2.2-a14b/image-to-video/turbo/api), [fal queue API](https://fal.ai/docs/documentation/model-apis/inference/queue), and [fal terms](https://fal.ai/legal/terms-of-service).

- Endpoint: `fal-ai/wan/v2.2-a14b/image-to-video/turbo`.
- Official model page labels the endpoint for inference and commercial use.
- Input supports image-to-video, `480p`, `580p`, `720p`, and `auto`, `16:9`, `9:16`, `1:1` aspect ratios.
- Input and output safety checkers are supported. Disabling the input checker requires account authorization, so ViralFlow enables both checkers.
- The endpoint supports asynchronous queue submit, status, and result operations. Results expose a downloadable file URL; the official example is MP4. Codec is measured from each downloaded output rather than assumed.
- Current advertised price is $0.10 per 720p video, $0.075 at 580p, and $0.05 at 480p.
- The Turbo request schema does **not** expose `num_frames` or `frames_per_second`. ViralFlow does not send those unsupported fields. Source duration is `PROVIDER_DEFINED` and is measured after download.
- The endpoint page does not publish a specific rate-limit number. Runtime 429/provider errors remain fail-closed and are not paid-retried in this benchmark.

## Exact eight-second handling

The original provider output is always preserved as `*-source.mp4`. If the source contains at least 7.88 seconds, a separate copy is normalized to exactly 8 seconds, 720×1280, 30 fps, H.264 with the existing FFmpeg pipeline. Sources shorter than 7.88 seconds are not stretched or fabricated; they fail the duration gate and remain available for inspection. The report records both source and normalized durations.

## Three-call benchmark

The ignored assets are `benchmark-assets/beauty.jpg`, `benchmark-assets/home.jpg`, and `benchmark-assets/gadget.jpg`. `flow-baseline.mp4` is optional for technical scoring. Without it, the report uses `FLOW_REFERENCE_STATUS=OWNER_REQUIRED` and cannot claim `FLOW_COMPARABLE` or `ABOVE_FLOW`. The owner may directly approve the three fal outputs as production quality without making a Flow-equivalence claim.

Paid execution requires:

```text
FAL_KEY=<server-only>
VIDEO_BENCHMARK_ALLOW_PAID=true
VIDEO_BENCHMARK_MAX_USD=0.30
pnpm benchmark:video -- --manifest benchmarks/stage-fal-wan.json --models fal_wan_2_2_turbo --execute
```

The forecast is exactly 3 × $0.10 = $0.30. Each fixture has one paid attempt and no automatic paid retry. Existing reports require `--resume`, so completed samples are not regenerated.

## Quality and decision states

The automated technical gate remains 85/100 and checks 8.00 ± 0.12 seconds, portrait ratio, minimum 540×960 resolution, non-empty media, H.264, and at least 24 fps. Human review separately scores product identity, motion naturalness, deformation/artifacts, commercial suitability, prompt adherence, and visual attractiveness.

- Before real evidence: `PRIMARY_CANDIDATE`.
- All three technical samples pass: `BENCHMARK_PASS_PENDING_OWNER_REVIEW`.
- Any required sample fails: `BENCHMARK_FAILED`.
- Only explicit owner visual approval: `PRODUCTION_APPROVED`.

Auto Mode requires `FAL_KEY`, passing evidence, and `PRODUCTION_APPROVED`. Otherwise it remains `WAITING_FOR_PROVIDER`. Google Veo, PixVerse, and Runway integrations stay available as disabled fallbacks.

## Cost forecast

At $0.10 per master, the three-account pilot uses 450–600 masters/month for $45–$60 nominal. Ten accounts use 1,200–1,500 masters/month for $120–$150 nominal. Retry-adjusted cost is `nominal cost / observed success rate`; until real data exists, the UI labels the 85% value as a planning assumption, yielding about $0.1176 per passing master, $52.94–$70.59/month for three accounts, and $141.18–$176.47/month for ten accounts.
