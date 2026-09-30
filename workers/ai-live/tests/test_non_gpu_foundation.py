from __future__ import annotations

import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from presenter import (  # noqa: E402
    MockPresenter, MuseTalkPresenter, PresenterProvider, PresenterUnavailable,
)
from voice import (  # noqa: E402
    SpeechChunk, SpeechChunkQueue, UnconfiguredVoiceProvider, VoiceProvider,
)
from watchdog import LiveObservation, LiveWatchdog  # noqa: E402

JPEG = b"\xff\xd8test-frame\xff\xd9"
PCM = b"\x00\x00" * 160


class FakeEngine:
    def __init__(self) -> None:
        self.closed = False
        self.chunks = 0

    def prepare(self, reference: Path, fps: int) -> None:
        assert reference.is_file() and fps == 25

    def render_pcm16_chunk(self, audio: bytes):
        assert audio == PCM
        self.chunks += 1
        yield JPEG

    def close(self) -> None:
        self.closed = True


class BurstEngine(FakeEngine):
    def render_pcm16_chunk(self, audio: bytes):
        assert audio == PCM
        self.chunks += 1
        for _ in range(200):
            yield JPEG


class PresenterContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.reference = Path(self.temp_dir.name) / "reference.jpg"
        self.reference.write_bytes(JPEG)

    def test_mock_is_explicit_and_never_fabricates_default_frames(self) -> None:
        with self.assertRaises(PresenterUnavailable) as denied:
            MockPresenter(internal_use=False)
        self.assertEqual(denied.exception.code, "MOCK_PRESENTER_INTERNAL_ONLY")
        presenter = MockPresenter(internal_use=True)
        self.assertIsInstance(presenter, PresenterProvider)
        presenter.load_presenter(self.reference, 25)
        presenter.start_stream()
        presenter.push_audio_chunk(PCM)
        self.assertEqual(list(presenter.receive_frames()), [])
        self.assertEqual(presenter.health()["status"], "MOCK_ONLY")
        presenter.stop()

    def test_mock_30_minute_virtual_stream_has_bounded_frame_queue(self) -> None:
        presenter = MockPresenter(internal_use=True, frame_factory=lambda _audio: iter((JPEG,)))
        presenter.load_presenter(self.reference, 25)
        presenter.start_stream()
        # 1 one-second audio chunk per simulated second; no wall-clock sleep.
        for second in range(30 * 60):
            presenter.push_audio_chunk(PCM)
            if second % 10 == 0:
                list(presenter.receive_frames())
            self.assertLessEqual(presenter.metrics()["frame_queue_depth"], 2)
        self.assertEqual(presenter.metrics()["audio_chunks"], 1800)
        self.assertEqual(presenter.metrics()["frames_generated"], 1800)
        presenter.stop()
        self.assertEqual(presenter.metrics()["frame_queue_depth"], 0)

    def test_musetalk_requires_cuda_and_never_constructs_mock(self) -> None:
        calls = []
        presenter = MuseTalkPresenter(
            capability_probe=lambda: {"gpu": {"cuda_available": False}, "ready": False},
            engine_factory=lambda: calls.append("created"),  # type: ignore[arg-type]
        )
        self.assertEqual(presenter.health()["status"], "GPU_REQUIRED")
        with self.assertRaises(PresenterUnavailable) as unavailable:
            presenter.load_presenter(self.reference, 25)
        self.assertEqual(unavailable.exception.code, "GPU_REQUIRED")
        self.assertEqual(calls, [])

    def test_musetalk_incremental_contract_with_injected_test_backend(self) -> None:
        engine = FakeEngine()
        presenter = MuseTalkPresenter(
            capability_probe=lambda: {"gpu": {"cuda_available": True}, "ready": True},
            engine_factory=lambda: engine,
        )
        self.assertIsInstance(presenter, PresenterProvider)
        presenter.load_presenter(self.reference, 25)
        presenter.start_stream()
        presenter.push_audio_chunk(PCM)
        frames = []
        deadline = time.monotonic() + 2
        while not frames and time.monotonic() < deadline:
            frames.extend(presenter.receive_frames())
            time.sleep(0.005)
        self.assertEqual(frames, [JPEG])
        self.assertEqual(presenter.metrics()["frames_generated"], 1)
        presenter.stop()
        self.assertTrue(engine.closed)
        self.assertEqual(presenter.metrics()["status"], "STOPPED")

    def test_musetalk_frame_timing_window_stays_bounded_under_burst(self) -> None:
        engine = BurstEngine()
        presenter = MuseTalkPresenter(
            capability_probe=lambda: {"gpu": {"cuda_available": True}, "ready": True},
            engine_factory=lambda: engine,
        )
        presenter.load_presenter(self.reference, 25)
        presenter.start_stream()
        presenter.push_audio_chunk(PCM)
        deadline = time.monotonic() + 2
        while presenter.metrics()["frames_generated"] < 200 and time.monotonic() < deadline:
            time.sleep(0.005)
        self.assertEqual(presenter.metrics()["frames_generated"], 200)
        self.assertLessEqual(len(presenter._frame_times), 120)
        presenter.stop()


