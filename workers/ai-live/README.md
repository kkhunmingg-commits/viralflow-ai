# AI LIVE / LIVE-1 local presenter worker

This worker belongs to the existing ViralFlow AI application. The Next.js server
authenticates users and checks account/product ownership. Customer media runs
through the loopback Local Live Agent; explicitly enabled development tools can
use the authenticated worker proxy. The browser must never receive
`AI_LIVE_WORKER_TOKEN` or reach the worker directly. TikTok LIVE and posting
authorization remain outside this worker. Development proof
tools drive its existing audio/frame contracts with real offline speech or an
actual microphone. The internal encoder produces continuous H.264 video and
AAC audio on a shared clock, writes a local MP4, and sends encoded A/V through
direct RTMP/RTMPS providers. No external broadcasting application, virtual
camera, or virtual audio device is required.

## State and honest readiness

`GET /health` reports actual Python, NVIDIA CUDA, FFmpeg, NVENC encoder, MuseTalk
1.5 model, and optional LivePortrait availability. `ready=false` blocks Start
Presenter with HTTP 503. Encoder and presenter readiness are separate: real
MJPEG frames are not proof of encoded receiver audio/video. Software H.264/AAC
and direct RTMP have passed the local development proof below. Production requires a
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
enter the internal software H.264 encoder; continuous PCM enters its AAC
timeline independently of the slower inference queue. The local MP4 contains
both video and audio. The slow preview displays real inferred frames and does
not replay an MP4. File output alone does not establish live transport; the
separate continuous receiver proof below supplies that evidence. NVENC remains
unvalidated on this host.

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

The latest [continuous direct-stream proof](../../docs/AI_LIVE_DIRECT_STREAMING_PROOF.json)
ran for **600.026 seconds**, beginning only after a real generated frame reached
the encoder and transport reported LIVE. Thai comments and products were
existing TEST fixtures; Windows Thai SAPI voice and MuseTalkCPUFloat32 were
real. All 51 comments were accepted, all 51 duplicates rejected, and 51 speech
calls delivered 8,417,760 audio bytes through the existing domain pipeline.

The presenter generated **240 real frames at 0.397 FPS**; latency was 9.531 s
median and 15.969 s p95. The encoder produced 15,025 frames at 25.001 FPS,
including **14,785 holds of real generated frames**. Encoder bitrate was
308.450 kbps and transport bitrate 306.198 kbps. Mux packet drift was 8 ms
final / 64 ms maximum, with input-clock drift 0 ms. These are synchronized
packet timestamps, not realtime phoneme/lip synchronization: held mouth poses
cannot track the continuous speech at this CPU throughput.

The inference branch dropped 173 audio chunks; the encoded playback PCM branch
dropped 0 samples. Transport dropped 15 tags, including 5 audio tags, across
startup/reconnect. The audio buffer peaked at 6,815 ms. Maximum queues were
comment 1, action 2, presenter 4, encoder 0, and transport 0. RAM after warmup
stayed within 4,341.2–4,347.5 MiB. One injected reconnect recovered in the same
producer session. The receiver received bytes while the producer was active;
both pre- and post-reconnect recordings decoded H.264/AAC, actual JPEG frames,
and nonzero PCM audio. The retained summary includes hashes and decoded sample
counts/RMS, so this claim does not depend on a socket-connected flag.

Stop reported released resources and closed worker/receiver, with RAM reduced
to 750.6 MiB. A separate short CLI helper encountered torch interpreter
finalization hanging after media resources closed. Bounded helper-process exit
is being fixed/retested and is not yet claimed as fully verified. An unrelated
TypeScript scheduler test also fails against the intentionally empty Hobby
`vercel.json`; this proof does not claim the whole TypeScript suite passes.

`scripts/ai-live-direct-stream-proof.ts` requires
`AI_LIVE_DIRECT_STREAM_PROOF=1`, the existing development flags, a running
authenticated loopback worker configured for direct streaming, a real uploaded
reference ID, and an existing account/product context. Its default measured
window is 600 seconds; it paces distinct Thai fixture comments every 12 seconds,
uses the existing Controller/CommentEngine/ProductBrain/Voice boundaries,
retains at most 121 metric samples, and stops through the real session path.
Worker tokens and diagnostic session IDs stay in local development processes.

This establishes the development media architecture only. CPU inference is not
realtime, NVIDIA/NVENC acceptance remains outstanding, LIVE-1 is incomplete,
and the production GPU gate remains false. No TikTok LIVE transport credentials
or TikTok broadcast were used; no production deployment occurred.

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
| `GET /sessions/{id}/metrics` | none | `status`, real presenter FPS/latency, bounded queues, shared-clock encoder/audio/drift, drops and transport health |
| `GET /sessions/{id}/preview` | none | MJPEG multipart stream of **actual** inferred frames; no placeholder frames |
| `GET /sessions/{id}/frame` | none | Latest actual generated JPEG or 204 while no frame exists |
| `POST /sessions/{id}/stop` | none | `status=STOPPING` or terminal state |

The presenter inference queue holds four chunks; direct playback feeds the
encoder independently, with bounded audio buffering and separate drop counters.
Backpressure returns 429 for unaccepted input instead of growing queues.
At most one presenter session can run at a time. The worker's default audio
idle timeout is 15 seconds; the direct proof configured 30 seconds. On expiry
the worker closes the session (`stop_reason=AUDIO_IDLE_TIMEOUT`). The installed
agent owns a separate session lifecycle so waiting for comments can keep its
encoder running; Stop must still close every resource.
The frame queue keeps only the newest two frames per preview client. Sessions
are ephemeral and carry no TikTok account tokens or product records.

The direct development flow is `Comment -> AI Brain -> Voice -> Presenter +
shared-clock audio -> InternalEncoder -> StreamProvider -> local receiver`.
The eventual TikTok provider requires official capability or legitimately
issued transport credentials. Posting authorization supplies no LIVE rights.

Run Python tests in the configured environment with `python -m unittest
discover -s workers/ai-live/tests` and inspect status with `python
workers/ai-live/capabilities.py`. The real CPU engine test requires the explicit
flag and official weights described in [DEV_CPU_BACKEND.md](DEV_CPU_BACKEND.md).
