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
import time

import numpy as np

import soundfile as sf
import torch
from voxcpm import VoxCPM


# A take may run on past the text (pilots saw takes that never ended and hit the 10-minute timeout).
# With a length budget the take is streamed and stopped as soon as it passes what the clip can use,
# then redone with the next seed; a time budget stops retrying and keeps the shortest take.
MAX_TAKES = 3
OVERRUN = 1.15


def take_audio(model, text: str, cap_seconds):
    if cap_seconds is None:
        return model.generate(text=text, cfg_value=2.0, inference_timesteps=10)
    rate, chunks, total = model.tts_model.sample_rate, [], 0
    stream = model.generate_streaming(text=text, cfg_value=2.0, inference_timesteps=10)
    try:
        for chunk in stream:
            chunk = np.asarray(chunk, dtype=np.float32).reshape(-1)
            chunks.append(chunk)
            total += len(chunk)
            if total / rate > cap_seconds:
                break
    finally:
        stream.close()
    return np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)


def main() -> None:
    request = json.load(sys.stdin)
    text, voice, output = request["text"], request["voice"], request["output"]
    max_seconds = request.get("max_seconds")
    cap = float(max_seconds) * OVERRUN if max_seconds else None
    budget = float(os.environ.get("VOXCPM_TIME_BUDGET", "420"))
    seed = int(os.environ.get("VOXCPM_SEED", "42"))
    started = time.monotonic()
    model = VoxCPM.from_pretrained(os.environ.get("VOXCPM_MODEL", "openbmb/VoxCPM2"), load_denoiser=False,
                                   optimize=False, device=os.environ.get("VOXCPM_DEVICE") or None)
    rate, best = model.tts_model.sample_rate, None
    for take in range(MAX_TAKES if cap else 1):
        take_started = time.monotonic()
        torch.manual_seed(seed + take)
        # Voice design: a text description in parentheses, no reference recording, so nobody is cloned.
        wav = take_audio(model, f"({voice}){text}", cap)
        seconds = len(wav) / rate
        if seconds > 0.5 and (best is None or seconds < best[0]):
            best = (seconds, wav)
        if cap is None or seconds <= cap:
            break
        print(f"take {take + 1}: passed {cap:.1f}s, trying the next seed", file=sys.stderr)
        # Stop when another take of the same length would run past the time budget.
        if time.monotonic() - started + (time.monotonic() - take_started) > budget:
            break
    if best is None:
        sys.exit("no usable take")
    sf.write(output, best[1], rate)


if __name__ == "__main__":
    main()
