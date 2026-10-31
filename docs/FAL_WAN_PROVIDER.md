# fal Wan 2.2 Turbo provider

`FalWanVideoProvider` is server-side infrastructure for `fal-ai/wan/v2.2-a14b/image-to-video/turbo`. It uploads the source through `@fal-ai/client`, submits one queue request, polls with a fixed bound, fetches the result, downloads the file, hashes it, and returns normalized metadata. Errors redact `FAL_KEY`.

The provider requests `720p`, `9:16`, input/output safety checks, disabled prompt expansion, regular acceleration, high video quality, and balanced write mode. It intentionally omits frame count and FPS because those fields are not in the Turbo endpoint schema.

`FAL_WAN_PROVIDER_STATE` defaults to `PRIMARY_CANDIDATE`. Auto Mode requires both a configured server-only key and `PRODUCTION_APPROVED`; benchmark success alone produces `BENCHMARK_PASS_PENDING_OWNER_REVIEW`.

No database migration is required. Existing Phase 6 provider/model, generation attempt, cost, media, quality, and master records already cover this provider.
