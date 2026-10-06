"""Owner-scoped, bounded live-session state with incremental frame delivery."""

from __future__ import annotations

import queue
import os
import threading
import time
import uuid
import logging
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator, Callable

from engine import FrameEngine
from provider_config import dev_fallback_enabled
from av_pipeline import AVSessionStream

MAX_REFERENCE_BYTES = 4 * 1024 * 1024
MAX_REFERENCE_STORAGE_BYTES = 64 * 1024 * 1024
MAX_REFERENCES = 20
MAX_REFERENCE_BYTES_PER_OWNER = 20 * 1024 * 1024
MAX_REFERENCES_PER_OWNER = 5
MAX_IMAGE_DIMENSION = 8192
MAX_IMAGE_PIXELS = 16_000_000
REFERENCE_TTL_SECONDS = 60 * 60
MAX_AUDIO_BYTES = 32_000  # 1 second, 16 kHz mono signed 16-bit PCM
MAX_PENDING_AUDIO_CHUNKS = 4
AUDIO_IDLE_TIMEOUT_SECONDS = 15.0


class LiveError(Exception):
    def __init__(self, status: int, code: str, detail: str):
        super().__init__(detail)
        self.status = status
        self.code = code
        self.detail = detail


def image_dimensions(image: bytes, media_type: str) -> tuple[int, int]:
    """Read image header dimensions without decoding untrusted pixel data."""
    if media_type == "image/png":
        if len(image) < 33 or image[12:16] != b"IHDR":
            raise LiveError(415, "INVALID_REFERENCE_IMAGE", "PNG header is invalid")
        return int.from_bytes(image[16:20], "big"), int.from_bytes(image[20:24], "big")
    if media_type == "image/jpeg":
        offset = 2
        sof_markers = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                       0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
        while offset + 4 <= len(image):
            if image[offset] != 0xFF:
                break
            while offset < len(image) and image[offset] == 0xFF:
                offset += 1
            if offset >= len(image):
                break
            marker = image[offset]
            offset += 1
            if marker in (0xD8, 0xD9, 0x01) or 0xD0 <= marker <= 0xD7:
                continue
            if offset + 2 > len(image):
                break
            segment_length = int.from_bytes(image[offset:offset + 2], "big")
            if segment_length < 2 or offset + segment_length > len(image):
                break
            if marker in sof_markers:
                if segment_length < 7:
                    break
                return (int.from_bytes(image[offset + 5:offset + 7], "big"),
                        int.from_bytes(image[offset + 3:offset + 5], "big"))
            offset += segment_length
    raise LiveError(415, "INVALID_REFERENCE_IMAGE", "JPEG/PNG dimensions are missing")


@dataclass(frozen=True)
class Reference:
    owner_id: str
    path: Path
    size_bytes: int
    created_at: float


