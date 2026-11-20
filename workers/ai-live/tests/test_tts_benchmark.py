from __future__ import annotations
import copy
import hashlib
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_agent.model_manager import ModelArtifact, ModelRecord, VerifiedLocalModel
from local_agent.security import SecurityError
from local_tts import PendingLocalTTSProvider
from tts_benchmark import THAI_BENCHMARK_CASES, _measure_sentence, attach_owner_review, run_voxcpm_benchmark


class TTSBenchmarkTests(unittest.TestCase):
    def test_corpus_covers_commerce_and_mixed_speech(self):
        names = {item[0] for item in THAI_BENCHMARK_CASES}
        self.assertTrue({"price", "units", "mixed", "sku", "long"}.issubset(names))

    def test_pending_provider_cannot_create_fake_measurement(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(RuntimeError, "LOCAL_TTS_MODEL_PENDING"):
                _measure_sentence(PendingLocalTTSProvider(), "สวัสดีค่ะ", "u", Path(temp) / "voice.wav")

    def test_nc_model_is_rejected_before_backend_or_audio_measurement(self):
        with tempfile.TemporaryDirectory() as temp:
            record = ModelRecord("nc-model", "TTS", "fixture", "https://example.invalid/model", "MIT", "CC-BY-NC-4.0",
                                 False, False, ("notice",), "models/voice", (ModelArtifact("models/voice/m.bin", "a" * 64, 1),),
                                 False, 1, 0, "cpu-dev")
            model = VerifiedLocalModel(record, Path(temp), ())
            with self.assertRaisesRegex(SecurityError, "LOCAL_MODEL_NOT_SHIPPABLE"):
                run_voxcpm_benchmark(model, Path(temp) / "results")

    def test_owner_scores_require_actual_clip_binding_and_never_auto_approve(self):
        report = {"samples": [{"sample_id": "sample", "audio_sha256": hashlib.sha256(b"unit-test-review-only").hexdigest(),
                                "pronunciation_owner_rating": None, "naturalness_owner_rating": None,
                                "voice_consistency_owner_rating": None}], "live_production_approved": False}
        ratings = [{"sample_id": "sample", "audio_sha256": report["samples"][0]["audio_sha256"],
                    "pronunciation": 4, "naturalness": 3, "voice_consistency": 4}]
        reviewed = attach_owner_review(report, ratings, reviewer_identity="human test reviewer", reviewed_at=int(time.time()))
        self.assertEqual(reviewed["human_review_status"], "OWNER_RATED")
        self.assertFalse(reviewed["live_production_approved"])
        self.assertIsNone(report["samples"][0]["naturalness_owner_rating"])
        bad = copy.deepcopy(ratings)
        bad[0]["audio_sha256"] = "wrong audio"
        with self.assertRaisesRegex(ValueError, "TTS_OWNER_REVIEW_AUDIO_MISMATCH"):
            attach_owner_review(report, bad, reviewer_identity="human", reviewed_at=int(time.time()))
        with self.assertRaisesRegex(ValueError, "TTS_OWNER_REVIEW_REQUIRED"):
            attach_owner_review(report, ratings, reviewer_identity="", reviewed_at=int(time.time()))


if __name__ == "__main__":
    unittest.main()
