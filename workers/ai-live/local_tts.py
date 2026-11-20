"""Local-only speech contract and bounded PCM bridge for the presenter pipeline.

The default is an honest pending provider. Model names, paths and keys are not a
customer configuration surface. A real adapter accepts only a model resolved by
the signed local model manager. Unit-test backends are not production voices.
"""
from __future__ import annotations

import hashlib
import json
import math
import threading
import time
from collections import OrderedDict
from collections.abc import Iterator, Mapping
from typing import TYPE_CHECKING, Protocol, runtime_checkable

from thai_speech import NORMALIZER_VERSION, estimate_duration, normalize_thai_speech, sentence_chunks
from voice import MAX_SPEECH_CHUNK_BYTES, SpeechChunk

if TYPE_CHECKING:
    from local_agent.model_manager import VerifiedLocalModel

LOCAL_TTS_MODEL_PENDING = "LOCAL_TTS_MODEL_PENDING"
MAX_UTTERANCE_PCM = 16_000 * 2 * 120


@runtime_checkable
class LocalTTSProvider(Protocol):
    def stream_text(self, text: str, utterance_id: str) -> Iterator[SpeechChunk]: ...
    def interrupt(self) -> None: ...
    def cancel(self) -> None: ...
    def health(self) -> dict[str, object]: ...
    def warmup(self) -> dict[str, object]: ...
    def estimate_duration(self, text: str) -> float: ...
    def voice_packs(self) -> list[dict[str, object]]: ...


class PendingLocalTTSProvider:
    """No network call, invented PCM, or implicit OS/provider fallback."""
    def __init__(self) -> None:
        self._cancelled = False

    def stream_text(self, text: str, utterance_id: str) -> Iterator[SpeechChunk]:
        normalize_thai_speech(text)
        if not isinstance(utterance_id, str) or not utterance_id or len(utterance_id) > 128:
            raise ValueError("INVALID_SPEECH_REQUEST")
        raise RuntimeError("SPEECH_CANCELLED" if self._cancelled else LOCAL_TTS_MODEL_PENDING)
        yield  # pragma: no cover

    def interrupt(self) -> None:
        pass

    def cancel(self) -> None:
        self._cancelled = True

    def health(self) -> dict[str, object]:
        return {"ready": False, "status": "SPEECH_CANCELLED" if self._cancelled else LOCAL_TTS_MODEL_PENDING,
                "local": True, "requires_api_key": False, "thai": True, "cloning": False}

    def warmup(self) -> dict[str, object]:
        return self.health()

    def estimate_duration(self, text: str) -> float:
        return estimate_duration(text)

    def voice_packs(self) -> list[dict[str, object]]:
        return []


class PCMBackend(Protocol):
    """Installer-owned backend, already licensed and resolved; mono PCM16/16k."""
    @property
    def fingerprint(self) -> str: ...
    def stream_sentence(self, text: str, stop: threading.Event) -> Iterator[bytes]: ...
    def health(self) -> dict[str, object]: ...
    def close(self) -> None: ...