@dataclass
class Session:
    owner_id: str
    reference_id: str
    engine: FrameEngine
    fps_target: int
    audio_idle_timeout_seconds: float = AUDIO_IDLE_TIMEOUT_SECONDS
    status: str = "STARTING"
    audio: queue.Queue[tuple[bytes, float] | None] = field(
        default_factory=lambda: queue.Queue(maxsize=MAX_PENDING_AUDIO_CHUNKS)
    )
    listeners: list[queue.Queue[bytes | None]] = field(default_factory=list)
    stop_event: threading.Event = field(default_factory=threading.Event)
    lock: threading.Lock = field(default_factory=threading.Lock)
    frame_times: deque[float] = field(default_factory=lambda: deque(maxlen=120))
    frames_generated: int = 0
    latency_ms: float | None = None
    last_audio_at: float | None = None
    stop_reason: str | None = None
    error: str | None = None
    dev_fallback: bool = False
    stream: AVSessionStream | None = None
    stream_factory: Callable[[Path], AVSessionStream] | None = None
    direct_audio: bool = False
    inference_audio_drops: int = 0
    output_path: Path | None = None
    started_at: float | None = None
    ended_at: float | None = None
    latency_samples: deque[float] = field(default_factory=lambda: deque(maxlen=4096))
    audio_queue_delay_ms: float | None = None
    frame_drops: int = 0
    audio_chunks: int = 0
    inference_active: bool = False
    inference_started_at: float | None = None
    inference_delay_ms: float | None = None
    latest_frame: bytes | None = None
    thread: threading.Thread | None = None
    process: object | None = None

    def metrics(self) -> dict[str, object]:
        with self.lock:
            now = time.monotonic()
            while self.frame_times and self.frame_times[0] < now - 2:
                self.frame_times.popleft()
            fps = len(self.frame_times) / 2 if self.frame_times else 0.0
            result = {
                "status": self.status,
                "fps": round(fps, 1),
                "target_fps": self.fps_target,
                "latency_ms": round(self.latency_ms, 1) if self.latency_ms is not None else None,
                "queue_depth": self.audio.qsize(),
                "frames_generated": self.frames_generated,
                "stop_reason": self.stop_reason,
                "error": self.error,
                "inference_audio_drops": self.inference_audio_drops,
            }
            if self.stream is not None:
                result["encoder"] = self.stream.metrics()
            if self.dev_fallback:
                samples = sorted(self.latency_samples)
                duration = (self.ended_at or now) - (self.started_at or now)
                cpu = ram = None
                if self.process is not None:
                    try:
                        cpu = round(self.process.cpu_percent(), 1)
                        ram = round(self.process.memory_info().rss / (1024 * 1024), 1)
                    except Exception:
                        pass
                result.update({
                    "dev_fallback": True, "backend": "MuseTalkCPUFloat32",
                    "average_fps": round(self.frames_generated / duration, 3) if duration > 0 else 0,
                    "p50_latency_ms": round(samples[int((len(samples) - 1) * .5)], 1) if samples else None,
                    "p95_latency_ms": round(samples[int((len(samples) - 1) * .95)], 1) if samples else None,
                    "cpu_percent": cpu, "ram_mb": ram, "frame_drops": self.frame_drops,
                    "audio_queue_delay_ms": self.audio_queue_delay_ms,
                    "audio_queue_depth": self.audio.qsize(), "audio_chunks": self.audio_chunks,
                    "audio_receiving": self.audio_chunks > 0 and self.last_audio_at is not None and now - self.last_audio_at < 2,
                    "inference_active": self.inference_active,
                    "inference_delay_ms": self.inference_delay_ms,
                    "preview_status": "GENERATED" if self.latest_frame else "WAITING_FOR_FRAMES",
                    "resources_released": self.status in ("STOPPED", "FAILED") and (self.thread is None or not self.thread.is_alive()),
                    "encoder": self.stream.metrics() if self.stream else None,
                })
            return result

    def emit_frame(self, jpeg: bytes, received_at: float) -> None:
        if not (jpeg.startswith(b"\xff\xd8") and jpeg.endswith(b"\xff\xd9")):
            raise ValueError("backend returned a non-JPEG frame")
        now = time.monotonic()
        with self.lock:
            self.frames_generated += 1
            self.latency_ms = (now - received_at) * 1000
            self.latency_samples.append(self.latency_ms)
            if self.inference_started_at is not None:
                self.inference_delay_ms = round((now - self.inference_started_at) * 1000, 1)
            self.latest_frame = jpeg
            self.frame_times.append(now)
            for listener in self.listeners:
                if listener.full():
                    try:
                        listener.get_nowait()
                        self.frame_drops += 1
                    except queue.Empty:
                        pass
                listener.put_nowait(jpeg)
        if self.stream is not None:
            self.stream.push_frame(jpeg)


