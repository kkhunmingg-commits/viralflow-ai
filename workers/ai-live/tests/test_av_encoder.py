"""Actual FFmpeg encode/decode checks with explicitly synthetic unit fixtures."""
from __future__ import annotations

import io
import math
import struct
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from av_encoder import EncoderConfig, InternalAVEncoder, resolve_ffmpeg_path

try:
    from PIL import Image
    FFMPEG = resolve_ffmpeg_path()
except (ImportError, RuntimeError):
    FFMPEG = None


def jpeg(color: str = "blue") -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (64, 64), color).save(output, format="JPEG")
    return output.getvalue()


def tone(seconds: float) -> bytes:
    return b"".join(struct.pack("<h", round(8000 * math.sin(2 * math.pi * 440 * i / 16000)))
                    for i in range(round(seconds * 16000)))


def decode(path: Path, *arguments: str) -> bytes:
    result = subprocess.run([FFMPEG, "-v", "error", "-i", str(path), *arguments, "pipe:1"],
                            capture_output=True, timeout=15)
    if result.returncode:
        raise AssertionError(result.stderr.decode(errors="replace"))
    return result.stdout


def track_end_ms(path: Path, stream: str) -> float:
    # Frame hash exposes decoder packet PTS and duration in the track timebase.
    lines = decode(path, "-map", f"0:{stream}:0", "-f", "framemd5").decode().splitlines()
    base = next(line.split(":", 1)[1].strip() for line in lines if line.startswith("#tb 0:"))
    numerator, denominator = map(int, base.split("/"))
    packets = [line.split(",") for line in lines if line and not line.startswith("#")]
    return max((int(fields[2]) + int(fields[3])) * numerator / denominator * 1000 for fields in packets)


class AVEncoderPolicyTests(unittest.TestCase):
    def encoder(self, **limits):
        with patch("av_encoder.resolve_ffmpeg_path", return_value="unit-ffmpeg"):
            return InternalAVEncoder(EncoderConfig(**limits), Path("unit-unused.mp4"))

    def test_pause_cancels_only_unsent_speech_without_resetting_media_positions(self):
        encoder = self.encoder()
        encoder.push_frame(b"\xff\xd8real unit fixture\xff\xd9")
        original = b"\x01\x00" * 640
        encoder.push_audio(original)
        with encoder._lock:
            first_tick = encoder._audio_tick(320)
        encoder._audio_queue.put(first_tick)
        self.assertEqual(encoder.cancel_pending_audio(), 320)
        self.assertEqual(encoder._audio_cursor, 320)
        self.assertEqual(encoder._audio_tail, 320)
        self.assertFalse(encoder._stop.is_set())
        self.assertEqual(encoder._audio_queue.get_nowait(), bytes(len(first_tick)))
        self.assertEqual(encoder._audio_tick(640), bytes(640))
        next_speech = b"\x02\x00" * 320
        self.assertTrue(encoder.push_audio(next_speech))
        self.assertEqual(encoder._audio_tick(960), next_speech)
        self.assertEqual(encoder._audio_cursor, 960)
        self.assertEqual(encoder._audio_buffer_samples, 0)
        encoder.dispose()

    def test_rejected_first_frame_does_not_start_shared_media_epoch(self):
        encoder = self.encoder()
        with patch("av_encoder.time.monotonic", return_value=100):
            with self.assertRaises(ValueError):
                encoder.push_frame(b"\xff\xd8real unit fixture\xff\xd9", float("nan"))
        self.assertIsNone(encoder._epoch)
        self.assertFalse(encoder._first_frame.is_set())
        with patch("av_encoder.time.monotonic", return_value=200):
            self.assertTrue(encoder.push_frame(b"\xff\xd8real unit fixture\xff\xd9"))
        self.assertEqual(encoder._epoch, 200)
        self.assertEqual(encoder._last_frame_timestamp, 0)
        encoder.dispose()

    def test_input_queue_overflow_fails_without_skipping_timeline_positions(self):
        encoder = self.encoder(input_queue_size=1, fps=60)
        frame = b"\xff\xd8real unit fixture\xff\xd9"
        encoder.push_frame(frame)
        encoder._schedule()
        metrics = encoder.metrics()
        self.assertEqual(metrics["error"], "ENCODER_INPUT_BACKPRESSURE")
        self.assertEqual(metrics["video_queue_depth"], 1)
        self.assertEqual(metrics["audio_queue_depth"], 1)
        self.assertEqual(encoder._video_queue.get_nowait(), frame)
        self.assertEqual(len(encoder._audio_queue.get_nowait()), round(16000 / 60) * 2)
        encoder.dispose()

    def test_video_output_cannot_conceal_missing_or_stale_audio_media(self):
        encoder = self.encoder()
        encoder._started = True
        with patch("av_encoder.time.monotonic", return_value=0):
            encoder.push_frame(b"\xff\xd8real unit fixture\xff\xd9")

        def read_tags(*tags):
            flv = bytearray(b"FLV\x01\x05\x00\x00\x00\x09\x00\x00\x00\x00")
            for kind, payload in tags:
                flv.extend(bytes([kind]) + len(payload).to_bytes(3, "big") + b"\x00" * 7)
                flv.extend(payload + (len(payload) + 11).to_bytes(4, "big"))
            encoder._process = Mock(stdout=io.BytesIO(flv))
            encoder._read_output()

        with patch("av_encoder.time.monotonic", return_value=6):
            # AAC sequence headers are configuration, not audio progress.
            read_tags((8, b"\xaf\x00\x12\x08"), (9, b"\x17\x01\x00\x00\x00"))
            health = encoder.health()
        self.assertFalse(health["encoder_stalled"])
        self.assertTrue(health["audio_stalled"])
        with patch("av_encoder.time.monotonic", return_value=6):
            read_tags((8, b"\xaf\x01unit AAC fixture"))
        with patch("av_encoder.time.monotonic", return_value=7):
            self.assertFalse(encoder.health()["audio_stalled"])
        with patch("av_encoder.time.monotonic", return_value=12):
            read_tags((9, b"\x17\x01\x00\x00\x00"))
            self.assertTrue(encoder.health()["audio_stalled"])
        encoder._process = None
        encoder.dispose()

    def test_scheduler_stall_before_output_uses_elapsed_time(self):
        encoder = self.encoder()
        encoder._started = True
        with patch("av_encoder.time.monotonic", return_value=0):
            encoder.push_frame(b"\xff\xd8real unit fixture\xff\xd9")
        with patch("av_encoder.time.monotonic", return_value=6):
            self.assertTrue(encoder.health()["encoder_stalled"])
        encoder.dispose()