class ManagedLocalTTSProvider:
    """One provider per room/context. Incremental chunks, no concurrent voice.

    Cancellation prevents further output immediately, while cooperative model
    compute releases at the next native chunk. Readiness requires real warmup.
    Audio cache is bounded in memory and isolated by account/presenter/context.
    """
    def __init__(self, backend: PCMBackend, *, context_id: str, voice_pack_id: str = "default",
                 lexicon: Mapping[str, str] | None = None, cache_bytes: int = 8 * 1024 * 1024,
                 timeout_seconds: float = 30.0):
        if (not isinstance(context_id, str) or not context_id or len(context_id) > 300
                or not isinstance(voice_pack_id, str) or not voice_pack_id or len(voice_pack_id) > 128
                or type(cache_bytes) is not int or not 0 <= cache_bytes <= 32 * 1024 * 1024
                or not 0.05 <= timeout_seconds <= 120):
            raise ValueError("INVALID_LOCAL_TTS_CONFIG")
        self.backend = backend
        self.context_id, self.voice_pack_id = context_id, voice_pack_id
        self.lexicon = dict(lexicon or {})
        normalize_thai_speech("ทดสอบ", lexicon=self.lexicon)
        self._lock = threading.RLock()
        self._generation = 0
        self._stop = threading.Event()
        self._cancelled = self._busy = self._warmed = False
        self._cache: OrderedDict[str, tuple[bytes, ...]] = OrderedDict()
        self._cache_bytes = 0
        self._cache_limit = cache_bytes
        self._timeout = timeout_seconds
        self._hits = self._misses = 0

    def _active(self, generation: int, stop: threading.Event) -> bool:
        with self._lock:
            return not self._cancelled and not stop.is_set() and generation == self._generation

    def _cache_key(self, sentence: str) -> str:
        value = "\0".join((self.backend.fingerprint, self.context_id, self.voice_pack_id, NORMALIZER_VERSION, sentence))
        return hashlib.sha256(value.encode()).hexdigest()

    def _put_cache(self, key: str, chunks: list[bytes]) -> None:
        size = sum(map(len, chunks))
        if not chunks or size > min(self._cache_limit, MAX_UTTERANCE_PCM):
            return
        with self._lock:
            old = self._cache.pop(key, ())
            self._cache_bytes -= sum(map(len, old))
            while self._cache and self._cache_bytes + size > self._cache_limit:
                _, removed = self._cache.popitem(last=False)
                self._cache_bytes -= sum(map(len, removed))
            self._cache[key] = tuple(chunks)
            self._cache_bytes += size

    def stream_text(self, text: str, utterance_id: str) -> Iterator[SpeechChunk]:
        normalized = normalize_thai_speech(text, lexicon=self.lexicon)
        if not isinstance(utterance_id, str) or not utterance_id or len(utterance_id) > 128:
            raise ValueError("INVALID_SPEECH_REQUEST")
        with self._lock:
            if self._cancelled:
                raise RuntimeError("SPEECH_CANCELLED")
            if self._busy:
                raise RuntimeError("VOICE_BUSY")
            if not self.backend.health().get("ready"):
                raise RuntimeError(LOCAL_TTS_MODEL_PENDING)
            self._busy = True
            generation = self._generation
            stop = self._stop = threading.Event()
        deadline = time.monotonic() + self._timeout
        emitted = 0
        try:
            for sentence in sentence_chunks(normalized):
                if not self._active(generation, stop):
                    return
                key = self._cache_key(sentence)
                with self._lock:
                    cached = self._cache.get(key)
                    if cached is not None:
                        self._cache.move_to_end(key)
                        self._hits += 1
                    else:
                        self._misses += 1
                chunks: list[bytes] = []
                source = iter(cached) if cached is not None else self.backend.stream_sentence(sentence, stop)
                try:
                    while self._active(generation, stop):
                        try:
                            pcm = next(source)
                        except StopIteration:
                            break
                        if not self._active(generation, stop):
                            return
                        if time.monotonic() > deadline:
                            stop.set()
                            raise RuntimeError("LOCAL_TTS_TIMEOUT")
                        if not isinstance(pcm, bytes) or not pcm or len(pcm) % 2 or len(pcm) > MAX_UTTERANCE_PCM:
                            raise RuntimeError("LOCAL_TTS_INVALID_PCM")
                        for offset in range(0, len(pcm), MAX_SPEECH_CHUNK_BYTES):
                            fragment = pcm[offset:offset + MAX_SPEECH_CHUNK_BYTES]
                            emitted += len(fragment)
                            if emitted > MAX_UTTERANCE_PCM:
                                raise RuntimeError("LOCAL_TTS_AUDIO_LIMIT")
                            # The lock orders interrupt against emission; the caller's
                            # existing generation-aware SpeechChunkQueue rejects late
                            # chunks after this boundary as well.
                            with self._lock:
                                if not self._active(generation, stop):
                                    return
                                chunk = SpeechChunk(fragment, utterance_id)
                            chunks.append(fragment)
                            yield chunk
                    if cached is None and self._active(generation, stop):
                        if not chunks:
                            raise RuntimeError("LOCAL_TTS_EMPTY_AUDIO")
                        self._put_cache(key, chunks)
                finally:
                    close = getattr(source, "close", None)
                    if close:
                        close()
        finally:
            with self._lock:
                self._busy = False

    def interrupt(self) -> None:
        with self._lock:
            self._generation += 1
            self._stop.set()

    def cancel(self) -> None:
        with self._lock:
            self._cancelled = True
            self._warmed = False
            self.interrupt()
            self._cache.clear()
            self._cache_bytes = 0
        self.backend.close()

    def warmup(self) -> dict[str, object]:
        try:
            chunks = list(self.stream_text("สวัสดีค่ะ", "local-tts-warmup"))
            with self._lock:
                self._warmed = bool(chunks) and not self._cancelled
        except (ValueError, RuntimeError):
            with self._lock:
                self._warmed = False
        return self.health()

    def health(self) -> dict[str, object]:
        with self._lock:
            backend = self.backend.health()
            ready = not self._cancelled and self._warmed and bool(backend.get("ready"))
            return {"ready": ready, "status": "SPEECH_CANCELLED" if self._cancelled else
                    "LOCAL_TTS_READY" if ready else LOCAL_TTS_MODEL_PENDING, "local": True,
                    "requires_api_key": False, "thai": True, "streaming_pcm": True,
                    "cloning": bool(backend.get("cloning", False)), "busy": self._busy,
                    "warmup_passed": self._warmed, "cache_bytes": self._cache_bytes,
                    "cache_hits": self._hits, "cache_misses": self._misses,
                    "interruption_mode": "between_native_chunks", "timeout_scope": "between_native_chunks"}

    def estimate_duration(self, text: str) -> float:
        return estimate_duration(text)

    def voice_packs(self) -> list[dict[str, object]]:
        return [{"id": self.voice_pack_id, "status": "BOUND", "cloning": self.health()["cloning"]}]


