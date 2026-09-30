# AI LIVE architecture and readiness

AI LIVE is a module of the existing ViralFlow AI application, not a separate product. It reuses the authenticated ViralFlow user, that user's connected TikTok account records, and available product records. The existing AUTO Affiliate and TikTok posting paths remain independent. This document describes the non-GPU foundation; **LIVE-1 is not complete** and no customer TikTok LIVE broadcast is possible yet.

## Readiness labels

| Status | What is ready or missing |
| --- | --- |
| `READY_WITHOUT_GPU` | The local TypeScript session/domain contracts, deterministic comment and reply policies, product selection, bounded action queue, events, watchdog, Python provider/voice contracts, and internal mock tests can be developed and tested without an NVIDIA GPU. This does **not** mean the customer can start a live broadcast. |
| `WAITING_FOR_GPU` | The real presenter requires an NVIDIA GPU with CUDA, MuseTalk source and model weights, and an incremental frame backend. `MuseTalkPresenter` reports `GPU_REQUIRED` when CUDA is absent and never silently substitutes `MockPresenter`. FFmpeg/NVENC readiness is checked separately for future encoding. |
| `GPU_VALIDATION_REQUIRED` | On a CUDA host, integrate and measure real MuseTalk audio-to-frame inference, frame quality, lip synchronization, FPS, latency, audio backpressure, long-session stability, and NVENC encoding. A selected reference image or a mock JPEG does not establish a working presenter. |

The future TikTok LIVE connection, comment ingestion, LLM provider, speech generation, encoder/RTMP transport, product pinning, and Shop actions are **outside this foundation**. TikTok Production remains in review; no existing TikTok app configuration, OAuth scopes, Content Posting API flow, or Production environment setting is changed by AI LIVE.

## Boundaries and data flow

```text
ViralFlow authenticated user
  ├─ existing connected TikTok accounts (selection only)
  ├─ existing available products (selection/context only)
  └─ AI LIVE page
       ├─ customer status and setup (no internal diagnostics)
       └─ authenticated Next.js proxy → local Python presenter worker

Internal non-GPU domain path (mock/dev tests only):
normalized comment → CommentEngine → LiveBrain → ProductBrain
  → ActionQueue → VoiceProvider contract → PresenterProvider contract
  → LiveEventLog / Watchdog / session snapshot

Future production path, not implemented here:
TikTok LIVE comments → real brain/voice → real MuseTalk frames
  → encoder → TikTok LIVE transport
```

The UI selects the existing account and product records. Selection is not a TikTok LIVE connection or product pin. The customer page shows only preparation and truthful empty states for comments and replies. `Start Live`/`Stop Live` remain unavailable. The separate local presenter preview can start only when the Python worker reports genuine readiness; an uploaded reference image is labeled as a selected still, not a live frame.

## TypeScript control and domain layer

- `LiveSessionController` models `STARTING`, `RUNNING`, `PAUSED`, `RECOVERY_REQUIRED`, `BLOCKED`, and `STOPPED`. A snapshot includes the owner, selected TikTok account, selected existing products, presenter reference, runtime status, timestamps, and latest comment/response. Start, pause, resume, stop, context update, and recovery use a `PresenterRuntimePort` and a `LiveSessionSnapshotStore` interface. The store is a contract; a durable production implementation and customer route are **not** supplied in this foundation. Reloading an active snapshot marks it `RECOVERY_REQUIRED`; the controller does not automatically restart a possibly running presenter.
- `CommentEngine` accepts normalized input through an interface, deduplicates comment IDs/text, applies viewer cooldown and spam checks, detects Thai/English through a replaceable detector, prioritizes questions and purchase intent, and bounds its in-memory queue. Simulated comments in tests are not TikTok comments.
- `LiveBrainProvider` returns a reply, intent, priority, and suggested actions. `RuleBasedLiveBrain` is a deterministic internal fallback using known product facts; it does not call an LLM, invent a price, or promise a purchase action.
- `ProductBrain` works from the existing `Product` type. It filters unavailable products, rotates with minimum dwell and recent-history limits, and consumes CTA timing so repeated ticks do not emit the same CTA.
- `ActionQueue` accepts `SPEAK`, `SWITCH_PRODUCT`, `SHOW_PRODUCT`, `PAUSE`, `RESUME`, and `STOP`. It is bounded, priority ordered, cancellable, and deduplicates by idempotency key. `STOP`/`PAUSE` receive elevated priority. This is an in-memory control primitive, not a durable delivery guarantee.
- `LivePipeline` composes comment intake, brain decisions, action execution, a chunk-streaming `VoiceProvider` port, and a `PresenterAudioPort`. The same pipeline path accepts internal test doubles or future real adapters. It does not connect to TikTok LIVE; `SHOW_PRODUCT` currently records a local event and does not pin a product. Speech interruption and cancellation have explicit methods, and a voice failure moves the session to `RECOVERY_REQUIRED`.
- `LiveEventLog` holds a bounded, human-readable activity history for future UI use. `Watchdog` detects stale session/presenter heartbeats, stuck audio/comment queues, and a disconnected stream. Recovery attempts are bounded; detection does not trigger an endless restart loop.

