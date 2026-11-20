"""One media boundary for CPU development and the future validated GPU worker.

Video starts only on an actual generated JPEG. Holding it is not new inference.
"""
from __future__ import annotations

import threading
import time
from pathlib import Path

from av_encoder import EncoderConfig, InternalAVEncoder
from direct_stream import LocalTestStream, StreamProvider
from watchdog import LiveObservation, LiveWatchdog


class AVSessionStream:
    def __init__(self, output_path: Path, provider: StreamProvider | None = None,
                 config: EncoderConfig | None = None):
        self.provider = provider or LocalTestStream(output_path.with_suffix(".flv"))
        self.encoder = InternalAVEncoder(config or EncoderConfig(), output_path, self.provider)
        self._watchdog = LiveWatchdog(max_recovery_attempts=0)
        self._stop = threading.Event()
        self._closed = False
        self._fatal_error: str | None = None
        self._inference_active = False
        self._inference_started_at: float | None = None
        self._presenter_last_progress: float | None = None
        self.presenter_timeout_seconds = 30.0
        self.on_failure = None
        self._issues: tuple[str, ...] = ()
        self._monitor: threading.Thread | None = None
        self._speech_paused = False
        self.speech_generation = 0

    def start(self) -> None:
        self.provider.connect()
        self.provider.start()
        try:
            self.encoder.start()
        except Exception:
            self.provider.dispose()
            raise
        self._monitor = threading.Thread(target=self._observe, name="live-av-watchdog", daemon=True)
        self._monitor.start()

    def _observe(self) -> None:
        while not self._stop.wait(1):
            encoded = self.encoder.health()
            transport = self.provider.health()
            running = encoded["status"] == "RUNNING"
            progress_at = (self._presenter_last_progress if self._presenter_last_progress is not None
                           else self._inference_started_at)
            stalled_presenter = (self._inference_active and progress_at is not None
                and time.monotonic() - progress_at > self.presenter_timeout_seconds)
            self._issues = self._watchdog.inspect(LiveObservation(
                session_alive=not self._stop.is_set(), presenter_alive=not stalled_presenter,
                encoder_alive=encoded["status"] != "FAILED",
                stream_connected=transport.get("healthy") is True or not running,
                encoder_output_age_seconds=(encoded.get("output_age_ms") or 0) / 1000 if running else 0,
                audio_queue_depth=int(encoded["audio_buffer_samples"]),
                audio_oldest_age_seconds=float(encoded["audio_input_age_ms"]) / 1000,
            ))
            # Transport owns bounded reconnect. Never restart the encoder clock,
            # presenter session, or speech to reconnect the destination.
            if (encoded["status"] == "FAILED" or encoded.get("encoder_stalled") or encoded.get("audio_stalled")
                    or transport.get("status") == "FAILED" or stalled_presenter):
                self._fatal_error = ("PRESENTER_STALLED" if stalled_presenter else
                                     "AUDIO_STALLED" if encoded.get("audio_stalled") else "STREAM_PIPELINE_FAILED")
                try:
                    if callable(self.on_failure):
                        self.on_failure()
                except Exception:
                    # Failure notification must not prevent media release.
                    pass
                finally:
                    self._stop.set()
                    try:
                        self.encoder.stop()
                    finally:
                        self.provider.stop()

    def push_frame(self, jpeg: bytes) -> bool:
        if self._speech_paused:
            return False
        accepted = self.encoder.push_frame(jpeg)
        if accepted:
            self._presenter_last_progress = time.monotonic()
        return accepted

    def push_audio(self, pcm: bytes) -> bool:
        # Reserve the entire chunk under the encoder lock, including concurrent
        # microphone and voice input. A rejected chunk was never partly played.
        return False if self._speech_paused else self.encoder.push_audio(pcm, allow_partial=False)

    def pause_speech(self) -> None:
        self._speech_paused = True
        self.speech_generation += 1
        self.encoder.cancel_pending_audio()
        self.presenter_activity(False)

    def resume_speech(self) -> None:
        self._speech_paused = False

    def accepts_speech_generation(self, generation: int) -> bool:
        return not self._speech_paused and generation == self.speech_generation

    def presenter_activity(self, active: bool) -> None:
        self._inference_active = active
        self._inference_started_at = time.monotonic() if active else None
        self._presenter_last_progress = self._inference_started_at

    def metrics(self) -> dict[str, object]:
        encoded = self.encoder.metrics()
        if self._fatal_error:
            encoded.update({"status": "FAILED", "error": self._fatal_error})
        return {**encoded, "audio_buffer_ms": encoded["audio_latency_ms"],
                "transport": self.provider.metrics(), "watchdog_issues": list(self._issues)}

    def close(self) -> None:
        if self._closed:
            return
        self._stop.set()
        if self._monitor and self._monitor is not threading.current_thread():
            self._monitor.join(timeout=2)
        try:
            self.encoder.dispose()
        finally:
            self.provider.dispose()
            self._closed = True
