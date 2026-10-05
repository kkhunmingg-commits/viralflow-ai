# Video cost strategy

Updated 5 October 2026. Reuse approved masters before paying for another. Variations must change meaningful creative content and pass existing quality/compliance/originality gates. Current fal defaults are provisional: no production winner is asserted.

## Current comparison

| Candidate | Native source request | Public estimated charge | Conservative reservation |
|---|---|---:|---:|
| LTX 0.9.8 Distilled | 193 frames / 24 fps, 720p portrait, detail off | $0.160833… | $0.160834 benchmark |
| Wan 2.6 Flash | 10 seconds, 720p, silent | $0.25, conditional-price inference | $0.50 |
| Kling 2.5 Turbo Standard | 10 seconds, portrait reference | $0.42 | $0.42 |
| LTX 2.3 Fast | 8 seconds, 1080p portrait, silent | $0.48 | $0.48 |

Current official sources: [LTX Distilled](https://fal.ai/models/fal-ai/ltxv-13b-098-distilled/image-to-video), [Wan Flash API](https://fal.ai/models/wan/v2.6/image-to-video/flash/api), [Kling Standard](https://fal.ai/models/fal-ai/kling-video/v2.5-turbo/standard/image-to-video), [LTX Fast](https://fal.ai/models/fal-ai/ltx-2.3/image-to-video/fast). Wan silent pricing is inferred from the documented 25% of standard I2V condition; reserve the higher audio-on Flash quote pending authenticated verification. Actual charges/latency remain unknown: **0 real generations, $0 spend, no FAL_KEY available**.

Legacy Wan 2.2 Turbo is $0.10/video but its schema cannot request duration/frames; it is excluded from the 8–10-second policy comparison without measured duration evidence. Preview/research-only LTX and models lacking documented portrait support are excluded. Existing non-fal adapters are retained and not invoked by this comparison.

## Evidence-based selection

```text
UsableCostPerClip = SUM(all attempted costs, including failed/unknown liabilities)
                   / COUNT(technically and commercially passing clips)
```

Missing invoices retain reservations; never assume failed/unknown requests cost zero. All selected observations must complete and pass for a candidate to be eligible. Lowest usable cost ranks first; measured latency breaks ties. One passing sample is preliminary observed evidence, not proof of sustained reliability.

Commercial weights: identity 30%, packaging 20%, motion 15%, temporal consistency 15%, appeal 10%, portrait composition 10%. Total >=85, identity >=90, packaging/temporal >=85; visible human/hand anatomy must also be >=85. Technical duration, native portrait resolution and integrity pass independently. Owner approval and real Flow comparison remain separate; no invented Flow labels.

## Minimal benchmark budget

Same portrait product image/intent, four candidates once: estimated **$1.310834**, reserved **$1.560834**. Ascending reserved cost order. Only models whose first sample passes technical and visual commercial review may proceed to the other two products. Four models × three products reserve **$4.682502**, below the immutable **$5 total maximum**. Authenticated pricing may raise the forecast; stop before generation if above either configured or hard cap.

No paid retry or second sample. Durable pre-submit liability and exclusive journal prevent reload/concurrent/ambiguous duplicate payment. Failed/unknown attempts count against the cumulative cap across resumed runs.

## Daily planning: provisional primary

Public-rate forecasts, not actual usable-cost guarantees. No assumed success rate.

| Masters/day | Primary only: 193/24 × $0.02 | Worst case: primary + $0.50 fallback on every job |
|---:|---:|---:|
| 15 | $2.4125 | $9.9125 |
| 20 | $3.2167 | $13.2167 |
| 45 | $7.2375 | $29.7375 |

Default $5 daily fal cap blocks volumes above it. More target clips never increase budget automatically. A 10-second LTX target uses 241/24 seconds (~$0.200833). Recalculate from measured output reliability and current price after real benchmark.

## Production rules

- PRIMARY once, FALLBACK at most once, then `REVIEW_REQUIRED`.
- Clip/job caps count both attempts cumulatively; account/run/provider/day/month and fal daily limits all apply, strictest wins.
- Database serialization enforces two operation slots across processes; request/settlement replay is not another charge.
- Confirmed paid failure is settled before fallback. Unknown submit, timeout or cancel acknowledgement retains the hold and blocks fallback until reconciliation.
- Kill switch, credential, exact model owner approval, real narration, visual evaluator and migration handshake precede paid work.

See [fal activation/configuration](FAL_WAN_PROVIDER.md). Account billing caps at fal are additional safeguards.
