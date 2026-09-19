# Real Video AI Provider Benchmark V1

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
