# AI LIVE / LIVE-1 local presenter worker

This worker belongs to the existing ViralFlow AI application. The Next.js server
authenticates users, owns accounts/products, and proxies calls to the loopback
worker. The browser must never receive `AI_LIVE_WORKER_TOKEN` or reach the worker
directly. TikTok LIVE and posting remain outside this worker. Development proof
tools can drive its existing audio/frame contracts with offline speech or an
actual microphone, and encode inferred frames to a local file.

## State and honest readiness

`GET /health` reports actual Python, NVIDIA CUDA, FFmpeg, NVENC encoder, MuseTalk
1.5 model, and optional LivePortrait availability. `ready=false` blocks Start
Presenter with HTTP 503. `encoder_ready` is separate because LIVE-1's MJPEG
preview can work without the later TikTok LIVE encoder. Production requires a
separately provisioned CUDA streaming adapter; weights are not committed. An
explicit development provider implements genuine CPU inference with official
MuseTalk model weights. The [official MuseTalk repository](https://github.com/TMElyralab/MuseTalk)
provides a realtime inference example that consumes audio clips; merely playing
its completed output files as a "live" preview is intentionally not supported.
LivePortrait is an optional later motion/expression input, not a LIVE-1 blocker.

The backend named by `AI_LIVE_MUSETALK_STREAM_MODULE` must export a truthful
`probe_readiness() -> bool` and `create_engine()` returning an object with
`prepare(reference: Path, fps: int)`,
`render_pcm16_chunk(audio: bytes) -> Iterator[bytes]` (yield JPEG frames **during**
inference), and `close()`. The module is loaded only after hardware/model
prechecks pass. The production adapter is not bundled; the UI must show the unavailable reason
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

## Explicit CPU development proof

CPU fallback is disabled by default. Enable both `AI_LIVE_DEV_FALLBACK=true`
and `PRESENTER_PROVIDER=dev_fallback` in the local process environment. It is
rejected in production. With fallback disabled, an NVIDIA-free host continues
to report `GPU_REQUIRED`. Follow [DEV_CPU_BACKEND.md](DEV_CPU_BACKEND.md) to
create `.venv-dev`, install the pinned CPU packages, and explicitly download
the official models into the ignored `.ai-live-dev/models` directory.

For an offline Thai speech fixture, Windows must have a Thai SAPI voice
installed (this proof used Microsoft Pattara). The provider synthesizes an
audio WAV locally, then emits mono 16-kHz PCM16 chunks through `VoiceProvider`.
No speech API is called. It reports an error if the language voice is missing.

```powershell
$env:AI_LIVE_DEV_FALLBACK = 'true'
$env:PRESENTER_PROVIDER = 'dev_fallback'
$env:APP_ENV = 'development'
$env:AI_LIVE_ENV = 'development'
$env:AI_LIVE_DEV_CPU_THREADS = '4'
$env:HF_HOME = Join-Path (Get-Location) '.ai-live-dev/cache'
$speechRequest = @{ text = 'สินค้านี้ใช้ยังไง กรุณาอ่านคำแนะนำบนฉลากก่อนใช้งาน' } | ConvertTo-Json
$speechRequest | .\.venv-dev\Scripts\python.exe workers/ai-live/offline_voice.py --output .ai-live-dev/proof/thai-speech.wav
.\.venv-dev\Scripts\python.exe workers/ai-live/proof_flow.py --reference .ai-live-dev/reference-astronaut.png --audio .ai-live-dev/proof/thai-speech.wav --owner 00000000-0000-4000-8000-000000000001 --output .ai-live-dev/proof/stability --seconds 600
```

The runner starts an authenticated loopback worker with a temporary random
token, consumes its genuine MJPEG stream, and provides a read-only browser
preview at `http://127.0.0.1:18766`. Its token stays server-side. It configures
the bundled imageio-FFmpeg executable automatically. Actual inferred JPEGs
enter `StreamProvider` and FFmpeg `libx264` software encoding; the generated
local MP4 is a **video-only** sink (`audio_encoded=false`, `nvenc=false`). It
does not prove synchronized audiovisual playback or NVENC. The slow preview
displays each frame as it is inferred and does not replay an MP4.

To exercise physical microphone callbacks, run the same command with
`--microphone --seconds 30` and a different output directory. `--audio` remains
the separate audio-control fixture; inference receives live microphone PCM.
The microphone buffer holds two one-second chunks and discards the oldest on
overflow because CPU inference is slower than capture. The proof records the
actual device, captured/nonzero bytes, submitted chunks, drops and hardware
overflows. It closes the input stream and empties its queue on stop. Browser
microphone chunks use the same worker audio contract. Windows hardware access
must be available to the executing process; an input error is a blocker, not a
signal to substitute a recording or virtual input.

The completed 600.438-second proof produced 243 real 256×256 frames and an
equally sized stream of encoded frames, at approximately **0.404 average FPS**.
The two-FPS setting describes audio-to-frame sampling; actual CPU throughput
is much lower. Final rolling p50/p95 receive-to-frame latency was 7.157/9.922
seconds. This establishes the local architecture flow only. It does not meet
the 2–5 FPS aspiration, validate production LIVE-1, or validate TikTok LIVE.
The output proof JSON records measurements and resource release.

To switch to the future NVIDIA production adapter, set
`PRESENTER_PROVIDER=musetalk`, disable `AI_LIVE_DEV_FALLBACK`, and configure the
real CUDA streaming module. The `PresenterProvider` / `FrameEngine` contracts,
PCM audio, JPEG output, session events, health, metrics and stop/release remain
the same; UI and business logic do not require a MuseTalk-specific rewrite.
Developer diagnostics are only returned in the explicitly enabled DEV mode.

## Server-to-worker contract

Every request requires `Authorization: Bearer <AI_LIVE_WORKER_TOKEN>` and
`X-ViralFlow-Owner-Id: <authenticated Supabase user UUID>`. The worker verifies
both and binds all references/sessions to that owner. Cross-owner IDs yield 404.

| Method/path | Body | Response |
| --- | --- | --- |
| `GET /health` | none | `ready`, `blockers`, Python/GPU/FFmpeg/MuseTalk/LivePortrait status |
| `POST /references` | raw JPEG or PNG, matching `Content-Type`, max 4 MiB and bounded dimensions | `reference_id`, `status=STORED`; 507 on storage quota |
| `POST /sessions` | JSON `reference_id`, `target_fps` (1–30; DEV defaults to 2 and caps at 5) | `session_id`, `status=STARTING`; HTTP 503 when unready |
| `POST /sessions/{id}/audio` | raw mono 16-kHz signed 16-bit little-endian PCM, at most one second per chunk, `application/octet-stream` | `accepted`, `queue_depth`; 429 on backpressure |
| `GET /sessions/{id}/metrics` | none | `status`, measured `fps`, `latency_ms`, queue and frame count |
| `GET /sessions/{id}/preview` | none | MJPEG multipart stream of **actual** inferred frames; no placeholder frames |
| `POST /sessions/{id}/stop` | none | `status=STOPPING` or terminal state |

Audio queue length is four chunks; excess audio is rejected rather than silently
building latency. At most one presenter session can run at a time.
If no audio chunk arrives for 15 seconds after preparation or the latest chunk,
the worker stops and closes the session (`stop_reason=AUDIO_IDLE_TIMEOUT`). This
releases model resources when a browser disappears without calling Stop Presenter.
The frame queue keeps only the newest two frames per preview client. Sessions
are ephemeral and carry no TikTok account tokens or product records.

The future production flow remains `Chat -> AI Brain -> TTS -> Presenter ->
Encoder -> TikTok LIVE`. The local DEV proof can additionally connect the
existing comment/brain/product/voice flow via `--comment-context` and the
software file sink. It does not authorize or enable a TikTok stream.

Run Python tests in the configured environment with `python -m unittest
discover -s workers/ai-live/tests` and inspect status with `python
workers/ai-live/capabilities.py`. The real CPU engine test requires the explicit
flag and official weights described in [DEV_CPU_BACKEND.md](DEV_CPU_BACKEND.md).
