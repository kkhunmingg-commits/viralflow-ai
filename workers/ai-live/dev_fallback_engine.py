"""Real MuseTalk 1.5 inference on CPU, isolated to proof-of-flow sessions.

Uses the official MIT MuseTalk weights and its published VAE/Whisper/UNet
algorithm, in float32 on an actual CPU. No CUDA emulation, generated stand-ins,
prerecorded clips, enhancer or paid API. Models must be provisioned explicitly
with bootstrap_dev_fallback.py. Face localisation uses OpenCV's CPU cascade.

Algorithm reference: https://github.com/TMElyralab/MuseTalk (MIT), especially
musetalk/models/{vae,unet}.py and musetalk/utils/audio_processor.py.
"""

from __future__ import annotations

import gc
import importlib.util
import json
import math
import os
import threading
from pathlib import Path
from typing import Iterator

BACKEND = "MuseTalkCPUFloat32"
MODEL_FILES = (
    "musetalkV15/musetalk.json", "musetalkV15/unet.pth",
    "sd-vae/config.json", "sd-vae/diffusion_pytorch_model.safetensors",
    "whisper/config.json", "whisper/model.safetensors", "whisper/preprocessor_config.json",
)


def models_directory() -> Path:
    default = Path(__file__).resolve().parents[2] / ".ai-live-dev" / "models"
    configured = os.getenv("AI_LIVE_DEV_MODELS_DIR", "").strip()
    return Path(configured or str(default)).expanduser().resolve()


def probe_readiness() -> dict[str, object]:
    missing_dependencies = [name for name in ("torch", "diffusers", "transformers", "cv2", "numpy", "accelerate") if importlib.util.find_spec(name) is None]
    missing_models = [name for name in MODEL_FILES if not (models_directory() / name).is_file()]
    status = "DEV_DEPENDENCIES_REQUIRED" if missing_dependencies else "DEV_MODELS_REQUIRED" if missing_models else "READY"
    return {"ready": status == "READY", "status": status, "backend": BACKEND, "device": "cpu", "missing_dependencies": missing_dependencies, "missing_models": missing_models}


