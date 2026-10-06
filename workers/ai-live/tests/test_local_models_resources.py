"""Signed installation, license admission, memory reservations and warmup."""
import copy
import hashlib
import json
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_agent.components import remove_managed_components
from local_agent.model_manager import CATALOG_PATH, LocalModelManager, validate_model_record
from local_agent.resource_manager import LocalResourceManager, LocalAIWarmup, select_profile
from local_agent.security import SecurityError
from test_components import Fixture, Network, Response


def record():
    data = b"test model bytes; never inference"
    return {"model_id": "qwen3-4b-q4_k_m", "kind": "BRAIN", "version": "fixture-1",
            "source": "https://huggingface.co/Qwen/Qwen3-4B-GGUF", "code_license": "MIT",
            "weights_license": "Apache-2.0", "commercial_allowed": True, "redistribution_allowed": True,
            "attribution": ["Test-only artifact; not actual model weights"],
            "relative_path": "models/local-ai/brain", "requires_gpu": False,
            "minimum_ram_gb": 8, "minimum_vram_gb": 0, "profile": "qwen3-4b-q4_k_m",
            "artifacts": [{"relative_path": "models/local-ai/brain/model.gguf",
                           "sha256": hashlib.sha256(data).hexdigest(), "size_bytes": len(data)},
                          {"relative_path": "models/local-ai/brain/LICENSE", "sha256": hashlib.sha256(b"Fixture license").hexdigest(),
                           "size_bytes": len(b"Fixture license")}]}, data


def release(fixture, version="1.0.0", *, corrupt=False):
    model, data = record()
    catalog = {"format": "viralflow-local-ai-models-v1", "models": [model]}
    runtime = {"runtime/python.exe": b"fixture", "runtime/ffmpeg.exe": b"fixture",
               "worker/managed_worker_entry.py": b"# fixture"}
    files = {CATALOG_PATH: json.dumps(catalog).encode(),
             "models/local-ai/brain/model.gguf": b"tampered" if corrupt else data,
             "models/local-ai/brain/LICENSE": b"Fixture license"}
    a, ab = fixture.artifact("runtime", runtime, version)
    b, bb = fixture.artifact("models", files, version)
    from test_components import NOW
    return {"v": 1, "releaseVersion": version, "issuedAt": NOW - 1, "expiresAt": NOW + 3600,
            "profiles": {"cpu-dev": [a, b]}, "localModels": {"cpu-dev": catalog}}, [ab, bb]


class LocalModelTests(unittest.TestCase):
    def test_noncommercial_unclear_rights_paths_hashes_rejected(self):
        item, _ = record()
        for change in ({"commercial_allowed": False}, {"redistribution_allowed": False},
                       {"weights_license": "CC-BY-NC-SA-3.0"}, {"weights_license": "unknown"},
                       {"code_license": "research-only"}, {"relative_path": "../model"},
                       {"source": "http://example.com"}, {"requires_gpu": 1},
                       {"artifacts": item["artifacts"][:1]},
                       {"artifacts": [{"relative_path": "models/local-ai/brain/a", "sha256": None, "size_bytes": 1}]}):
            with self.subTest(change=change), self.assertRaises(SecurityError):
                validate_model_record(item | change)

    def test_signed_install_resolve_tamper_repair_upgrade_rollback_uninstall(self):
        fixture = Fixture()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve() / "components"
            payload, archives = release(fixture)
            network = Network([Response(raw) for raw in archives])
            components = fixture.manager(root, network)
            components.load_manifest(fixture.sign(payload))
            components.install()
            manager = LocalModelManager(components)
            model = manager.resolve("qwen3-4b-q4_k_m", "BRAIN")
            self.assertEqual(model.path("model.gguf").read_bytes(), record()[1])
            with self.assertRaises(SecurityError):
                model.path("../outside")
            model.path("model.gguf").write_bytes(b"tampered")
            with self.assertRaises(SecurityError):
                manager.resolve("qwen3-4b-q4_k_m", "BRAIN")
            self.assertFalse(components.verify_current())
            # Verified cached archives repair the altered installed file.
            components.install(repair=True)
            repaired = manager.resolve("qwen3-4b-q4_k_m", "BRAIN")
            repaired.verify_files()
            previous = components.runtime_root()
            newer, archives = release(fixture, "1.1.0")
            components.load_manifest(fixture.sign(newer))
            # Network failure cannot replace the previous verified release.
            with patch.object(components.transport, "download", side_effect=SecurityError("COMPONENT_DOWNLOAD_FAILED")):
                with self.assertRaises(SecurityError):
                    components.install()
            self.assertTrue(previous.exists())
            components.load_manifest(fixture.sign(payload))
            self.assertTrue(components.verify_current())
            self.assertEqual(components.runtime_root(), previous)
            network.responses += [Response(raw) for raw in archives]
            components.load_manifest(fixture.sign(newer))
            components.install()
            self.assertNotEqual(components.runtime_root(), previous)
            manager.resolve("qwen3-4b-q4_k_m", "BRAIN").verify_files()
            remove_managed_components(root)
            self.assertFalse((root / "active.json").exists())
            self.assertFalse(repaired.path("model.gguf").exists())

    def test_license_and_bad_hash_rejected_before_download(self):
        fixture = Fixture()
        with tempfile.TemporaryDirectory() as temporary:
            network = Network()
            components = fixture.manager(Path(temporary).resolve() / "components", network)
            payload, _ = release(fixture)
            bad = copy.deepcopy(payload)
            bad["localModels"]["cpu-dev"]["models"][0]["commercial_allowed"] = False
            with self.assertRaisesRegex(SecurityError, "NOT_SHIPPABLE"):
                components.load_manifest(fixture.sign(bad))
            bad, _ = release(fixture, corrupt=True)
            with self.assertRaisesRegex(SecurityError, "UNSIGNED_ARTIFACT"):
                components.load_manifest(fixture.sign(bad))
            self.assertEqual(network.requests, [])


