# Real Video AI Provider Benchmark V1

Phase 6B compares real eight-second image-to-video output for ViralFlow commerce. It does not activate a production provider, connect TikTok publishing, or expose provider secrets to the browser. A paid run remains disabled until the owner explicitly supplies licensed fixtures, a Flow AI reference clip, provider keys, and a spending cap.

## Revised provider scope

Pricing and capabilities were checked against provider documentation on 17 September 2026.

| Candidate | Access | 8-second 720p forecast | Role |
|---|---|---:|---|
| fal Wan 2.2 Turbo | Ready after `FAL_KEY` | $0.10 | First test and lowest-cost direct candidate |
| PixVerse V6 | Ready after `PIXVERSE_API_KEY` | $0.32–$0.72 | Direct 8-second challenger; 72 credits without audio |
| Runway Gen-4 Turbo | Ready after `RUNWAYML_API_SECRET` | $0.40 | Cheapest Runway comparison |
| Runway H3 Max | Ready after Runway key | $0.64 | Fallback comparison |
| Runway WAN 3 | Ready after Runway key | $0.80 | Fallback comparison |
| Runway Hailuo 3 | Ready after Runway key | $0.82 | Fallback comparison; includes one image reference |
| Runway Gen-4.5 | Ready after Runway key | $0.96 | Quality-ceiling comparison |
| TikTok Symphony | **NOT_RUN** | Unknown | Legitimate API exists, but this environment has no approved app/access token/advertiser scope or public unit price |

PixVerse's conservative hard-cap estimate uses package credits at $10 per 1,000 credits: 72 × $0.01 = $0.72. Its published Starter-pack example equates a V6 720p five-second clip to $0.20; proportional eight-second consumption is $0.32. The CLI uses the conservative rate unless `PIXVERSE_USD_PER_CREDIT` is set from the actual purchased API plan.

Official sources:

- fal Wan 2.2 Turbo model and price: https://fal.ai/models/fal-ai/wan/v2.2-a14b/image-to-video/turbo
- PixVerse V6 capabilities: https://docs.platform.pixverse.ai/v6-2056814m0
- PixVerse pricing: https://docs.platform.pixverse.ai/pricing-796039m0
- PixVerse image-to-video API: https://docs.platform.pixverse.ai/image-to-video-882971m0
- TikTok Symphony API overview: https://ads.tiktok.com/creative/creativeCenter/tools/api
- Runway pricing: https://docs.dev.runwayml.com/guides/pricing/
- Runway models: https://docs.dev.runwayml.com/guides/models/

## Cost-first staged plan

Stage 1 is exactly three licensed products × one run for each candidate, in this order:

1. fal Wan 2.2 Turbo
2. PixVerse V6
3. Runway Gen-4 Turbo

The lowest published-equivalent Stage 1 generation cost is **$2.46**: fal $0.30 + PixVerse $0.96 + Runway $1.20. The conservative forecast and required hard cap are **$3.66**, because package-rate PixVerse usage may be $2.16 for the three clips. Account funding or subscription minimums can exceed consumed generation cost.

No second sample is generated automatically. A second sample is eligible per product/provider only after the first sample:

- reaches the automated technical threshold of 85;
- receives `FLOW_COMPARABLE` or `ABOVE_FLOW` beside the owner's reference clip;
- still fits under the total hard budget.

The `--second-round` command requires `--resume`, a scored first-round report, `--flow-reference-confirmed`, and the same hard cap. Samples that do not meet all gates are recorded as `SKIPPED`; completed IDs are reused so retries cannot pay twice for them.

## Fixtures and fairness

Use three licensed product images: Growth Beauty, Affiliate Home, and Affiliate Gadget. Each source should be a clean PNG, JPEG, or WebP, at least 720×1280. Every candidate receives the same source, prompt, 8-second duration, portrait framing, and seed where supported. The manifest in `benchmarks/` is a schema example and contains no production media.

## Automated gate

`AutomatedQualityScore` totals 100:

```text
25 duration: 8.00s ± 0.12
20 portrait: 9:16 ratio ± 0.015
20 resolution: at least 540×960
15 non-empty: more than 20 KB
10 codec: H.264
10 frame rate: at least 24 fps
```

A score of **85 or higher** passes. H.264 and frame-rate misses can be normalized by the existing local FFmpeg stage, while duration, orientation, resolution, and usable media remain decisive.

## Human quality and reliability

Every technical pass is reviewed blind on the requested dimensions:

```text
HumanQualityScore = 0.25 ProductIdentityPreservation
                  + 0.20 MotionNaturalness
                  + 0.15 ArtifactDeformationControl
                  + 0.15 CommercialTikTokSuitability
                  + 0.15 PromptAdherence
                  + 0.10 VisualAttractiveness
```

Reliability is objective: completed technical passes divided by planned executable samples, with failed spend included in effective cost. A candidate needs at least 80% reliability, complete human review, average HumanQualityScore ≥85, no reviewed fixture below 80, and Flow-comparable status on every reviewed pass.

The only human comparison statuses are `BELOW_FLOW`, `FLOW_COMPARABLE`, and `ABOVE_FLOW`. The harness rejects `FLOW_COMPARABLE` or `ABOVE_FLOW` unless the reviewer explicitly confirms that the owner's Flow AI reference clip was present. Until that clip is supplied, the benchmark cannot claim Flow equivalence or select a winner.

## Safe execution

Planning is free and is the default:

```text
pnpm benchmark:video -- --manifest benchmarks/video-provider-fixtures.json
```

Live Stage 1 additionally requires the provider keys in `.env.local`, `VIDEO_BENCHMARK_ALLOW_PAID=true`, a `VIDEO_BENCHMARK_MAX_USD` of at least the current conservative forecast, and `--execute`. Secrets are never serialized. Output and JSON evidence stay under ignored `.video-benchmark/`.

After blind review, apply scores only with the owner's reference available:

```text
pnpm benchmark:video -- --scores benchmarks/video-provider-human-scores.json --report .video-benchmark/report.json --flow-reference-confirmed
```

Then, and only for qualified samples:

```text
pnpm benchmark:video -- --manifest benchmarks/video-provider-fixtures.json --execute --resume --second-round --flow-reference-confirmed
```

Only a completed report with a non-null winner may inform a separately reviewed CostRouter change.
