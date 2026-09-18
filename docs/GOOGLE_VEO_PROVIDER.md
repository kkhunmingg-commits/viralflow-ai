# Google Veo provider contract

Verified against official Google documentation on 18 September 2026. The Gemini Developer API and Google Flow consumer product use different access, quotas, and billing. Flow subscription credits cannot be used as Gemini API USD capacity.

## Confirmed API models

| ViralFlow model | Gemini API model | Status | 720p price | 8-second 720p cost |
|---|---|---|---:|---:|
| `VEO_3_1_LITE` | `veo-3.1-lite-generate-preview` | Preview | $0.05/second | $0.40 |
| `VEO_3_1_FAST` | `veo-3.1-fast-generate-preview` | Preview | $0.10/second | $0.80 |
| `VEO_3_1_STANDARD` | `veo-3.1-generate-preview` | Preview | $0.40/second | $3.20 |

There is no free Veo tier. A Gemini API project with active paid billing is required. Model-specific limits depend on the active usage tier and are shown in Google AI Studio; Google does not publish one guaranteed RPM value for every account. ViralFlow treats HTTP 429 as bounded, retryable rate-limit or quota failure and never assumes capacity.

Official sources:

- Veo generation and model contract: https://ai.google.dev/gemini-api/docs/veo
- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- Gemini API billing and spend caps: https://ai.google.dev/gemini-api/docs/billing
- Gemini API rate limits: https://ai.google.dev/gemini-api/docs/rate-limits
- Gemini API terms: https://ai.google.dev/gemini-api/terms

## Capabilities

All three models accept text-to-video and image-to-video, generate one video per request, support `9:16` and `16:9`, produce native audio that is always on, and output 24 fps. Supported durations are 4, 6, or 8 seconds. A 1080p request must be 8 seconds.

Lite supports 720p and 1080p. Fast and Standard support 720p, 1080p, and 4K; 4K must be 8 seconds. Standard and Fast support up to three reference images and Veo video extension. Lite does not expose reference images or extension in the Gemini API contract. ViralFlow's commerce default is 8 seconds, `9:16`, 720p.

The REST flow is a long-running operation:

1. `POST /v1beta/models/{model}:predictLongRunning` with server-only `x-goog-api-key`.
2. Poll the returned operation name with bounded attempts.
3. Read `response.generateVideoResponse.generatedSamples[0].video.uri`.
4. Download the MP4 with the server-only key.
5. Run the existing FFmpeg probe, `VideoQualityScore`, compliance, originality, and storage gates.

Google retains generated videos for two days. ViralFlow downloads a successful result immediately and stores the original provider file, normalized master, variations, and metadata in the existing private `video-assets` bucket. Provider output is never made public by storage policy.

## Safety, provenance, and commercial use

Veo outputs carry SynthID. Google applies safety filters and memorization checks to prompts, uploaded media, video, and audio. Safety or audio processing can block generation; Google states that blocked generation is not charged. ViralFlow maps these cases to `SAFETY_REJECTED` and records no actual cost unless a successful video is returned.

Google's terms state that Google does not claim ownership of generated original content. The user remains responsible for lawful use, rights, claims, disclosure, and any required attribution. Paid-service prompts and responses are not used to improve Google products under the cited Gemini API terms. ViralFlow still preserves AIGC provenance and routes all output through Phase 6C before any publishing decision.

## Server configuration

```text
GOOGLE_GENAI_API_KEY=
GOOGLE_VEO_MODEL=VEO_3_1_LITE
VIDEO_BENCHMARK_ALLOW_PAID=false
VIDEO_BENCHMARK_MAX_USD=0
```

`GOOGLE_GENAI_API_KEY` is optional and server-only. It is never serialized to browser props, logs, benchmark reports, database metadata, or error messages. The default model is Lite. Fast or Standard must be selected explicitly and remain subject to the same quality and budget gates.

## Failure and retry contract

- Missing key: Auto Mode enters `WAITING_FOR_PROVIDER`.
- Missing or exhausted account budget: Auto Mode remains `BLOCKED` with `WAIT_FOR_BUDGET`, matching the existing Phase 10 state constraint.
- Budget cap exceeded: stop before the generation request.
- Creation request timeout: do not blindly resubmit because the remote operation may already exist and a duplicate could be billed.
- Polling or download 429/5xx: retry only within the configured bound.
- Operation failure, safety rejection, invalid/empty output, or download failure: record the categorized failure and stop or retry according to policy.
- Successful output below quality 85: reject it before storage as an accepted master.
- Actual cost: record only after a successful generated output; nominal cost remains an estimate because the Gemini response does not expose invoice data.

Automated tests use injected HTTP responses. They never call Google or spend money.

## Google Flow consumer product

`GOOGLE_FLOW_MANUAL` is represented as `MANUAL_BENCHMARK_ONLY` until Google publishes a supported Flow automation API. ViralFlow does not scrape Flow, drive its browser UI, rotate accounts, share credentials, or count Flow credits as Auto Mode capacity.

Google's Flow help currently lists 50 daily credits with or without a subscription, plus 200 monthly for AI Plus and 1,000 monthly for AI Pro. Per-generation credit costs are 10 for Veo 3.1 Lite and 20 for Fast for non-Ultra subscribers, 5 and 10 respectively for Ultra subscribers, and 100 for Quality for all users. These values are consumer credits, can change, and do not map to Gemini API USD billing.

- Flow credits: https://support.google.com/flow/answer/16526234
- Flow model features: https://support.google.com/flow/answer/16352836

An owner-supplied Flow clip can be imported with `--import-flow`. The source remains unchanged; a separate normalized 8-second portrait MP4 is scored against the same technical and human rubric.