class ResourceTests(unittest.TestCase):
    def test_profiles_and_brain_does_not_consume_presenter_or_voice_reservation(self):
        self.assertEqual(select_profile(16, None).name, "CPU_DEV")
        for ram, vram in ((float("nan"), 12), (16, float("inf")), (16, -1), (None, 8)):
            with self.assertRaises(SecurityError):
                select_profile(ram, vram)
        for vram, name in ((8, "GPU_LITE"), (12, "GPU_STANDARD"), (16, "GPU_HIGH")):
            self.assertEqual(select_profile(16, vram).name, name)
        manager = LocalResourceManager(select_profile(16, 8))
        with manager.acquire("BRAIN", vram_mib=3072, prefer_gpu=True) as brain:
            self.assertEqual(brain.device, "CPU")
            with manager.acquire("PRESENTER", vram_mib=4096, prefer_gpu=True, allow_cpu=False) as avatar:
                self.assertEqual(avatar.device, "GPU")
        manager.register_model("avatar", "PRESENTER", 4096)
        with self.assertRaisesRegex(SecurityError, "GPU_FULL"):
            manager.register_model("brain", "BRAIN", 3072)
        manager.unload_model("avatar", lambda: None)
        self.assertEqual(manager.metrics()["loaded_models"], 0)

    def test_priority_cancellation_and_bounded_queue(self):
        manager = LocalResourceManager(select_profile(16, 0), maximum_pending=2)
        first = manager.acquire("BRAIN")
        results = []
        def wait(kind):
            with manager.acquire(kind):
                results.append(kind)
        low = threading.Thread(target=wait, args=("BACKGROUND",))
        high = threading.Thread(target=wait, args=("TTS",))
        low.start(); high.start()
        deadline = time.monotonic() + 1
        while manager.metrics()["queued"] != 2 and time.monotonic() < deadline:
            time.sleep(0.005)
        with self.assertRaisesRegex(SecurityError, "QUEUE_FULL"):
            manager.acquire("BRAIN")
        first.release()
        low.join(2); high.join(2)
        self.assertEqual(results, ["TTS", "BACKGROUND"])
        cancel = threading.Event(); cancel.set()
        with self.assertRaisesRegex(SecurityError, "CANCELLED"):
            manager.acquire("BRAIN", cancel_event=cancel)
        self.assertEqual(manager.metrics()["queued"], 0)

    def test_warmup_all_stages_required_and_invalidation(self):
        class Provider:
            def __init__(self, ready): self.ready = ready
            def warmup(self): return {"ready": self.ready}
        voice = Provider(False)
        warmed = []
        warmup = LocalAIWarmup(Provider(True), voice, lambda: warmed.append("presenter"), lambda: warmed.append("encoder"))
        self.assertFalse(warmup.warmup()["ready"])
        self.assertEqual(warmed, [])
        voice.ready = True
        self.assertTrue(warmup.warmup()["ready"])
        self.assertEqual(warmed, ["presenter", "encoder"])
        warmup.invalidate()
        self.assertFalse(warmup.health()["ready"])
        warmup.stages["brain"] = lambda: (_ for _ in ()).throw(RuntimeError("actual warmup failed"))
        with self.assertRaises(RuntimeError):
            warmup.warmup()
        self.assertFalse(warmup.health()["ready"])


if __name__ == "__main__": unittest.main()
