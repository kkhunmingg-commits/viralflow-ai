"""Read-only capability detection for the local presenter worker."""

from __future__ import annotations

import importlib
import importlib.util
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

MUSETALK_REQUIRED_ASSETS = (
    "scripts/realtime_inference.py",
    "models/musetalkV15/musetalk.json",
    "models/musetalkV15/unet.pth",
    "models/whisper/config.json",
    "models/whisper/pytorch_model.bin",
    "models/whisper/preprocessor_config.json",
    "models/sd-vae/config.json",
    "models/sd-vae/diffusion_pytorch_model.bin",
    "models/dwpose/dw-ll_ucoco_384.pth",
    "models/face-parse-bisent/79999_iter.pth",
    "models/face-parse-bisent/resnet18-5c106cde.pth",
)


def _command_output(*args: str) -> str | None:
    try:
        result = subprocess.run(
            args, capture_output=True, text=True, timeout=3, check=False
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return result.stdout if result.returncode == 0 else None


def inspect_capabilities() -> dict[str, Any]:
    configured_ffmpeg = os.getenv("AI_LIVE_FFMPEG_PATH", "").strip()
    ffmpeg_path = configured_ffmpeg if configured_ffmpeg and Path(configured_ffmpeg).is_file() else shutil.which("ffmpeg")
    encoders = _command_output(ffmpeg_path, "-hide_banner", "-encoders") if ffmpeg_path else None
    nvenc_encoder = bool(encoders and "h264_nvenc" in encoders)

    nvidia_output = _command_output(
        "nvidia-smi", "--query-gpu=name", "--format=csv,noheader"
    )
    nvidia_name = nvidia_output.strip().splitlines()[0] if nvidia_output and nvidia_output.strip() else None
    torch_installed = importlib.util.find_spec("torch") is not None
    cuda_available = False
    cuda_device = None
    if torch_installed:
        try:
            import torch  # type: ignore[import-not-found]

            cuda_available = bool(torch.cuda.is_available())
            if cuda_available:
                cuda_device = torch.cuda.get_device_name(0)
        except (ImportError, OSError, RuntimeError):
            pass
    nvenc_usable = False
    if cuda_available and nvenc_encoder and ffmpeg_path:
        # Listing h264_nvenc only proves FFmpeg was compiled with the encoder.
        # A one-frame local probe also checks that the runtime can initialize it.
        nvenc_usable = _command_output(
            ffmpeg_path, "-hide_banner", "-loglevel", "error", "-f", "lavfi",
            "-i", "color=c=black:s=64x64:r=1", "-frames:v", "1",
            "-c:v", "h264_nvenc", "-f", "null", "-"
        ) is not None

    model_root = os.getenv("AI_LIVE_MUSETALK_ROOT", "").strip()
    model_path = Path(model_root) if model_root else None
    missing_model_assets = [
        asset for asset in MUSETALK_REQUIRED_ASSETS
        if not model_path or not (model_path / asset).is_file()
    ]
    models_available = not missing_model_assets
    backend_module = os.getenv("AI_LIVE_MUSETALK_STREAM_MODULE", "").strip()
    backend_available = False
    try:
        if backend_module and importlib.util.find_spec(backend_module):
            module = importlib.import_module(backend_module)
            probe = getattr(module, "probe_readiness", None)
            backend_available = bool(
                callable(probe)
                and callable(getattr(module, "create_engine", None))
                and probe() is True
            )
    except Exception:
        # Any backend probe failure is an unavailable presenter, not a healthy one.
        pass
    liveportrait_root = os.getenv("AI_LIVE_LIVEPORTRAIT_ROOT", "").strip()
    liveportrait_available = bool(
        liveportrait_root and (Path(liveportrait_root) / "inference.py").is_file()
    )

    blockers = []
    if not cuda_available:
        blockers.append("NVIDIA CUDA runtime is unavailable")
    if not models_available:
        blockers.append("MuseTalk 1.5 source/model weights are unavailable")
    if not backend_available:
        blockers.append("incremental MuseTalk frame backend is unavailable")
    encoder_blockers = []
    if not ffmpeg_path:
        encoder_blockers.append("FFmpeg is unavailable")
    if not nvenc_usable:
        encoder_blockers.append("usable NVIDIA NVENC is unavailable")

    return {
        "ready": not blockers,
        "blockers": blockers,
        "encoder_ready": not encoder_blockers,
        "encoder_blockers": encoder_blockers,
        "python": {"version": sys.version.split()[0], "platform": platform.platform()},
        "gpu": {
            "nvidia_name": nvidia_name,
            "cuda_available": cuda_available,
            "cuda_device": cuda_device,
            "torch_installed": torch_installed,
        },
        "ffmpeg": {
            "available": bool(ffmpeg_path),
            "nvenc_encoder_listed": nvenc_encoder,
            "nvenc_usable": nvenc_usable,
        },
        "musetalk": {
            "primary_candidate": True,
            "models_available": models_available,
            "missing_assets": missing_model_assets,
            "streaming_backend_available": backend_available,
        },
        "liveportrait": {"optional_candidate_available": liveportrait_available},
    }


if __name__ == "__main__":
    import json

    print(json.dumps(inspect_capabilities(), indent=2))