class _VoxPCMConverter:
    """Stateful anti-alias FIR, 48k -> 16k, preserving phase across native chunks."""
    def __init__(self, input_rate: int):
        import numpy as np
        if input_rate != 48_000:
            raise RuntimeError("LOCAL_TTS_SAMPLE_RATE_UNSUPPORTED")
        self.np = np
        taps = 63
        n = np.arange(taps) - (taps - 1) / 2
        kernel = 2 * 0.15 * np.sinc(2 * 0.15 * n) * np.hamming(taps)
        self.kernel = kernel / kernel.sum()
        self.history = np.zeros(taps - 1, dtype=np.float32)
        self.offset = 0

    def convert(self, value) -> bytes:
        np = self.np
        samples = np.asarray(value, dtype=np.float32)
        if samples.ndim != 1 or not len(samples) or not np.isfinite(samples).all() or len(samples) > 48_000 * 120:
            raise RuntimeError("LOCAL_TTS_INVALID_PCM")
        combined = np.concatenate((self.history, samples))
        filtered = np.convolve(combined, self.kernel, mode="valid")
        self.history = combined[-len(self.history):]
        decimated = filtered[(-self.offset) % 3::3]
        self.offset = (self.offset + len(samples)) % 3
        return np.rint(np.clip(decimated, -1.0, 1.0) * 32767).astype("<i2").tobytes()


class VoxCPMBackend:
    """Real official adapter; never fetches models or enables a remote denoiser.

    Optional cloning is deliberately unavailable until encrypted reference bytes
    can be passed in memory. VoxCPM's current public reference API takes a path.
    No reference recordings are materialized as unencrypted temporary files.
    """
    def __init__(self, model: VerifiedLocalModel, *, device: str = "cpu"):
        if device not in {"cpu", "cuda", "cuda:0"}:
            raise ValueError("INVALID_LOCAL_TTS_DEVICE")
        record = model.record
        if (record.kind != "TTS" or record.source.rstrip("/") != "https://huggingface.co/openbmb/VoxCPM2"
                or record.code_license != "Apache-2.0" or record.weights_license != "Apache-2.0"
                or record.commercial_allowed is not True or record.redistribution_allowed is not True):
            raise RuntimeError("LOCAL_TTS_LICENSE_REJECTED")
        model.verify_files()
        if device == "cpu":
            try:
                import psutil
                # Keep a conservative activation/loader margin. Never overcommit
                # the presenter/encoder just to claim a local voice proof.
                weight_bytes = sum(item.size_bytes for item in record.artifacts
                                   if item.relative_path.endswith((".safetensors", ".pth", ".pt")))
                if psutil.virtual_memory().available < max(8 * 1024 ** 3, int(weight_bytes * 1.5)):
                    raise RuntimeError("LOCAL_TTS_CPU_MEMORY_PENDING")
            except ImportError as exc:
                raise RuntimeError("LOCAL_TTS_RESOURCE_CHECK_PENDING") from exc
        self._fingerprint = hashlib.sha256((record.model_id + record.version +
            "".join(artifact.sha256 for artifact in record.artifacts)).encode()).hexdigest()
        self._model = None
        self._device = device
        try:
            from voxcpm import VoxCPM
            self._model = VoxCPM(voxcpm_model_path=str(model.directory()),
                                 zipenhancer_model_path=None, enable_denoiser=False,
                                 optimize=False, device=device)
            if self._model.tts_model.sample_rate != 48_000:
                self._model = None
                raise RuntimeError("LOCAL_TTS_SAMPLE_RATE_UNSUPPORTED")
        except ImportError as exc:
            raise RuntimeError("LOCAL_TTS_RUNTIME_PENDING") from exc

    @property
    def fingerprint(self) -> str:
        return self._fingerprint

    def stream_sentence(self, text: str, stop: threading.Event) -> Iterator[bytes]:
        if self._model is None:
            raise RuntimeError(LOCAL_TTS_MODEL_PENDING)
        converter = _VoxPCMConverter(self._model.tts_model.sample_rate)
        source = self._model.generate_streaming(text=text, cfg_value=2.0, inference_timesteps=10,
                                              normalize=False, denoise=False, retry_badcase=False, max_len=750)
        try:
            for value in source:
                if stop.is_set():
                    return
                pcm = converter.convert(value)
                if pcm:
                    yield pcm
        finally:
            source.close()

    def health(self) -> dict[str, object]:
        return {"ready": self._model is not None, "local": True, "device": self._device,
                "cloning": False, "status": "LOCAL_TTS_LOADED" if self._model else LOCAL_TTS_MODEL_PENDING}

    def close(self) -> None:
        self._model = None


