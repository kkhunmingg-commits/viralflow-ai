"""Real loopback HTTP, Ed25519 leases and ZIP verification; HTTPS is injected."""
from __future__ import annotations

import copy
import http.client
import json
import sys
import tempfile
import threading
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_agent.agent import AgentConfig, LocalAgent, VERSIONS
from local_agent.http_server import AgentHTTPServer
from test_device_identity_fixture import registered_identity_fixture
import test_components as component_fixtures
import test_local_agent as agent_fixtures


class LocalComponentHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.signer = component_fixtures.Fixture()
        manifest, archives = self.signer.release(VERSIONS["agent"])
        artifacts = manifest["profiles"].pop("cpu-dev")
        for artifact in artifacts:
            artifact["url"] = artifact["url"].replace("/cpu-dev/", "/nvidia/")
        manifest["profiles"]["nvidia"] = artifacts
        self.network = component_fixtures.Network([
            component_fixtures.Response(json.dumps(self.signer.sign(manifest)).encode()),
            *(component_fixtures.Response(archive) for archive in archives),
        ])
        self.manager = self.signer.manager(root / "components", self.network, profile="nvidia")
        self.worker = agent_fixtures.RecordingWorker()
        self.identity = registered_identity_fixture(root / "identity", agent_fixtures.DEVICE)
        config = AgentConfig(agent_fixtures.DEVICE, "component-pair-code", self.signer.public,
                             root / "references", trusted_keys={"release-1": self.signer.public})
        self.manifest_url = (component_fixtures.ORIGIN + "/viralflow/ai-live/components/"
                             + VERSIONS["agent"] + "/manifest.json")
        self.agent = LocalAgent(config, worker=self.worker, hardware_probe=agent_fixtures.supported_hardware,
                                now=lambda: component_fixtures.NOW, device_identity=self.identity,
                                components=self.manager, component_manifest_url=self.manifest_url)
        self.server = AgentHTTPServer(self.agent, port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close)

    def close(self):
        self.server.shutdown()
        self.thread.join(timeout=3)
        self.server.server_close()
        self.agent.close()

    def request(self, method, path, body=None, *, token=None, origin=agent_fixtures.ORIGIN):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        headers = {"Origin": origin}
        if token:
            headers["Authorization"] = "Bearer " + token
        if body is not None:
            headers["Content-Type"] = "application/json"
            body = json.dumps(body).encode()
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), json.loads(response.read())
        finally:
            connection.close()

    def pair(self, *, register=True):
        status, _, body = self.request("POST", "/v1/pair", {"code": "component-pair-code"})
        self.assertEqual(status, 200)
        token = body["token"]
        if register:
            certificate = self.signer.sign({
                "v": 1, "purpose": "AI_LIVE_DEVICE_CERTIFICATE", "ownerId": agent_fixtures.OWNER_A,
                "deviceId": agent_fixtures.DEVICE, "publicKeyFingerprint": self.identity.fingerprint,
                "issuedAt": component_fixtures.NOW, "expiresAt": component_fixtures.NOW + 86400,
                "versions": VERSIONS.copy(),
            })
            status, _, view = self.request("POST", "/v1/device/certificate",
                                           {"certificate": certificate}, token=token)
            self.assertEqual(status, 200)
            self.assertTrue(view["deviceAuthorized"])
        return token

    def grant(self, token, **overrides):
        status, _, challenge = self.request("GET", "/v1/challenge", token=token)
        self.assertEqual(status, 200)
        payload = {"v": 1, "ownerId": agent_fixtures.OWNER_A, "deviceId": agent_fixtures.DEVICE,
                   "challenge": challenge["challenge"], "accountId": agent_fixtures.ACCOUNT,
                   "productIds": [agent_fixtures.PRODUCT], "grantId": str(uuid.uuid4()),
                   "issuedAt": component_fixtures.NOW, "expiresAt": component_fixtures.NOW + 120,
                   "entitled": True, "versions": VERSIONS.copy(), **overrides}
        return self.signer.sign(payload)

    def assert_projection(self, body):
        self.assertEqual(set(body), {"state", "bytesReceived", "totalBytes", "canPrepare"})
        self.assertIs(type(body["bytesReceived"]), int)
        self.assertIs(type(body["totalBytes"]), int)
        self.assertIs(type(body["canPrepare"]), bool)
        self.assertLessEqual(0, body["bytesReceived"])
        self.assertLessEqual(body["bytesReceived"], body["totalBytes"])

    def test_status_requires_bound_pairing_and_device_authorization(self):
        status, _, body = self.request("GET", "/v1/components/status")
        self.assertEqual((status, body["code"]), (401, "LOCAL_AUTH_REQUIRED"))
        token = self.pair(register=False)
        status, _, body = self.request("GET", "/v1/components/status", token=token)
        self.assertEqual(status, 200)
        self.assert_projection(body)
        self.assertFalse(body["canPrepare"])
        status, _, _ = self.request("GET", "/v1/components/status", token=token,
                                     origin="https://attacker.example")
        self.assertEqual(status, 403)
        status, _, _ = self.request("POST", "/v1/components/prepare",
                                     {"grant": self.signer.sign({}), "repair": False}, token=token)
        self.assertEqual(status, 403)
        self.assertEqual(self.network.requests, [])

    def test_fresh_signed_lease_installs_verified_components_without_unlocking_live(self):
        token = self.pair()
        status, _, before = self.request("GET", "/v1/components/status", token=token)
        self.assertEqual(status, 200)
        self.assert_projection(before)
        self.assertTrue(before["canPrepare"])
        grant = self.grant(token)
        status, headers, progress = self.request("POST", "/v1/components/prepare",
                                                {"grant": grant, "repair": False}, token=token)
        self.assertEqual(status, 202)
        self.assertEqual(headers["Access-Control-Allow-Origin"], agent_fixtures.ORIGIN)
        self.assert_projection(progress)
        self.agent._component_thread.join(timeout=3)
        self.assertFalse(self.agent._component_thread.is_alive())
        status, _, installed = self.request("GET", "/v1/components/status", token=token)
        self.assertEqual(status, 200)
        self.assert_projection(installed)
        self.assertEqual(installed["state"], "READY")
        self.assertFalse(installed["canPrepare"])
        self.assertGreater(installed["totalBytes"], 0)
        self.assertEqual(installed["bytesReceived"], installed["totalBytes"])
        self.assertIsNotNone(self.manager.runtime_root())
        self.assertEqual(len(self.network.requests), 3)
        self.assertEqual(self.network.requests[0][3], self.manifest_url.removeprefix(component_fixtures.ORIGIN))
        self.assertTrue(all(request[0] == "releases.example" for request in self.network.requests))
        self.assertEqual(self.network.closed, 3)
        status, _, view = self.request("GET", "/v1/status", token=token)
        self.assertEqual(status, 200)
        self.assertFalse(view["canStart"])
        self.assertEqual(self.worker.calls, [])
        status, _, _ = self.request("POST", "/v1/components/prepare",
                                     {"grant": grant, "repair": False}, token=token)
        self.assertEqual(status, 403)
        self.assertEqual(len(self.network.requests), 3)

    def test_prepare_rejects_browser_urls_commands_and_extra_fields_before_network(self):
        token = self.pair()
        valid = {"grant": self.grant(token), "repair": False}
        forbidden = ["url", "manifestUrl", "origin", "profile", "command", "args", "path", "minimumNvidiaDriver"]
        for field in forbidden:
            with self.subTest(field=field):
                status, _, body = self.request("POST", "/v1/components/prepare",
                    {**valid, field: "https://127.0.0.1/untrusted"}, token=token)
                self.assertEqual((status, body["code"]), (400, "INVALID_PREPARATION_REQUEST"))
        for body in ({"grant": valid["grant"]}, {"repair": False}, {}, [valid], "run command"):
            with self.subTest(body=type(body).__name__):
                status, _, _ = self.request("POST", "/v1/components/prepare", body, token=token)
                self.assertEqual(status, 400)
        self.assertEqual(self.network.requests, [])

    def test_prepare_repair_accepts_only_json_boolean(self):
        token = self.pair()
        grant = self.grant(token)
        for repair in (0, 1, "false", "true", None, [], {}):
            with self.subTest(repair=repair):
                status, _, body = self.request("POST", "/v1/components/prepare",
                                                {"grant": grant, "repair": repair}, token=token)
                self.assertEqual((status, body["code"]), (400, "INVALID_PREPARATION_REQUEST"))
        self.assertEqual(self.network.requests, [])

    def test_invalid_signed_leases_never_download(self):
        token = self.pair()
        for overrides in ({"ownerId": agent_fixtures.OWNER_B}, {"deviceId": str(uuid.uuid4())},
                          {"entitled": False}, {"issuedAt": component_fixtures.NOW - 121,
                                                "expiresAt": component_fixtures.NOW - 1},
                          {"versions": {**VERSIONS, "agent": "0.0.0"}},
                          {"url": "https://attacker.example/manifest.json"}):
            with self.subTest(overrides=overrides):
                status, _, _ = self.request("POST", "/v1/components/prepare",
                    {"grant": self.grant(token, **overrides), "repair": False}, token=token)
                self.assertEqual(status, 403)
        tampered = copy.deepcopy(self.grant(token))
        tampered["payload"]["accountId"] = str(uuid.uuid4())
        status, _, _ = self.request("POST", "/v1/components/prepare",
                                     {"grant": tampered, "repair": False}, token=token)
        self.assertEqual(status, 403)
        self.assertEqual(self.network.requests, [])

    def test_status_removes_private_details_and_bounds_untrusted_progress(self):
        token = self.pair()
        for raw in ({"state": "FAILED", "bytesReceived": -1, "totalBytes": 10},
                    {"state": "unknown-private-provider", "bytesReceived": True, "totalBytes": 2**50},
                    {"state": "DOWNLOADING", "bytesReceived": 999, "totalBytes": 10}):
            with self.subTest(raw=raw), patch.object(self.manager, "status", return_value={
                **raw, "path": str(self.manager.root), "key": "private-stream-key", "debug": "native traceback",
            }):
                status, _, body = self.request("GET", "/v1/components/status", token=token)
                self.assertEqual(status, 200)
                self.assert_projection(body)
                if raw["state"] != "DOWNLOADING":
                    self.assertEqual(body["state"], "ERROR")
                else:
                    self.assertEqual(body["bytesReceived"], 10)


if __name__ == "__main__":
    unittest.main()
