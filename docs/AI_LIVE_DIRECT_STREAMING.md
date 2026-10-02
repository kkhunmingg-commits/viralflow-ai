# AI LIVE direct streaming

ViralFlow is the streaming application. A customer chooses an account, presenter, product, and microphone, then starts or stops AI LIVE in ViralFlow. A separate broadcasting application, virtual camera, or virtual audio device is not part of this workflow.

## Implemented development architecture

```text
Authorized comment input → LiveBrain → Voice/TTS audio
                                      ↓
Selected presenter → PresenterEngine → generated frames
                                      ↓
                    synchronized A/V timeline
                                      ↓
                 InternalEncoder (H.264 + AAC)
                                      ↓
                          StreamProvider
                                      ↓
                       receiver / player
```

The internal encoder consumes continuous video frames and continuous audio using a shared monotonic timeline and produces timestamped H.264 video plus AAC audio. Software H.264 is the measured development backend; NVIDIA NVENC has the same encoder contract but still needs hardware validation. Replacing the presenter backend with its GPU implementation must not change customer UI, account authorization, session ownership, or provider interfaces.

Presenter, encoder, audio, and provider boundaries require bounded queues, backpressure, a documented dropped-frame policy, and dropped-audio accounting. Slow inference may repeat the last **real generated** frame to keep development output moving; it must never synthesize fake lip-sync frames or count repeats as new presenter inference. File output alone does not prove continuous live streaming.

## Provider boundary

- `LocalTestStream` supports local proofs without social-platform credentials.
- `GenericRTMPProvider` and `GenericRTMPSProvider` own direct transport and consume the internal encoded A/V stream.
- `TikTokLiveProvider` is a capability boundary. Only an officially available LIVE capability granted to the account, or a lawfully issued stream URL and key, can enable its transport. Posting OAuth and Content Posting API do not establish LIVE capability.

Providers share connect, start, health, stop, and dispose behavior. Health records the observed bitrate and transport state; reconnect uses bounded retry and exponential backoff without creating a second session. Stop must release presenter work, audio, encoder, queues, provider connections, and any watchdog tasks.

Watchdogs must detect presenter/audio/encoder stalls, disconnected transport, queue overflow, and missing output. A connected socket alone does not prove that encoded media is reaching a receiver.

## Customer screen and truthful status

The normal customer screen contains account, presenter, product, microphone, reference preview, START LIVE, STOP LIVE, and status. Installation, pairing, membership, machine authorization, and update controls are available in the closed-by-default “ตั้งค่าการ LIVE” disclosure. Moving these controls does not bypass any authorization or readiness checks.

The customer projection accepts only `phase` and `connectionQuality` enum values. It discards arbitrary status messages, engine names, server addresses, stream keys, ports, technical identifiers, and raw diagnostics. Human labels cover ready, preparing, connecting, live, reconnecting, stopping, stopped, setup required, and failure.

`BUSY` and `sessionActive` alone never produce “กำลัง LIVE”. The agent must observe real provider output before publishing a LIVE phase, and the customer UI also requires the validated production release and an authenticated, authorized active session. The production validation gate remains false until NVIDIA acceptance is completed. Development proofs must not unlock customer Start.

Connection quality is shown only as “ดี”, “พอใช้”, or “มีปัญหา” when a validated session has actual measured health. Missing health data is “ยังไม่มีข้อมูล”; a session identifier or a successful connection does not imply good quality. Raw FPS, drift, latency, bitrate, drops, queue depth, and reconnect count belong in developer diagnostics.

The browser preview shows the customer's selected image with an explicit “ภาพอ้างอิง · ยังไม่ใช่ภาพสด” label until a real presenter frame arrives. The authenticated frame path uses only the owned internal session at the fixed loopback origin, accepts bounded JPEG bodies, and sends authorization in headers. Preview requests run one at a time; replaced, stopped, and unmounted image Blob URLs are revoked. This path remains disabled while production validation is false. A generated frame is labeled “ภาพจากระบบ”; it is not evidence of TikTok receiver output or successful broadcasting. No browser audio is invented.

## Credentials and production boundary

Stream configuration belongs to an account owner and must be encrypted at rest, excluded from logs, redacted from diagnostics, and unavailable to the customer browser unless an operation strictly requires it. Sensitive runtime values must be cleared when practical. Saved credentials are not proof that an account is eligible for LIVE.

