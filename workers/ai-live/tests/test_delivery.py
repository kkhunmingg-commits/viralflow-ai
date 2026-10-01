"""Offline installation/update contracts, using isolated temporary directories."""

from __future__ import annotations

import base64
import hashlib
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from installer.delivery import DeliveryError, DeliveryManager, MARKER, _regular_path
from installer.build_windows import public_key_configuration
from local_agent.security import SecurityError, canonical_json
from local_agent.updater import SafeUpdater


def bundle(directory: Path, version: str, *, extra: dict[str, bytes] | None = None) -> tuple[Path, str]:
    files = {"LocalLiveAgent.exe": f"isolated-runtime-{version}".encode(),
             "_internal/runtime.dll": b"bundled runtime", **(extra or {})}
    manifest = {"format": MARKER, "version": version,
                "files": {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
    path = directory / f"bundle-{version}.zip"
    with zipfile.ZipFile(path, "w") as output:
        output.writestr("bundle.json", json.dumps(manifest))
        for name, data in files.items():
            output.writestr(name, data)
    return path, hashlib.sha256(path.read_bytes()).hexdigest()


class DeliveryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.root = self.directory / "LiveAgent"
        self.manager = DeliveryManager(self.root)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_fresh_install_contains_bundled_runtime_and_existing_version_detected(self) -> None:
        archive, digest = bundle(self.directory, "0.1.0")
        record = self.manager.install(archive, digest)
        self.assertEqual(record["version"], "0.1.0")
        self.assertTrue(self.manager.verify_current())
        self.assertTrue((self.manager.executable().parent / "_internal/runtime.dll").exists())
        self.assertEqual(DeliveryManager(self.root).current(), record)

    def test_same_version_rerun_is_noop_and_repair_replaces_corrupt_files(self) -> None:
        archive, digest = bundle(self.directory, "0.2.0")
        first = self.manager.install(archive, digest)
        self.assertEqual(self.manager.install(archive, digest), first)
        self.manager.executable().write_bytes(b"corruption")
        self.assertFalse(self.manager.verify_current())
        repaired = self.manager.install(archive, digest, repair=True)
        self.assertNotEqual(first["release"], repaired["release"])
        self.assertTrue(self.manager.verify_current())

    def test_upgrade_keeps_identity_and_old_release_while_switching_current(self) -> None:
        one, digest_one = bundle(self.directory, "0.1.0")
        old = self.manager.install(one, digest_one)
        identity = self.root / "identity"
        identity.mkdir()
        (identity / "device.bin").write_bytes(b"encrypted fixture")
        two, digest_two = bundle(self.directory, "0.2.0")
        upgraded = self.manager.install(two, digest_two)
        self.assertEqual(upgraded["version"], "0.2.0")
        self.assertTrue((self.root / old["release"]).exists())
        self.assertEqual((identity / "device.bin").read_bytes(), b"encrypted fixture")
        self.assertEqual(self.manager.state, "RESTART_REQUIRED")

    def test_failed_upgrade_rolls_back_and_does_not_touch_current_release(self) -> None:
        one, digest_one = bundle(self.directory, "0.1.0")
        old = self.manager.install(one, digest_one)
        selected: list[Path | None] = []

        def integration(executable: Path | None) -> None:
            selected.append(executable)
            if executable and executable.parent.name.startswith("0.2.0-"):
                raise RuntimeError("simulated OS integration failure")

        self.manager.integration = integration
        two, digest_two = bundle(self.directory, "0.2.0")
        with self.assertRaises(RuntimeError):
            self.manager.install(two, digest_two)
        self.assertEqual(self.manager.current(), old)
        self.assertTrue(self.manager.verify_current())
        self.assertEqual(selected[-1], self.manager.executable())
        self.assertEqual(len(list((self.root / "releases").iterdir())), 1)
        self.assertEqual(self.manager.state, "ROLLED_BACK")

    def test_failed_fresh_install_leaves_no_active_release(self) -> None:
        self.manager.integration = lambda _path: (_ for _ in ()).throw(RuntimeError("failure"))
        archive, digest = bundle(self.directory, "0.2.0")
        with self.assertRaises(RuntimeError):
            self.manager.install(archive, digest)
        self.assertIsNone(self.manager.current())
        self.assertEqual(len(list((self.root / "releases").iterdir())), 0)

    def test_uninstall_cleans_only_owned_components_identity_and_references(self) -> None:
        archive, digest = bundle(self.directory, "0.2.0")
        self.manager.install(archive, digest)
        for name in ("identity", "references", "updates"):
            (self.root / name).mkdir()
            (self.root / name / "fixture").write_bytes(b"owned")
        unknown = self.root / "not-managed.txt"
        unknown.write_text("preserve")
        outside = self.directory / "other-user-data.txt"
        outside.write_text("preserve")
        self.manager.uninstall()
        self.assertEqual(list(self.root.iterdir()), [unknown])
        self.assertEqual(outside.read_text(), "preserve")

    def test_unmanaged_folder_and_wrong_hash_are_never_modified(self) -> None:
        self.root.mkdir()
        existing = self.root / "customer-file.txt"
        existing.write_text("preserve")
        with self.assertRaises(DeliveryError):
            DeliveryManager(self.root)
        archive, digest = bundle(self.directory, "0.2.0")
        with self.assertRaises(DeliveryError):
            self.manager.install(archive, "0" * 64)
        self.assertEqual(existing.read_text(), "preserve")

    def test_archive_path_escape_and_windows_alias_are_rejected(self) -> None:
        for name in ("../escape.exe", "NUL.dll", "file.", "_internal\\evil.dll"):
            archive, digest = bundle(self.directory, "0.2.0", extra={name: b"bad"})
            with self.assertRaises(DeliveryError):
                self.manager.install(archive, digest)
        self.assertFalse((self.directory / "escape.exe").exists())

    def test_downgrade_and_mismatched_signed_version_block_before_activation(self) -> None:
        newer, digest = bundle(self.directory, "0.2.0")
        old = self.manager.install(newer, digest)
        older, old_digest = bundle(self.directory, "0.1.0")
        with self.assertRaises(DeliveryError):
            self.manager.install(older, old_digest)
        with self.assertRaises(DeliveryError):
            self.manager.install(newer, digest, expected_version="0.3.0")
        self.assertEqual(self.manager.current(), old)

    def test_root_ancestors_and_lexical_parent_paths_are_rejected(self) -> None:
        with self.assertRaises(DeliveryError):
            _regular_path(self.root / "releases" / ".." / "identity", self.root)
        # Simulate a Windows junction above the installation boundary. This
        # regression catches the old earlybreak at root.parent, without needing
        # administrator symlink privileges or creating a real external junction.
        original = Path.lstat
        class Reparse:
            st_file_attributes = 0x400
            st_mode = 0o40755
        def lstat(path: Path):
            if path == self.directory:
                return Reparse()
            return original(path)
        with patch.object(Path, "lstat", lstat):
            with self.assertRaises(DeliveryError):
                _regular_path(self.root, self.root)


class UpdateTests(unittest.TestCase):
    def setUp(self) -> None:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
        self.key = Ed25519PrivateKey.generate()
        self.public = self.key.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.root = self.directory / "LiveAgent"
        self.manager = DeliveryManager(self.root, integration=lambda _path: None)
        first, digest = bundle(self.directory, "0.1.0")
        self.manager.install(first, digest)
        self.archive, self.digest = bundle(self.directory, "0.2.0")
        self.updater = SafeUpdater(self.root, self.public, allowed_hosts=frozenset({"updates.example.test"}),
                                   installed_versions={"web": "0.1.0", "agent": "0.1.0", "worker": "0.1.0"},
                                   now=lambda: 1000, delivery=self.manager)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def signed(self, **package_overrides: object) -> dict[str, object]:
        payload = {"v": 1, "issuedAt": 990, "expiresAt": 1100,
                   "versions": {"web": "0.2.0", "agent": "0.2.0", "worker": "0.2.0"},
                   "package": {"url": "https://updates.example.test/viralflow/ai-live/releases/0.2.0.zip",
                               "sha256": self.digest, "sizeBytes": self.archive.stat().st_size,
                               **package_overrides}}
        signature = base64.urlsafe_b64encode(self.key.sign(canonical_json(payload))).decode().rstrip("=")
        return {"payload": payload, "signature": signature}

    def test_signed_update_requires_confirmation_then_restart(self) -> None:
        self.assertEqual(self.updater.discover(self.signed())["state"], "AVAILABLE")
        self.assertFalse(self.updater.status()["canStart"])
        with self.assertRaises(SecurityError):
            self.updater.apply(self.archive)
        with self.assertRaises(SecurityError):
            self.updater.apply(self.archive, confirmed=True, session_active=True)
        self.assertEqual(self.updater.apply(self.archive, confirmed=True)["state"], "RESTART_REQUIRED")
        self.assertEqual(self.manager.current()["version"], "0.2.0")

    def test_forged_signature_or_external_host_are_blocked(self) -> None:
        signed = self.signed()
        signed["payload"]["package"]["url"] = "https://attacker.test/file"
        with self.assertRaises(SecurityError):
            self.updater.discover(signed)
        for url in ("http://updates.example.test/viralflow/ai-live/releases/x", "https://evil.test/viralflow/ai-live/releases/x",
                    "https://updates.example.test:444/viralflow/ai-live/releases/x"):
            with self.assertRaises(SecurityError):
                self.updater.discover(self.signed(url=url))

    def test_expired_manifest_and_missing_trust_block_update(self) -> None:
        self.updater.discover(self.signed())
        self.updater.now = lambda: 1200
        with self.assertRaises(SecurityError):
            self.updater.apply(self.archive, confirmed=True)
        self.updater.public_key_pem = b""
        with self.assertRaises(SecurityError):
            self.updater.discover(self.signed())

    def test_failed_update_retains_previous_runtime(self) -> None:
        self.updater.discover(self.signed())
        old = self.manager.current()
        self.manager.integration = lambda _path: (_ for _ in ()).throw(RuntimeError("failed import"))
        with self.assertRaises(RuntimeError):
            self.updater.apply(self.archive, confirmed=True)
        self.assertEqual(self.updater.state, "ROLLED_BACK")
        self.assertEqual(self.manager.current(), old)

    def test_verified_manifest_cannot_be_changed_by_caller_after_discover(self) -> None:
        signed = self.signed()
        self.updater.discover(signed)
        signed["payload"]["package"]["sha256"] = "0" * 64
        self.assertEqual(self.updater.apply(self.archive, confirmed=True)["state"], "RESTART_REQUIRED")

    def test_mixed_component_versions_and_unwired_runtime_integration_fail_closed(self) -> None:
        signed = self.signed()
        signed["payload"]["versions"]["worker"] = "0.3.0"
        signed["signature"] = base64.urlsafe_b64encode(self.key.sign(canonical_json(
            signed["payload"]))).decode().rstrip("=")
        with self.assertRaises(SecurityError):
            self.updater.discover(signed)
        self.updater.discover(self.signed())
        self.updater.delivery.integration_configured = False
        with self.assertRaises(SecurityError):
            self.updater.apply(self.archive, confirmed=True)
        self.assertEqual(self.manager.current()["version"], "0.1.0")

    def test_package_public_key_input_cannot_accept_private_key(self) -> None:
        from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, NoEncryption
        public = self.directory / "public.pem"
        public.write_bytes(self.public)
        self.assertEqual(public_key_configuration(public)["grantPublicKeyPem"].encode(), self.public)
        private = self.directory / "must-not-package.pem"
        private.write_bytes(self.key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()))
        with self.assertRaises(RuntimeError):
            public_key_configuration(private)


if __name__ == "__main__":
    unittest.main()
