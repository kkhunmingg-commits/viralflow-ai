# AI LIVE / LIVE-1 local presenter worker

This worker belongs to the existing ViralFlow AI application. The Next.js server
authenticates users, owns accounts/products, and proxies calls to the loopback
worker. The browser must never receive `AI_LIVE_WORKER_TOKEN` or reach the worker
directly. There is no TikTok LIVE, RTMP, comments, TTS, or posting code here.

## State and honest readiness

`GET /health` reports actual Python, NVIDIA CUDA, FFmpeg, NVENC encoder, MuseTalk
1.5 model, and optional LivePortrait availability. `ready=false` blocks Start
Presenter with HTTP 503. `encoder_ready` is separate because LIVE-1's MJPEG
preview can work without the later TikTok LIVE encoder. This checkout does **not** include MuseTalk code,
weights, or a streaming inference adapter. A real-time backend remains required
on a CUDA host. The [official MuseTalk repository](https://github.com/TMElyralab/MuseTalk)
provides a realtime inference example that consumes audio clips; merely playing
its completed output files as a "live" preview is intentionally not supported.
LivePortrait is an optional later motion/expression input, not a LIVE-1 blocker.

The backend named by `AI_LIVE_MUSETALK_STREAM_MODULE` must export a truthful
`probe_readiness() -> bool` and `create_engine()` returning an object with
`prepare(reference: Path, fps: int)`,
`render_pcm16_chunk(audio: bytes) -> Iterator[bytes]` (yield JPEG frames **during**
inference), and `close()`. The module is loaded only after hardware/model
prechecks pass. No backend is bundled; the UI must show the unavailable reason
and must not claim a working lip-sync preview until genuine frames arrive.

## Start locally

On a suitable NVIDIA/CUDA machine, install the worker HTTP dependencies with
`python -m pip install -r workers/ai-live/requirements.txt`, then install the
official MuseTalk environment and its model weights separately. Set a random
32+ character `AI_LIVE_WORKER_TOKEN` in the **server and worker environments**,
set `AI_LIVE_MUSETALK_ROOT` and (when developed) `AI_LIVE_MUSETALK_STREAM_MODULE`,
then run `python workers/ai-live/main.py`. The worker binds `127.0.0.1:8765` by
default; `AI_LIVE_WORKER_PORT` can change the port. It does not enable CORS.
Reference files are stored in the host's temporary `viralflow-ai-live` directory.
If FFmpeg is outside `PATH`, `AI_LIVE_FFMPEG_PATH` can identify its executable.
Only one worker process may own that directory. On worker restart, its prior
UUID-named portrait files are removed because the in-memory owner mapping is
gone. The worker deletes unused references after one hour, checking every
minute; active sessions retain their reference until they end. Storage is
bounded to 20 images / 64 MiB globally and 5 images / 20 MiB per owner. Image
headers must declare at most 8192 pixels per side and 16 million total pixels.

## Server-to-worker contract

Every request requires `Authorization: Bearer <AI_LIVE_WORKER_TOKEN>` and
`X-ViralFlow-Owner-Id: <authenticated Supabase user UUID>`. The worker verifies
both and binds all references/sessions to that owner. Cross-owner IDs yield 404.

| Method/path | Body | Response |
| --- | --- | --- |
| `GET /health` | none | `ready`, `blockers`, Python/GPU/FFmpeg/MuseTalk/LivePortrait status |
| `POST /references` | raw JPEG or PNG, matching `Content-Type`, max 4 MiB and bounded dimensions | `reference_id`, `status=STORED`; 507 on storage quota |
| `POST /sessions` | JSON `reference_id`, `target_fps` (1–30) | `session_id`, `status=STARTING`; HTTP 503 when unready |
| `POST /sessions/{id}/audio` | raw mono 16-kHz signed 16-bit little-endian PCM, at most one second per chunk, `application/octet-stream` | `accepted`, `queue_depth`; 429 on backpressure |
| `GET /sessions/{id}/metrics` | none | `status`, measured `fps`, `latency_ms`, queue and frame count |
| `GET /sessions/{id}/preview` | none | MJPEG multipart stream of **actual** inferred frames; no placeholder frames |
| `POST /sessions/{id}/stop` | none | `status=STOPPING` or terminal state |

Audio queue length is four chunks; excess audio is rejected rather than silently
building latency. At most one presenter session can run on the GPU at a time.
If no audio chunk arrives for 15 seconds after preparation or the latest chunk,
the worker stops and closes the session (`stop_reason=AUDIO_IDLE_TIMEOUT`). This
releases the GPU when a browser disappears without calling Stop Presenter.
The frame queue keeps only the newest two frames per preview client. Sessions
are ephemeral and carry no TikTok account tokens or product records.

The planned future flow remains `Chat -> AI Brain -> TTS -> Presenter -> Encoder
-> TikTok LIVE`. LIVE-1 implements only the authenticated presenter boundary.
FFmpeg/NVENC are capability gates for the eventual encoder; they are not used
to turn a fully rendered file into a fake real-time preview.

Run dependency-free focused tests with `python -m unittest discover -s
workers/ai-live/tests` and status inspection with `python workers/ai-live/capabilities.py`.