@unittest.skipUnless(FFMPEG, "Actual FFmpeg/Pillow dependencies required")
class AVEncoderTests(unittest.TestCase):
    def test_continuous_flv_and_live_mp4_have_decodable_h264_aac(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "live output.mp4"
            captured = []
            encoder = InternalAVEncoder(EncoderConfig(ffmpeg_path=FFMPEG), output, captured.append)
            encoder.start()
            try:
                encoder.push_audio(tone(3.2))
                encoder.push_frame(jpeg("red"))
                time.sleep(0.5)
                encoder.push_frame(jpeg("green"))
                deadline = time.monotonic() + 5
                while encoder.metrics()["timeline_ms"] < 2600 and time.monotonic() < deadline:
                    time.sleep(0.04)
                running = encoder.metrics()
                self.assertEqual(running["status"], "RUNNING", running)
                self.assertGreater(running["encoded_bytes"], 1000)
                self.assertGreater(sum(map(len, captured)), 1000, "Sink must receive before stop")
                self.assertGreater(output.stat().st_size, 1000, "MP4 fragments must exist before stop")
                self.assertFalse(encoder.health()["audio_stalled"])
                # Decode a snapshot while the encoder is still running.
                snapshot = Path(directory) / "while-running.mp4"
                snapshot.write_bytes(output.read_bytes())
                self.assertGreater(len(decode(snapshot, "-map", "0:v:0", "-f", "framemd5")), 200)
            finally:
                encoder.stop()
            metrics = encoder.metrics()
            self.assertEqual(metrics["status"], "STOPPED", metrics)
            self.assertTrue(metrics["audio_encoded"])
            self.assertEqual(metrics["input_av_drift_ms"], 0)
            self.assertLessEqual(metrics["max_av_drift_ms"], 104)
            self.assertGreater(metrics["held_frames"], 20)
            self.assertEqual(metrics["queue_depth"], 0)
            self.assertEqual(metrics["sink_dropped_tags"], 0)
            self.assertTrue(all(not thread.is_alive() for thread in encoder._threads))
            flv = Path(directory) / "live.flv"
            flv.write_bytes(b"".join(captured))
            for file in (output, flv):
                probe = subprocess.run([FFMPEG, "-hide_banner", "-i", str(file)], capture_output=True,
                                       timeout=10).stderr.decode(errors="replace")
                self.assertIn("Video: h264", probe)
                self.assertIn("Audio: aac", probe)
                pcm = decode(file, "-map", "0:a:0", "-f", "s16le", "-ac", "1", "-ar", "16000")
                samples = struct.unpack(f"<{len(pcm) // 2}h", pcm)
                rms = math.sqrt(sum(sample * sample for sample in samples) / len(samples))
                self.assertGreater(rms, 2000, "Encoded audio must contain the supplied tone")
                hashes = decode(file, "-map", "0:v:0", "-f", "framemd5").decode().splitlines()
                frames = [line for line in hashes if line and not line.startswith("#")]
                self.assertEqual(len(frames), metrics["frames_encoded"])
                self.assertEqual(len({frame.split(",")[-1].strip() for frame in frames}), 2)
                self.assertLessEqual(abs(track_end_ms(file, "v") - track_end_ms(file, "a")), 104)

    def test_no_real_jpeg_means_no_video_and_silent_audio_waits(self):
        with tempfile.TemporaryDirectory() as directory:
            encoder = InternalAVEncoder(EncoderConfig(ffmpeg_path=FFMPEG), Path(directory) / "waiting.mp4")
            encoder.start()
            time.sleep(0.2)
            self.assertEqual(encoder.metrics()["status"], "WAITING_FOR_FRAME")
            self.assertEqual(encoder.metrics()["frames_encoded"], 0)
            self.assertEqual(encoder.metrics()["audio_samples_written"], 0)
            encoder.stop()
            self.assertEqual(encoder.metrics()["status"], "STOPPED")
            self.assertTrue(all(not thread.is_alive() for thread in encoder._threads))

    def test_silence_padding_and_sink_failure_do_not_break_local_av(self):
        def disconnected_sink(_: bytes) -> None:
            raise ConnectionError("Local unit fixture disconnect")

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "independent.mp4"
            encoder = InternalAVEncoder(EncoderConfig(ffmpeg_path=FFMPEG), output, disconnected_sink)
            encoder.start()
            encoder.push_frame(jpeg())
            time.sleep(0.8)
            encoder.stop()
            metrics = encoder.metrics()
            self.assertEqual(metrics["status"], "STOPPED", metrics)
            self.assertGreater(metrics["sink_errors"], 0)
            self.assertEqual(metrics["silence_samples"], metrics["audio_samples_written"])
            pcm = decode(output, "-map", "0:a:0", "-f", "s16le")
            self.assertGreater(len(pcm), 1000)
            self.assertFalse(any(pcm), "Silence padding should decode to zero")
            self.assertLessEqual(abs(track_end_ms(output, "v") - track_end_ms(output, "a")), 104)

    def test_bounded_audio_and_latest_frame_input_policy(self):
        with tempfile.TemporaryDirectory() as directory:
            encoder = InternalAVEncoder(EncoderConfig(ffmpeg_path=FFMPEG, max_audio_buffer_ms=100),
                                        Path(directory) / "unused.mp4")
            self.assertFalse(encoder.push_audio(b"\x00\x00" * 3200))
            encoder.push_frame(jpeg("red"), timestamp_ms=0)
            encoder.push_frame(jpeg("green"), timestamp_ms=1)
            self.assertFalse(encoder.push_frame(jpeg("blue"), timestamp_ms=0))
            metrics = encoder.metrics()
            self.assertEqual(metrics["audio_buffer_samples"], 1600)
            self.assertEqual(metrics["audio_dropped_samples"], 1600)
            self.assertEqual(metrics["frame_drops"], 2)
            with self.assertRaises(ValueError):
                encoder.push_audio(b"\x01")
            with self.assertRaises(ValueError):
                encoder.push_frame(b"not jpeg")
            with self.assertRaises(ValueError):
                encoder.push_audio(b"\x00\x00", float("nan"))
            encoder.dispose()

    def test_rejected_whole_audio_chunk_can_be_retried_without_duplicate_playback(self):
        with tempfile.TemporaryDirectory() as directory:
            encoder = InternalAVEncoder(EncoderConfig(ffmpeg_path=FFMPEG, max_audio_buffer_ms=100),
                                        Path(directory) / "retry.mp4")
            first = b"\x11\x00" * 600
            second = b"\x22\x00" * 1400
            self.assertTrue(encoder.push_audio(first, allow_partial=False))
            self.assertFalse(encoder.push_audio(second, allow_partial=False))
            self.assertEqual(encoder.metrics()["audio_buffer_samples"], 600)
            self.assertEqual(encoder.metrics()["audio_dropped_samples"], 0)
            with encoder._lock:
                self.assertEqual(encoder._audio_tick(600), first)
            self.assertTrue(encoder.push_audio(second, allow_partial=False))
            with encoder._lock:
                self.assertEqual(encoder._audio_tick(2000), second)
            self.assertEqual(encoder.metrics()["audio_buffer_samples"], 0)
            encoder.dispose()


if __name__ == "__main__":
    unittest.main()
