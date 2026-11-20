"""Owner/room-scoped local comment → brain → streaming PCM scheduler.

The same executor is used by the installed worker and contract tests. Only the
model/encoder boundaries are substituted in tests. There is no cloud AI client,
OS voice fallback, prerecorded presenter, or alternate test orchestration.
"""
from __future__ import annotations

import re
import math
import threading
import time
from collections import OrderedDict, deque
from dataclasses import dataclass
from typing import Callable

from local_brain import BrainRequest, BrainScope, InMemoryProductStore, ProductSnapshot
from voice import SpeechChunk


class LocalAIError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class SafetyVoiceBuffer:
    """Python worker projection of the existing finite, real-PCM safety buffer.

    Clips are prepared by the SAME local voice adapter before a room starts.
    Missing clips mean silence/recovery, never synthesized test tones or looping
    filler. Product claims cannot be reused for another product/context.
    """
    def __init__(self, max_seconds: int = 120):
        if type(max_seconds) is not int or not 1 <= max_seconds <= 600:
            raise ValueError("INVALID_SAFETY_CAPACITY")
        self._clips: deque[tuple[str | None, bytearray]] = deque()
        self._maximum = max_seconds * 32_000
        self._lock = threading.Lock()
        self.activations = self.consumed_bytes = 0

    def prepare(self, chunks: list[SpeechChunk], product_id: str | None = None) -> None:
        if not chunks or any(not isinstance(chunk, SpeechChunk) for chunk in chunks):
            raise LocalAIError("INVALID_SAFETY_VOICE_PCM")
        pcm = bytearray(b"".join(chunk.pcm16 for chunk in chunks))
        if not pcm or not any(pcm):
            raise LocalAIError("INVALID_SAFETY_VOICE_PCM")
        with self._lock:
            if len(pcm) + sum(len(clip) for _, clip in self._clips) > self._maximum:
                raise LocalAIError("SAFETY_VOICE_CAPACITY")
            self._clips.append((product_id, pcm))

    def take(self, product_id: str | None) -> bytes | None:
        with self._lock:
            for entry in tuple(self._clips):
                bound, pcm = entry
                if bound is not None and bound != product_id:
                    continue
                result = bytes(pcm[:16_000])  # at most half a second
                del pcm[:len(result)]
                if not pcm:
                    self._clips.remove(entry)
                self.consumed_bytes += len(result)
                return result
        return None

    def clear(self) -> None:
        with self._lock:
            for _, clip in self._clips:
                clip[:] = b"\0" * len(clip)
            self._clips.clear()

    def metrics(self) -> dict[str, object]:
        with self._lock:
            return {"remaining_seconds": sum(len(clip) for _, clip in self._clips) / 32_000,
                    "fallback_activations": self.activations,
                    "consumed_seconds": self.consumed_bytes / 32_000}


@dataclass
class _Speech:
    key: str
    text: str
    priority: int
    source: str
    product_id: str | None
    sequence: int
    gesture: str = "neutral"
    sentence_index: int = 0


def comment_priority(text: str) -> int:
    # Match the existing CommentEngine customer-priority policy.
    if re.search(r"อันตราย|หลอกลวง|รายงาน|คุกคาม|unsafe|scam|report|harassment", text, re.I):
        return 100
    if re.search(r"ราคา|เท่าไหร่|กี่บาท|price|cost|shipping|[?？]|ไหม|มั้ย|how|what|where", text, re.I):
        return 80
    if re.search(r"ซื้อ|สั่ง|ตะกร้า|buy|order|checkout", text, re.I):
        return 70
    return 50 if re.search(r"สวัสดี|หวัดดี|hello|\bhi\b", text, re.I) else 30


