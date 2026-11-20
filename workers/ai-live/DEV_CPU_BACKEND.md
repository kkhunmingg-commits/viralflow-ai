# CPU proof-of-flow backend

This development provider performs real **MuseTalk 1.5** neural lip-sync
inference. It passes PCM16 audio through Whisper-tiny, conditions the MuseTalk
UNet with audio embeddings and the reference face, decodes the inferred latent
with the VAE, and yields individual 256×256 JPEGs. The fixed reference supplies
identity/background; the lower face pixels come from neural inference. There
are no prerecorded frames, mock frames, external inference services or CUDA
emulation.

Production remains the NVIDIA/CUDA MuseTalk provider. CPU measurements do not
validate production LIVE-1, NVENC, or realtime performance.

## Official CPU support

The official [VAE](https://github.com/TMElyralab/MuseTalk/blob/main/musetalk/models/vae.py)
selects CPU when CUDA is absent and defaults to float32. The official
[UNet](https://github.com/TMElyralab/MuseTalk/blob/main/musetalk/models/unet.py)
accepts a CPU device and loads weights with `map_location`. The stock
[realtime script](https://github.com/TMElyralab/MuseTalk/blob/main/scripts/realtime_inference.py)
selects CPU too, but then unconditionally uses half precision, and its
`datagen` helper sends the final batch to its default CUDA device. Consequently
the stock realtime command is not the CPU streaming implementation used here.

The independent `dev_fallback_engine.py` uses the supported model interfaces
directly on real CPU tensors in float32, at batch size one. It uses OpenCV CPU
face localisation and feathered lower-face blending, with no enhancer. It
avoids importing the optional mmpose/face-parsing preparation stack. Its
Whisper context remains the trained 10×5×384 shape; context padding is measured
in audio time so reducing FPS does not introduce seconds of silent padding.

## Setup (Windows PowerShell)

```powershell
python -m venv .venv-dev
.\.venv-dev\Scripts\python.exe -m pip install --upgrade pip
.\.venv-dev\Scripts\python.exe -m pip install torch==2.6.0 --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple
.\.venv-dev\Scripts\python.exe -m pip install -r workers/ai-live/requirements-dev-fallback.txt
.\.venv-dev\Scripts\python.exe workers/ai-live/bootstrap_dev_fallback.py
$env:AI_LIVE_DEV_FALLBACK = 'true'
$env:PRESENTER_PROVIDER = 'dev_fallback'
$env:AI_LIVE_DEV_CPU_THREADS = '4'
$env:HF_HOME = Join-Path (Get-Location) '.ai-live-dev/cache'
$env:AI_LIVE_FFMPEG_PATH = .\.venv-dev\Scripts\python.exe -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'
```

Defaults load models from `.ai-live-dev/models`; override with
`AI_LIVE_DEV_MODELS_DIR`. The bootstrap explicitly downloads roughly 3.9 GB of
official weights, verifies their published SHA256 values and records source
revisions in `.ai-live-dev/model-manifest.json`. Runtime performs no downloads.
The local runtime and model directory are ignored by Git. Set development FPS
to 2 initially (supported range 1–5). Input is mono 16-kHz PCM16, with each chunk
at most one second. Smaller chunks accumulate until a frame interval; memory
for audio history is bounded. Frames are yielded after individual inference,
without first building a completed video.

`interrupt()` stops at a neural-stage boundary; the current CPU kernel cannot
be forcibly cancelled. `close()` waits for rendering to leave the engine lock,
clears pending audio, and releases all models. A stopped provider must wait for
its inference thread to finish before reporting resource release.

## Licenses and test reference

The official [MuseTalk license statement](https://github.com/TMElyralab/MuseTalk#disclaimerlicense)
allows commercial use of code and model weights (MIT); dependencies must obey
their own licenses. [Whisper-tiny](https://huggingface.co/openai/whisper-tiny)
is Apache-2.0; the [VAE model card](https://huggingface.co/stabilityai/sd-vae-ft-mse)
declares MIT. The downloaded NASA astronaut image is scikit-image's public
test fixture, used solely for this local proof. [Its documentation](https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut)
identifies Eileen Collins and states the NASA image has no known copyright
restrictions. Choose a presenter reference
with appropriate rights before product use.

## Genuine inference test

```powershell
$env:AI_LIVE_REAL_CPU_TEST = 'true'
$env:AI_LIVE_REAL_REFERENCE = Join-Path (Get-Location) '.ai-live-dev/reference-astronaut.png'
$env:AI_LIVE_REAL_AUDIO = Join-Path (Get-Location) '.ai-live-dev/proof/thai-speech.wav'
.\.venv-dev\Scripts\python.exe -m unittest discover -s workers/ai-live/tests -p test_dev_fallback_engine.py -v
```

The integration test requires a real mono 16-kHz PCM16 WAV. It checks individual
JPEGs, changing inferred face frames, an actual CPU model device, interruption
and model release. Without the explicit flag it is skipped, and must not be
reported as neural-inference validation.
