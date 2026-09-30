"""Non-GPU presenter contract and explicit, bounded implementations.

The customer-facing worker continues to use ``worker_core.LiveStore`` and its
incremental ``FrameEngine`` path. This module defines the next integration
boundary without pretending that a CUDA MuseTalk backend is already installed.
"""

from __future__ import annotations

import queue
import threading
import time
from collections import deque
from pathlib import Path
from typing import Callable, Iterator, Protocol, runtime_checkable

from capabilities import inspect_capabilities
from engine import FrameEngine, make_engine

MAX_AUDIO_CHUNK_BYTES = 32_000
MAX_PENDING_AUDIO_CHUNKS = 4
MAX_PENDING_FRAMES = 2


class PresenterUnavailable(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@runtime_checkable
class PresenterProvider(Protocol):
    def load_presenter(self, reference: Path, fps: int) -> None:
        """Validate and prepare a reference, without starting a stream."""

    def start_stream(self) -> None:
        """Start processing audio chunks incrementally."""

    def push_audio_chunk(self, pcm16: bytes) -> None:
        """Accept one mono 16-kHz PCM16 chunk or report backpressure."""

    def receive_frames(self) -> Iterator[bytes]:
        """Drain currently available JPEG frames; never return a completed clip."""

    def stop(self) -> None:
        """Stop processing and release resources. Repeated calls are safe."""

    def health(self) -> dict[str, object]:
        """Return readiness and a stable internal reason code."""

    def metrics(self) -> dict[str, object]:
        """Return measured runtime status and bounded queue depths."""


def _validate_audio(pcm16: bytes) -> None:
    if not pcm16 or len(pcm16) > MAX_AUDIO_CHUNK_BYTES or len(pcm16) % 2:
        raise ValueError("INVALID_AUDIO_CHUNK")


def _validate_frame(frame: bytes) -> None:
    if not (frame.startswith(b"\xff\xd8") and frame.endswith(b"\xff\xd9")):
        raise ValueError("INVALID_PRESENTER_FRAME")


class MockPresenter:
    """Explicit internal test/development double; never selected by the HTTP API.

    No frames are fabricated by default. Tests must supply a frame factory, and
    health always identifies this provider as mock-only.
    """

    def __init__(
        self,
        *,
        internal_use: bool,
        frame_factory: Callable[[bytes], Iterator[bytes]] | None = None,
    ) -> None:
        if not internal_use:
            raise PresenterUnavailable("MOCK_PRESENTER_INTERNAL_ONLY")
        self._frame_factory = frame_factory
        self._frames: deque[bytes] = deque(maxlen=MAX_PENDING_FRAMES)
        self._status = "NEW"
        self._audio_chunks = 0
        self._frames_generated = 0

    def load_presenter(self, reference: Path, fps: int) -> None:
        if not reference.is_file() or not 1 <= fps <= 30:
            raise ValueError("INVALID_PRESENTER_CONFIG")
        if self._status not in ("NEW", "STOPPED"):
            raise RuntimeError("PRESENTER_ALREADY_LOADED")
        self._status = "LOADED"

    def start_stream(self) -> None:
        if self._status != "LOADED":
            raise RuntimeError("PRESENTER_NOT_LOADED")
        self._status = "RUNNING"

    def push_audio_chunk(self, pcm16: bytes) -> None:
        if self._status != "RUNNING":
            raise RuntimeError("PRESENTER_NOT_RUNNING")
        _validate_audio(pcm16)
        self._audio_chunks += 1
        if self._frame_factory is None:
            return
        for frame in self._frame_factory(pcm16):
            _validate_frame(frame)
            self._frames.append(frame)
            self._frames_generated += 1

    def receive_frames(self) -> Iterator[bytes]:
        while self._frames:
            yield self._frames.popleft()

    def stop(self) -> None:
        self._frames.clear()
        self._status = "STOPPED"

    def health(self) -> dict[str, object]:
        return {"ready": self._status in ("LOADED", "RUNNING"), "status": "MOCK_ONLY"}

    def metrics(self) -> dict[str, object]:
        return {
            "status": self._status,
            "audio_chunks": self._audio_chunks,
            "frames_generated": self._frames_generated,
            "frame_queue_depth": len(self._frames),
            "provider_kind": "INTERNAL_MOCK",
        }


class MuseTalkPresenter:
    """Adapter for a genuine incremental CUDA backend, with no mock fallback.

    The configured backend must satisfy ``engine.FrameEngine``. Audio and
    output queues are bounded to prevent growing latency on a slow GPU or
    disconnected preview. Backend errors stop the presenter; they never
    trigger an automatic paid/inference retry.
    """

    def __init__(
        self,
        *,
        capability_probe: Callable[[], dict[str, object]] = inspect_capabilities,
        engine_factory: Callable[[], FrameEngine] = make_engine,
    ) -> None:
        self._capability_probe = capability_probe
        self._engine_factory = engine_factory
        self._engine: FrameEngine | None = None
        self._audio: queue.Queue[tuple[bytes, float] | None] = queue.Queue(
            maxsize=MAX_PENDING_AUDIO_CHUNKS
        )
        self._frames: queue.Queue[bytes] = queue.Queue(maxsize=MAX_PENDING_FRAMES)
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._status = "NEW"
        self._error: str | None = None
        self._audio_chunks = 0
        self._frames_generated = 0
        self._frame_times: deque[float] = deque(maxlen=120)
        self._latency_ms: float | None = None

    def health(self) -> dict[str, object]:
        capabilities = self._capability_probe()
        gpu = capabilities.get("gpu")
        if not isinstance(gpu, dict) or not gpu.get("cuda_available"):
            return {"ready": False, "status": "GPU_REQUIRED"}
        if not capabilities.get("ready"):
            return {"ready": False, "status": "PRESENTER_BACKEND_REQUIRED"}
        return {"ready": True, "status": "READY"}

    def load_presenter(self, reference: Path, fps: int) -> None:
        if self._status != "NEW":
            raise RuntimeError("PRESENTER_ALREADY_LOADED")
        if not reference.is_file() or not 1 <= fps <= 30:
            raise ValueError("INVALID_PRESENTER_CONFIG")
        readiness = self.health()
        if not readiness["ready"]:
            raise PresenterUnavailable(str(readiness["status"]))
        engine = self._engine_factory()
        try:
            engine.prepare(reference, fps)
        except Exception:
            engine.close()
            raise
        self._engine = engine
        self._status = "LOADED"

    def start_stream(self) -> None:
        if self._status != "LOADED":
            raise RuntimeError("PRESENTER_NOT_LOADED")
        self._status = "RUNNING"
        self._thread = threading.Thread(target=self._run, name="musetalk-presenter", daemon=True)
        self._thread.start()

    def push_audio_chunk(self, pcm16: bytes) -> None:
        _validate_audio(pcm16)
        with self._lock:
            if self._status != "RUNNING":
                raise RuntimeError("PRESENTER_NOT_RUNNING")
            try:
                self._audio.put_nowait((pcm16, time.monotonic()))
            except queue.Full as exc:
                raise PresenterUnavailable("AUDIO_BACKPRESSURE") from exc
            self._audio_chunks += 1

    def _run(self) -> None:
        try:
            assert self._engine is not None
            while not self._stop_event.is_set():
                try:
                    item = self._audio.get(timeout=0.1)
                except queue.Empty:
                    continue
                if item is None:
                    break
                pcm16, received_at = item
                for frame in self._engine.render_pcm16_chunk(pcm16):
                    if self._stop_event.is_set():
                        break
                    _validate_frame(frame)
                    now = time.monotonic()
                    with self._lock:
                        self._frames_generated += 1
                        self._latency_ms = (now - received_at) * 1000
                        self._frame_times.append(now)
                        while self._frame_times and self._frame_times[0] < now - 2:
                            self._frame_times.popleft()
                    if self._frames.full():
                        try:
                            self._frames.get_nowait()
                        except queue.Empty:
                            pass
                    self._frames.put_nowait(frame)
        except Exception:
            with self._lock:
                self._status = "FAILED"
                self._error = "PRESENTER_INFERENCE_FAILED"
        finally:
            try:
                assert self._engine is not None
                self._engine.close()
            except Exception:
                pass
            with self._lock:
                if self._status != "FAILED":
                    self._status = "STOPPED"

    def receive_frames(self) -> Iterator[bytes]:
        while True:
            try:
                yield self._frames.get_nowait()
            except queue.Empty:
                break

    def stop(self) -> None:
        engine_to_close: FrameEngine | None = None
        with self._lock:
            if self._status in ("NEW", "STOPPED", "FAILED"):
                self._status = "STOPPED" if self._status != "FAILED" else "FAILED"
                return
            if self._status == "LOADED":
                self._status = "STOPPED"
                engine_to_close = self._engine
                self._engine = None
            else:
                self._status = "STOPPING"
                self._stop_event.set()
        if engine_to_close is not None:
            engine_to_close.close()
            return
        if self._thread is None:
            return
        try:
            self._audio.put_nowait(None)
        except queue.Full:
            pass
        self._thread.join(timeout=2)
        # A hung third-party inference call cannot be force-killed safely.
        # Keep STOPPING visible instead of claiming resources were released.

    def metrics(self) -> dict[str, object]:
        with self._lock:
            now = time.monotonic()
            while self._frame_times and self._frame_times[0] < now - 2:
                self._frame_times.popleft()
            return {
                "status": self._status,
                "error": self._error,
                "fps": round(len(self._frame_times) / 2, 1),
                "latency_ms": round(self._latency_ms, 1) if self._latency_ms is not None else None,
                "audio_queue_depth": self._audio.qsize(),
                "frame_queue_depth": self._frames.qsize(),
                "audio_chunks": self._audio_chunks,
                "frames_generated": self._frames_generated,
            }
