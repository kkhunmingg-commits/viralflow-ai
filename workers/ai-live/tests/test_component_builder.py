"""Real portable Python/wheel relocation and publisher catalog integrity."""
from __future__ import annotations
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

WORKER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER))
from installer.build_components import archive_item, install_locked_wheels, stage_python, stage_worker, validate_models
from installer.build_windows import public_configuration, runtime_arguments
from installer.delivery import DeliveryManager, MARKER as APP_MARKER
from local_agent.components import MARKER as COMPONENT_MARKER


class ComponentPublisherTests(unittest.TestCase):
    def setUp(self):
        build = WORKER / "installer" / ".build"
        build.mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="component-builder-", dir=build)
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def test_component_catalog_matches_archive_and_chunk_bytes(self):
        stage = self.root / "stage"
        (stage / "models" / "musetalk").mkdir(parents=True)
        data = bytes(range(256)) * 99
        (stage / "models" / "musetalk" / "asset.bin").write_bytes(data)
        item = archive_item(stage, self.root / "out", name="models", version="0.3.0",
                            profile="cpu-dev", origin="https://releases.example.com")
        archive = self.root / "out" / item["url"].rsplit("/", 1)[1]
        self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), item["sha256"])
        self.assertEqual(item["expandedBytes"], len(data))
        offset = 0
        for chunk in item["chunks"]:
            block = archive.read_bytes()[offset:offset + chunk["sizeBytes"]]
            self.assertEqual(hashlib.sha256(block).hexdigest(), chunk["sha256"])
            offset += len(block)
        self.assertEqual(offset, archive.stat().st_size)
        with zipfile.ZipFile(archive) as package:
            for name, metadata in item["files"].items():
                raw = package.read(name)
                self.assertEqual(len(raw), metadata["sizeBytes"])
                self.assertEqual(hashlib.sha256(raw).hexdigest(), metadata["sha256"])

    def test_worker_archive_has_fixed_entry_and_excludes_customer_build_data(self):
        stage_worker(WORKER, self.root / "worker")
        self.assertTrue((self.root / "worker" / "managed_worker_entry.py").is_file())
        self.assertTrue((self.root / "worker" / "dev_fallback_engine.py").is_file())
        self.assertTrue((self.root / "worker" / "installer" / "delivery.py").is_file())
        self.assertFalse((self.root / "worker" / "installer" / "setup_app.py").exists())
        self.assertFalse((self.root / "worker" / "tests").exists())

    def test_model_builder_refuses_empty_or_missing_required_weights(self):
        (self.root / "models" / "musetalk").mkdir(parents=True)
        with self.assertRaises(ValueError):
            validate_models(self.root / "models", "cpu-dev")
        from bootstrap_dev_fallback import ARTIFACTS, DESTINATIONS
        for repository, names in ARTIFACTS.items():
            for name in names:
                file = self.root / "models" / "musetalk" / DESTINATIONS[repository] / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(b"catalog fixture; never inference")
        validate_models(self.root / "models", "cpu-dev")
        (self.root / "models" / "musetalk" / "musetalkV15" / "unet.pth").write_bytes(b"")
        with self.assertRaises(ValueError):
            validate_models(self.root / "models", "cpu-dev")

    def test_public_component_config_rejects_secret_urls_and_unknown_profiles(self):
        pem = Ed25519PrivateKey.generate().public_key().public_bytes(
            Encoding.PEM, PublicFormat.SubjectPublicKeyInfo).decode()
        config = {"trustedKeys": {"test-key": pem}, "retiredKeyIds": [],
                  "componentBootstrap": {"origin": "https://releases.example.com", "releaseVersion": "0.3.0",
                                         "profile": "nvidia", "minimumNvidiaDriver": "572.83"}}
        path = self.root / "config.json"
        path.write_text(json.dumps(config))
        self.assertEqual(public_configuration(path), config)
        for extra in ({"profile": "auto"}, {"origin": "https://example.com/scripts"},
                      {"minimumNvidiaDriver": "bad"}, {"command": "pip install anything"}):
            path.write_text(json.dumps(config | {"componentBootstrap": config["componentBootstrap"] | extra}))
            with self.assertRaises(Exception):
                public_configuration(path)
        args = runtime_arguments([])
        self.assertIn("local_agent.components", args)
        self.assertIn("local_agent.managed_runtime", args)
        self.assertIn("tkinter.ttk", args)

    def test_uninstall_removes_catalog_owned_components_and_preserves_foreign_nested_files(self):
        app = self.root / "LiveAgent"
        app.mkdir()
        (app / "managed.json").write_text(json.dumps({"format": APP_MARKER}))
        components = app / "components"
        release = components / "releases" / ("0.3.0-" + "a" * 32)
        (release / "runtime").mkdir(parents=True)
        owned = release / "runtime" / "python.exe"
        owned.write_bytes(b"owned interpreter fixture")
        foreign = release / "runtime" / "customer-notes.txt"
        foreign.write_text("preserve")
        (components / "managed.json").write_text(json.dumps(COMPONENT_MARKER))
        digest = "b" * 64
        payload = {"profiles": {"cpu-dev": [{"name": "runtime", "sha256": digest,
                    "files": {"runtime/python.exe": {"sha256": "c" * 64, "sizeBytes": owned.stat().st_size}}}]}}
        (release / "release-manifest.json").write_text(json.dumps({"payload": payload}))
        (release / "release-profile.json").write_text(json.dumps({"profile": "cpu-dev"}))
        downloads = components / "downloads"
        downloads.mkdir()
        (downloads / (digest + ".zip")).write_bytes(b"owned cache fixture")
        (downloads / "foreign.data").write_text("preserve cache")
        for name in ("worker", "live-credentials"):
            (app / name).mkdir()
            (app / name / "owned.data").write_text("owned")
        DeliveryManager(app).uninstall()
        self.assertFalse(owned.exists())
        self.assertEqual(foreign.read_text(), "preserve")
        self.assertFalse((downloads / (digest + ".zip")).exists())
        self.assertEqual((downloads / "foreign.data").read_text(), "preserve cache")
        self.assertFalse((app / "worker").exists())
        self.assertFalse((app / "live-credentials").exists())

    @unittest.skipUnless(sys.platform == "win32", "Windows portable CPython")
    def test_real_relocated_python_offline_hashed_wheel_ignores_host_python(self):
        runtime = self.root / "runtime"
        stage_python(Path(sys.base_prefix), runtime)
        wheels = self.root / "wheels"
        wheels.mkdir()
        wheel = wheels / "viralflow_fixture-1.0.0-py3-none-any.whl"
        with zipfile.ZipFile(wheel, "w") as archive:
            archive.writestr("viralflow_fixture.py", "VALUE = 'portable-wheel'\n")
            archive.writestr("viralflow_fixture-1.0.0.dist-info/METADATA", "Metadata-Version: 2.1\nName: viralflow-fixture\nVersion: 1.0.0\n")
            archive.writestr("viralflow_fixture-1.0.0.dist-info/WHEEL", "Wheel-Version: 1.0\nGenerator: test\nRoot-Is-Purelib: true\nTag: py3-none-any\n")
            archive.writestr("viralflow_fixture-1.0.0.dist-info/RECORD", "")
        lock = self.root / "requirements.lock"
        lock.write_text("viralflow-fixture==1.0.0 --hash=sha256:" + hashlib.sha256(wheel.read_bytes()).hexdigest())
        install_locked_wheels(wheels, lock, runtime)
        script = "import sys,viralflow_fixture,json;print(json.dumps({'value':viralflow_fixture.VALUE,'paths':sys.path,'isolated':sys.flags.isolated}))"
        result = subprocess.run([str(runtime / "python.exe"), "-I", "-B", "-c", script],
            capture_output=True, text=True, timeout=20, creationflags=0x08000000)
        self.assertEqual(result.returncode, 0, result.stderr)
        info = json.loads(result.stdout)
        self.assertEqual(info["value"], "portable-wheel")
        self.assertEqual(info["isolated"], 1)
        self.assertTrue(all(Path(path).is_relative_to(runtime) for path in info["paths"]))
        self.assertFalse((runtime / "Lib" / "site-packages" / "torch").exists())
        worker = self.root / "worker"
        stage_worker(WORKER, worker)
        script = ("import sys;sys.path.insert(0," + repr(str(worker)) + ");"
                  "import managed_worker_entry;from local_agent.live_worker import LocalWorkerBoundary;"
                  "from local_agent.agent import REALTIME_VALIDATED;assert REALTIME_VALIDATED is False")
        result = subprocess.run([str(runtime / "python.exe"), "-I", "-B", "-c", script],
            capture_output=True, text=True, timeout=20, creationflags=0x08000000)
        self.assertEqual(result.returncode, 0, result.stderr)
        lock.write_text("viralflow-fixture==1.0.0 --hash=sha256:" + "0" * 64)
        with self.assertRaises(subprocess.CalledProcessError):
            install_locked_wheels(wheels, lock, self.root / "bad-runtime")


if __name__ == "__main__":
    unittest.main()