class VoiceContractTests(unittest.TestCase):
    def test_voice_is_unconfigured_until_an_explicit_provider_is_installed(self) -> None:
        voice = UnconfiguredVoiceProvider()
        self.assertIsInstance(voice, VoiceProvider)
        self.assertEqual(voice.health()["status"], "VOICE_PROVIDER_REQUIRED")
        with self.assertRaisesRegex(RuntimeError, "VOICE_PROVIDER_REQUIRED"):
            list(voice.stream_text("Hello", "utterance-1"))

    def test_audio_queue_backpressure_interrupt_and_cancel(self) -> None:
        queue = SpeechChunkQueue(max_pending=2)
        chunk = SpeechChunk(PCM, "utterance-1")
        generation = queue.generation
        queue.push(chunk, generation=generation)
        queue.push(chunk, generation=generation)
        with self.assertRaisesRegex(RuntimeError, "SPEECH_BACKPRESSURE"):
            queue.push(chunk, generation=generation)
        self.assertEqual(queue.metrics()["queue_depth"], 2)
        self.assertEqual(queue.interrupt(), 2)
        self.assertIsNone(queue.pop())
        with self.assertRaisesRegex(RuntimeError, "SPEECH_INTERRUPTED"):
            queue.push(chunk, generation=generation)
        queue.push(chunk, generation=queue.generation)
        self.assertEqual(queue.cancel(), 1)
        with self.assertRaisesRegex(RuntimeError, "SPEECH_CANCELLED"):
            queue.push(chunk, generation=queue.generation)

    def test_rejects_invalid_pcm_shape(self) -> None:
        for pcm in (b"", b"\x00", b"\x00" * 32_002):
            with self.assertRaises(ValueError):
                SpeechChunk(pcm, "utterance-1")


class WatchdogTests(unittest.TestCase):
    def test_detects_stale_dependencies_and_caps_recovery_attempts(self) -> None:
        watchdog = LiveWatchdog(max_recovery_attempts=1, stuck_after_seconds=10)
        observation = LiveObservation(
            session_alive=True, presenter_alive=False, stream_connected=False,
            audio_queue_depth=2, audio_oldest_age_seconds=11,
            comment_queue_depth=1, comment_oldest_age_seconds=12,
        )
        self.assertEqual(watchdog.inspect(observation), (
            "PRESENTER_NOT_ALIVE", "AUDIO_QUEUE_STUCK",
            "COMMENT_QUEUE_STUCK", "STREAM_DISCONNECTED",
        ))
        self.assertTrue(watchdog.claim_recovery(observation))
        self.assertFalse(watchdog.claim_recovery(observation))
        self.assertEqual(watchdog.recovery_attempts, 1)

    def test_healthy_session_never_claims_recovery(self) -> None:
        watchdog = LiveWatchdog()
        observation = LiveObservation(True, True, True)
        self.assertEqual(watchdog.inspect(observation), ())
        self.assertFalse(watchdog.claim_recovery(observation))


if __name__ == "__main__":
    unittest.main()
