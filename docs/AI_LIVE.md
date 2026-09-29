# AI LIVE / LIVE-1

AI LIVE is a module in the existing ViralFlow AI application. The same signed-in user, TikTok account list, product list, app shell, and navigation are used by AUTO and AI LIVE. The new `/ai-live` page is protected by the existing Supabase session. LIVE-1 does not change AUTO, OAuth, TikTok Content Posting, scopes, production approval flags, or database schema.

## Implemented boundary

```text
User microphone (small PCM16 chunks) ─┐
Presenter image (JPEG/PNG) ────────────┼─> authenticated ViralFlow route
                                      └─> owner-scoped Python worker
                                          └─> incremental frame engine interface
                                              └─> MJPEG preview + measured FPS/latency
```

The browser sends audio in 0.25-second chunks through the Next.js route. Reference uploads are limited to 4 MiB to fit the Vercel Function request limit. The route verifies the Supabase user and forwards only allowlisted requests with a server-only bearer token and that user's ID. The worker accepts at most one presenter session and uses bounded audio/frame queues. Preview carries frames emitted by the inference engine, never a completed video file or simulated animation. Account/product selectors show existing owner data as context only; LIVE-1 does not use TikTok credentials, publish, or connect a LIVE session.

The worker and HTTP contract are documented in [`workers/ai-live/README.md`](../workers/ai-live/README.md). For local development, set `AI_LIVE_WORKER_URL=http://127.0.0.1:8765/` and the same random `AI_LIVE_WORKER_TOKEN` in the Next.js server and worker environment. For a deployed application, use a separately operated persistent GPU worker reachable at an HTTPS origin. The MJPEG proxy rotates its request every 20 seconds to avoid holding a Vercel Function open indefinitely; real GPU-host preview latency and continuity must still be measured before production use. Do not expose the worker token to the browser or put it in `NEXT_PUBLIC_*`. An empty/unreachable worker is reported as unavailable; Start remains disabled. Reference images are stored locally on the worker host and expire under the worker retention policy.

## Readiness and remaining work

The LIVE-1 UI, authentication boundary, local-audio transport, session management, capability inspection, owner isolation, and preview protocol are implemented. Actual photorealistic lip-sync inference is **not yet operational** in this checkout. The local machine lacks NVIDIA CUDA, FFmpeg/NVENC, MuseTalk weights, and the incremental MuseTalk adapter. `GET /health` reports these conditions and blocks Start rather than showing a fake live preview. An operator must provide a suitable NVIDIA host, install model dependencies and weights, and implement/validate a `FrameEngine` adapter that yields real frames while each audio chunk is processed. MuseTalk is the primary candidate; LivePortrait is optional for movement/expression. A successful capability check and real-frame preview on the target GPU are required before calling the presenter ready.

Future interfaces are reserved conceptually as `Chat -> AI Brain -> TTS -> Presenter -> Encoder -> TikTok LIVE`. LIVE-1 does not implement Chat ingestion, LLM replies, TTS, TikTok LIVE connection, RTMP, product pinning, Shop actions, or AUTO LIVE. FFmpeg/NVENC readiness is reported for the future encoder but no clip rendering is used as a substitute for real-time inference.

## Verification

Run `python -m unittest discover -s workers/ai-live/tests` for focused worker tests, and run `pnpm typecheck`, `pnpm lint`, and `pnpm build` for the ViralFlow application. No paid model/provider calls are involved.