The settings button in the customer disclosure requests an account/device-bound signed grant using the existing authorization boundary, then sends only that grant to the local agent's native settings launcher. The native window collects streaming configuration locally; the browser receives only a `configured` boolean. Preparing settings requires current device authorization and membership, but does not unlock Start or require a validated GPU release. Settings changes are disabled while a session is active.

This work does not authorize private platform endpoints, stream-key scraping, eligibility bypass, reverse engineering a broadcasting client, or repurposing posting permissions. TikTok direct transport remains `TIKTOK_LIVE_TRANSPORT_REQUIRED` when approved credentials or official capability are absent. Posting OAuth, the production application under review, Affiliate AUTO, `.env.local`, main, and Vercel Production remain outside this change.

## Required evidence

The retained development proof covers the following requirements. Production GPU acceptance and TikTok transport remain separate:

1. A Thai comment fixture through Brain, real Thai voice, and real presenter inference.
2. A file containing real H.264 video and AAC audio, with measured A/V drift.
3. Continuous direct streaming to a local receiver, whose decoded video and audio are verified.
4. At least ten minutes without crashes, deadlocks, or unbounded memory/queue growth.
5. Presenter FPS separately from encoder FPS, audio latency, A/V drift, bitrate, dropped frames/audio, queue depth, and reconnect count.
6. Disconnect/reconnect recovery without duplicated sessions, and complete Stop cleanup.

## Measured results

The current [proof summary](AI_LIVE_DIRECT_STREAMING_PROOF.json), measured on 2026-10-02, records a **600.086-second continuous development stream**. Comments were simulated Thai fixtures and products came from an existing test fixture. Voice was real Windows offline Thai SAPI and presenter frames were generated by real MuseTalkCPUFloat32 inference. Start/audio/Stop passed through the same `LocalWorkerBoundary` used by the Local Agent, including encrypted owner/account-scoped stream configuration. Exactly one producer session was observed. The measurement began after a real generated frame reached the encoder and direct transport reported LIVE; media reached the local receiver while the producer was still running.

