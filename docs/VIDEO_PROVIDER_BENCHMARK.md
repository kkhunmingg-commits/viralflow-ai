# Real Video AI Provider Benchmark V1

Phase 6B measures real image-to-video output against the eight-second ViralFlow commerce requirement and a user-supplied Flow AI reference set. It does not activate a provider in production, connect TikTok APIs, or put secrets in the browser.

## Why Runway Dev is the first benchmark gateway

The official Runway SDK exposes several first-party and partner video models through one authenticated API, queue contract, task-cost response, and output format. This lets the benchmark compare models without mixing billing semantics, polling reliability, download behavior, or gateway overhead. A later run may confirm the winning model through its direct provider API if that produces a material cost advantage.

Pricing was checked against the official Runway pricing and model documentation on 17 September 2026. One developer credit is $0.01. The V1 portrait, eight-second candidates are:

| Candidate | Eight-second forecast | Reason to test |
|---|---:|---|
| Gen-4 Turbo, 720×1280 | $0.40 | Lowest-cost established commerce candidate; exact 8s and portrait output |
| MiniMax H3 Max, 768p | $0.64 | Higher-resolution low-cost challenger; follows portrait source image |
| WAN 3.0, 720p | $0.80 | Reference-driven model with exact duration and portrait support |
| Hailuo 3.0, 768p | $0.82 | Quality challenger with image guidance; estimate includes one reference-image charge |
| Gen-4.5, 720×1280 | $0.96 | Higher-quality control candidate and practical ceiling |

The complete 3-fixture × 2-repeat matrix is forecast at **$21.72**. To reduce spend, run Stage 1 with `gen4_turbo,h3_max_768,wan3_720` first (**$11.04**). Run Hailuo and Gen-4.5 only if Stage 1 does not establish a consistent winner or the winner needs a quality ceiling comparison.

Official references:

- Runway pricing: https://docs.dev.runwayml.com/guides/pricing/
- Runway models: https://docs.dev.runwayml.com/guides/models/
- Runway input and aspect-ratio rules: https://docs.dev.runwayml.com/assets/inputs/
- Runway SDK/API guide: https://docs.dev.runwayml.com/guides/using-the-api/

## Fixtures and fairness

Use three licensed, representative product images:

1. Growth Beauty: label/packaging identity, hand interaction, and smooth beauty motion.
2. Affiliate Home: believable use motion, physics, and clear before/result framing without fabricated claims.
3. Affiliate Gadget: exact geometry, ports/controls, physically believable demonstration, and comparison clarity.

Each source should be a clean PNG, JPEG, or WebP under 5 MB and at least 720×1280. Use the same image, prompt, duration, aspect, repeat count, and deterministic seed where the model supports it. Do not use synthetic product identities to decide a production provider. The example manifest is a schema/template; its paths must be replaced with owner-approved assets.

## Two gates

The automatic gate requires all five checks:

- duration 8.00 seconds ±0.12;
- portrait ratio within 0.015 of 9:16;
- at least 540×960 pixels;
- H.264 output;
- non-empty file larger than 20 KB.

The final commerce output can add the existing local overlays, Thai voice, CTA, normalization, and AAC audio after the model supplies motion. The provider comparison therefore measures the expensive capability—product-preserving motion—without paying each provider to generate presentation elements already handled reliably by FFmpeg.

Every technically valid clip receives a blinded human score:

```text
VisualScore = 0.25 ProductIdentity
            + 0.20 MotionRealism
            + 0.15 PromptAdherence
            + 0.15 CommerceClarity
            + 0.15 ArtifactControl
            + 0.10 VisualPolish
```

Reviewers compare each clip beside the supplied Flow AI reference and the original product image. The score must reflect label/shape stability, believable physics, absence of melting/flicker, clear selling action, camera control, and polish. It must not reward invented product features.

## Eligibility and winner rule

A candidate is eligible only when:

- at least 80% of planned samples complete and pass the technical gate;
- every technical pass has a human review;
- average VisualScore is at least 85;
- no reviewed fixture is below 80.

Among eligible candidates, the winner is the lowest `TotalActualCost / ReviewedPassingOutputs`. Average visual score breaks a cost tie. A cheap model cannot win before the visual and consistency gates pass. If no candidate passes, the report returns no winner.

## Safe execution

The CLI defaults to planning and never calls a provider:

```text
pnpm benchmark:video -- --manifest benchmarks/video-provider-fixtures.json --models gen4_turbo,h3_max_768,wan3_720 --repeats 2
```

A paid run requires all of the following server-only values:

```text
RUNWAYML_API_SECRET=...
VIDEO_BENCHMARK_ALLOW_PAID=true
VIDEO_BENCHMARK_MAX_USD=11.04
```

Then add `--execute`. The runner refuses a forecast above the hard cap. It stores output and JSON evidence under `.video-benchmark/`, which Git ignores. Secrets are never serialized. Provider-returned task cost, latency, task ID, local path, technical evidence, failure reason, and forecast are retained.

If a process stops after some tasks complete, repeat the same command with `--resume`. Completed sample IDs are reused. A paid run refuses to overwrite an existing report without this flag, preventing accidental duplicate generations. Failed provider tasks retain any charge returned by the provider so cost-per-pass includes failed spend.

After blind review, fill a scores JSON keyed by sample ID and run:

```text
pnpm benchmark:video -- --scores benchmarks/video-provider-human-scores.json --report .video-benchmark/report.json
```

Only a completed report with a non-null winner may inform a future CostRouter production change. Phase 6B does not enable paid routing by itself.
