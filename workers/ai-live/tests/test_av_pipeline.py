"""Same session media boundary: fail closed, bounded observation, safe audio retry."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from av_pipeline import AVSessionStream


class OneObservation:
    def __init__(self):
        self.waited = False
        self.stopped = False

    def wait(self, _seconds):
        if self.waited or self.stopped:
            return True
        self.waited = True
        return False

    def set(self):
        self.stopped = True

    def is_set(self):
        return self.stopped


class AVPipelineTests(unittest.TestCase):
    def media(self):
        with patch("av_pipeline.InternalAVEncoder") as constructor:
            encoder = constructor.return_value
            encoder.health.return_value = {"status": "RUNNING", "encoder_stalled": False,
                "output_age_ms": 0, "audio_buffer_samples": 0, "audio_input_age_ms": 0}
            provider = Mock()
            provider.health.return_value = {"status": "LIVE", "healthy": True}
            stream = AVSessionStream(Path("unit.mp4"), provider)
            stream._stop = OneObservation()
            stream.on_failure = Mock()
            return stream, encoder, provider

    def test_pause_ai_preserves_stream_and_rejects_cancelled_generation_after_resume(self):
        stream, encoder, provider = self.media()
        original_generation = stream.speech_generation
        stream.pause_speech()
        encoder.cancel_pending_audio.assert_called_once_with()
        self.assertFalse(stream.push_audio(b"pending speech"))
        self.assertFalse(stream.push_frame(b"cancelled inference"))
        self.assertFalse(stream.accepts_speech_generation(original_generation))
        stream.resume_speech()
        self.assertFalse(stream.accepts_speech_generation(original_generation))
        self.assertTrue(stream.accepts_speech_generation(stream.speech_generation))
        stream.push_audio(b"new speech")
        encoder.push_audio.assert_called_once_with(b"new speech", allow_partial=False)
        provider.stop.assert_not_called()
        encoder.stop.assert_not_called()
        self.assertFalse(stream._stop.is_set())

    def test_failed_destination_stops_media_and_marks_original_session_failed(self):
        stream, encoder, provider = self.media()
        provider.health.return_value = {"status": "FAILED", "healthy": False}
        stream._observe()
        stream.on_failure.assert_called_once_with()
        encoder.stop.assert_called_once_with()
        provider.stop.assert_called_once_with()
        encoder.metrics.return_value = {"status": "STOPPED", "audio_latency_ms": 0}
        self.assertEqual(stream.metrics()["status"], "FAILED")
        stream.close()
        stream.close()
        encoder.dispose.assert_called_once_with()
        provider.dispose.assert_called_once_with()

    def test_no_presenter_progress_interrupts_original_session_without_restart(self):
        stream, encoder, provider = self.media()
        with patch("av_pipeline.time.monotonic", return_value=100):
            stream.presenter_activity(True)
        with patch("av_pipeline.time.monotonic", return_value=131):
            stream._observe()
        stream.on_failure.assert_called_once_with()
        encoder.stop.assert_called_once_with()
        provider.stop.assert_called_once_with()
        self.assertEqual(stream._fatal_error, "PRESENTER_STALLED")
        provider.start.assert_not_called()

    def test_actual_frame_progress_keeps_long_inference_alive(self):
        stream, encoder, provider = self.media()
        with patch("av_pipeline.time.monotonic", return_value=100):
            stream.presenter_activity(True)
        with patch("av_pipeline.time.monotonic", return_value=130):
            stream.push_frame(b"actual frame fixture")
        with patch("av_pipeline.time.monotonic", return_value=140):
            stream._observe()
        stream.on_failure.assert_not_called()
        encoder.stop.assert_not_called()
        provider.stop.assert_not_called()

    def test_rejected_frame_does_not_reset_presenter_stall_deadline(self):
        stream, encoder, provider = self.media()
        encoder.push_frame.return_value = False
        with patch("av_pipeline.time.monotonic", return_value=100):
            stream.presenter_activity(True)
        with patch("av_pipeline.time.monotonic", return_value=130):
            self.assertFalse(stream.push_frame(b"rejected frame fixture"))
        with patch("av_pipeline.time.monotonic", return_value=131):
            stream._observe()
        self.assertEqual(stream._fatal_error, "PRESENTER_STALLED")
        encoder.stop.assert_called_once_with()
        provider.stop.assert_called_once_with()

    def test_stalled_audio_track_stops_the_original_session(self):
        stream, encoder, provider = self.media()
        encoder.health.return_value["audio_stalled"] = True
        stream._observe()
        self.assertEqual(stream._fatal_error, "AUDIO_STALLED")
        stream.on_failure.assert_called_once_with()
        encoder.stop.assert_called_once_with()
        provider.stop.assert_called_once_with()
        provider.start.assert_not_called()

    def test_failure_callback_error_still_releases_media_and_preserves_fatal_code(self):
        stream, encoder, provider = self.media()
        encoder.health.return_value["audio_stalled"] = True
        stream.on_failure.side_effect = RuntimeError("unit presenter interrupt failure")
        stream._observe()
        self.assertEqual(stream._fatal_error, "AUDIO_STALLED")
        self.assertTrue(stream._stop.is_set())
        encoder.stop.assert_called_once_with()
        provider.stop.assert_called_once_with()

    def test_long_queued_pcm_does_not_fail_while_audio_track_advances(self):
        stream, encoder, provider = self.media()
        encoder.health.return_value.update({"audio_buffer_samples": 16000,
            "audio_input_age_ms": 11000, "audio_stalled": False})
        stream._observe()
        self.assertIn("AUDIO_QUEUE_STUCK", stream._issues)
        stream.on_failure.assert_not_called()
        encoder.stop.assert_not_called()
        provider.stop.assert_not_called()

    def test_audio_reservation_is_whole_chunk_at_shared_encoder_boundary(self):
        stream, encoder, _provider = self.media()
        encoder.push_audio.return_value = False
        self.assertFalse(stream.push_audio(b"\x00\x01" * 100))
        encoder.push_audio.assert_called_once_with(b"\x00\x01" * 100, allow_partial=False)


if __name__ == "__main__":
    unittest.main()
