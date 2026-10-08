"""Trusted local WorkerBoundary joining presenter, audio, encoder and transport.

This adapter has no platform API, credential discovery, cloud inference, or
production validation override. LocalAgent verifies the signed owner/account
grant and its release gate before invoking this boundary.
"""
from __future__ import annotations

import os
import hashlib
import queue
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from av_encoder import EncoderConfig, InternalAVEncoder, resolve_ffmpeg_path
from capabilities import inspect_capabilities
from direct_stream import StreamError, TikTokLiveProvider
from engine import make_engine
from provider_config import dev_fallback_enabled
from worker_core import LiveError, LiveStore, MAX_AUDIO_BYTES, MAX_REFERENCE_BYTES
from local_ai_session import LocalAISession, LocalAIError
from local_brain import BrainScope, InMemoryProductStore, LocalBrainProvider, PendingLocalBrainRuntime, ProductSnapshot
from local_tts import PendingLocalTTSProvider
from local_llama_runtime import physical_memory_mib

from .agent import AgentError
from .security import SecurityError
from .stream_credentials import StreamCredentialStore
from .resource_manager import LocalResourceManager, select_profile


class _PreparedEngine:
    def __init__(self, engine, digest, fps):
        self.engine, self.digest, self.fps = engine, digest, fps

    def prepare(self, reference, fps):
        if fps != self.fps or hashlib.sha256(Path(reference).read_bytes()).hexdigest() != self.digest:
            raise RuntimeError("PRESENTER_WARMUP_REQUIRED")

    def render_pcm16_chunk(self, pcm):
        return self.engine.render_pcm16_chunk(pcm)

    def interrupt(self):
        interrupt = getattr(self.engine, "interrupt", None)
        if callable(interrupt):
            interrupt()

    def close(self):
        self.engine.close()


@dataclass
class _LocalSession:
    owner_id: str
    account_id: str
    product_ids: tuple[str, ...]
    reference_id: str
    provider: object
    store: object
    session_id: str = ""
    paused: bool = False
    stopped: bool = False
    cleanup_complete: bool = False
    recoveries: int = 0
    stream: object | None = None
    microphone: object | None = None
    microphone_queue: queue.Queue[bytes] = field(default_factory=lambda: queue.Queue(8))
    microphone_stop: threading.Event = field(default_factory=threading.Event)
    microphone_thread: threading.Thread | None = None
    microphone_drops: int = 0
    microphone_error: bool = False
    ai: LocalAISession | None = None