The local receiver simultaneously recorded FLV and delivered received H.264/AAC as live fragmented MP4 to a browser player. This uses [fragmented MP4 output](https://ffmpeg.org/ffmpeg-formats.html#mov_002c-mp4_002c-ismv) and [MediaSource](https://developer.mozilla.org/en-US/docs/Web/API/MediaSource); it never waits for a completed MP4. The opt-in proof player binds only to loopback, validates Host/Origin, accepts bounded numeric observations for the current receiver generation, and exposes no stream keys, account IDs, paths or cloud credentials. It caps active clients at eight, applies two-second socket timeouts and closes pending requests on Stop. Slow response writes cannot hold the incoming media lock. This diagnostic page is not a customer route.

| Measurement | Observed result |
| --- | --- |
| A/V output | H.264 video and AAC audio in the local MP4 and both receiver FLV recordings |
| Mux packet timestamp drift | 16 ms final; 64 ms maximum; input clock drift 0 ms |
| Receiver packet timestamp drift | 48 ms maximum; both received tracks have monotonic timestamps |
| Real presenter output | 233 generated frames; 0.385 average FPS |
| Presenter latency | 9.766 s median; 15.907 s p95 |
| Encoder output | 15,028 frames at 25.000 FPS, including 14,795 held real frames |
| Bitrate | 304.859 kbps encoder; 302.600 kbps transport |
| Audio buffer | 6,855 ms maximum |
| Inference audio drops | 177 chunks on the slow presenter branch |
| Encoded playback PCM drops | 0 samples |
| Transport drops | 12 tags, including 4 audio tags, across startup/reconnect |
| Maximum queue depth | Comment 1; action 2; presenter 4; encoder 0; transport 6 |
| RAM after warmup | 4,345.1–4,352.6 MiB; first/last running samples 4,348.8/4,345.9 MiB |
| Reconnect | One injected reconnect; same producer session continued |
| Stop | Worker and receiver closed; resources released; RAM after Stop 752.7 MiB |
| Receiver progress | 601.719 s observed; maximum interval without byte progress 2.547 s |
| Live browser player | 1,206 received fragments; 588 playback observations; before/after reconnect verified |
| Player bounds/errors | Maximum fragment cache 706,935 bytes; zero playback errors |

The receiver recordings were fully decoded with strict error handling, and their first/middle/last windows were sampled for JPEG and PCM. The first receiver voice window decoded 160,000 samples with PCM16 RMS 2,047.4; the reconnected receiver voice window decoded 160,000 samples with RMS 1,497.2. Silence between fixture utterances is retained honestly. Combined receiver A/V spans total 602.888 s, including startup/stop boundaries. The summary retains recording sizes and SHA-256 hashes. This proves receiver video/audio bytes and continuous delivery, including recovery; it does not assert lossless transport during reconnect.

The browser player actually advanced decoded video frames, decoded AAC bytes and playback time on both receiver connections, with sound enabled. Observed WebAudio RMS peaks were 0.0901 before reconnect and 0.2708 after reconnect. No player errors, playback freezes, or browser console errors/warnings were observed during delivery. This supplements full receiver decoding with live playback evidence; a healthy publisher socket alone cannot satisfy the measurement checker.

All 51 fixture comments were accepted, and all 51 duplicate submissions were rejected. The existing Brain/ProductBrain/ActionQueue/Voice pipeline made 51 real speech calls and delivered 8,417,760 audio bytes. Queues stayed bounded and sampled RAM stayed flat after warmup. Presenter inference remains far below realtime: held frames preserve encoder timing but **do not establish phoneme/lip synchronization**. Packet timestamp drift measures the mux clock, not the delay between speech and a newly inferred mouth pose.

The ten-minute session reports resource release and closed worker/receiver. The existing isolated development helper verifies cleanup and then terminates only its own Windows process to release the imported native CPU runtime; ordinary interpreter finalization previously hung in native DLL teardown. After final request-bound and startup-cleanup fixes, a 12.067-second real A/V/reconnect smoke check also completed with exit code 0, one producer session and released worker/receiver. Its measurement explicitly reports `ten_minute_acceptance=false`; it supplements rather than replaces the retained ten-minute proof. The customer agent does not use this development-only process-exit path. The TypeScript suite also has an unrelated scheduler test failure against the intentionally empty Hobby `vercel.json`; this report does not claim all TypeScript tests pass.

Core fixes preserve the existing architecture: concurrent transport starts are serialized; queue removal and byte accounting are atomic across reconnect; only accepted presenter frames advance liveness; absent encoder output uses elapsed time; missing AAC media cannot be concealed by video output; and callback failures cannot prevent media cleanup. Session-wide retry remains bounded at three attempts with 0.25/0.5/1 s backoff. Regression tests cover presenter/audio/encoder stalls, disconnect exhaustion, queue overflow, URL/argument safety, verified TLS transport, encrypted credentials and original-session cleanup. The proof helper registers owned cleanup before each resource starts, attempts every release independently and preserves startup failures; missing references and partial startup cannot leave a receiver running.

`measure_direct_stream_proof.py` requires actual receiver recordings, full decode, advancing received bytes, bounded timestamp gaps and A/V drift, one producer session, and live player progress across reconnect for current ten-minute acceptance. Passing a short smoke or a completed local MP4 alone cannot satisfy it. Local raw evidence remains ignored under `.ai-live-dev/direct-stream/core-stability-20261002`; only its bounded, credential-free summary is committed.

`AI_LIVE_REALTIME_VALIDATED` remains false, LIVE-1 is incomplete, and no production deployment occurred. No TikTok LIVE broadcast or TikTok transport credentials were used. Remaining work includes actual NVIDIA presenter/NVENC acceptance and a legitimately provisioned TikTok transport; this CPU proof does not unlock customer broadcasting.

## Final verification

- Python suite: 272 tests executed, 270 passed and 2 opt-in inference/speech tests skipped. The separate real-media proofs above exercise actual CPU inference and Thai speech. The suite includes actual encode/decode, RTMP receiver/reconnect, verified TLS byte relay, stalled-output recovery, encrypted owner-scoped credentials, receiver/player security, partial-start cleanup and strict acceptance checks.
- Focused AI LIVE TypeScript tests: 122 passed across 21 files.
- Full TypeScript suite: 544 passed, 1 skipped, 1 pre-existing failure in `src/features/operations/scheduler.test.ts`. That test expects the recovery cron entry, while the existing `vercel.json` is intentionally empty following the Hobby cron removal. Neither the scheduler nor its configuration is modified by this work.
- `pnpm typecheck`: passed. `pnpm lint`: exit code 0, no errors and 8 existing warnings in unrelated video benchmark/test files.
- `pnpm build`: passed. Required public build values were supplied only in the build process; `.env.local` was not edited. No deployment was performed.
- Windows delivery tests use the existing offline package; no new installer was built in this streaming-only change. Package hashes and unsigned status remain recorded in `workers/ai-live/installer/README.md`; generated artifacts remain ignored.
