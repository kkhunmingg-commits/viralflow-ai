from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from capabilities import MUSETALK_REQUIRED_ASSETS, inspect_capabilities  # noqa: E402


class CapabilityTests(unittest.TestCase):
    def test_partial_musetalk_install_never_reports_model_ready(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in (
                "scripts/realtime_inference.py",
                "models/musetalkV15/unet.pth",
                "models/whisper/pytorch_model.bin",
            ):
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()
            with patch.dict(os.environ, {"AI_LIVE_MUSETALK_ROOT": directory,
                                      "AI_LIVE_MUSETALK_STREAM_MODULE": ""}):
                status = inspect_capabilities()
            self.assertFalse(status["ready"])
            self.assertFalse(status["musetalk"]["models_available"])
            self.assertIn("models/sd-vae/diffusion_pytorch_model.bin",
                          status["musetalk"]["missing_assets"])
            self.assertEqual(len(status["musetalk"]["missing_assets"]),
                             len(MUSETALK_REQUIRED_ASSETS) - 3)


if __name__ == "__main__":
    unittest.main()
