# Video cost strategy

ViralFlow minimizes paid master generations while preserving meaningful creative variation. The current target is 15–20 AI masters per day for three accounts and 40–50 masters per day for ten accounts. Existing local FFmpeg composition produces the final candidates. A variation must change the hook, opening, scene structure, CTA, voice/script, approved product asset, or creative angle. Crop or zoom alone is not counted as sufficient originality, and every variation still passes Phase 6C.

## Router formula

Only automatable providers with real benchmark evidence are eligible:

```text
RetryAdjustedCost = NominalGenerationCost / ObservedSuccessRate
SelectionScore = (TechnicalQuality / 100)
               × ObservedSuccessRate
               / RetryAdjustedCost
```

The provider must also meet automated quality 85, have at least one real sample, and receive `FLOW_COMPARABLE` or `ABOVE_FLOW` beside the owner's Flow reference. `GOOGLE_FLOW_MANUAL` and Meta/Vibes remain manual-only. The router ranks evidence rather than hardcoding a permanent winner.

The intended evaluation sequence is reusable approved master, legitimate automatable free/credit source, sufficient local composition, Google Veo 3.1 Lite, fal Wan 2.2 Turbo, PixVerse V6, Runway Gen-4 Turbo, and premium models only when justified. Benchmark evidence may change this order.

## Current public prices used for planning

| Provider | 8-second 720p nominal cost | Source/assumption |
|---|---:|---|
| Google Veo 3.1 Lite | $0.40 | $0.05/second, official Gemini API pricing |
| Google Veo 3.1 Fast | $0.80 | $0.10/second, official Gemini API pricing |
| fal Wan 2.2 Turbo | $0.10 | official fal model price per 720p video |
| PixVerse V6 | $0.72 conservative | 72 credits × configured $0.01/credit; actual package can be lower |
| Runway Gen-4 Turbo | $0.40 | 5 credits/second × 8 seconds × $0.01/credit |

Pricing sources:

- Google: https://ai.google.dev/gemini-api/docs/pricing
- fal: https://fal.ai/models/fal-ai/wan/v2.2-a14b/image-to-video/turbo
- PixVerse: https://docs.platform.pixverse.ai/pricing-796039m0
- Runway: https://docs.dev.runwayml.com/guides/pricing/

Forecasts use an 85% planning success rate only to expose retry risk. Real routing must replace this assumption with observed benchmark reliability.

## Three-account forecast

Target: 15–20 masters/day, 45–60 final clips/day, 450–600 AI generations/month, and 1,350–1,800 final clips/month.

| Provider | Nominal/month | Retry-adjusted/month | Retry-adjusted cost/final |
|---|---:|---:|---:|
| Veo Lite | $180–$240 | $211.76–$282.35 | $0.1176–$0.2092 |
| Veo Fast | $360–$480 | $423.53–$564.71 | $0.2353–$0.4183 |
| fal Wan | $45–$60 | $52.94–$70.59 | $0.0294–$0.0523 |
| PixVerse | $324–$432 | $381.18–$508.24 | $0.2118–$0.3765 |
| Runway Gen-4 Turbo | $180–$240 | $211.76–$282.35 | $0.1176–$0.2092 |

## Ten-account forecast

Target: 40–50 masters/day, 150 final clips/day, 1,200–1,500 AI generations/month, and 4,500 final clips/month.

| Provider | Nominal/month | Retry-adjusted/month | Retry-adjusted cost/final |
|---|---:|---:|---:|
| Veo Lite | $480–$600 | $564.71–$705.88 | $0.1255–$0.1569 |
| Veo Fast | $960–$1,200 | $1,129.41–$1,411.76 | $0.2510–$0.3137 |
| fal Wan | $120–$150 | $141.18–$176.47 | $0.0314–$0.0392 |
| PixVerse | $864–$1,080 | $1,016.47–$1,270.59 | $0.2259–$0.2824 |
| Runway Gen-4 Turbo | $480–$600 | $564.71–$705.88 | $0.1255–$0.1569 |

The cheapest nominal provider is not automatically selected. Product identity, motion, artifacts, commercial suitability, prompt adherence, visual attractiveness, technical pass rate, and accepted-output cost determine the winner.

## Spending controls

Every paid benchmark needs both `VIDEO_BENCHMARK_ALLOW_PAID=true` and a positive `VIDEO_BENCHMARK_MAX_USD`. ViralFlow computes the full forecast before execution and stops if it exceeds the cap. Production account budgets also enforce per-video, provider, run, account, daily, and monthly limits. Google AI Studio project spend caps are a second guard, not a replacement for ViralFlow's pre-request checks.
