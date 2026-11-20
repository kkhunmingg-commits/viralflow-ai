"""Real FFmpeg encoding verification; fixtures are explicitly synthetic input."""
from __future__ import annotations

import importlib.util
import io
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from software_stream import SoftwareLocalStream


def ffmpeg_path():
    configured = os.getenv("AI_LIVE_FFMPEG_PATH", "")
    if configured and Path(configured).is_file():
        return configured
    executable = shutil.which("ffmpeg")
    if not executable and importlib.util.find_spec("imageio_ffmpeg"):
        import imageio_ffmpeg
        executable = imageio_ffmpeg.get_ffmpeg_exe()
    return executable


class SoftwareStreamTests(unittest.TestCase):
    def test_missing_ffmpeg_fails_explicitly(self):
        with patch.dict(os.environ, {"AI_LIVE_FFMPEG_PATH": ""}), patch("software_stream.shutil.which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "SOFTWARE_ENCODER_UNAVAILABLE"):
                SoftwareLocalStream(Path("unused.mp4"), 3)

    @unittest.skipUnless(ffmpeg_path() and importlib.util.find_spec("PIL"), "Real FFmpeg/Pillow test dependencies are absent")
    def test_actual_jpegs_encode_and_decode_three_frames_without_nvenc(self):
        from PIL import Image
        executable = ffmpeg_path()
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"AI_LIVE_FFMPEG_PATH": executable}):
            output = Path(directory) / "actual-software-sink.mp4"
            stream = SoftwareLocalStream(output, 3)
            for color in ("red", "green", "blue"):
                buffer = io.BytesIO()
                Image.new("RGB", (64, 64), color).save(buffer, format="JPEG")
                stream.push_frame(buffer.getvalue())
            stream.close()
            metrics = stream.metrics()
            self.assertEqual(metrics["status"], "STOPPED")
            self.assertIsNone(metrics["error"])
            self.assertEqual(metrics["frames_encoded"], 3)
            self.assertFalse(metrics["nvenc"])
            self.assertEqual(metrics["queue_depth"], 0)
            decoded = subprocess.run([executable, "-v", "error", "-i", str(output), "-f", "framemd5", "pipe:1"], capture_output=True, text=True, timeout=10, check=True)
            self.assertEqual(len([line for line in decoded.stdout.splitlines() if line and not line.startswith("#")]), 3)
            self.assertGreater(output.stat().st_size, 0)


if __name__ == "__main__":
    unittest.main()