class LocalAISession:
    """Single speech consumer per physical room, bounded queues and cancellation.

    Native generation receives a deadline/cancellation event. A non-cooperative
    model is quarantined; a second inference never starts over its stuck thread.
    Stop reports pending cleanup so the managed child watchdog can release it.
    """
    def __init__(self, scope: BrainScope, brain, tts, product_store: InMemoryProductStore,
                 emit_pcm: Callable[[bytes], object], *, product_ids: tuple[str, ...],
                 interrupt_audio: Callable[[], None] = lambda: None,
                 gesture_intent: Callable[[str], None] = lambda _intent: None,
                 brain_timeout_seconds: float = 3, speech_timeout_seconds: float = 30,
                 pace_audio: bool = True, resource_manager=None):
        if not 0.01 <= brain_timeout_seconds <= 30 or not 0.01 <= speech_timeout_seconds <= 120:
            raise ValueError("INVALID_LOCAL_AI_DEADLINE")
        self.scope, self.brain, self.tts, self.product_store = scope, brain, tts, product_store
        self.product_ids = tuple(product_ids)
        self.current_product_id = product_ids[0] if product_ids else None
        self._emit_pcm, self._interrupt_audio, self._gesture = emit_pcm, interrupt_audio, gesture_intent
        self._brain_timeout, self._speech_timeout, self._pace = brain_timeout_seconds, speech_timeout_seconds, pace_audio
        self._resources = resource_manager
        self.safety = SafetyVoiceBuffer()
        self._condition = threading.Condition(threading.RLock())
        self._comments: list[tuple[int, int, str, str]] = []
        self._speech: list[_Speech] = []
        self._seen: OrderedDict[str, float] = OrderedDict()
        self._viewers: dict[str, float] = {}
        self._sequence = 0
        self._active: _Speech | None = None
        self._cancel = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._native_thread: threading.Thread | None = None
        self._paused = self._warmed = False
        self._error: str | None = None
        self._last_comment: str | None = None
        self._response: str | None = None
        self._events: deque[str] = deque(maxlen=40)
        self._audio_chunks = self._replies = 0

    def sync_products(self, snapshots: list[dict[str, object]]) -> None:
        """Trusted caller only: LocalAgent verified server signature/scope first."""
        if not isinstance(snapshots, list) or len(snapshots) > 10:
            raise LocalAIError("LOCAL_PRODUCT_CONTEXT_INVALID")
        prepared = []
        for value in snapshots:
            if not isinstance(value, dict) or set(value) != {"productId", "name", "version", "facts"}:
                raise LocalAIError("LOCAL_PRODUCT_CONTEXT_INVALID")
            if value["productId"] not in self.product_ids:
                raise LocalAIError("LOCAL_PRODUCT_SCOPE_MISMATCH")
            prepared.append(ProductSnapshot(self.scope, value["productId"], value["name"], value["version"], value["facts"]))
        if len({snapshot.product_id for snapshot in prepared}) != len(prepared):
            raise LocalAIError("LOCAL_PRODUCT_CONTEXT_INVALID")
        if {snapshot.product_id for snapshot in prepared} != set(self.product_ids):
            raise LocalAIError("LOCAL_PRODUCT_SCOPE_MISMATCH")
        with self._condition:
            if self._active is not None:
                self._interrupt()
            self._speech = [speech for speech in self._speech if speech.product_id is None]
            self._response = None
            self.product_store.clear_scope(self.scope)
            for snapshot in prepared:
                self.product_store.put(snapshot)

    def warmup(self) -> dict[str, object]:
        self._warmed = False
        self._error = "LOCAL_AI_WARMUP_REQUIRED"
        self.safety.clear()
        brain = self.brain.warmup(timeout_seconds=30)
        voice = self.tts.warmup()
        self._warmed = brain.get("ready") is True and voice.get("ready") is True
        if not self._warmed:
            self._error = "LOCAL_TTS_MODEL_PENDING" if voice.get("ready") is not True else "LOCAL_BRAIN_NOT_READY"
            return self.health()
        # Generic, finite filler only. Failed preparation never substitutes audio.
        prepared = list(self.tts.stream_text("ขอสักครู่นะคะ กำลังตรวจสอบข้อมูลให้ค่ะ", "warmup-safety"))
        self.safety.prepare(prepared)
        self._error = None
        return self.health()

    def bind_output(self, emit_pcm, interrupt_audio):
        with self._condition:
            if self._thread is not None:
                raise LocalAIError("LOCAL_AI_SESSION_ALREADY_STARTED")
            self._emit_pcm, self._interrupt_audio = emit_pcm, interrupt_audio

    def _admit(self, kind, cancel, timeout):
        from contextlib import nullcontext
        return (self._resources.acquire(kind, allow_cpu=True, prefer_gpu=False,
                                        timeout_seconds=timeout, cancel_event=cancel)
                if self._resources is not None else nullcontext())

    def health(self) -> dict[str, object]:
        brain_ready = self.brain.health().get("ready") is True
        voice_ready = self.tts.health().get("ready") is True
        if self._warmed and not (brain_ready and voice_ready):
            self._warmed = False
        code = (self._error or ("LOCAL_BRAIN_NOT_READY" if not brain_ready else
                "LOCAL_TTS_MODEL_PENDING" if not voice_ready else
                "LOCAL_AI_WARMUP_REQUIRED" if not self._warmed else "READY"))
        return {"ready": self._warmed and brain_ready and voice_ready and not self._stop.is_set() and self._error is None,
                "brain_ready": brain_ready, "tts_ready": voice_ready,
                "warmup_passed": self._warmed, "code": code,
                "local": True, "requires_api_key": False}

    def start(self) -> None:
        with self._condition:
            if self._thread is not None:
                raise LocalAIError("LOCAL_AI_SESSION_ALREADY_STARTED")
            if not self.health()["ready"]:
                raise LocalAIError(self._error or "LOCAL_AI_WARMUP_REQUIRED")
            self._thread = threading.Thread(target=self._run, name="local-live-ai-room", daemon=True)
            self._thread.start()

    def submit_comment(self, value: dict[str, object]) -> dict[str, object]:
        with self._condition:
            if self._stop.is_set():
                raise LocalAIError("LOCAL_AI_SESSION_STOPPED")
            if (not isinstance(value, dict) or set(value) != {"commentId", "viewerId", "text", "createdAtMs"}
                    or any(not isinstance(value[key], str) or not value[key].strip() or len(value[key]) > limit
                           for key, limit in (("commentId", 160), ("viewerId", 160), ("text", 300)))
                    or type(value["createdAtMs"]) not in (int, float)
                    or not math.isfinite(value["createdAtMs"]) or value["createdAtMs"] < 0):
                return {"accepted": False, "reason": "INVALID"}
            now = time.monotonic()
            text = " ".join(value["text"].split())
            key, signature = "id:" + value["commentId"], "text:" + value["viewerId"] + "\0" + text.casefold()
            self._seen = OrderedDict((key, at) for key, at in self._seen.items() if now - at < 300)
            self._viewers = {viewer: at for viewer, at in self._viewers.items() if now - at < 3}
            if key in self._seen or signature in self._seen:
                return {"accepted": False, "reason": "DUPLICATE"}
            if re.search(r"https?://|www\.|(.)\1{9,}", text, re.I):
                return {"accepted": False, "reason": "SPAM"}
            if value["viewerId"] in self._viewers:
                return {"accepted": False, "reason": "COOLDOWN"}
            priority = comment_priority(text)
            if len(self._comments) >= 100:
                weakest = min(self._comments, key=lambda item: item[0])
                if priority <= weakest[0]:
                    return {"accepted": False, "reason": "QUEUE_FULL"}
                self._comments.remove(weakest)
            self._sequence += 1
            self._comments.append((priority, self._sequence, value["commentId"], text))
            self._seen[key] = self._seen[signature] = now
            self._viewers[value["viewerId"]] = now
            while len(self._seen) > 2000:
                self._seen.popitem(last=False)
            if self._active is not None and priority > self._active.priority:
                self._interrupt()
            self._condition.notify_all()
            return {"accepted": True}

    def queue_speech(self, key: str, text: str, *, priority: int = 20, product_id: str | None = None) -> bool:
        with self._condition:
            if (self._stop.is_set() or not isinstance(key, str) or not 1 <= len(key) <= 160
                    or not isinstance(text, str) or not 1 <= len(text.strip()) <= 1600
                    or type(priority) is not int or not 0 <= priority <= 100
                    or (product_id is not None and product_id not in self.product_ids)
                    or len(self._speech) >= 100 or "speech:" + key in self._seen):
                return False
            self._sequence += 1
            self._speech.append(_Speech(key, text.strip(), priority, "SCRIPT", product_id, self._sequence))
            self._seen["speech:" + key] = time.monotonic()
            while len(self._seen) > 2000:
                self._seen.popitem(last=False)
            self._condition.notify_all()
            return True

    def _interrupt(self) -> None:
        self._cancel.set()
        self.tts.interrupt()
        self._interrupt_audio()

    def pause(self) -> None:
        with self._condition:
            self._paused = True
            self._interrupt()
            self._events.append("หยุดตอบผู้ชมชั่วคราว")

    def resume(self) -> None:
        with self._condition:
            self._paused = False
            self._events.append("ตอบผู้ชมต่อ")
            self._condition.notify_all()

    def _output(self, pcm: bytes) -> None:
        if self._cancel.is_set() or self._stop.is_set() or self._paused:
            raise LocalAIError("LOCAL_AI_INTERRUPTED")
        self._emit_pcm(pcm)
        self._audio_chunks += 1
        if self._pace and self._cancel.wait(len(pcm) / 32_000):
            raise LocalAIError("LOCAL_AI_INTERRUPTED")

    def _answer(self, text: str):
        result: list[object] = []
        finished = threading.Event()
        cancel = self._cancel
        def infer():
            try:
                with self._admit("BRAIN", cancel, self._brain_timeout):
                    result.append(self.brain.generate(BrainRequest(self.scope, text, self.current_product_id),
                        timeout_seconds=self._brain_timeout, cancel_event=cancel))
            except Exception as error:
                result.append(error)
            finally:
                finished.set()
        self._native_thread = threading.Thread(target=infer, name="local-live-brain", daemon=True)
        self._native_thread.start()
        deadline = time.monotonic() + self._brain_timeout
        activated = False
        while not finished.wait(min(0.05, max(0, deadline - time.monotonic()))):
            interrupted = cancel.is_set() or self._stop.is_set() or self._paused
            if interrupted or time.monotonic() >= deadline:
                cancel.set()
                if not finished.wait(0.25):
                    self._error = "LOCAL_AI_NATIVE_STOP_PENDING"
                raise LocalAIError("LOCAL_AI_INTERRUPTED" if interrupted else "LOCAL_BRAIN_TIMEOUT")
            # Half-second wait tick, matching existing LivePipeline safety semantics.
            if deadline - time.monotonic() < self._brain_timeout - 0.5:
                fallback = self.safety.take(self.current_product_id)
                if fallback:
                    if not activated:
                        self.safety.activations += 1
                        activated = True
                    self._output(fallback)
        if isinstance(result[0], Exception):
            raise result[0]
        return result[0]

    def _speak(self, request: _Speech) -> None:
        from thai_speech import sentence_chunks
        sentences = sentence_chunks(request.text)
        deadline = time.monotonic() + self._speech_timeout
        self._gesture(request.gesture)
        for index in range(request.sentence_index, len(sentences)):
            request.sentence_index = index
            with self._admit("TTS", self._cancel, min(30, self._speech_timeout)):
                for chunk in self.tts.stream_text(sentences[index], request.key + ":" + str(index)):
                    if time.monotonic() >= deadline:
                        self._interrupt()
                        raise LocalAIError("LOCAL_TTS_TIMEOUT")
                    if not isinstance(chunk, SpeechChunk):
                        raise LocalAIError("INVALID_SPEECH_CHUNK")
                    self._output(chunk.pcm16)
            request.sentence_index = index + 1

    def _run(self) -> None:
        while not self._stop.is_set():
            with self._condition:
                self._condition.wait_for(lambda: self._stop.is_set() or (not self._paused and
                    (self._comments or self._speech)), timeout=0.5)
                if self._stop.is_set():
                    break
                if self._paused or self._error == "LOCAL_AI_NATIVE_STOP_PENDING":
                    if self._native_thread and not self._native_thread.is_alive():
                        self._error = None
                    self._condition.wait(0.05)
                    continue
                self._cancel = threading.Event()
                comment = max(self._comments, key=lambda item: (item[0], -item[1])) if self._comments else None
                speech = max(self._speech, key=lambda item: (item.priority, -item.sequence)) if self._speech else None
                if comment is None and speech is None:
                    continue
                if comment and (speech is None or comment[0] > speech.priority):
                    self._comments.remove(comment)
                    self._active = _Speech(comment[2], comment[3], comment[0], "COMMENT", self.current_product_id, comment[1])
                else:
                    self._speech.remove(speech)
                    self._active = speech
                active = self._active
            try:
                if active.source == "COMMENT":
                    self._last_comment = active.text
                    self._events.append("กำลังตอบผู้ชม")
                    reply = self._answer(active.text)
                    active.text, active.gesture = reply.text, reply.gesture_intent
                    self._response = reply.text
                    self._replies += 1
                self._events.append("กำลังพูด")
                self._speak(active)
            except Exception as error:
                code = getattr(error, "code", str(error))
                if self._cancel.is_set() and active.source == "SCRIPT" and not self._stop.is_set():
                    with self._condition:
                        self._speech.append(active)  # resume at current sentence, no overlapping PCM
                elif code in ("LOCAL_BRAIN_TIMEOUT", "LOCAL_BRAIN_CANCELLED") and not self._paused and not self._stop.is_set():
                    if self._error != "LOCAL_AI_NATIVE_STOP_PENDING":
                        self._cancel = threading.Event()
                        fallback = self.safety.take(self.current_product_id)
                        if fallback:
                            self.safety.activations += 1
                            self._output(fallback)
                elif code != "LOCAL_AI_INTERRUPTED":
                    self._error = code if code in ("LOCAL_TTS_MODEL_PENDING", "LOCAL_TTS_TIMEOUT", "LOCAL_AI_NATIVE_STOP_PENDING") else "LOCAL_AI_RESPONSE_FAILED"
            finally:
                with self._condition:
                    self._active = None
                self._gesture("neutral")

    def snapshot(self) -> dict[str, object]:
        with self._condition:
            return {"readiness": self.health(), "paused": self._paused, "lastComment": self._last_comment,
                    "currentResponse": self._response, "activity": list(self._events),
                    "comment_queue_depth": len(self._comments), "speech_queue_depth": len(self._speech),
                    "audio_chunks": self._audio_chunks, "replies": self._replies, "safety": self.safety.metrics()}

    @property
    def speaking(self) -> bool:
        with self._condition:
            return self._active is not None

    def stop(self, timeout_seconds: float = 3) -> None:
        with self._condition:
            self._stop.set()
            self._interrupt()
            self._comments.clear()
            self._speech.clear()
            self._condition.notify_all()
        self.tts.cancel()
        self.brain.close()
        for thread in (self._thread, self._native_thread):
            if thread is not None and thread is not threading.current_thread():
                thread.join(timeout=max(0, timeout_seconds))
                if thread.is_alive():
                    raise LocalAIError("LOCAL_AI_NATIVE_STOP_PENDING")
        self.product_store.clear_scope(self.scope)
        self.safety.clear()
