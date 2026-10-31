# Video Factory V1

Phase 6 converts one selected, policy-safe Creative Brain project into a reusable eight-second master and controlled variations. The implementation is versioned as `video-factory-v1`; quality and similarity evidence are stored as `video-quality-v1` and `video-similarity-v1`.

## Architecture

The factory separates planning and rendering behind five contracts:

- `VideoProvider` maps an approved creative into render instructions.
- `ImageProvider` supplies an identifiable product visual.
- `VoiceProvider` supplies generated or future synthesized speech.
- `VideoRenderer` renders and probes the final media.
- `VideoQualityEvaluator` produces a deterministic score, state, and explanation.

V1 uses `TemplateVideoProvider`, `MockImageProvider`, `MockVoiceProvider`, and `FFmpegVideoRenderer`. `MockVideoProvider` makes fixtures repeatable. `LowCostImageToVideoProvider`, `TikTokSymphonyProvider`, and `PremiumVideoProvider` are disabled adapters that throw before making a provider call. No paid video API or TikTok production API is connected.

## Media and render strategy

The renderer consumes the Creative Brain timeline directly: hook from 0–2 seconds, product/benefit/demo from 2–5 seconds, and CTA from 5–8 seconds. It produces a real MP4 with a 1080×1920 vertical canvas, 30 fps H.264 video, AAC audio, overlay text, product title, motion, fade in/out, generated test-safe voice audio, a low-volume generated audio bed, normalization by mixing, and a fast-start container.

FFmpeg and ffprobe are pinned development dependencies. Rendering runs in a Node worker/server environment with local binary execution and writable temporary storage; it is not intended to run inside an Edge runtime. Product-image fixtures are deterministic PPM files and do not claim unsupported product features.

The reusable template set is:

`PRICE_SHOCK`, `PROMOTION`, `PROBLEM_SOLUTION`, `MUST_HAVE`, `REVIEW_DISCOVERY`, `DEMONSTRATION`, `COMPARISON`, and `POV`.

Each template receives the product, approved hook, overlays, CTA, and scene plan. It does not hardcode a product.

## Master and variation engine

`buildMasterVideo()` authenticates every source row by owner, requires a selected SAFE concept, chooses a cost strategy, creates or reuses one master per creative project, records a job before rendering, uploads media, evaluates the result, and writes the quality and zero-cost audit evidence. A READY or APPROVED master is returned on retry without another render.

`createVideoVariations()` creates three meaningful variants by default. The first changes the hook, the second changes the opening wording and motion, and the third changes CTA, overlay, motion, transition, background, and speed. The run UUID is deterministically derived from the master ID. The `(owner_id, master_video_id, variation_index)` and `(owner_id, run_id, variation_index)` constraints prevent duplicates. Re-running creation returns the existing set without resetting its state.

`buildVideoVariation()` uses the saved run ID in a stable job key. A READY or APPROVED variation with an output path is reused. Variations inherit the source product, account, scene plan, and SAFE creative status.

## Similarity

V1 uses a metadata score and avoids computer-vision cost:

```text
Similarity = 0.15 SameMaster
           + 0.20 SameHook
           + 0.15 SameCTA
           + 0.20 SameScenePlan
           + 0.10 SameMotion
           + 0.10 SameOverlay
           + 0.10 SameAudio
```

Each equality signal is 0 or 1 after stable normalization. A candidate is accepted only when `Similarity < 0.82`; candidates at or above 0.82 are omitted. The browser fixture produced 0.50, 0.50, and 0.55. An unchanged fixture scores 1.00 and is rejected.

## VideoQualityScore

The score is the sum of passing deterministic checks:

| Check | Weight |
|---|---:|
| Valid H.264 output | 10 |
| Duration within 0.08s of 8 seconds | 10 |
| 9:16 aspect | 8 |
| Minimum 540×960 resolution | 7 |
| Product-visibility proxy | 10 |
| Overlay readability | 7 |
| Safe text placement | 5 |
| Scene continuity | 8 |
| AAC audio presence | 5 |
| Non-empty-frame/file-size proxy | 7 |
| Valid assets | 5 |
| CTA visibility | 5 |
| Creative timing consistency | 5 |
| Inherited SAFE risk | 8 |
| **Total** | **100** |

`PASS` requires all critical format, duration, aspect, scene timing, asset, and risk checks plus a score of at least 85. Invalid format, malformed assets, or inherited REJECT risk yields `REJECT`. Other failures yield `RETRY`. Only PASS output can be approved. The explanation JSON stores every check and the score version.

V1 uses file size as its non-empty-frame proxy and the known product fixture/render plan as its visibility proxy. A later quality worker can replace these with decoded-frame sampling, perceptual blur/text checks, and product detection without changing the persistence contract.

## Jobs and idempotency

Jobs move through `QUEUED`, `PROCESSING`, `RETRYING`, `COMPLETED`, `FAILED`, or `CANCELLED`. Attempts are capped at two. Errors store a stable code and a bounded message.

- Master key: `master:{creativeProjectId}:{scriptId}`
- Variation run UUID: deterministic SHA-256-derived UUID for `video-variations-v1:{masterId}`
- Variation key: `variation:{variationId}:{runId}`

Database uniqueness enforces one owner/key and one owner/master/variation index. The zero-cost ledger is append-only and unique per job/provider/model/unit. A completed master or variation is returned without creating another final video or cost row.

## Storage and access

The private `video-assets` bucket accepts only the configured image, audio, and MP4 MIME types, with a 50 MB object limit. Paths are owner-scoped:

```text
owner/{owner_id}/products/{product_id}/...
owner/{owner_id}/masters/{master_id}/...
owner/{owner_id}/variations/{variation_id}/...
```

Authenticated storage policies require the first segment to be `owner` and the second to equal `auth.uid()`. Table RLS applies the same owner rule. UI playback uses 15-minute signed URLs; the bucket and object paths are not public.

## Fixtures and benchmark plan

- A: Growth Beauty produces a deterministic POV-style master and meaningful variants.
- B: Affiliate Home produces a distinct motion/template plan.
- C: Affiliate Gadget exercises demonstration/comparison behavior and purchase CTA treatment.
- D: malformed, short, empty output is classified `REJECT`.
- E: unchanged metadata scores 1.00 and is rejected as a near duplicate.

The current benchmark proves format, timing, deterministic variation, auditable cost, and policy inheritance. The next quality iterations should use a curated, licensed commerce-video evaluation set and measure first-frame clarity, product screen time, overlay readability on safe zones, motion smoothness, speech intelligibility, CTA visibility, and human sellability against strong eight-second commerce examples. A provider may enter routing only after it beats the local baseline under an explicit cost ceiling and keeps every artifact and quality result auditable.
