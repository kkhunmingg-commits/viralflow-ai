"""Provider-neutral, bounded speech-chunk boundary for future AI LIVE audio."""

from __future__ import annotations

import threading
from collections import deque
from dataclasses import dataclass
from typing import Iterator, Protocol, runtime_checkable

MAX_PENDING_SPEECH_CHUNKS = 8
MAX_SPEECH_CHUNK_BYTES = 32_000


@dataclass(frozen=True)
class SpeechChunk:
    pcm16: bytes
    utterance_id: str
    sample_rate_hz: int = 16_000

    def __post_init__(self) -> None:
        if (not self.pcm16 or len(self.pcm16) > MAX_SPEECH_CHUNK_BYTES
                or len(self.pcm16) % 2 or self.sample_rate_hz != 16_000
                or not self.utterance_id):
            raise ValueError("INVALID_SPEECH_CHUNK")


@runtime_checkable
class VoiceProvider(Protocol):
    def stream_text(self, text: str, utterance_id: str) -> Iterator[SpeechChunk]:
        """Yield incremental speech chunks for text; no whole-clip prerequisite."""

    def interrupt(self) -> None:
        """Stop current utterance and discard pending chunks."""

    def cancel(self) -> None:
        """Permanently cancel this provider instance."""

    def health(self) -> dict[str, object]:
        """Report whether a configured speech source is available."""


class UnconfiguredVoiceProvider:
    """Honest default: no paid or local speech engine is silently selected."""

    def stream_text(self, text: str, utterance_id: str) -> Iterator[SpeechChunk]:
        if not text.strip() or not utterance_id:
            raise ValueError("INVALID_SPEECH_REQUEST")
        raise RuntimeError("VOICE_PROVIDER_REQUIRED")
        yield  # pragma: no cover - keeps this method an iterator contract

    def interrupt(self) -> None:
        pass

    def cancel(self) -> None:
        pass

    def health(self) -> dict[str, object]:
        return {"ready": False, "status": "VOICE_PROVIDER_REQUIRED"}


class SpeechChunkQueue:
    """Bounded bridge from a future VoiceProvider to presenter audio input.

    An interrupt invalidates chunks from the current utterance. Cancellation
    closes the queue. No background TTS or network call is started here.
    """

    def __init__(self, max_pending: int = MAX_PENDING_SPEECH_CHUNKS) -> None:
        if max_pending < 1:
            raise ValueError("max_pending must be positive")
        self._pending: deque[SpeechChunk] = deque()
        self._max_pending = max_pending
        self._cancelled = False
        self._generation = 0
        self._lock = threading.Lock()

    @property
    def generation(self) -> int:
        with self._lock:
            return self._generation

    def push(self, chunk: SpeechChunk, *, generation: int) -> None:
        with self._lock:
            if self._cancelled:
                raise RuntimeError("SPEECH_CANCELLED")
            if generation != self._generation:
                raise RuntimeError("SPEECH_INTERRUPTED")
            if len(self._pending) >= self._max_pending:
                raise RuntimeError("SPEECH_BACKPRESSURE")
            self._pending.append(chunk)

    def pop(self) -> SpeechChunk | None:
        with self._lock:
            return self._pending.popleft() if self._pending else None

    def interrupt(self) -> int:
        with self._lock:
            removed = len(self._pending)
            self._pending.clear()
            self._generation += 1
            return removed

    def cancel(self) -> int:
        with self._lock:
            removed = len(self._pending)
            self._pending.clear()
            self._generation += 1
            self._cancelled = True
            return removed

    def metrics(self) -> dict[str, object]:
        with self._lock:
            return {"queue_depth": len(self._pending), "cancelled": self._cancelled}
