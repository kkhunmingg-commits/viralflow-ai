"""CPU backend gates and opt-in genuine neural inference integration tests."""

import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dev_fallback_engine import MODEL_FILES, MuseTalkCPUEngine, create_engine, models_directory, probe_readiness


class DevFallbackEngineGates(unittest.TestCase):
    def test_blank_models_setting_uses_workspace_default(self):
        with patch.dict(os.environ, {"AI_LIVE_DEV_MODELS_DIR": " "}):
            self.assertEqual(models_directory(), Path(__file__).resolve().parents[3] / ".ai-live-dev/models")

    def test_factory_requires_explicit_development_mode(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "DEV_FALLBACK_DISABLED"):
                create_engine()

    def test_factory_rejects_production(self):
        for key in ("NODE_ENV", "VERCEL_ENV", "AI_LIVE_ENV"):
            with patch.dict(os.environ, {"AI_LIVE_DEV_FALLBACK": "true", key: "production"}, clear=True):
                with self.assertRaisesRegex(RuntimeError, "DEV_FALLBACK_PRODUCTION_FORBIDDEN"):
                    create_engine()

    def test_factory_requires_provider_switch(self):
        with patch.dict(os.environ, {"AI_LIVE_DEV_FALLBACK": "true", "PRESENTER_PROVIDER": "musetalk"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "DEV_FALLBACK_DISABLED"):
                create_engine()
        with patch.dict(os.environ, {"AI_LIVE_DEV_FALLBACK": "true", "PRESENTER_PROVIDER": "dev_fallback"}, clear=True):
            self.assertIsInstance(create_engine(), MuseTalkCPUEngine)

    def test_missing_weights_reported_without_download_or_mock(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"AI_LIVE_DEV_MODELS_DIR": directory}), patch("dev_fallback_engine.importlib.util.find_spec", return_value=object()):
            readiness = probe_readiness()
            self.assertFalse(readiness["ready"])
            self.assertEqual(readiness["status"], "DEV_MODELS_REQUIRED")
            self.assertEqual(readiness["missing_models"], list(MODEL_FILES))
            with self.assertRaisesRegex(RuntimeError, "DEV_MODELS_REQUIRED"):
                reference = Path(directory) / "reference.png"
                reference.write_bytes(b"not-an-image")
                MuseTalkCPUEngine().prepare(reference, 2)

    def test_missing_dependency_reports_stable_reason(self):
        with patch("dev_fallback_engine.importlib.util.find_spec", return_value=None):
            self.assertEqual(probe_readiness()["status"], "DEV_DEPENDENCIES_REQUIRED")

    def test_invalid_audio_rejected_before_importing_neural_runtime(self):
        engine = MuseTalkCPUEngine()
        for audio in (b"", b"x", b"xx" * 16001):
            with self.assertRaisesRegex(ValueError, "INVALID_AUDIO_CHUNK"):
                list(engine.render_pcm16_chunk(audio))

    def test_stop_is_safe_before_prepare_and_repeatable(self):
        engine = MuseTalkCPUEngine()
        engine.interrupt()
        engine.close()
        engine.close()
        self.assertFalse(engine._prepared)
        self.assertEqual(len(engine._pending), 0)


@unittest.skipUnless(os.getenv("AI_LIVE_REAL_CPU_TEST") == "true", "opt-in test requires official weights and real reference/audio")
class RealCPUInference(unittest.TestCase):
    def test_real_audio_changes_real_generated_face_and_releases_models(self):
        import hashlib
        import wave

        reference = Path(os.environ["AI_LIVE_REAL_REFERENCE"])
        with wave.open(os.environ["AI_LIVE_REAL_AUDIO"], "rb") as audio:
            self.assertEqual((audio.getnchannels(), audio.getsampwidth(), audio.getframerate()), (1, 2, 16000))
            pcm = audio.readframes(16000)
        engine = MuseTalkCPUEngine()
        try:
            engine.prepare(reference, 2)
            frames = list(engine.render_pcm16_chunk(pcm))
            self.assertEqual(len(frames), 2)
            self.assertTrue(all(frame.startswith(b"\xff\xd8") and frame.endswith(b"\xff\xd9") for frame in frames))
            self.assertGreater(len({hashlib.sha256(frame).hexdigest() for frame in frames}), 1)
            self.assertEqual(str(next(engine._model.parameters()).device), "cpu")
            engine.interrupt()
            self.assertEqual(list(engine.render_pcm16_chunk(pcm)), [])
        finally:
            engine.close()
        self.assertIsNone(engine._model)
        self.assertIsNone(engine._vae)
        self.assertIsNone(engine._whisper)


if __name__ == "__main__":
    unittest.main()