class LiveStore:
    def __init__(
        self,
        data_dir: Path,
        audio_idle_timeout_seconds: float = AUDIO_IDLE_TIMEOUT_SECONDS,
        reference_ttl_seconds: float = REFERENCE_TTL_SECONDS,
        max_reference_storage_bytes: int = MAX_REFERENCE_STORAGE_BYTES,
        max_references: int = MAX_REFERENCES,
        max_reference_bytes_per_owner: int = MAX_REFERENCE_BYTES_PER_OWNER,
        max_references_per_owner: int = MAX_REFERENCES_PER_OWNER,
        janitor_interval_seconds: float = 60.0,
        stream_factory: Callable[[str, str, Path], AVSessionStream] | None = None,
        direct_audio: bool | None = None,
    ):
        if min(audio_idle_timeout_seconds, reference_ttl_seconds, max_reference_storage_bytes,
               max_references, max_reference_bytes_per_owner,
               max_references_per_owner, janitor_interval_seconds) <= 0:
            raise ValueError("Worker timeouts and reference quotas must be positive")
        self.data_dir = data_dir
        self.audio_idle_timeout_seconds = audio_idle_timeout_seconds
        self.reference_ttl_seconds = reference_ttl_seconds
        self.max_reference_storage_bytes = max_reference_storage_bytes
        self.max_references = max_references
        self.max_reference_bytes_per_owner = max_reference_bytes_per_owner
        self.max_references_per_owner = max_references_per_owner
        self.stream_factory = stream_factory
        self.direct_audio = dev_fallback_enabled() if direct_audio is None else direct_audio
        self.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.data_dir.is_symlink():
            raise ValueError("Reference directory must not be a symlink")
        os.chmod(self.data_dir, 0o700)
        self.references: dict[str, Reference] = {}
        self.sessions: dict[str, Session] = {}
        self.lock = threading.Lock()
        # Reference metadata is intentionally in-memory only. On restart, no
        # previous reference ID can be authenticated, so remove orphan files.
        self._remove_orphaned_files()
        self.janitor_stop = threading.Event()
        self.janitor = threading.Thread(
            target=self._janitor_loop,
            args=(janitor_interval_seconds,),
            name="presenter-reference-janitor",
            daemon=True,
        )
        self.janitor.start()

    def _remove_orphaned_files(self) -> None:
        for path in self.data_dir.iterdir():
            if path.suffix.lower() not in (".jpg", ".png"):
                continue
            try:
                if str(uuid.UUID(path.stem)) != path.stem:
                    continue
            except ValueError:
                continue
            if path.is_file() or path.is_symlink():
                path.unlink(missing_ok=True)

    def _janitor_loop(self, interval: float) -> None:
        while not self.janitor_stop.wait(interval):
            self.prune_references()

    def close(self) -> None:
        self.janitor_stop.set()
        self.janitor.join(timeout=1)
        for session_id, session in list(self.sessions.items()):
            self.stop_session(session.owner_id, session_id)

    def prune_references(self) -> None:
        with self.lock:
            self._prune_references_locked()

    def _prune_references_locked(self) -> None:
        active_ids = {
            session.reference_id for session in self.sessions.values()
            if session.status in ("STARTING", "RUNNING", "STOPPING")
        }
        now = time.time()
        for reference_id, reference in list(self.references.items()):
            if reference_id in active_ids or now - reference.created_at < self.reference_ttl_seconds:
                continue
            try:
                reference.path.unlink(missing_ok=True)
            except OSError:
                # Retry next sweep. Keep it counted against storage quota.
                continue
            del self.references[reference_id]

    def save_reference(self, owner_id: str, image: bytes, media_type: str) -> str:
        if not image or len(image) > MAX_REFERENCE_BYTES:
            raise LiveError(413, "INVALID_REFERENCE_SIZE", "Reference image must be nonempty and at most 4 MiB")
        if media_type == "image/jpeg" and image.startswith(b"\xff\xd8") and image.endswith(b"\xff\xd9"):
            suffix = ".jpg"
        elif media_type == "image/png" and image.startswith(b"\x89PNG\r\n\x1a\n"):
            suffix = ".png"
        else:
            raise LiveError(415, "INVALID_REFERENCE_TYPE", "Use a JPEG or PNG image")
        width, height = image_dimensions(image, media_type)
        if (width < 1 or height < 1 or width > MAX_IMAGE_DIMENSION
                or height > MAX_IMAGE_DIMENSION or width * height > MAX_IMAGE_PIXELS):
            raise LiveError(422, "REFERENCE_DIMENSIONS_TOO_LARGE", "Reference dimensions exceed 16 MP / 8192 px")
        reference_id = str(uuid.uuid4())
        path = self.data_dir / f"{reference_id}{suffix}"
        with self.lock:
            self._prune_references_locked()
            stored_bytes = sum(reference.size_bytes for reference in self.references.values())
            owned = [reference for reference in self.references.values() if reference.owner_id == owner_id]
            if (len(self.references) >= self.max_references
                    or stored_bytes + len(image) > self.max_reference_storage_bytes
                    or len(owned) >= self.max_references_per_owner
                    or sum(reference.size_bytes for reference in owned) + len(image)
                    > self.max_reference_bytes_per_owner):
                raise LiveError(507, "REFERENCE_QUOTA_EXCEEDED", "Presenter reference storage is full")
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            try:
                with os.fdopen(descriptor, "wb") as output:
                    output.write(image)
            except Exception:
                path.unlink(missing_ok=True)
                raise
            self.references[reference_id] = Reference(owner_id, path, len(image), time.time())
        return reference_id

    def get_reference(self, owner_id: str, reference_id: str) -> Reference:
        with self.lock:
            self._prune_references_locked()
            reference = self.references.get(reference_id)
        if reference is None or reference.owner_id != owner_id:
            raise LiveError(404, "REFERENCE_NOT_FOUND", "Reference not found")
        return reference

    def start_session(
        self, owner_id: str, reference_id: str, fps: int, engine: FrameEngine
    ) -> tuple[str, Session]:
        if not 1 <= fps <= 30:
            raise LiveError(422, "INVALID_FPS", "Target FPS must be from 1 to 30")
        reference = self.get_reference(owner_id, reference_id)
        with self.lock:
            busy = any(
                session.status in ("STARTING", "RUNNING", "STOPPING") or (session.thread is not None and session.thread.is_alive())
                for session in self.sessions.values()
            )
            if not busy:
                session_id = str(uuid.uuid4())
                session = Session(
                    owner_id, reference_id, engine, fps,
                    audio_idle_timeout_seconds=self.audio_idle_timeout_seconds,
                )
                session.dev_fallback = dev_fallback_enabled()
                session.direct_audio = self.direct_audio
                if session.dev_fallback or self.stream_factory is not None:
                    output_dir = Path(os.getenv("AI_LIVE_DEV_OUTPUT_DIR", "").strip() or str(self.data_dir / "outputs"))
                    session.output_path = output_dir / f"{session_id}.mp4"
                    session.stream_factory = (lambda path: self.stream_factory(owner_id, session_id, path)) if self.stream_factory else AVSessionStream
                # Retain a bounded number of completed records for diagnostics.
                completed = [key for key, value in self.sessions.items() if value.status in ("STOPPED", "FAILED")]
                for key in completed[:-19]:
                    del self.sessions[key]
                self.sessions[session_id] = session
        if busy:
            try:
                engine.close()
            finally:
                raise LiveError(409, "PRESENTER_BUSY", "The presenter worker is busy")
        session.thread = threading.Thread(
            target=self._process_audio,
            args=(session, reference.path),
            name=f"presenter-{session_id}",
            daemon=True,
        )
        session.thread.start()
        return session_id, session

    @staticmethod
    def _process_audio(session: Session, reference_path: Path) -> None:
        try:
            session.engine.prepare(reference_path, session.fps_target)
            if session.dev_fallback and not session.stop_event.is_set():
                try:
                    import psutil
                    session.process = psutil.Process()
                    session.process.cpu_percent()
                except ImportError:
                    pass
            if session.stream_factory and not session.stop_event.is_set():
                assert session.output_path is not None
                session.stream = session.stream_factory(session.output_path)
                session.stream.presenter_timeout_seconds = 30.0 if session.dev_fallback else 5.0
                session.stream.on_failure = lambda: (session.stop_event.set(), getattr(session.engine, "interrupt", lambda: None)())
                session.stream.start()
            with session.lock:
                if not session.stop_event.is_set():
                    session.status = "RUNNING"
                    session.last_audio_at = time.monotonic()
                    session.started_at = session.last_audio_at
            while not session.stop_event.is_set():
                if session.stream and session.stream.metrics()["status"] == "FAILED":
                    raise RuntimeError("ENCODER_FAILED")
                try:
                    item = session.audio.get(timeout=0.25)
                except queue.Empty:
                    with session.lock:
                        if (
                            session.status == "RUNNING"
                            and session.last_audio_at is not None
                            and time.monotonic() - session.last_audio_at
                            >= session.audio_idle_timeout_seconds
                        ):
                            session.status = "STOPPING"
                            session.stop_reason = "AUDIO_IDLE_TIMEOUT"
                            session.stop_event.set()
                    continue
                if item is None:
                    break
                pcm, received_at = item
                with session.lock:
                    session.audio_queue_delay_ms = round((time.monotonic() - received_at) * 1000, 1)
                    session.inference_active = True
                    session.inference_started_at = time.monotonic()
                activity = getattr(session.stream, "presenter_activity", None)
                generation = getattr(session.stream, "speech_generation", None)
                accepts_generation = getattr(session.stream, "accepts_speech_generation", None)
                if callable(activity):
                    activity(True)
                # The engine must yield frames during inference, not after a
                # complete video has been rendered to disk.
                for jpeg in session.engine.render_pcm16_chunk(pcm):
                    if session.stop_event.is_set():
                        break
                    if callable(accepts_generation) and not accepts_generation(generation):
                        break
                    session.emit_frame(jpeg, received_at)
                with session.lock:
                    session.inference_active = False
                if callable(activity):
                    activity(False)
        except Exception:
            if session.dev_fallback:
                logging.getLogger(__name__).exception("Development presenter inference failed")
            # Do not leak model paths or driver internals through the API.
            with session.lock:
                session.status = "FAILED"
                session.error = "PRESENTER_INFERENCE_FAILED"
        finally:
            try:
                session.engine.close()
            except Exception:
                pass
            if session.stream is not None:
                session.stream.close()
                if session.stream.metrics()["status"] == "FAILED":
                    session.status = "FAILED"
                    session.error = "LIVE_PIPELINE_FAILED"
            with session.lock:
                session.inference_active = False
                session.ended_at = time.monotonic()
                while not session.audio.empty():
                    try:
                        session.audio.get_nowait()
                    except queue.Empty:
                        break
                if session.status != "FAILED":
                    session.status = "STOPPED"
                for listener in session.listeners:
                    if listener.full():
                        try:
                            listener.get_nowait()
                        except queue.Empty:
                            pass
                    listener.put_nowait(None)

    def get_session(self, owner_id: str, session_id: str) -> Session:
        with self.lock:
            session = self.sessions.get(session_id)
        if session is None or session.owner_id != owner_id:
            raise LiveError(404, "SESSION_NOT_FOUND", "Presenter session not found")
        return session

    def send_audio(self, owner_id: str, session_id: str, pcm: bytes) -> int:
        session = self.get_session(owner_id, session_id)
        if not pcm or len(pcm) > MAX_AUDIO_BYTES or len(pcm) % 2:
            raise LiveError(422, "INVALID_AUDIO_CHUNK", "Send at most 1 second of 16-kHz mono PCM16")
        with session.lock:
            if session.status != "RUNNING":
                raise LiveError(409, "PRESENTER_NOT_RUNNING", "Presenter is not running")
            try:
                received_at = time.monotonic()
                if session.stream and session.direct_audio:
                    if not session.stream.push_audio(pcm):
                        raise LiveError(429, "AUDIO_BACKPRESSURE", "Live audio buffer is full")
                    if session.audio.full():
                        # Audio playback is already clocked independently. Slow
                        # CPU inference uses recent speech instead of growing
                        # an unbounded lip-sync backlog. Count this explicitly.
                        session.audio.get_nowait()
                        session.inference_audio_drops += 1
                session.audio.put_nowait((pcm, received_at))
                session.last_audio_at = received_at
                session.audio_chunks += 1
            except queue.Full as exc:
                raise LiveError(429, "AUDIO_BACKPRESSURE", "Presenter audio queue is full") from exc
        return session.audio.qsize()

    def stop_session(self, owner_id: str, session_id: str) -> str:
        session = self.get_session(owner_id, session_id)
        with session.lock:
            if session.status in ("STOPPED", "FAILED"):
                terminal = True
            else:
                terminal = False
                session.status = "STOPPING"
            session.stop_event.set()
        if terminal:
            if session.thread is not None:
                session.thread.join(timeout=2)
            return session.status
        try:
            session.audio.put_nowait(None)
        except queue.Full:
            pass
        interrupt = getattr(session.engine, "interrupt", None)
        if callable(interrupt):
            interrupt()
        if session.thread is not None:
            session.thread.join(timeout=2)
        return session.status

    def frames(self, owner_id: str, session_id: str) -> Iterator[bytes]:
        session = self.get_session(owner_id, session_id)
        listener: queue.Queue[bytes | None] = queue.Queue(maxsize=2)
        with session.lock:
            if session.status in ("STOPPED", "FAILED"):
                raise LiveError(409, "PRESENTER_NOT_RUNNING", "Presenter is not running")
            session.listeners.append(listener)
        try:
            while True:
                try:
                    frame = listener.get(timeout=1)
                except queue.Empty:
                    if session.stop_event.is_set():
                        break
                    continue
                if frame is None:
                    break
                yield b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(frame)).encode() + b"\r\n\r\n" + frame + b"\r\n"
        finally:
            with session.lock:
                if listener in session.listeners:
                    session.listeners.remove(listener)
