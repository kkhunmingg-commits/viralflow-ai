# Local Live Agent foundation

The installed Windows companion runs `launcher.pyw`, which shows a fresh one-time
pairing code in a small GUI and starts `AgentHTTPServer` on `127.0.0.1:8766`.
The trusted signed installer must package the Python runtime and
`requirements.txt`, then provision `config.json` beside the launcher with a
stable `deviceId` UUID and pinned `grantPublicKeyPem`. This repository does not
ship a production-signed distribution or a validated CUDA presenter/NVENC
release. Local installer assets and an internal software H.264/AAC encoder are
present; the measured direct development proof is described below. The launcher
keeps `REALTIME_VALIDATED = False`; no browser value or environment variable
can turn on streaming.

The browser sends an exact allowed `Origin` and the agent requires an exact
`Host: 127.0.0.1:8766`. Browser routes are:

| Route | Authentication | Result |
| --- | --- | --- |
| `GET /v1/discovery` | Origin and Host | Minimal process/version detection |
| `POST /v1/pair` `{code}` | One-time GUI code | Origin-bound in-memory bearer, expiry, device ID |
| `POST /v1/renew` | Bearer | Rotated bearer and expiry; old bearer invalidated |
| `GET /v1/challenge` | Bearer | One-use 32-byte challenge |
| `GET /v1/status`, `GET /v1/hardware` | Bearer | Thai customer state only |
| `POST /v1/references` | Bearer | Bounded JPEG/PNG upload, returns opaque presenter ID |
| `POST /v1/stream/setup` `{grant}` | Bearer and fresh signed owner/account/device grant | Opens native transport settings; returns only `configured`, never server URL/key |
| `POST /v1/sessions/start` | Bearer and cloud grant | Owner-bound local session, only after validation gate |
| `GET /v1/sessions/{id}/frame` | Owner-bound bearer | Actual generated JPEG or 204; customer bridge also requires production validation |
| `POST /v1/sessions/{id}/pause`, `/resume`, `/stop`, `/recover` | Owner-bound bearer | Session control; recovery is at most once and only while initial grant is fresh |

Cloud grants are Ed25519 signatures over recursively key-sorted compact JSON.
The signed fields are `v`, `ownerId`, `deviceId`, `challenge`, `accountId`,
`productIds`, `grantId`, `issuedAt`, `expiresAt`, `entitled`, and `versions`.
Start checks the signature, two-minute lifetime, one-use challenge and grant ID,
device, selected account/products, and exact web/agent/worker/model versions.
The initially unbound bearer becomes bound to the signed owner on first grant.
An established session may continue beyond grant expiry; membership changes
are checked at the next Start. Stop remains available to its owner regardless
of entitlement or hardware changes. There is no cloud or mock fallback.

`LocalWorkerBoundary` joins the genuine local presenter, real audio,
`AVSessionStream` shared-clock H.264/AAC encoder, and direct `StreamProvider`.
The software encoder and Generic RTMP transport have measured receiver
evidence; NVIDIA presenter/NVENC production acceptance is still outstanding.
The legacy refusing worker/encoder boundaries remain fail-closed defaults for
unconfigured callers. `MuseTalkLocalPresenter` uses the existing
`PresenterProvider` boundary. The launcher's release validation remains false,
so available development adapters do not enable customer Start. Raw audio/video
is never sent to ViralFlow Cloud by this package.

The native settings window accepts only legitimately obtained streaming
configuration. It stores credentials in Windows current-user DPAPI storage,
bound to the authorized owner/account. The browser launches it using a signed
grant and receives a boolean result; it does not collect or persist stream keys.
Settings preparation does not require GPU validation, and is blocked while a
session is active. Missing TikTok credentials remain
`TIKTOK_LIVE_TRANSPORT_REQUIRED`; no private platform API, eligibility bypass,
key scraping, or external broadcasting client is involved.

## Measured direct development evidence

The [retained proof](../../../docs/AI_LIVE_DIRECT_STREAMING_PROOF.json) records
600.026 seconds of continuous direct streaming with real Windows Thai SAPI
voice and MuseTalkCPUFloat32 frames. Comments and products were existing TEST
fixtures. H.264 video and AAC audio were actually decoded from the receiver
before and after one injected reconnect; decoded PCM was nonzero and the same
producer session continued. Worker/receiver resource release was recorded.

The presenter generated 240 real frames at 0.397 FPS with 9.531 s median /
15.969 s p95 latency. The 25.001-FPS encoder held real frames 14,785 times;
this preserves the shared clock and does not prove realtime lip sync. Final /
maximum mux packet drift was 8/64 ms; encoder bitrate was 308.450 kbps.
Audio buffering peaked at 6,815 ms. Slow inference dropped 173 audio chunks,
encoded playback dropped 0 PCM samples, and transport startup/reconnect dropped
15 tags including 5 audio tags. Queues were bounded (comment/action/presenter/
encoder/transport maxima 1/2/4/0/0), while warmed RAM stayed at
4,341.2–4,347.5 MiB.

A separate short CLI helper hung during torch interpreter finalization after
its media resources had closed; the bounded-exit fix still needs final
verification. An unrelated TypeScript scheduler baseline test fails because
Hobby `vercel.json` is intentionally empty, so the full suite is not reported
as passing. No TikTok LIVE was run, no transport credentials were provisioned,
LIVE-1 remains incomplete, and no production deployment occurred.

`BootstrapManager` is an installer plan, not a downloader. The installer passes
its pinned Ed25519 key and exact allowlisted download hosts, then calls
`load_manifest({payload,signature})`. Only signed, fixed artifact names and
HTTPS paths under `/viralflow/ai-live/` are accepted. Trusted installer code
may call `stage_verified_bytes`, which verifies size and SHA-256 before writing
fixed local filenames. `status`, `repair_needed`, `check_updates`, and
`uninstall_cleanup` provide first-run, dependency/model, update, repair, and
cleanup state. Large model transfer, actual downloads, executable installation,
and automatic update scheduling remain to be built and verified on NVIDIA.

`hardware.py` records technical diagnostics only through the trusted
`developer_diagnostics` method. Browser routes receive Thai reasons with no
GPU model, driver, encoder, worker port, file path, or internal provider name.
VRAM/RAM/disk tiers are provisional and carry `GPU_VALIDATION_REQUIRED` until
real NVIDIA benchmarks and the full acceptance checklist pass.
