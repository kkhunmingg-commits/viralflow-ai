"""Preparation uses the existing device, membership and account grant boundary."""
import dataclasses
import json
import threading
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_agent.agent import AgentError
from local_agent.hardware import HardwareTiers
from local_agent.security import SecurityError
from test_local_agent import AgentFixture, OWNER_B, ORIGIN, signed, supported_hardware


class ComponentFixture:
    profile = "nvidia"
    transport = object()
    def __init__(self):
        self.state = "NOT_CONFIGURED"
        self.calls = []
        self.entered = threading.Event()
        self.release = threading.Event()
        self.release.set()
        self.failed = False
    def status(self):
        return {"state": self.state, "bytesReceived": 4, "totalBytes": 10,
                "canPrepare": self.state != "READY", "debug": "private-key-not-for-browser"}
    def fetch_manifest(self, url):
        self.calls.append(("fetch", url))
    def install(self, *, repair, cancel):
        self.calls.append(("install", repair))
        self.state = "DOWNLOADING"
        self.entered.set()
        self.release.wait(2)
        if self.failed or cancel.is_set():
            raise SecurityError("COMPONENT_INSTALL_FAILED")
        self.state = "READY"
    def cancel(self):
        self.release.set()


class AgentComponentTests(AgentFixture):
    def prepare(self, *, supported=True):
        agent = self.make_agent(validated=False, supported=supported)
        components = ComponentFixture()
        agent._components = components
        agent._component_manifest_url = "https://releases.example/viralflow/ai-live/components/0.3.0/manifest.json"
        token, challenge, self.presenter = self.pair_and_reference(agent)
        return agent, components, token, challenge

    def test_preparation_uses_installed_url_and_signed_grant_without_unlocking_live(self):
        agent, components, token, challenge = self.prepare()
        components.release.clear()
        result = agent.prepare_components(token, ORIGIN, self.grant(challenge))
        self.assertTrue(components.entered.wait(1))
        self.assertEqual(result["components"]["state"], "DOWNLOADING")
        self.assertEqual(set(result["components"]), {"state", "bytesReceived", "totalBytes", "canPrepare"})
        self.assertNotIn("private-key", json.dumps(agent.status(token, ORIGIN)))
        self.assertEqual(components.calls[0], ("fetch", agent._component_manifest_url))
        components.release.set()
        agent._component_thread.join(2)
        view = agent.status(token, ORIGIN)
        self.assertEqual(view["components"]["state"], "READY")
        self.assertFalse(view["canStart"])
        self.assertEqual(self.worker.calls, [])

    def test_nonmember_wrong_owner_wrong_device_expired_and_tampered_cannot_download(self):
        for changed in ({"entitled": False}, {"ownerId": OWNER_B}, {"deviceId": OWNER_B},
                        {"expiresAt": 999}, {"versions": {"web": "invalid"}}):
            with self.subTest(changed=changed):
                agent, components, token, challenge = self.prepare()
                grant = self.grant(challenge)
                grant["payload"].update(changed)
                with self.assertRaises(AgentError):
                    agent.prepare_components(token, ORIGIN, signed(grant["payload"]))
                self.assertEqual(components.calls, [])
        agent, components, token, challenge = self.prepare()
        grant = self.grant(challenge)
        grant["signature"] = "A" * 86
        with self.assertRaises(AgentError):
            agent.prepare_components(token, ORIGIN, grant)
        self.assertEqual(components.calls, [])

    def test_duplicate_busy_and_revoked_device_do_not_install(self):
        agent, components, token, challenge = self.prepare()
        components.release.clear()
        grant = self.grant(challenge)
        agent.prepare_components(token, ORIGIN, grant)
        self.assertTrue(components.entered.wait(1))
        with self.assertRaises(AgentError):
            agent.prepare_components(token, ORIGIN, grant)
        fresh = agent.challenge(token, ORIGIN)["challenge"]
        with self.assertRaisesRegex(AgentError, "COMPONENTS_BUSY"):
            agent.prepare_components(token, ORIGIN, self.grant(fresh))
        components.release.set()
        agent._component_thread.join(2)
        agent._device_identity.mark_revoked(1001)
        with self.assertRaises(AgentError):
            agent.prepare_components(token, ORIGIN, self.grant(fresh), repair=True)
        self.assertEqual(len(components.calls), 2)

    def test_hardware_and_unconfigured_channel_block_without_manual_setup_or_silent_cpu_fallback(self):
        agent, components, token, challenge = self.prepare(supported=False)
        self.assertFalse(agent.components_status(token, ORIGIN)["components"]["canPrepare"])
        with self.assertRaisesRegex(AgentError, "COMPONENTS_NOT_READY"):
            agent.prepare_components(token, ORIGIN, self.grant(challenge))
        components.profile = "cpu-dev"
        with patch.dict("os.environ", {"APP_ENV": "production", "AI_LIVE_ENV": "production"}):
            self.assertFalse(agent.components_status(token, ORIGIN)["components"]["canPrepare"])
        agent._component_manifest_url = None
        self.assertFalse(agent.components_status(token, ORIGIN)["components"]["canPrepare"])
        self.assertEqual(components.calls, [])

    def test_interrupted_preparation_is_repairable_and_shutdown_cancels_owned_operation(self):
        agent, components, token, challenge = self.prepare()
        components.failed = True
        agent.prepare_components(token, ORIGIN, self.grant(challenge))
        agent._component_thread.join(2)
        self.assertEqual(agent.components_status(token, ORIGIN)["components"]["state"], "ERROR")
        components.failed = False
        fresh = agent.challenge(token, ORIGIN)["challenge"]
        agent.prepare_components(token, ORIGIN, self.grant(fresh), repair=True)
        agent._component_thread.join(2)
        self.assertEqual(components.calls[-1], ("install", True))
        self.assertFalse(agent.status(token, ORIGIN)["canStart"])
        agent.close()
        self.assertFalse(agent._component_thread.is_alive())

    def test_missing_encoder_can_be_restored_and_driver_advice_is_enum_only(self):
        agent, components, token, _ = self.prepare()
        agent._hardware_probe = lambda: dataclasses.replace(supported_hardware(), encoder_listed=False)
        view = agent.status(token, ORIGIN)
        self.assertFalse(view["machineReady"])
        self.assertTrue(view["components"]["canPrepare"])
        agent.config = dataclasses.replace(agent.config, hardware_tiers=HardwareTiers(minimum_driver_version="600.0"))
        view = agent.status(token, ORIGIN)
        self.assertEqual(view["hardwareAdvice"], "DRIVER_UPDATE_REQUIRED")
        self.assertFalse(view["components"]["canPrepare"])
        self.assertNotIn("driver_version", json.dumps(view))

    def test_bootstrap_updates_and_start_do_not_run_concurrently(self):
        agent, components, token, challenge = self.prepare()
        components.release.clear()
        agent.prepare_components(token, ORIGIN, self.grant(challenge))
        self.assertTrue(components.entered.wait(1))
        with self.assertRaisesRegex(AgentError, "COMPONENTS_BUSY"):
            agent.apply_update(token, ORIGIN, confirmed=True)
        fresh = agent.challenge(token, ORIGIN)["challenge"]
        with self.assertRaisesRegex(AgentError, "COMPONENTS_REQUIRED"):
            agent.start(token, ORIGIN, self.start_body(fresh))
        components.release.set()


if __name__ == "__main__":
    import unittest
    unittest.main()
