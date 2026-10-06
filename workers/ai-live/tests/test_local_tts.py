from __future__ import annotations
import hashlib
import json
import socket
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_tts import (LocalTTSProvider, ManagedLocalTTSProvider, PendingLocalTTSProvider,
                       VoxCPMBackend, _VoxPCMConverter, make_managed_local_tts)
from local_agent.model_manager import ModelArtifact, ModelRecord, VerifiedLocalModel
from local_agent.security import SecurityError
from voice import VoiceProvider


class FixturePCMBackend:
    """Contract bytes only. This fixture is never a voice quality proof."""
    fingerprint = "unit-test-contract-only"
    def __init__(self, *, pcm=b"\x01\x00" * 20_000, delay=0):
        self.pcm = pcm
        self.delay = delay
        self.sentences = []
        self.pulls = 0
        self.closed = False
    def stream_sentence(self, text, stop):
        self.sentences.append(text)
        for _ in range(2):
            self.pulls += 1
            time.sleep(self.delay)
            if stop.is_set():
                return
            yield self.pcm
    def health(self):
        return {"ready": not self.closed, "cloning": False}
    def close(self):
        self.closed = True


class LocalTTSTests(unittest.TestCase):
    def test_default_pending_and_no_network_or_fake_pcm(self):
        with patch.object(socket, "create_connection", side_effect=AssertionError("outbound blocked")):
            provider = PendingLocalTTSProvider()
            self.assertIsInstance(provider, LocalTTSProvider)
            self.assertIsInstance(provider, VoiceProvider)
            self.assertEqual(provider.warmup()["status"], "LOCAL_TTS_MODEL_PENDING")
            self.assertFalse(provider.health()["ready"])
            with self.assertRaisesRegex(RuntimeError, "LOCAL_TTS_MODEL_PENDING"):
                list(provider.stream_text("สวัสดีค่ะ", "u"))
            provider.cancel()
            with self.assertRaisesRegex(RuntimeError, "SPEECH_CANCELLED"):
                list(provider.stream_text("สวัสดีค่ะ", "u"))

    def test_pcm_format_sentence_normalization_warmup_and_context_cache(self):
        backend = FixturePCMBackend()
        provider = ManagedLocalTTSProvider(backend, context_id="room-a/account-a/presenter-a")
        self.assertFalse(provider.health()["ready"])
        self.assertTrue(provider.warmup()["ready"])
        chunks = list(provider.stream_text("ราคา 1,290 บาท! ขนาด 250ml.", "u1"))
        self.assertTrue(all(chunk.sample_rate_hz == 16000 and len(chunk.pcm16) <= 32000 for chunk in chunks))
        self.assertIn("หนึ่งพันสองร้อยเก้าสิบ", backend.sentences[-2])
        count = len(backend.sentences)
        repeated = list(provider.stream_text("ราคา 1,290 บาท! ขนาด 250ml.", "u2"))
        self.assertEqual(len(backend.sentences), count)
        self.assertEqual([x.pcm16 for x in chunks], [x.pcm16 for x in repeated])
        self.assertTrue(all(x.utterance_id == "u2" for x in repeated))
        other = ManagedLocalTTSProvider(backend, context_id="room-b/account-b/presenter-b")
        list(other.stream_text("ราคา 1,290 บาท!", "other"))
        self.assertGreater(len(backend.sentences), count)

    def test_interrupt_no_more_native_compute_or_partial_cache_and_busy(self):
        backend = FixturePCMBackend(pcm=b"\x01\x00" * 100)
        provider = ManagedLocalTTSProvider(backend, context_id="room")
        stream = provider.stream_text("สวัสดีค่ะ", "u")
        next(stream)
        with self.assertRaisesRegex(RuntimeError, "VOICE_BUSY"):
            list(provider.stream_text("ค่ะ", "other"))
        provider.interrupt()
        self.assertEqual(list(stream), [])
        self.assertEqual(backend.pulls, 1)
        self.assertEqual(provider.health()["cache_bytes"], 0)
        self.assertEqual(len(list(provider.stream_text("สวัสดีค่ะ", "next"))), 2)
        provider.cancel()
        self.assertFalse(provider.health()["ready"])
        self.assertEqual(provider.health()["cache_bytes"], 0)

    def test_timeout_bad_pcm_and_bounded_cache(self):
        slow = ManagedLocalTTSProvider(FixturePCMBackend(delay=.06), context_id="room", timeout_seconds=.05)
        with self.assertRaisesRegex(RuntimeError, "LOCAL_TTS_TIMEOUT"):
            list(slow.stream_text("สวัสดีค่ะ", "u"))
        invalid = ManagedLocalTTSProvider(FixturePCMBackend(pcm=b"odd"), context_id="room")
        with self.assertRaisesRegex(RuntimeError, "LOCAL_TTS_INVALID_PCM"):
            list(invalid.stream_text("สวัสดีค่ะ", "u"))
        cached = ManagedLocalTTSProvider(FixturePCMBackend(pcm=b"\x01\x00" * 100), context_id="room", cache_bytes=500)
        for text in ("สวัสดีค่ะ", "ราคาเท่าไรคะ", "ส่งฟรีค่ะ"):
            list(cached.stream_text(text, "u"))
        self.assertLessEqual(cached.health()["cache_bytes"], 500)

    def test_cpu_resampling_is_chunk_partition_invariant_and_rejects_nan(self):
        import numpy as np
        source = np.sin(np.arange(4800) * 2 * np.pi * 1000 / 48000).astype(np.float32)
        one = _VoxPCMConverter(48000).convert(source)
        converter = _VoxPCMConverter(48000)
        split = b"".join(converter.convert(part) for part in (source[:157], source[157:1101], source[1101:]))
        self.assertEqual(one, split)
        self.assertEqual(len(one), 1600 * 2)
        with self.assertRaisesRegex(RuntimeError, "LOCAL_TTS_INVALID_PCM"):
            converter.convert(np.array([float("nan")]))

    def test_production_factory_never_uses_missing_model_or_raw_customer_path(self):
        class MissingComponents:
            def runtime_root(self):
                return None
        self.assertFalse(make_managed_local_tts(MissingComponents(), context_id="room").health()["ready"])

    def test_voxcpm_rejects_nc_and_bad_bytes_before_runtime_import(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            directory = root / "models" / "tts"
            directory.mkdir(parents=True)
            path = directory / "model.safetensors"
            path.write_bytes(b"unit-test-integrity-only")
            artifact = ModelArtifact("models/tts/model.safetensors", hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_size)
            def model(weights):
                record = ModelRecord("voxcpm2", "TTS", "fixture", "https://huggingface.co/openbmb/VoxCPM2", "Apache-2.0",
                                     weights, weights == "Apache-2.0", True, ("notice",), "models/tts", (artifact,), False, 8, 0, "voxcpm2")
                return VerifiedLocalModel(record, root, (path,))
            with self.assertRaisesRegex(RuntimeError, "LOCAL_TTS_LICENSE_REJECTED"):
                VoxCPMBackend(model("CC-BY-NC-4.0"))
            path.write_bytes(b"tampered")
            with self.assertRaisesRegex(SecurityError, "LOCAL_MODEL_INTEGRITY_FAILED"):
                VoxCPMBackend(model("Apache-2.0"))


if __name__ == "__main__":
    unittest.main()