def make_managed_local_tts(components, *, context_id: str, device: str = "cpu") -> LocalTTSProvider:
    """Production factory: signed artifacts + owner-rated release acceptance.

    A catalog entry alone cannot make a production voice ready. Both the real
    benchmark and the explicit release acceptance must be allowlisted artifacts
    covered by the existing signed component release. Startup then warms real
    synthesis independently. Failed/missing approval remains pending.
    """
    from local_agent.model_manager import LocalModelManager
    from local_agent.security import SecurityError
    pending = PendingLocalTTSProvider()
    try:
        model = LocalModelManager(components).resolve("voxcpm2", "TTS")
        approval_path = model.path("tts-acceptance.json")
        benchmark_path = model.path("benchmark.json")
        if approval_path.stat().st_size > 64 * 1024 or benchmark_path.stat().st_size > 4 * 1024 * 1024:
            return pending
        approval = json.loads(approval_path.read_bytes())
        benchmark = json.loads(benchmark_path.read_bytes())
        if (approval.get("format") != "viralflow-tts-acceptance-v1"
                or approval.get("production_approved") is not True
                or approval.get("model_id") != model.record.model_id
                or approval.get("model_version") != model.record.version
                or approval.get("device") != device
                or approval.get("benchmark_sha256") != hashlib.sha256(benchmark_path.read_bytes()).hexdigest()
                or not isinstance(approval.get("approved_by"), str) or not approval["approved_by"].strip()
                or benchmark.get("model_id") != model.record.model_id or benchmark.get("version") != model.record.version
                or benchmark.get("device") != device or benchmark.get("human_review_status") != "OWNER_RATED"
                or benchmark.get("status") != "MEASURED_OWNER_REVIEW_PENDING" or benchmark.get("failed_samples")
                or benchmark.get("interruption", {}).get("passed") is not True
                or benchmark.get("cancelled_ready") is not False
                or not benchmark.get("owner_review", {}).get("reviewer_identity")
                or not benchmark.get("samples") or type(benchmark.get("inference_session_seconds")) not in (float, int)
                or not math.isfinite(benchmark["inference_session_seconds"])
                or benchmark["inference_session_seconds"] < 3600):
            return pending
        for sample in benchmark["samples"]:
            audio_path = model.path(sample["audio_file"])
            if hashlib.sha256(audio_path.read_bytes()).hexdigest() != sample.get("audio_sha256"):
                return pending
            if any(type(sample.get(key + "_owner_rating")) is not int or not 4 <= sample[key + "_owner_rating"] <= 5
                   for key in ("pronunciation", "naturalness", "voice_consistency")):
                return pending
            for key, maximum in (("real_time_factor", 1.0), ("first_audio_seconds", 1.0)):
                value = sample.get(key)
                if type(value) not in (int, float) or not math.isfinite(value) or not 0 < value <= maximum:
                    return pending
            if sample.get("multiple_pcm_chunks") is not True:
                return pending
        return ManagedLocalTTSProvider(VoxCPMBackend(model, device=device), context_id=context_id)
    except (SecurityError, OSError, ValueError, RuntimeError, ImportError, KeyError, TypeError, AttributeError):
        return pending
