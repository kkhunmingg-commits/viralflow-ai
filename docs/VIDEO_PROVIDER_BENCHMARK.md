# Real Video AI Provider Benchmark V1

The benchmark compares real eight-second portrait product videos without activating a production provider. Paid execution is disabled until the owner supplies licensed product images, an owner Flow reference, server-only keys, explicit paid mode, and a hard USD cap.

## Candidate sequence

| Stage | Candidate | Access | 8-second 720p forecast | Purpose |
|---|---|---|---:|---|
| A | Google Flow owner reference | `MANUAL_BENCHMARK_ONLY` | Consumer credits; manual labor | Human quality baseline only |
| B | Google Veo 3.1 Lite API | Ready after key and approval | $0.40 | Primary official Google API candidate |
| C1 | fal Wan 2.2 Turbo | Ready after key and approval | $0.10 | Lower-cost fallback |
| C2 | PixVerse V6 | Ready after key and approval | $0.32–$0.72 | Direct fallback |
| C3 | Runway Gen-4 Turbo | Ready after key and approval | $0.40 | Runway comparison |
| Ceiling | Veo 3.1 Fast / Standard | Ready after key and approval | $0.80 / $3.20 | Run only when Lite needs a quality comparison |
| Fallback | H3 Max, WAN 3, Hailuo 3, Gen-4.5 | Ready after Runway key | Existing catalog | Run only if cheaper candidates fail |
| Manual | Meta AI / Vibes | `MANUAL_BENCHMARK_ONLY` | Manual | Optional comparison; no supported public generation API |
| Blocked | TikTok Symphony | `NOT_RUN` | Unknown | Missing approved access and public unit price |

Stage B costs at most **$1.20** for three products × one Veo Lite sample. The harness calculates this amount before any request. Stage C is not run automatically. The benchmark stops when a sufficiently cheap candidate passes consistently.

## Fixtures and gates

Use one licensed Beauty, Home, and Gadget product image with the same creative intent for every candidate. Every candidate receives 8 seconds, `9:16`, 720p, and the same seed when supported.

The automated score is:

```text
25 duration: 8.00s ± 0.12
20 portrait ratio
20 resolution at least 540×960
15 non-empty media over 20 KB
10 H.264 codec
10 frame rate at least 24 fps
```

The pass threshold is 85. Human scoring remains:

```text
HumanQualityScore = 0.25 ProductIdentityPreservation
                  + 0.20 MotionNaturalness
                  + 0.15 ArtifactDeformationControl
                  + 0.15 CommercialTikTokSuitability
                  + 0.15 PromptAdherence
                  + 0.10 VisualAttractiveness
```

Human status is `BELOW_FLOW`, `FLOW_COMPARABLE`, or `ABOVE_FLOW`. The harness rejects the latter two unless the reviewer confirms the owner's Flow clip was present. No current provider has been claimed Flow-comparable.

A second sample is allowed only when the first passes the technical gate, is potentially Flow-comparable, and remains under the cap. Completed sample IDs are resumed rather than paid for again.

## Google Flow manual import

Google Flow consumer credits are not Gemini API billing and cannot supply Auto Mode. There is no supported Flow automation API in the official material reviewed on 18 September 2026. ViralFlow never automates the Flow UI.

The owner can supply a Flow output:

```text
pnpm benchmark:video -- --import-flow C:\path\to\owner-flow-output.mp4 --fixture-id growth-beauty --report .video-benchmark/report.json
```

The original stays unchanged. A separate MP4 is trimmed to eight seconds, normalized to 720×1280 H.264, and scored. The report records manual labor and excludes the candidate from Auto Mode.

Meta/Vibes uses the existing `--import-meta` path and remains manual-only for the same operational reason.

## Safe execution

Planning is free:

```text
pnpm benchmark:video -- --manifest benchmarks/video-provider-fixtures.json
```

An intentional live Veo Lite run additionally requires:

```text
GOOGLE_GENAI_API_KEY=<server-only>
VIDEO_BENCHMARK_ALLOW_PAID=true
VIDEO_BENCHMARK_MAX_USD=1.20
pnpm benchmark:video -- --manifest benchmarks/video-provider-fixtures.json --models veo_3_1_lite --execute
```

No live command was run in this change. Secrets are never written to reports. Evidence remains under ignored `.video-benchmark/`.

## Router decision

The production CostRouter still has no real winner. A candidate must have real samples, technical score at least 85, complete owner comparison, Flow-comparable status, and observed reliability. Eligible providers are ranked by quality × success rate ÷ retry-adjusted cost. See `GOOGLE_VEO_PROVIDER.md` and `VIDEO_COST_STRATEGY.md`.
