"""Real signatures/ZIPs with only HTTPS network boundaries replaced by fixtures."""
from __future__ import annotations

import base64
import copy
import hashlib
import io
import json
import socket
import sys
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from local_agent.components import BootstrapManager, ComponentTransport, MAX_FILES, MAX_MANIFEST_BYTES, remove_managed_components
from local_agent.security import SecurityError, canonical_json

ORIGIN = "https://releases.example"
NOW = 1000000


class Response:
    def __init__(self, data, *, status=200, headers=None, interrupt=None):
        self.data, self.status, self.offset, self.interrupt = data, status, 0, interrupt
        self.headers = {"Content-Length": str(len(data)), "ETag": '"immutable-fixture"', **(headers or {})}

    def getheader(self, name, default=None):
        return self.headers.get(name, default)

    def read(self, size):
        if self.interrupt is not None and self.offset >= self.interrupt:
            raise OSError("fixture interruption")
        end = min(self.offset + size, len(self.data), self.interrupt if self.interrupt is not None else len(self.data))
        data = self.data[self.offset:end]
        self.offset = end
        return data


class Network:
    def __init__(self, responses=(), address="8.8.8.8"):
        self.responses = list(responses)
        self.address = address
        self.requests = []
        self.closed = 0

    def resolve(self, host, port, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (self.address, 443))]

    def connection(self, host, address):
        network = self
        class Connection:
            def request(self, method, path, headers):
                network.requests.append((host, address, method, path, headers))
            def getresponse(self):
                if not network.responses:
                    raise AssertionError("Unexpected network request")
                return network.responses.pop(0)
            def close(self):
                network.closed += 1
        return Connection()

    def transport(self):
        return ComponentTransport(ORIGIN, resolver=self.resolve, connection_factory=self.connection)


class Fixture:
    def __init__(self):
        self.key = Ed25519PrivateKey.generate()
        self.public = self.key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)

    def sign(self, payload):
        envelope = {"keyId": "release-1", "payload": payload}
        signature = self.key.sign(canonical_json(envelope))
        return {**envelope, "signature": base64.urlsafe_b64encode(signature).decode().rstrip("=")}

    def artifact(self, name, files, version="1.0.0", *, symlink=None):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
            for relative, data in files.items():
                info = zipfile.ZipInfo(relative)
                info.external_attr = (0o120777 if relative == symlink else 0o100644) << 16
                archive.writestr(info, data)
        data = output.getvalue()
        digest = hashlib.sha256(data).hexdigest()
        item = {"name": name, "version": version,
            "url": f"{ORIGIN}/viralflow/ai-live/components/{version}/cpu-dev/{name}-{digest}.zip",
            "sha256": digest, "sizeBytes": len(data), "expandedBytes": sum(map(len, files.values())),
            "files": {name: {"sizeBytes": len(data), "sha256": hashlib.sha256(data).hexdigest()} for name, data in files.items()},
            "chunks": [{"sizeBytes": len(chunk), "sha256": hashlib.sha256(chunk).hexdigest()}
                for start in range(0, len(data), 16384) if (chunk := data[start:start + 16384])]}
        return item, data

    def release(self, version="1.0.0", *, symlink=None):
        runtime = {"runtime/python.exe": b"fixture-python", "runtime/ffmpeg.exe": b"fixture-ffmpeg",
            "worker/managed_worker_entry.py": b"# verified fixture worker\n" + bytes(range(256)) * 300}
        models = {"models/musetalk/model.bin": bytes(range(256)) * 400,
                  "models/voice/model.bin": b"fixture-voice"}
        a, a_bytes = self.artifact("runtime", runtime, version, symlink=symlink)
        b, b_bytes = self.artifact("models", models, version)
        payload = {"v": 1, "releaseVersion": version, "issuedAt": NOW - 1, "expiresAt": NOW + 3600,
                   "profiles": {"cpu-dev": [a, b]}}
        return payload, [a_bytes, b_bytes]

    def manager(self, root, network, **kwargs):
        return BootstrapManager(root, trusted_keys={"release-1": self.public},
            transport=network.transport(), now=lambda: NOW, **kwargs)


