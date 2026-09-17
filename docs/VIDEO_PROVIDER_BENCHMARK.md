# Real Video AI Provider Benchmark V1

Phase 6B compares real eight-second image-to-video output for ViralFlow commerce. It does not activate a production provider, connect TikTok publishing, or expose provider secrets to the browser. A paid run remains disabled until the owner explicitly supplies licensed fixtures, a Flow AI reference clip, provider keys, and a spending cap.

## Revised provider scope

Pricing and capabilities were checked against provider documentation on 17 September 2026.

| Candidate | Access | 8-second 720p forecast | Role |
|---|---|---:|---|
| Meta AI / Vibes | **MANUAL_BENCHMARK_ONLY** | $0 provider charge; manual labor excluded | Owner-supplied comparison only; no supported public video-generation API |
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

## Meta AI / Vibes findings

The official Vibes announcement describes a consumer feed in the Meta AI app and on meta.ai. People can start from scratch, work with existing content, and remix videos. Meta's European announcement also describes image generation and animation in the app. Neither announcement exposes a developer endpoint. The current Meta Model API publicly lists Muse Spark and Muse Image, while Meta's July 2026 Muse Video announcement calls video an early preview that is “coming soon” to creators and Meta AI. No official public Muse Video or Vibes generation API was found.

The resulting status is **`MANUAL_BENCHMARK_ONLY`**:

- **Image-to-video:** consumer Vibes can animate or work from existing media, but there is no documented server API contract for product image-to-video.
- **Duration:** Meta officially documents transforming 10 seconds of an uploaded video in its consumer video editor, and the Muse Video preview includes an approximately 10-second example. Vibes generation duration is not published as a guaranteed parameter.
- **Output:** official public documentation does not specify Vibes export resolution, codec, container, or a guaranteed aspect-ratio matrix. Meta's Muse Video preview includes a vertical 9:16 example, but that is evidence of model capability rather than an API contract.
- **Provenance:** Meta says Muse Image carries the invisible Content Seal signal and that video support is planned. Meta also requires disclosure for realistic AI-generated or materially altered video posted on its platforms and may display an `AI info` label. ViralFlow must retain AI provenance and disclosure metadata even when the imported file has no detectable watermark.
- **Commercial use:** Meta presents these tools for creators and shows business/marketing examples, but the publicly accessible Vibes materials do not grant or clearly document an off-platform commercial/e-commerce output license. Commercial suitability therefore remains **unverified** until the owner reviews the applicable account's Meta AI Terms and any media/music rights.
- **Free limits:** Meta AI describes everyday use as free with usage limits on compute-intensive features and optional subscription access after limits. Meta previously described 10-second video editing as free for a limited time. No public Vibes video-generation quota or reset schedule is documented.
- **Automation:** unsupported. ViralFlow will not scrape Meta AI, drive the consumer UI, rotate accounts, or treat manual generation as an Auto Mode provider.

Official Meta references:

- Vibes product announcement: https://about.fb.com/news/2025/09/introducing-vibes-ai-videos/
- Meta AI image animation and Vibes in Europe: https://about.fb.com/news/2025/11/bringing-vibes-to-europe-a-new-way-to-create-share-and-play-in-the-meta-ai-app/
- 10-second consumer video editing: https://about.fb.com/news/2025/06/edit-videos-with-meta-ai/
- Muse Video preview and Content Seal plan: https://ai.meta.com/blog/introducing-muse-image-muse-video-msl/
- Current developer product surface: https://ai.meta.com/llama/
- AI-generated content disclosure: https://about.fb.com/news/2024/02/labeling-ai-generated-images-on-facebook-instagram-and-threads/
- Meta AI free-use statement: https://ai.meta.com/meta-ai/assistant/

## Cost-first staged plan

The benchmark order is free/credit-and-quality first. Meta appears first as a manual comparison slot, followed by the executable Stage 1 providers:

1. Meta AI / Vibes — manual owner-supplied clip only
2. fal Wan 2.2 Turbo
3. PixVerse V6
4. Runway Gen-4 Turbo

The lowest published-equivalent Stage 1 generation cost is **$2.46**: fal $0.30 + PixVerse $0.96 + Runway $1.20. The conservative forecast and required hard cap are **$3.66**, because package-rate PixVerse usage may be $2.16 for the three clips. Account funding or subscription minimums can exceed consumed generation cost.

No second sample is generated automatically. A second sample is eligible per product/provider only after the first sample:

- reaches the automated technical threshold of 85;
- receives `FLOW_COMPARABLE` or `ABOVE_FLOW` beside the owner's reference clip;
- still fits under the total hard budget.

The `--second-round` command requires `--resume`, a scored first-round report, `--flow-reference-confirmed`, and the same hard cap. Samples that do not meet all gates are recorded as `SKIPPED`; completed IDs are reused so retries cannot pay twice for them.

## Manual Meta/Vibes import

Use the same source product image and creative intent as the corresponding fixture. The owner creates the clip manually in an authorized Meta AI/Vibes experience, downloads it, and imports it locally:

```text
pnpm benchmark:video -- --import-meta C:\path\to\owner-meta-output.mp4 --fixture-id growth-beauty --report .video-benchmark/report.json
```

The importer never alters the source file. It creates a separate derived MP4 under `.video-benchmark/outputs`, trims sources of approximately 10 seconds to 8 seconds, normalizes to 720×1280, 30 fps, H.264/yuv420p, removes audio for the motion-only comparison, and applies the same automated score. The report records one generation, unknown quota usage, `$0` provider cost, `humanLaborRequired: true`, and `sourceKind: OWNER_MANUAL_IMPORT`.

Manual output may earn a quality status after comparison with the owner's Flow AI reference, but it remains ineligible for Auto Mode and cannot become the production winner. Its `$0` field means no measured provider charge; it does not mean zero operational cost.

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
