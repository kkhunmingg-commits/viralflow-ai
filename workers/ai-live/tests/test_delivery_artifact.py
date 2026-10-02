"""Exercise the real offline bundle in workspace-isolated temporary installs."""

from __future__ import annotations

import json
import hashlib
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

WORKER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER))
from installer.delivery import DeliveryManager

BUILD = WORKER / "installer" / ".build"


@unittest.skipUnless(sys.platform == "win32" and (BUILD / "payload.zip").exists(),
                     "Build the Windows offline artifact before packaged-runtime verification")
class PackagedRuntimeTests(unittest.TestCase):
    def test_real_fresh_install_bundled_crypto_runtime_repair_and_uninstall(self) -> None:
        info = json.loads((BUILD / "payload-info.json").read_text(encoding="utf-8"))
        verified: list[Path] = []

        def self_test(executable: Path | None) -> None:
            if executable is None:
                return
            self.assertTrue(executable.absolute().is_relative_to(BUILD.absolute()))
            report = root.parent / "self-test-report.json"
            environment = os.environ.copy()
            environment["VIRALFLOW_SELF_TEST_REPORT"] = str(report)
            completed = subprocess.run([str(executable), "--self-test"], env=environment,
                                       creationflags=0x08000000, timeout=30, check=False)
            diagnostic = json.loads(report.read_text(encoding="utf-8")) if report.exists() else {}
            self.assertEqual(completed.returncode, 0, diagnostic)
            self.assertEqual(diagnostic.get("status"), "PASSED")
            verified.append(executable)

        with tempfile.TemporaryDirectory(prefix="isolated-install-", dir=BUILD) as isolated:
            root = Path(isolated) / "LiveAgent"
            self.assertTrue(root.absolute().is_relative_to(BUILD.absolute()))
            manager = DeliveryManager(root, integration=self_test)
            previous = BUILD / "previous-0.3.0.zip"
            old = None
            if info["version"] == "0.4.0" and previous.is_file():
                old = manager.install(previous, hashlib.sha256(previous.read_bytes()).hexdigest(), expected_version="0.3.0")
                identity = root / "identity"
                identity.mkdir()
                (identity / "upgrade-fixture.bin").write_bytes(b"preserve owned identity during upgrade")
                # Unconfigured first-run components must never be fabricated or
                # destroyed by an agent-only update/repair transaction.
                components = root / "components"
                components.mkdir()
                (components / "customer-notes.txt").write_text("preserve unrelated component data")
            manager.install(BUILD / "payload.zip", info["sha256"], expected_version=info["version"])
            if old:
                self.assertEqual(manager.current()["version"], "0.4.0")
                self.assertTrue((root / old["release"]).is_dir())
                self.assertEqual((identity / "upgrade-fixture.bin").read_bytes(), b"preserve owned identity during upgrade")
            self.assertTrue(manager.verify_current())
            self.assertTrue((manager.executable().parent / "ffmpeg.exe").is_file())
            internal = manager.executable().parent / "_internal"
            self.assertTrue((internal / "_sounddevice_data" / "portaudio-binaries" / "libportaudio64bit.dll").is_file())
            self.assertTrue((internal / "_sounddevice_data" / "portaudio-binaries" / "README.md").is_file())
            self.assertTrue((internal / "sounddevice-0.5.1.dist-info" / "LICENSE").is_file())
            # This is the bundled native runtime, not the system Python interpreter.
            self.assertTrue((manager.executable().parent / "_internal" / "python310.dll").is_file())
            (manager.executable().parent / "THIRD_PARTY_NOTICES.md").write_text("damaged")
            self.assertFalse(manager.verify_current())
            manager.install(BUILD / "payload.zip", info["sha256"], repair=True)
            self.assertTrue(manager.verify_current())
            self.assertEqual(len(verified), 3 if old else 2)
            manager.uninstall()
            self.assertFalse((root / "releases").exists())
            self.assertFalse((root / "current.json").exists())
            if old:
                self.assertEqual((components / "customer-notes.txt").read_text(), "preserve unrelated component data")

    def test_packaged_hidden_launcher_first_run_local_discovery_and_encrypted_identity(self) -> None:
        with socket.socket() as connection:
            connection.settimeout(0.2)
            if connection.connect_ex(("127.0.0.1", 8766)) == 0:
                self.skipTest("A companion is already open; never interfere with its process")
        info = json.loads((BUILD / "payload-info.json").read_text(encoding="utf-8"))
        # Keep the simulated per-user profile short enough for Windows native
        # DLL loading (the repository path is already unusually deep). The
        # actual install directory remains inside this workspace and follows
        # the exact normal LOCALAPPDATA/ViralFlow/LiveAgent layout.
        with tempfile.TemporaryDirectory(prefix="s", dir=BUILD) as isolated:
            profile = Path(isolated)
            root = profile / "ViralFlow" / "LiveAgent"
            self.assertTrue(root.absolute().is_relative_to(BUILD.absolute()))
            manager = DeliveryManager(root)
            manager.install(BUILD / "payload.zip", info["sha256"])
            environment = os.environ.copy()
            environment["LOCALAPPDATA"] = str(profile)
            startup = subprocess.STARTUPINFO()
            startup.dwFlags = subprocess.STARTF_USESHOWWINDOW
            startup.wShowWindow = 0
            process = subprocess.Popen([str(manager.executable()), "--startup-smoke"],
                                       env=environment, startupinfo=startup,
                                       creationflags=0x08000000, shell=False)
            response = None
            # Loopback companion traffic must stay local even on hosts with a
            # globally configured HTTP proxy. Never send it through that proxy.
            local_transport = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            try:
                for _attempt in range(40):
                    if process.poll() is not None:
                        self.fail("Packaged launcher exited before becoming available")
                    try:
                        request = urllib.request.Request("http://127.0.0.1:8766/v1/discovery",
                            headers={"Origin": "https://viralflow-ai-blond.vercel.app"})
                        with local_transport.open(request, timeout=0.4) as reply:
                            response = json.loads(reply.read(8192))
                        break
                    except (OSError, ValueError):
                        time.sleep(0.2)
                trace = profile / "startup-smoke.trace"
                safe_trace = trace.read_text(encoding="utf-8")[-3000:] if trace.exists() else "no startup exceptions captured"
                self.assertIsNotNone(response, "Packaged companion did not become available: " + safe_trace)
                self.assertEqual(response["versions"]["agent"], info["version"])
                self.assertFalse(response["paired"])
                self.assertFalse(response["deviceAuthorized"])
                self.assertEqual(response["updateStatus"], "NOT_CONFIGURED")
                self.assertFalse(response["updateCanApply"])
                self.assertFalse(response["updateCanRepair"])
                encrypted = (root / "identity" / "device.bin").read_bytes()
                self.assertNotIn(b"PRIVATE KEY", encrypted)
                self.assertNotIn(b'"deviceId"', encrypted)
            finally:
                # Only the PID created for this isolated fixture is terminated.
                if process.poll() is None:
                    process.terminate()
                process.wait(timeout=10)
                manager.uninstall()


if __name__ == "__main__":
    unittest.main()
