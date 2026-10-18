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


def main() -> None:
    request = json.load(sys.stdin)
    text, voice, output = request["text"], request["voice"], request["output"]
    torch.manual_seed(int(os.environ.get("VOXCPM_SEED", "42")))
    model = VoxCPM.from_pretrained(os.environ.get("VOXCPM_MODEL", "openbmb/VoxCPM2"), load_denoiser=False,
                                   optimize=False, device=os.environ.get("VOXCPM_DEVICE") or None)
    # Voice design: a text description in parentheses, no reference recording, so nobody is cloned.
    wav = model.generate(text=f"({voice}){text}", cfg_value=2.0, inference_timesteps=10)
    sf.write(output, wav, model.tts_model.sample_rate)


if __name__ == "__main__":
    main()
