"""Local Thai narration with VoxCPM2 (Apache-2.0). Reads {"text","voice","output"} JSON on stdin.

Setup on the render machine (not in the web app):
  python -m venv .venv-tts && .venv-tts/bin/pip install "voxcpm==2.0.3" soundfile
  export THAI_TTS_PROVIDER=voxcpm2 THAI_TTS_PYTHON=$PWD/.venv-tts/bin/python
Optional: VOXCPM_MODEL=/path/to/local/VoxCPM2 to load weights without network access,
VOXCPM_DEVICE=cpu|cuda, VOXCPM_SEED for repeatable takes.
Checked against the voxcpm 2.0.3 wheel: generate() has no seed argument, so torch is seeded here.
"""
import json
import os
import sys

import soundfile as sf
import torch
from voxcpm import VoxCPM


# A take may run on past the text (pilots saw takes that never ended and hit the 10-minute timeout).
# With a length budget, generation is capped just past what the clip can use and a long take is redone
# with the next seed, so a bad take costs seconds instead of minutes.
MAX_TAKES = 3
OVERRUN = 1.15


def main() -> None:
    request = json.load(sys.stdin)
    text, voice, output = request["text"], request["voice"], request["output"]
    max_seconds = request.get("max_seconds")
    seed = int(os.environ.get("VOXCPM_SEED", "42"))
    model = VoxCPM.from_pretrained(os.environ.get("VOXCPM_MODEL", "openbmb/VoxCPM2"), load_denoiser=False,
                                   optimize=False, device=os.environ.get("VOXCPM_DEVICE") or None)
    tts = model.tts_model
    options = {}
    if max_seconds:
        latents_per_second = tts.audio_vae.sample_rate / (tts.patch_size * tts.chunk_size)
        options = {"max_len": int(float(max_seconds) * OVERRUN * latents_per_second) + 2, "retry_badcase": False}
    best = None
    for take in range(MAX_TAKES if max_seconds else 1):
        torch.manual_seed(seed + take)
        # Voice design: a text description in parentheses, no reference recording, so nobody is cloned.
        wav = model.generate(text=f"({voice}){text}", cfg_value=2.0, inference_timesteps=10, **options)
        seconds = len(wav) / tts.sample_rate
        if best is None or seconds < best[0]:
            best = (seconds, wav)
        if not max_seconds or seconds < float(max_seconds) * OVERRUN * 0.97:
            break
        print(f"take {take + 1}: {seconds:.1f}s reached the length cap, trying the next seed", file=sys.stderr)
    sf.write(output, best[1], tts.sample_rate)


if __name__ == "__main__":
    main()