class LocalWorkerBoundary:
    def __init__(self, data_dir: Path, credential_store: StreamCredentialStore, *,
                 engine_factory: Callable = make_engine,
                 capability_probe: Callable = inspect_capabilities,
                 provider_factory: Callable = TikTokLiveProvider,
                 stream_factory: Callable | None = None,
                 store_factory: Callable = LiveStore,
                 microphone_factory: Callable | None = None,
                 ai_provider_factory: Callable | None = None,
                 compliance_transport_factory: Callable | None = None,
                 resource_manager=None,
                 stop_timeout_seconds: float = 15):
        self.data_dir = Path(data_dir)
        self._credentials = credential_store
        self._engine_factory = engine_factory
        self._capability_probe = capability_probe
        self._provider_factory = provider_factory
        self._stream_factory = stream_factory
        self._microphone_factory = microphone_factory
        self._store_factory = store_factory
        self._ai_provider_factory = ai_provider_factory or (lambda scope, products:
            (LocalBrainProvider(PendingLocalBrainRuntime(), products), PendingLocalTTSProvider()))
        self._compliance_transport_factory = compliance_transport_factory
        self._product_contexts: dict[tuple[str, str], list[dict[str, object]]] = {}
        self._compliance_contexts: dict[tuple[str, str], object] = {}
        self._ai_probe: LocalAISession | None = None
        self._prepared = {}
        self._resources = resource_manager or LocalResourceManager(select_profile(physical_memory_mib()[0] / 1024, None))
        if not 0 < stop_timeout_seconds <= 30:
            raise ValueError("Stop timeout must be positive and at most 30 seconds")
        self._stop_timeout_seconds = stop_timeout_seconds
        self._sessions: dict[str, _LocalSession] = {}
        self._pending: dict[str, _LocalSession] = {}
        self._lock = threading.RLock()
        self._closed = False
        self._initial_claimed = False
        self._capability_cache: dict[str, object] | None = None
        self._capability_at = 0.0
        self.encoder_config = EncoderConfig(video_codec=os.getenv("AI_LIVE_ENCODER", "libx264").strip() or "libx264")
        # Pausing speech or awaiting a comment keeps the live encoder running.
        self.store = self._make_store("initial")
        self._stores = [self.store]

    def _make_store(self, room_key: str):
        return self._store_factory(self.data_dir / "rooms" / room_key / "presenters",
            stream_factory=lambda owner, session, path: self._create_stream(owner, session, path, room_key),
            direct_audio=True, audio_idle_timeout_seconds=86400)

    @staticmethod
    def _error(code: str, status: int = 503) -> AgentError:
        message = "ต้องตั้งค่าการ LIVE" if code == "TIKTOK_LIVE_TRANSPORT_REQUIRED" else "ระบบ AI LIVE ยังไม่พร้อมใช้งาน"
        return AgentError(status, code, message)

    def _create_stream(self, owner_id: str, session_id: str, output_path: Path, room_key: str):
        with self._lock:
            record = self._sessions.get(session_id) or self._pending.get(room_key)
            if record is None or record.owner_id != owner_id or record.stopped:
                raise self._error("SESSION_NOT_FOUND", 404)
            record.session_id = session_id
            self._sessions[session_id] = record
            factory = self._stream_factory
            if factory is None:
                from av_pipeline import AVSessionStream
                factory = AVSessionStream
            record.stream = factory(output_path, provider=record.provider, config=self.encoder_config)
            return record.stream

    def health(self) -> dict[str, object]:
        with self._lock:
            if self._closed:
                return {"ready": False, "code": "WORKER_STOPPED"}
            now = time.monotonic()
            if self._capability_cache is None or now - self._capability_at >= 10:
                try:
                    capability = self._capability_probe()
                    executable = resolve_ffmpeg_path(self.encoder_config.ffmpeg_path)
                    if self.encoder_config.video_codec == "h264_nvenc":
                        codec_ready = capability.get("ffmpeg", {}).get("nvenc_usable") is True
                    else:
                        result = subprocess.run([executable, "-hide_banner", "-encoders"], capture_output=True,
                                                timeout=3, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                        codec_ready = result.returncode == 0 and b"libx264" in result.stdout
                    self._capability_cache = {"ready": capability.get("ready") is True and codec_ready,
                        "code": "READY" if capability.get("ready") is True and codec_ready else "WORKER_NOT_VALIDATED",
                        "encoder_ready": False, "presenter_ready": False,
                        "dev_fallback": capability.get("dev_fallback") is True}
                except Exception:
                    self._capability_cache = {"ready": False, "code": "WORKER_NOT_VALIDATED",
                                              "encoder_ready": False, "presenter_ready": False}
                self._capability_at = now
            result = dict(self._capability_cache)
            live_ai = next((record.ai for record in self._sessions.values() if not record.stopped and record.ai), None)
            probe = live_ai or self._ai_probe
            ai = probe.health() if probe else {"ready": False, "brain_ready": False, "tts_ready": False, "warmup_passed": False}
            result.update({key: ai.get(key) is True for key in ("brain_ready", "tts_ready", "warmup_passed")})
            prepared = any(item["ready"] for item in self._prepared.values()) or live_ai is not None
            result["presenter_ready"] = result["encoder_ready"] = prepared
            result["warmup_passed"] = result["warmup_passed"] and prepared
            result["ready"] = result["ready"] and ai.get("ready") is True and prepared
            if ai.get("ready") is not True:
                result["code"] = ai.get("code", "LOCAL_AI_WARMUP_REQUIRED")
            return result

    def _make_ai(self, owner_id, account_id, room_id, product_ids, emit_pcm, interrupt_audio):
        store = InMemoryProductStore()
        scope = BrainScope(owner_id, account_id, room_id)
        brain, voice = self._ai_provider_factory(scope, store)
        authority = self._compliance_transport_factory(scope, store) if self._compliance_transport_factory else None
        signed = self._compliance_contexts.get((owner_id, account_id))
        sync = getattr(authority, "sync_context", None)
        if signed is not None and callable(sync):
            sync(signed)
        return LocalAISession(scope, brain, voice, store, emit_pcm, product_ids=tuple(product_ids),
                              interrupt_audio=interrupt_audio, resource_manager=self._resources,
                              compliance_transport=authority)

    def sync_compliance_context(self, owner_id, account_id, signed):
        # Only called through the existing authenticated agent/inherited pipe.
        # The managed TypeScript authority independently verifies the envelope.
        import copy
        if (not isinstance(signed, dict) or not isinstance(signed.get("payload"), dict)
                or signed["payload"].get("ownerId") != owner_id
                or signed["payload"].get("accountId") != account_id):
            raise self._error("LOCAL_PRODUCT_SCOPE_MISMATCH", 422)
        key = (owner_id, account_id)
        with self._lock:
            if key not in self._compliance_contexts and len(self._compliance_contexts) >= 10:
                raise self._error("ROOM_CAPACITY_REACHED", 409)
            targets = ([self._prepared[key]["ai"]] if key in self._prepared else []) + [record.ai
                for record in self._sessions.values() if not record.stopped and record.owner_id == owner_id
                and record.account_id == account_id and record.ai]
            for ai in targets:
                # Context refresh interrupts any stale utterance before replacing
                # decision authority; the subsequent facts sync replaces its queue.
                ai.tts.interrupt()
                sync = getattr(ai.compliance.transport, "sync_context", None)
                if callable(sync):
                    sync(signed)
            self._compliance_contexts[key] = copy.deepcopy(signed)

    def warmup(self) -> dict[str, object]:
        # Selection/reference are required for genuine presenter/encoder warmup.
        return self.health()

    def prepare_room(self, owner_id, account_id, product_ids, presenter_path, microphone_id=None):
        path = Path(presenter_path)
        if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= MAX_REFERENCE_BYTES:
            raise self._error("PRESENTER_NOT_FOUND", 404)
        products = self._product_contexts.get((owner_id, account_id))
        if products is None or {product["productId"] for product in products} != set(product_ids):
            raise self._error("LOCAL_PRODUCT_CONTEXT_REQUIRED", 409)
        with self._lock:
            if (self._closed or any(not record.cleanup_complete and record.owner_id == owner_id
                    and record.account_id == account_id for record in self._sessions.values())
                    or any(record.owner_id == owner_id and record.account_id == account_id
                           for record in self._pending.values())):
                raise self._error("SESSION_BUSY", 409)
            old = self._prepared.pop((owner_id, account_id), None)
        if old:
            old["ai"].stop(); old["engine"].close()
        ai = self._make_ai(owner_id, account_id, str(uuid.uuid4()), product_ids, lambda _pcm: None, lambda: None)
        engine = encoder = None
        output = self.data_dir / "warmup" / (str(uuid.uuid4()) + ".mp4")
        try:
            ai.sync_products(products)
            readiness = ai.warmup()
            if readiness.get("ready") is not True:
                raise self._error(readiness.get("code", "LOCAL_AI_WARMUP_REQUIRED"))
            pcm = bytearray()
            for chunk in ai.tts.stream_text("ยินดีต้อนรับค่ะ", "presenter-warmup"):
                pcm.extend(chunk.pcm16)
                if len(pcm) >= 16000: break
            if not pcm or not any(pcm): raise RuntimeError("LOCAL_TTS_MODEL_PENDING")
            fps = 2 if dev_fallback_enabled() else self.encoder_config.fps
            engine = self._engine_factory()
            engine.prepare(path, fps)
            frames = iter(engine.render_pcm16_chunk(bytes(pcm[:32000])))
            try: frame = next(frames)
            finally:
                close = getattr(frames, "close", None)
                if callable(close): close()
            if not isinstance(frame, bytes) or not frame.startswith(b"\xff\xd8") or not frame.endswith(b"\xff\xd9"):
                raise RuntimeError("PRESENTER_WARMUP_FAILED")
            encoder = InternalAVEncoder(self.encoder_config, output)
            encoder.start(); encoder.push_frame(frame, 0); encoder.push_audio(bytes(pcm[:32000]), 0)
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                observed = encoder.metrics()
                if observed["error"] or (observed["encoded_bytes"] > 0 and observed["audio_encoded"]):
                    break
                time.sleep(0.05)
            encoder.dispose()
            metrics = encoder.metrics()
            if metrics["error"] or metrics["encoded_bytes"] <= 0 or not metrics["audio_encoded"]:
                raise RuntimeError("ENCODER_WARMUP_FAILED")
            with self._lock:
                self._prepared[(owner_id, account_id)] = {"ready": True, "ai": ai,
                    "engine": _PreparedEngine(engine, hashlib.sha256(path.read_bytes()).hexdigest(), fps),
                    "product_ids": tuple(product_ids)}
                self._ai_probe = ai
            return self.health()
        except Exception as exc:
            ai.stop()
            if engine: engine.close()
            raise self._error(getattr(exc, "code", "LOCAL_AI_WARMUP_FAILED")) from None
        finally:
            if encoder: encoder.dispose()
            output.unlink(missing_ok=True)

    def sync_product_context(self, owner_id: str, account_id: str, products: list[dict[str, object]]) -> None:
        # This inherited-pipe method is called only after LocalAgent verifies the
        # signed server product envelope. It is never a raw browser fact source.
        if not isinstance(products, list) or not 1 <= len(products) <= 10:
            raise self._error("LOCAL_PRODUCT_CONTEXT_INVALID", 422)
        try:
            scope = BrainScope(owner_id, account_id, "context-validation")
            checked = [ProductSnapshot(scope, product["productId"], product["name"], product["version"], product["facts"])
                for product in products if isinstance(product, dict) and set(product) == {"productId", "name", "version", "facts"}]
            if len(checked) != len(products) or len({product.product_id for product in checked}) != len(products):
                raise ValueError
        except Exception:
            raise self._error("LOCAL_PRODUCT_CONTEXT_INVALID", 422) from None
        import copy
        with self._lock:
            key = (owner_id, account_id)
            if key not in self._product_contexts and len(self._product_contexts) >= 10:
                raise self._error("ROOM_CAPACITY_REACHED", 409)
            targets = ([self._prepared[key]["ai"]] if key in self._prepared else []) + [record.ai
                for record in self._sessions.values() if not record.stopped and record.owner_id == owner_id
                and record.account_id == account_id and record.ai]
            if any(set(ai.product_ids) != {product.product_id for product in checked} for ai in targets):
                raise self._error("LOCAL_PRODUCT_SCOPE_MISMATCH", 409)
            for ai in targets:
                ai.sync_products(copy.deepcopy(products))
            self._product_contexts[key] = copy.deepcopy(products)

    def _owned(self, owner_id: str, session_id: str) -> _LocalSession:
        with self._lock:
            record = self._sessions.get(session_id)
            if record is None or record.owner_id != owner_id:
                raise self._error("SESSION_NOT_FOUND", 404)
            return record

    def start_session(self, owner_id: str, account_id: str, product_ids: tuple[str, ...],
                      presenter_path: Path, microphone_id: str | None) -> str:
        if microphone_id not in (None, "default"):
            raise self._error("MICROPHONE_NOT_ALLOWED", 422)
        with self._lock:
            if self._closed:
                raise self._error("WORKER_STOPPED")
            if (any(not record.cleanup_complete and record.owner_id == owner_id and record.account_id == account_id
                    for record in self._sessions.values())
                    or any(record.owner_id == owner_id and record.account_id == account_id for record in self._pending.values())):
                raise self._error("SESSION_BUSY", 409)
            if sum(not record.cleanup_complete for record in self._sessions.values()) + len(self._pending) >= 10:
                raise self._error("ROOM_CAPACITY_REACHED", 409)
            try:
                credentials = self._credentials.load(owner_id, account_id)
            except SecurityError as exc:
                raise self._error(exc.code, 403) from None
            if not credentials:
                raise self._error("TIKTOK_LIVE_TRANSPORT_REQUIRED")
            path = Path(presenter_path)
            if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= MAX_REFERENCE_BYTES:
                raise self._error("PRESENTER_NOT_FOUND", 404)
            # Capture the validated reference into owner-scoped worker storage.
            with path.open("rb") as source:
                image = source.read(MAX_REFERENCE_BYTES + 1)
            media_type = "image/png" if image.startswith(b"\x89PNG\r\n\x1a\n") else "image/jpeg"
            provider = None
            engine = None
            record = None
            room_key = "initial" if not self._initial_claimed else str(uuid.uuid4())
            self._initial_claimed = True
            room_store = self.store if room_key == "initial" else self._make_store(room_key)
            if room_store is not self.store:
                self._stores.append(room_store)
            try:
                provider = self._provider_factory(credentials["server_url"], credentials["stream_key"])
                # Avoid retaining a second plaintext credentials dictionary.
                credentials.clear()
                reference = room_store.save_reference(owner_id, image, media_type)
                record = _LocalSession(owner_id, account_id, tuple(product_ids), reference, provider, room_store)
                products = self._product_contexts.get((owner_id, account_id))
                if products is None or {product["productId"] for product in products} != set(product_ids):
                    raise self._error("LOCAL_PRODUCT_CONTEXT_REQUIRED", 409)
                prepared = self._prepared.get((owner_id, account_id))
                if not prepared or prepared["product_ids"] != tuple(product_ids):
                    raise self._error("LOCAL_AI_WARMUP_REQUIRED", 409)
                prepared["engine"].prepare(path, 2 if dev_fallback_enabled() else self.encoder_config.fps)
                engine = prepared["engine"]
                self._prepared.pop((owner_id, account_id))
                record.ai = prepared["ai"]
                record.ai.bind_output(lambda pcm: self.push_audio(owner_id, record.session_id, pcm),
                                      lambda: self._interrupt_room_audio(record))
                record.ai.sync_products(products)
                ai_health = record.ai.health()
                if ai_health.get("ready") is not True:
                    raise self._error(ai_health.get("code", "LOCAL_AI_WARMUP_REQUIRED"))
                self._pending[room_key] = record
                inference_fps = 2 if dev_fallback_enabled() else self.encoder_config.fps
                session_id, _ = room_store.start_session(owner_id, reference, inference_fps, engine)
                record.session_id = session_id
                self._sessions[session_id] = record
                self._pending.pop(room_key, None)
                record.ai.start()
                if microphone_id == "default":
                    self._start_microphone(record)
                # Bound retained stopped records, matching LiveStore's history.
                terminal = [key for key, item in self._sessions.items() if item.cleanup_complete]
                for key in terminal[:-19]:
                    old = self._sessions.pop(key, None)
                    if old and old.store is not self.store:
                        old.store.close()
                        self._stores.remove(old.store)
                return session_id
            except Exception as exc:
                self._pending.pop(room_key, None)
                if record and record.session_id:
                    self.stop_session(owner_id, record.session_id)
                else:
                    if engine:
                        try:
                            engine.close()
                        except Exception:
                            pass
                    if provider:
                        provider.dispose()
                    if record:
                        if record.ai:
                            record.ai.stop()
                        self._remove_reference(record)
                    room_store.close()
                    if room_store is not self.store:
                        self._stores.remove(room_store)
                if isinstance(exc, AgentError):
                    raise
                if isinstance(exc, (StreamError, LiveError)):
                    raise self._error(exc.code, getattr(exc, "status", 503)) from None
                raise self._error("WORKER_START_FAILED") from None
            finally:
                credentials.clear()

    @staticmethod
    def _interrupt_room_audio(record: _LocalSession) -> None:
        if not record.session_id:
            return
        session = record.store.get_session(record.owner_id, record.session_id)
        with session.lock:
            while not session.audio.empty():
                try:
                    session.audio.get_nowait()
                except queue.Empty:
                    break
            interrupt = getattr(record.stream, "interrupt_speech", None)
            if callable(interrupt):
                interrupt()
            else:
                # Existing AVSessionStream invalidates speech generation on
                # pause; immediately resume the SAME encoder/transport clock.
                pause, resume = getattr(record.stream, "pause_speech", None), getattr(record.stream, "resume_speech", None)
                if callable(pause) and callable(resume):
                    pause()
                    if not record.paused:
                        resume()

    def submit_comment(self, owner_id: str, session_id: str, comment: dict[str, object]) -> dict[str, object]:
        record = self._owned(owner_id, session_id)
        if record.stopped or not record.ai:
            raise self._error("SESSION_NOT_RUNNING", 409)
        return record.ai.submit_comment(comment)

    def queue_speech(self, owner_id: str, session_id: str, speech: dict[str, object]) -> dict[str, object]:
        record = self._owned(owner_id, session_id)
        if record.stopped or not record.ai or not isinstance(speech, dict) or set(speech) != {"id", "text", "productId"}:
            raise self._error("INVALID_SPEECH_REQUEST", 422)
        return {"accepted": record.ai.queue_speech(speech["id"], speech["text"], product_id=speech["productId"])}

    def session_ai_status(self, owner_id: str, session_id: str) -> dict[str, object]:
        record = self._owned(owner_id, session_id)
        return record.ai.snapshot() if record.ai else {"readiness": {"ready": False}}

    def push_audio(self, owner_id: str, session_id: str, pcm16: bytes) -> int:
        record = self._owned(owner_id, session_id)
        if not isinstance(pcm16, bytes) or not pcm16 or len(pcm16) % 2 or len(pcm16) > MAX_AUDIO_BYTES:
            raise self._error("INVALID_AUDIO_CHUNK", 422)
        with self._lock:
            if record.stopped:
                raise self._error("SESSION_NOT_RUNNING", 409)
            if record.paused:
                return 0
        try:
            return record.store.send_audio(owner_id, session_id, pcm16)
        except LiveError as exc:
            raise self._error(exc.code, exc.status) from None

    def _start_microphone(self, record: _LocalSession) -> None:
        factory = self._microphone_factory
        if factory is None:
            try:
                import sounddevice
                factory = sounddevice.RawInputStream
            except ImportError:
                raise self._error("MICROPHONE_UNAVAILABLE") from None

        def callback(indata, _frames, _timestamp, status) -> None:
            if record.microphone_stop.is_set() or record.paused or (record.ai and record.ai.speaking):
                return
            if status:
                record.microphone_drops += 1
            try:
                record.microphone_queue.put_nowait(bytes(indata))
            except queue.Full:
                record.microphone_drops += 1

        try:
            record.microphone = factory(samplerate=16000, channels=1, dtype="int16", blocksize=1600,
                                        callback=callback)
            record.microphone_thread = threading.Thread(target=self._drain_microphone, args=(record,),
                                                        name="live-microphone-input", daemon=True)
            record.microphone_thread.start()
            record.microphone.start()
        except Exception:
            self._stop_microphone(record)
            raise self._error("MICROPHONE_UNAVAILABLE") from None

    def _drain_microphone(self, record: _LocalSession) -> None:
        while not record.microphone_stop.is_set():
            try:
                pcm = record.microphone_queue.get(timeout=0.1)
            except queue.Empty:
                continue
            if record.paused:
                continue
            try:
                self.push_audio(record.owner_id, record.session_id, pcm)
            except AgentError as exc:
                record.microphone_drops += 1
                if exc.code not in ("PRESENTER_NOT_RUNNING", "AUDIO_BACKPRESSURE"):
                    record.microphone_error = True

    @staticmethod
    def _stop_microphone(record: _LocalSession) -> None:
        record.microphone_stop.set()
        if record.microphone:
            try:
                record.microphone.stop()
            except Exception:
                record.microphone_error = True
            try:
                record.microphone.close()
            except Exception:
                record.microphone_error = True
            finally:
                record.microphone = None
        if record.microphone_thread:
            record.microphone_thread.join(timeout=1)
        while not record.microphone_queue.empty():
            try:
                record.microphone_queue.get_nowait()
            except queue.Empty:
                break

    def pause_session(self, owner_id: str, session_id: str) -> None:
        record = self._owned(owner_id, session_id)
        with self._lock:
            if record.stopped:
                raise self._error("SESSION_NOT_RUNNING", 409)
            record.paused = True
            if record.ai:
                record.ai.pause()
            session = record.store.get_session(owner_id, session_id)
            while not session.audio.empty():
                try:
                    session.audio.get_nowait()
                except queue.Empty:
                    break
            pause_speech = getattr(record.stream, "pause_speech", None)
            if callable(pause_speech):
                pause_speech()

    def resume_session(self, owner_id: str, session_id: str) -> None:
        record = self._owned(owner_id, session_id)
        with self._lock:
            if record.stopped:
                raise self._error("SESSION_NOT_RUNNING", 409)
            record.paused = False
            resume_speech = getattr(record.stream, "resume_speech", None)
            if callable(resume_speech):
                resume_speech()
            if record.ai:
                record.ai.resume()

    def _remove_reference(self, record: _LocalSession) -> None:
        with record.store.lock:
            reference = record.store.references.pop(record.reference_id, None)
        if reference:
            reference.path.unlink(missing_ok=True)

    def stop_session(self, owner_id: str, session_id: str) -> None:
        record = self._owned(owner_id, session_id)
        with self._lock:
            if record.cleanup_complete:
                return
            record.stopped = True
        deadline = time.monotonic() + self._stop_timeout_seconds
        self._stop_microphone(record)
        ai_pending = False
        if record.ai:
            try:
                record.ai.stop(timeout_seconds=max(0, deadline - time.monotonic()))
            except LocalAIError:
                ai_pending = True
        try:
            record.store.stop_session(owner_id, session_id)
        finally:
            session = record.store.get_session(owner_id, session_id)
            if record.stream:
                record.stream.close()
            record.provider.dispose()
            if session.thread:
                session.thread.join(timeout=max(0, deadline - time.monotonic()))
        # Retain the reference and permit Stop to retry while native inference
        # finishes. The caller must not claim that every resource is released.
        if ai_pending or (session.thread and session.thread.is_alive()):
            raise self._error("WORKER_STOP_PENDING", 409)
        self._remove_reference(record)
        record.cleanup_complete = True
        record.store.close()

    def recover_session(self, owner_id: str, session_id: str) -> None:
        record = self._owned(owner_id, session_id)
        with self._lock:
            session = record.store.get_session(owner_id, session_id)
            if record.stopped or record.recoveries >= 1 or session.status != "RUNNING":
                raise self._error("RECOVERY_UNAVAILABLE", 409)
            record.recoveries += 1
        try:
            record.provider.reconnect()
        except Exception:
            raise self._error("RECOVERY_FAILED") from None

    def session_metrics(self, owner_id: str, session_id: str) -> dict[str, object]:
        record = self._owned(owner_id, session_id)
        session = record.store.get_session(owner_id, session_id)
        return {**session.metrics(),
                "paused": record.paused, "microphone_drops": record.microphone_drops,
                "microphone_error": record.microphone_error, "recovery_attempts": record.recoveries,
                "presenter_stalled": self._presenter_stalled(session), "resources_released": record.cleanup_complete,
                "transport": record.provider.metrics()}

    @staticmethod
    def _presenter_stalled(session) -> bool:
        threshold = 30 if session.dev_fallback else 5
        with session.lock:
            pending = session.inference_active or not session.audio.empty()
            last_progress = session.frame_times[-1] if session.frame_times else session.inference_started_at
            return bool(pending and last_progress is not None and time.monotonic() - last_progress > threshold)

    def preview_frame(self, owner_id: str, session_id: str) -> bytes | None:
        record = self._owned(owner_id, session_id)
        session = record.store.get_session(owner_id, session_id)
        with session.lock:
            return session.latest_frame

    def customer_stream(self, owner_id: str, session_id: str) -> dict[str, object]:
        record = self._owned(owner_id, session_id)
        session = record.store.get_session(owner_id, session_id)
        transport = record.provider.health()
        encoder_failed = bool(record.stream and record.stream.metrics().get("status") == "FAILED")
        presenter_stalled = self._presenter_stalled(session)
        if record.cleanup_complete:
            state = "STOPPED"
        elif record.stopped:
            state = "STOPPING"
        elif session.status == "FAILED" or encoder_failed or transport.get("status") == "FAILED" or record.microphone_error:
            state = "ERROR"
        elif transport.get("status") == "RECONNECTING":
            state = "RECONNECTING"
        elif transport.get("healthy") is True:
            state = "LIVE"
        elif session.status == "STARTING" or record.stream is None:
            state = "PREPARING"
        else:
            state = "CONNECTING"
        quality = "PROBLEM" if state == "ERROR" or presenter_stalled or transport.get("output_stalled") else "GOOD" if state == "LIVE" else "FAIR"
        return {"phase": state, "connectionQuality": quality}

    def close(self) -> None:
        with self._lock:
            records = list(self._sessions.values())
            prepared = list(self._prepared.values())
            self._prepared.clear()
            self._closed = True
        for item in prepared:
            try:
                item["ai"].stop()
            finally:
                item["engine"].close()
        for record in records:
            try:
                self.stop_session(record.owner_id, record.session_id)
            except AgentError as exc:
                if exc.code != "WORKER_STOP_PENDING":
                    raise
        for store in self._stores:
            store.close()
        if self._ai_probe:
            self._ai_probe.stop()
        self._product_contexts.clear()
        self._compliance_contexts.clear()