class MuseTalkCPUEngine:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._cancel = threading.Event()
        self._prepared = False
        self._model = self._vae = self._whisper = self._extractor = None
        self._latent = self._positional = self._reference = self._blend_mask = None
        self._pending = bytearray()
        self._tail = b""
        self._frames = 0
        self._audio_samples = 0
        self._fps = 2

    def prepare(self, reference: Path, fps: int) -> None:
        if not reference.is_file() or not 1 <= fps <= 5:
            raise ValueError("INVALID_DEV_PRESENTER_CONFIG")
        readiness = probe_readiness()
        if not readiness["ready"]:
            raise RuntimeError(str(readiness["status"]))
        import cv2
        import numpy as np
        import torch
        from diffusers import AutoencoderKL, UNet2DConditionModel
        from transformers import WhisperFeatureExtractor, WhisperModel

        with self._lock:
            if self._prepared:
                raise RuntimeError("PRESENTER_ALREADY_LOADED")
            self._cancel.clear()
            self._fps = fps
            torch.set_num_threads(max(1, min(16, int(os.getenv("AI_LIVE_DEV_CPU_THREADS", "4")))))
            cv2.setNumThreads(1)
            image = cv2.imdecode(np.frombuffer(reference.read_bytes(), dtype=np.uint8), cv2.IMREAD_COLOR)
            if image is None:
                raise ValueError("INVALID_REFERENCE_IMAGE")
            cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
            faces = cascade.detectMultiScale(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), scaleFactor=1.1, minNeighbors=5, minSize=(48, 48))
            if len(faces) != 1:
                raise ValueError("DEV_REFERENCE_SINGLE_FACE_REQUIRED")
            x, y, width, height = map(int, faces[0])
            # Include chin; inference is genuinely at the trained 256x256 size.
            x1, y1 = max(0, x - width // 10), max(0, y - height // 10)
            x2, y2 = min(image.shape[1], x + width + width // 10), min(image.shape[0], y + height + height // 4)
            self._reference = cv2.resize(image[y1:y2, x1:x2], (256, 256), interpolation=cv2.INTER_LANCZOS4)
            self._blend_mask = np.zeros((256, 256, 1), dtype=np.float32)
            self._blend_mask[115:246, 12:244] = 1.0
            self._blend_mask = cv2.GaussianBlur(self._blend_mask, (31, 31), 0)[..., None]
            directory = models_directory()
            config = json.loads((directory / "musetalkV15/musetalk.json").read_text(encoding="utf-8"))
            # Meta construction + mmap/assign prevents two full 3.4GB copies.
            with torch.device("meta"):
                self._model = UNet2DConditionModel(**config)
            weights = torch.load(directory / "musetalkV15/unet.pth", map_location="cpu", weights_only=True, mmap=True)
            self._model.load_state_dict(weights, strict=True, assign=True)
            self._model = self._model.float().eval().requires_grad_(False)
            del weights
            self._vae = AutoencoderKL.from_pretrained(directory / "sd-vae", local_files_only=True, use_safetensors=True, torch_dtype=torch.float32).eval().requires_grad_(False)
            self._whisper = WhisperModel.from_pretrained(directory / "whisper", local_files_only=True, use_safetensors=True, torch_dtype=torch.float32).eval().requires_grad_(False)
            self._extractor = WhisperFeatureExtractor.from_pretrained(directory / "whisper", local_files_only=True)
            rgb = cv2.cvtColor(self._reference, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
            tensor = torch.from_numpy(rgb.transpose(2, 0, 1)).unsqueeze(0)
            masked = tensor.clone()
            masked[:, :, 128:, :] = 0
            with torch.inference_mode():
                scaling = self._vae.config.scaling_factor
                self._latent = torch.cat([self._vae.encode(masked * 2 - 1).latent_dist.mode() * scaling, self._vae.encode(tensor * 2 - 1).latent_dist.mode() * scaling], dim=1)
            positions = torch.arange(50, dtype=torch.float32).unsqueeze(1)
            frequencies = torch.exp(torch.arange(0, 384, 2, dtype=torch.float32) * (-math.log(10000.0) / 384))
            self._positional = torch.zeros(1, 50, 384)
            self._positional[0, :, 0::2] = torch.sin(positions * frequencies)
            self._positional[0, :, 1::2] = torch.cos(positions * frequencies)
            self._prepared = True

    def render_pcm16_chunk(self, audio: bytes) -> Iterator[bytes]:
        if not audio or len(audio) % 2 or len(audio) > 32_000:
            raise ValueError("INVALID_AUDIO_CHUNK")
        import cv2
        import numpy as np
        import torch

        with self._lock:
            if not self._prepared:
                raise RuntimeError("PRESENTER_NOT_LOADED")
            if self._cancel.is_set():
                return
            self._pending.extend(audio)
            minimum_bytes = 2 * math.ceil(16000 / self._fps)
            if len(self._pending) < minimum_bytes:
                return
            current = bytes(self._pending)
            self._pending.clear()
            tail_samples = len(self._tail) // 2
            waveform = np.frombuffer(self._tail + current, dtype="<i2").astype(np.float32) / 32768.0
            self._tail = current[-6400:]
            sample_count = len(current) // 2
            previous_samples = self._audio_samples
            self._audio_samples += sample_count
            target_frames = math.floor(self._audio_samples * self._fps / 16000)
            with torch.inference_mode():
                feature = self._extractor(waveform, sampling_rate=16000, return_tensors="pt").input_features
                states = self._whisper.encoder(feature, output_hidden_states=True).hidden_states
                embeddings = torch.stack(states, dim=2)
                while self._frames < target_frames and not self._cancel.is_set():
                    frame_time_samples = self._frames * 16000 / self._fps - previous_samples + tail_samples
                    centre = max(0, int(frame_time_samples / 320))
                    # Same 10x5x384 Whisper context as the official model. Fixed
                    # 80ms left context avoids fps-dependent multi-second padding.
                    indices = torch.arange(centre - 4, centre + 6)
                    valid = (indices >= 0) & (indices < embeddings.shape[1])
                    context = torch.zeros(1, 10, 5, 384)
                    context[:, valid] = embeddings[:, indices[valid]]
                    conditioning = context.reshape(1, 50, 384) + self._positional
                    latent = self._model(self._latent, torch.tensor([0]), encoder_hidden_states=conditioning).sample
                    if self._cancel.is_set():
                        return
                    output = self._vae.decode(latent / self._vae.config.scaling_factor).sample
                    predicted = ((output[0] / 2 + 0.5).clamp(0, 1).permute(1, 2, 0).numpy() * 255).round().astype(np.uint8)[..., ::-1]
                    frame = (predicted * self._blend_mask + self._reference * (1 - self._blend_mask)).round().astype(np.uint8)
                    success, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                    if not success:
                        raise RuntimeError("PRESENTER_JPEG_ENCODE_FAILED")
                    self._frames += 1
                    yield jpeg.tobytes()

    def interrupt(self) -> None:
        self._cancel.set()

    def close(self) -> None:
        self.interrupt()
        with self._lock:
            self._prepared = False
            self._model = self._vae = self._whisper = self._extractor = None
            self._latent = self._positional = self._reference = self._blend_mask = None
            self._pending.clear()
            self._tail = b""
            self._frames = self._audio_samples = 0
            gc.collect()


def create_engine() -> MuseTalkCPUEngine:
    if os.getenv("AI_LIVE_DEV_FALLBACK", "").strip().lower() != "true":
        raise RuntimeError("DEV_FALLBACK_DISABLED")
    if any(os.getenv(name, "").lower() == "production" for name in ("VERCEL_ENV", "NODE_ENV", "AI_LIVE_ENV")):
        raise RuntimeError("DEV_FALLBACK_PRODUCTION_FORBIDDEN")
    from provider_config import dev_fallback_enabled
    if not dev_fallback_enabled():
        raise RuntimeError("DEV_FALLBACK_DISABLED")
    return MuseTalkCPUEngine()