class ComponentTests(unittest.TestCase):
    def setUp(self):
        self.fixture = Fixture()
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve() / "components"

    def tearDown(self):
        self.temporary.cleanup()

    def test_default_is_truthful_and_unmanaged_root_is_never_adopted(self):
        manager = BootstrapManager(self.root)
        self.assertEqual(manager.status(), {"state": "NOT_CONFIGURED", "bytesReceived": 0, "totalBytes": 0, "canPrepare": False})
        self.assertFalse(self.root.exists())
        self.root.mkdir()
        foreign = self.root / "customer.txt"
        foreign.write_text("keep")
        with self.assertRaisesRegex(SecurityError, "COMPONENT_ROOT_UNMANAGED"):
            BootstrapManager(self.root)
        remove_managed_components(self.root)
        self.assertEqual(foreign.read_text(), "keep")

    def test_fresh_install_reloads_verifies_and_polls_without_rehashing_archives(self):
        payload, archives = self.fixture.release()
        network = Network([Response(data) for data in archives])
        updates = []
        manager = self.fixture.manager(self.root, network, progress=updates.append)
        manager.load_manifest(self.fixture.sign(payload))
        self.assertTrue(manager.status()["canPrepare"])
        manager.install()
        release = manager.runtime_root()
        self.assertEqual(manager.status()["state"], "READY")
        self.assertTrue((release / "runtime/python.exe").exists())
        self.assertTrue((release / "models/musetalk/model.bin").exists())
        with patch("local_agent.components._hash_file", side_effect=AssertionError("status must not hash GB files")), patch.object(manager, "_validate_manifest", side_effect=AssertionError("status must reuse trusted verification stamp")):
            for _ in range(4):
                self.assertEqual(manager.status()["state"], "READY")
        self.assertTrue(all(set(update) == {"state", "bytesReceived", "totalBytes", "canPrepare"} for update in updates))
        self.assertLessEqual(len(updates), 8)
        restored = self.fixture.manager(self.root, Network())
        self.assertEqual(restored.status()["state"], "VERIFY_REQUIRED")
        self.assertTrue(restored.verify_current())
        self.assertEqual(restored.runtime_root(), release)
        (release / "models/musetalk/model.bin").write_bytes(b"corruption")
        self.assertIsNone(restored.runtime_root())
        self.assertEqual(restored.status()["state"], "REPAIR_REQUIRED")
        self.assertFalse(restored.verify_current())
        # Repair reuses the fully verified cache, not a paid/network request.
        restored.install(repair=True)
        self.assertEqual(restored.status()["state"], "READY")
        self.assertNotEqual(restored.runtime_root(), release)

    def test_realistic_runtime_catalog_over_8192_files_and_2mb_is_accepted_but_bounds_remain(self):
        payload, _archives = self.fixture.release()
        files = payload["profiles"]["cpu-dev"][0]["files"]
        empty = {"sizeBytes": 0, "sha256": hashlib.sha256(b"").hexdigest()}
        for index in range(9000):
            files["runtime/Lib/site-packages/" + "package" * 14 + f"/module_{index}.py"] = empty
        signed = self.fixture.sign(payload)
        self.assertGreater(len(canonical_json(signed)), 2 * 1024 * 1024)
        self.assertLess(len(canonical_json(signed)), MAX_MANIFEST_BYTES)
        manager = self.fixture.manager(self.root, Network())
        with patch("local_agent.components._hash_file", side_effect=AssertionError("Catalog validation must not read archives")):
            manager.load_manifest(signed)
        self.assertEqual(manager.status()["state"], "REQUIRED")
        oversized = copy.deepcopy(payload)
        files = oversized["profiles"]["cpu-dev"][0]["files"]
        for index in range(MAX_FILES - len(files) + 1):
            files[f"runtime/Lib/extra_{index}.py"] = empty
        with self.assertRaisesRegex(SecurityError, "COMPONENT_MANIFEST_INVALID"):
            self.fixture.manager(self.root, Network()).load_manifest(self.fixture.sign(oversized))

    def test_download_resume_verifies_signed_prefix_and_exact_range_etag(self):
        payload, archives = self.fixture.release()
        item, data = payload["profiles"]["cpu-dev"][0], archives[0]
        prefix = 2 * 16384
        network = Network([Response(data, interrupt=prefix + 19),
            Response(data[prefix:], status=206, headers={"Content-Range": f"bytes {prefix}-{len(data)-1}/{len(data)}"})])
        transport = network.transport()
        directory = self.root / "downloads"
        with self.assertRaisesRegex(SecurityError, "COMPONENT_DOWNLOAD_FAILED"):
            transport.download(item, "1.0.0", "cpu-dev", directory)
        self.assertFalse((directory / (item["sha256"] + ".zip")).exists())
        target = transport.download(item, "1.0.0", "cpu-dev", directory)
        self.assertEqual(target.read_bytes(), data)
        self.assertEqual(network.requests[1][4]["Range"], f"bytes={prefix}-")
        self.assertEqual(network.requests[1][4]["If-Range"], '"immutable-fixture"')

    def test_corrupt_prefix_restarts_and_corrupt_complete_download_never_activates(self):
        payload, archives = self.fixture.release()
        item, data = payload["profiles"]["cpu-dev"][0], archives[0]
        network = Network([Response(data, interrupt=32768), Response(data), Response(data[:-1] + b"x"), Response(data)])
        transport, directory = network.transport(), self.root / "downloads"
        with self.assertRaises(SecurityError):
            transport.download(item, "1.0.0", "cpu-dev", directory)
        partial = directory / (item["sha256"] + ".partial")
        damaged = bytearray(partial.read_bytes())
        damaged[0] ^= 1
        partial.write_bytes(damaged)
        target = transport.download(item, "1.0.0", "cpu-dev", directory)
        self.assertNotIn("Range", network.requests[1][4])
        target.unlink()
        with self.assertRaisesRegex(SecurityError, "COMPONENT_PACKAGE_INTEGRITY_FAILED"):
            transport.download(item, "1.0.0", "cpu-dev", directory)
        self.assertFalse(target.exists())
        self.assertFalse(partial.exists())
        self.assertEqual(transport.download(item, "1.0.0", "cpu-dev", directory).read_bytes(), data)

    def test_wrong_range_changed_etag_redirect_compression_and_private_dns_are_denied(self):
        payload, archives = self.fixture.release()
        item, data = payload["profiles"]["cpu-dev"][0], archives[0]
        for headers in ({"Content-Range": "bytes 1-2/3"},
                        {"Content-Range": f"bytes 16384-{len(data)-1}/{len(data)}", "ETag": '"changed"'}):
            with self.subTest(headers=headers), tempfile.TemporaryDirectory() as directory:
                network = Network([Response(data, interrupt=16384), Response(data[16384:], status=206, headers=headers)])
                transport = network.transport()
                with self.assertRaises(SecurityError):
                    transport.download(item, "1.0.0", "cpu-dev", Path(directory))
                with self.assertRaisesRegex(SecurityError, "COMPONENT_RESUME_REJECTED"):
                    transport.download(item, "1.0.0", "cpu-dev", Path(directory))
        for response in (Response(data, status=302), Response(data, headers={"Content-Encoding": "gzip"}),
                         Response(data, headers={"Transfer-Encoding": "chunked"}), Response(data, headers={"ETag": 'W/"weak"'})):
            with tempfile.TemporaryDirectory() as directory, self.assertRaises(SecurityError):
                Network([response]).transport().download(item, "1.0.0", "cpu-dev", Path(directory))
        for address in ("127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "::ffff:8.8.8.8"):
            network = Network([Response(data)], address=address)
            with self.assertRaisesRegex(SecurityError, "UPDATE_NETWORK_NOT_ALLOWED"):
                network.transport().download(item, "1.0.0", "cpu-dev", self.root / "downloads")
            self.assertEqual(network.requests, [])

    def test_signature_profile_path_expiry_and_release_immutability_fail_closed(self):
        payload, _ = self.fixture.release()
        manager = self.fixture.manager(self.root, Network())
        signed = self.fixture.sign(payload)
        signed["payload"]["expiresAt"] += 1
        with self.assertRaises(SecurityError):
            manager.load_manifest(signed)
        for alter in (lambda value: value.update(expiresAt=NOW - 1),
                      lambda value: value["profiles"]["cpu-dev"][0].update(url="http://localhost/package.zip"),
                      lambda value: value["profiles"]["cpu-dev"][1]["files"].update({"../escape": {"sizeBytes": 1, "sha256": "0" * 64}})):
            invalid = copy.deepcopy(payload)
            alter(invalid)
            with self.assertRaises(SecurityError):
                manager.load_manifest(self.fixture.sign(invalid))
        nvidia = self.fixture.manager(self.root, Network(), profile="nvidia")
        nvidia.load_manifest(self.fixture.sign(payload))
        self.assertEqual(nvidia.status()["state"], "PROFILE_UNAVAILABLE")
        self.assertFalse(nvidia.status()["canPrepare"])
        with self.assertRaisesRegex(SecurityError, "COMPONENT_PROFILE_UNAVAILABLE"):
            nvidia.install()
        manager.load_manifest(self.fixture.sign(payload))
        changed = copy.deepcopy(payload)
        changed["profiles"]["cpu-dev"][0]["files"]["runtime/python.exe"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(SecurityError, "COMPONENT_RELEASE_NOT_IMMUTABLE"):
            manager.load_manifest(self.fixture.sign(changed))

    def test_fresh_signed_lifetime_renews_same_immutable_release_after_original_expiry(self):
        payload, archives = self.fixture.release()
        network = Network([Response(data) for data in archives])
        manager = self.fixture.manager(self.root, network)
        clock = [NOW]
        manager.now = lambda: clock[0]
        manager.load_manifest(self.fixture.sign(payload))
        manager.install()
        active = (self.root / "active.json").read_bytes()
        release = manager.runtime_root()
        clock[0] = NOW + 3700
        self.assertEqual(manager.status()["state"], "NOT_CONFIGURED")
        self.assertIsNone(manager.runtime_root())
        renewed = copy.deepcopy(payload)
        renewed.update(issuedAt=clock[0] - 1, expiresAt=clock[0] + 3600)
        manager.load_manifest(self.fixture.sign(renewed))
        manager.install()
        self.assertEqual(manager.status()["state"], "READY")
        self.assertEqual(manager.runtime_root(), release)
        self.assertEqual((self.root / "active.json").read_bytes(), active)
        self.assertEqual(len(network.requests), 2, "Renewal re-verifies installed files; it does not redownload")
        changed = copy.deepcopy(renewed)
        changed["profiles"]["cpu-dev"][1]["files"]["models/voice/model.bin"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(SecurityError, "COMPONENT_RELEASE_NOT_IMMUTABLE"):
            manager.load_manifest(self.fixture.sign(changed))

    def test_failed_update_preserves_active_pointer_and_safe_zip_denies_symlink(self):
        payload, archives = self.fixture.release()
        network = Network([Response(data) for data in archives])
        manager = self.fixture.manager(self.root, network)
        manager.load_manifest(self.fixture.sign(payload))
        manager.install()
        old_pointer = (self.root / "active.json").read_bytes()
        newer, new_archives = self.fixture.release("2.0.0", symlink="runtime/python.exe")
        network.responses.extend(Response(data) for data in new_archives)
        manager.load_manifest(self.fixture.sign(newer))
        with self.assertRaisesRegex(SecurityError, "COMPONENT_ARCHIVE_INVALID"):
            manager.install()
        self.assertEqual((self.root / "active.json").read_bytes(), old_pointer)
        self.assertFalse(list((self.root / "releases").glob(".staging-*")))
        self.assertTrue(manager.verify_current())
        self.assertIsNone(manager.runtime_root(), "A new catalog cannot silently authorize the retained old runtime")
        self.assertTrue((self.root / json.loads(old_pointer)["release"] / "runtime/python.exe").exists())

    def test_cancellation_before_commit_cannot_activate_and_uninstall_preserves_nested_foreign_files(self):
        payload, archives = self.fixture.release()
        network = Network([Response(data) for data in archives])
        manager = self.fixture.manager(self.root, network)
        manager.load_manifest(self.fixture.sign(payload))
        original = manager._catalog
        def cancel_at_commit(record=None):
            result = original(record)
            manager.cancel()
            return result
        with patch.object(manager, "_catalog", side_effect=cancel_at_commit):
            with self.assertRaisesRegex(SecurityError, "COMPONENT_DOWNLOAD_INTERRUPTED"):
                manager.install()
        self.assertFalse((self.root / "active.json").exists())
        self.assertEqual(manager.status()["state"], "INTERRUPTED")
        restored = self.fixture.manager(self.root, Network())
        restored.install()
        release = restored.runtime_root()
        foreign = [self.root / "customer.txt", self.root / "downloads/customer.txt", release / "models/customer.txt"]
        for path in foreign:
            path.write_text("keep")
        remove_managed_components(self.root)
        for path in foreign:
            self.assertEqual(path.read_text(), "keep")
        self.assertFalse((release / "runtime/python.exe").exists())
        self.assertFalse((self.root / "active.json").exists())

    def test_fixed_manifest_fetch_matches_version_and_never_follows_redirect(self):
        payload, _ = self.fixture.release()
        data = canonical_json(self.fixture.sign(payload))
        network = Network([Response(data)])
        manager = self.fixture.manager(self.root, network)
        manager.fetch_manifest(ORIGIN + "/viralflow/ai-live/components/1.0.0/manifest.json")
        self.assertEqual(manager.status()["state"], "REQUIRED")
        with self.assertRaisesRegex(SecurityError, "COMPONENT_URL_NOT_ALLOWED"):
            manager.fetch_manifest("https://attacker.example/viralflow/ai-live/components/1.0.0/manifest.json")
        network.responses.append(Response(data, status=302))
        with self.assertRaisesRegex(SecurityError, "COMPONENT_MANIFEST_DOWNLOAD_REJECTED"):
            manager.fetch_manifest(ORIGIN + "/viralflow/ai-live/components/1.0.0/manifest.json")


if __name__ == "__main__":
    unittest.main()