These components are integration contracts and tested local orchestration building blocks. They are **not yet wired to a real TikTok LIVE session** and must not be presented as one.

## Python presenter and voice boundary

`workers/ai-live/presenter.py` defines `PresenterProvider`: `load_presenter`, `start_stream`, `push_audio_chunk`, `receive_frames`, `stop`, `health`, and `metrics`. `MockPresenter` requires explicit internal use and a test-supplied frame factory; it is not selected by the HTTP worker API and is forbidden for production sessions. `MuseTalkPresenter` is an adapter to a genuine incremental CUDA backend, not a bundled lip-sync model. Its audio queue is capped at four PCM chunks; its preview frame queue retains at most two JPEG frames. The provider rejects bad chunks and backpressure, and reports a failure instead of silently replaying a completed video.

`workers/ai-live/voice.py` defines a chunk-streaming `VoiceProvider`, interrupt/cancel operations, and a bounded speech queue. `UnconfiguredVoiceProvider` reports `VOICE_PROVIDER_REQUIRED`; it does not call a paid or local TTS engine. The Python watchdog is decision-only and caps recovery claims. The existing worker handles owner-scoped references and ephemeral presenter preview through the authenticated Next.js proxy. The browser never receives the worker token. A full worker endpoint and local-operation description is in [`workers/ai-live/README.md`](../workers/ai-live/README.md).

The existing worker's health check is fail-closed: no CUDA or real incremental backend means no presenter start. The app does not fabricate progress, lip sync, FPS, or a customer live stream from mock frames.

## Remaining integration and acceptance

1. Provide an NVIDIA/CUDA host and install the actual MuseTalk source, model weights, and an incremental audio-to-frame adapter. Validate real frames and measured latency/FPS over sustained use. Validate FFmpeg/NVENC on that host. Optional LivePortrait movement can be evaluated separately.
2. Supply a real voice source behind `VoiceProvider` and validate interruption, queue pressure, and audio/frame synchronization. A real LLM brain, if added, must preserve verified-product and seller-rule constraints.
3. Add a durable owner-scoped snapshot store and integrate the controller with authenticated application routes. Implement controlled recovery without duplicate starts or unbounded retries.
4. After TikTok grants the required separate LIVE permissions, implement and test comment reading, LIVE connection/transport, product pinning, and Shop actions under their own approvals. Existing Content Posting API approval does not imply TikTok LIVE approval.
5. Keep customer controls disabled until the real path is connected and observed end to end. Internal mock tests and a selected portrait are not sufficient to mark `LIVE-1` complete.

Focused verification: TypeScript domain/controller/pipeline tests and `python -m unittest discover -s workers/ai-live/tests`. The 30-minute virtual-clock simulation feeds one comment per second through the same TypeScript pipeline, checks duplicate rejection and bounded comment/action/event queues, and keeps audio on an internal mock boundary. The Python 30-minute virtual-duration worker test checks bounded frame/audio behavior. Neither is a 30-minute GPU or TikTok LIVE benchmark.
