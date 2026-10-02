"""Import the windowed launcher without opening windows or installing anything."""
from __future__ import annotations

import copy
import importlib.machinery
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_agent.agent import VERSIONS
from local_agent.security import SecurityError

loader = importlib.machinery.SourceFileLoader("_launcher_configuration_test",
    str(Path(__file__).resolve().parents[1] / "local_agent" / "launcher.pyw"))
spec = importlib.util.spec_from_loader(loader.name, loader)
launcher = importlib.util.module_from_spec(spec)
loader.exec_module(launcher)


class LauncherConfigurationTests(unittest.TestCase):
    def configuration(self, **overrides):
        return {"trustedKeys": {"release-1": "public-trust-fixture"}, "componentBootstrap": {
            "origin": "https://releases.example", "releaseVersion": VERSIONS["agent"],
            "profile": "nvidia", "minimumNvidiaDriver": "555.1", **overrides,
        }}

    def test_absent_catalog_defaults_to_nvidia_and_cannot_download(self):
        self.assertEqual(launcher.component_configuration({}), (None, None, "nvidia", None))
        self.assertEqual(launcher.component_configuration({"componentBootstrap": None}),
                         (None, None, "nvidia", None))

    def test_fixed_package_origin_version_profile_and_driver_make_exact_manifest_url(self):
        self.assertEqual(launcher.component_configuration(self.configuration()),
            ("https://releases.example", "https://releases.example/viralflow/ai-live/components/"
             + VERSIONS["agent"] + "/manifest.json", "nvidia", "555.1"))
        normalized = self.configuration(origin="https://RELEASES.example:443/", minimumNvidiaDriver=None)
        self.assertEqual(launcher.component_configuration(normalized),
            ("https://releases.example", "https://releases.example/viralflow/ai-live/components/"
             + VERSIONS["agent"] + "/manifest.json", "nvidia", None))

    def test_explicit_cpu_dev_is_preserved_without_enabling_it(self):
        result = launcher.component_configuration(self.configuration(profile="cpu-dev"))
        self.assertEqual(result[2], "cpu-dev")
        self.assertEqual(result[1].split("/")[-1], "manifest.json")

    def test_component_catalog_requires_installed_trusted_keys(self):
        for trust in (None, {}, ""):
            with self.subTest(trust=trust):
                configured = self.configuration()
                configured["trustedKeys"] = trust
                configured["grantPublicKeyPem"] = "legacy-public-key-only"
                with self.assertRaises(SecurityError):
                    launcher.component_configuration(configured)

    def test_missing_profile_or_required_coordinates_are_rejected(self):
        for field in ("origin", "releaseVersion", "profile"):
            with self.subTest(field=field):
                configured = self.configuration()
                del configured["componentBootstrap"][field]
                with self.assertRaises(SecurityError):
                    launcher.component_configuration(configured)
        for profile in ("", "auto", "gpu", "cpu", None):
            with self.subTest(profile=profile), self.assertRaises(SecurityError):
                launcher.component_configuration(self.configuration(profile=profile))

    def test_command_and_arbitrary_url_overrides_are_rejected(self):
        for field in ("command", "args", "pythonPath", "manifestUrl", "url", "installScript"):
            with self.subTest(field=field), self.assertRaises(SecurityError):
                launcher.component_configuration(self.configuration(**{field: "untrusted override"}))

    def test_nonpublic_literal_origins_and_nonorigin_urls_are_rejected(self):
        for origin in ("http://releases.example", "https://127.0.0.1", "https://10.0.0.1",
                       "https://192.168.1.1", "https://[::1]", "https://169.254.169.254",
                       "https://user:secret@releases.example", "https://releases.example:8443",
                       "https://releases.example/other", "https://releases.example?command=x",
                       "https://releases.example#fragment"):
            with self.subTest(origin=origin), self.assertRaises(SecurityError):
                launcher.component_configuration(self.configuration(origin=origin))

    def test_version_and_minimum_driver_have_strict_public_formats(self):
        for version in ("../0.4.0", "0.4.0/other", "v0.4.0", "01.4.0", "0.4.0-beta", 4, None):
            with self.subTest(version=version), self.assertRaises(SecurityError):
                launcher.component_configuration(self.configuration(releaseVersion=version))
        for driver in ("latest", "555", "555.1;run", "../555.1", True, 555):
            with self.subTest(driver=driver), self.assertRaises(ValueError):
                launcher.component_configuration(self.configuration(minimumNvidiaDriver=driver))

    def test_packaged_config_uses_fixed_location_and_rejects_commands(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "local_agent").mkdir()
            target = root / "local_agent" / "config.json"
            configured = self.configuration()
            target.write_text(json.dumps(configured), encoding="utf-8")
            with patch.object(launcher.sys, "_MEIPASS", str(root), create=True):
                self.assertEqual(launcher.packaged_config(), configured)
                for field in ("command", "manifestUrl", "path"):
                    rejected = copy.deepcopy(configured)
                    rejected[field] = "untrusted browser command"
                    target.write_text(json.dumps(rejected), encoding="utf-8")
                    with self.subTest(field=field), self.assertRaises(SecurityError):
                        launcher.packaged_config()


if __name__ == "__main__":
    unittest.main()
