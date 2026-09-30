from __future__ import annotations

import http.client
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from local_agent.agent import AgentConfig, LocalAgent, VERSIONS  # noqa: E402
from local_agent.http_server import AgentHTTPServer, MAX_CONCURRENT_CLIENTS  # noqa: E402
from test_local_agent import (  # noqa: E402
    ACCOUNT, DEVICE, ORIGIN, OWNER_A, PRODUCT, REFERENCE_JPEG, TEST_KEY,
    RecordingWorker, signed, supported_hardware, test_signature,
)


class LoopbackHTTPTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.clock = [1000.0]
        self.worker = RecordingWorker()
        config = AgentConfig(DEVICE, "one-time-code-123", TEST_KEY,
                             Path(self.temp.name) / "references")
        self.agent = LocalAgent(config, worker=self.worker,
                                hardware_probe=supported_hardware,
                                grant_signature_verifier=test_signature,
                                now=lambda: self.clock[0])
        self.server = AgentHTTPServer(self.agent, port=0)
        self.port = self.server.server_port
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.closed = False
        self.addCleanup(self.close_server)

    def close_server(self) -> None:
        if self.closed:
            return
        self.closed = True
        self.server.shutdown()
        self.thread.join(timeout=3)
        self.server.server_close()
        self.agent.close()

    def request(self, method: str, path: str, body: bytes | None = None,
                *, origin: str = ORIGIN, token: str | None = None,
                headers: dict[str, str] | None = None) -> tuple[int, dict[str, str], dict[str, object]]:
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        sent = {"Origin": origin, **(headers or {})}
        if token is not None:
            sent["Authorization"] = f"Bearer {token}"
        connection.request(method, path, body=body, headers=sent)
        response = connection.getresponse()
        data = response.read()
        result = (response.status, dict(response.getheaders()), json.loads(data) if data else {})
        connection.close()
        return result

    @staticmethod
    def json_body(value: object) -> bytes:
        return json.dumps(value, separators=(",", ":")).encode()

    def pair(self) -> str:
        status, _, body = self.request("POST", "/v1/pair",
                                       self.json_body({"code": "one-time-code-123"}),
                                       headers={"Content-Type": "application/json"})
        self.assertEqual(status, 200)
        self.assertEqual(body["deviceId"], DEVICE)
        self.assertGreater(body["expiresAt"], self.clock[0])
        return str(body["token"])

    def test_agent_absent_and_server_is_loopback_only(self) -> None:
        self.assertEqual(self.server.server_address[0], "127.0.0.1")
        status, _, discovery = self.request("GET", "/v1/discovery")
        self.assertEqual(status, 200)
        self.assertEqual(discovery["versions"], VERSIONS)
        self.assertFalse(discovery["paired"])
        # Once the companion exits, the same loopback port has no agent.
        self.close_server()
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=0.3)
        with self.assertRaises(OSError):
            connection.request("GET", "/v1/discovery", headers={"Origin": ORIGIN})
            connection.getresponse()
        connection.close()

    def test_local_api_auth_pairing_and_customer_projection(self) -> None:
        status, _, body = self.request("GET", "/v1/status")
        self.assertEqual((status, body["code"]), (401, "LOCAL_AUTH_REQUIRED"))
        token = self.pair()
        status, headers, view = self.request("GET", "/v1/status", token=token)
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)
        self.assertTrue(view["paired"])
        self.assertFalse(view["canStart"])
        self.assertEqual(view["state"], "STARTING")
        status, _, hardware = self.request("GET", "/v1/hardware", token=token)
        self.assertEqual(status, 200)
        self.assertEqual(hardware["machineStatus"]["state"], "กำลังเตรียม")
        self.assertNotIn("CUDA", json.dumps(hardware, ensure_ascii=False))
        status, _, challenge = self.request("GET", "/v1/challenge", token=token)
        self.assertEqual(status, 200)
        self.assertEqual(len(challenge["challenge"]), 43)
        status, _, renewed = self.request("POST", "/v1/renew", token=token)
        self.assertEqual(status, 200)
        self.assertNotEqual(renewed["token"], token)
        status, _, old = self.request("GET", "/v1/status", token=token)
        self.assertEqual((status, old["code"]), (401, "LOCAL_AUTH_REQUIRED"))

    def test_exact_host_origin_preflight_and_token_origin_binding(self) -> None:
        status, headers, body = self.request("GET", "/v1/discovery",
                                             headers={"Host": "evil.example"})
        self.assertEqual((status, body["code"]), (403, "HOST_DENIED"))
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        status, headers, body = self.request("GET", "/v1/discovery",
                                             origin="https://evil.example")
        self.assertEqual((status, body["code"]), (403, "ORIGIN_DENIED"))
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        status, headers, _ = self.request("OPTIONS", "/v1/status", headers={
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization,content-type",
            "Access-Control-Request-Private-Network": "true",
        })
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Private-Network"], "true")
        token = self.pair()
        status, _, body = self.request("GET", "/v1/status", token=token,
                                       origin="http://localhost:3000")
        self.assertEqual((status, body["code"]), (401, "LOCAL_AUTH_REQUIRED"))

    def test_reference_upload_and_start_stays_closed_without_gpu_validation(self) -> None:
        token = self.pair()
        status, _, uploaded = self.request("POST", "/v1/references", REFERENCE_JPEG,
                                           token=token, headers={"Content-Type": "image/jpeg"})
        self.assertEqual(status, 201)
        status, _, issued = self.request("GET", "/v1/challenge", token=token)
        self.assertEqual(status, 200)
        grant = signed({
            "v": 1, "ownerId": OWNER_A, "deviceId": DEVICE,
            "challenge": issued["challenge"], "accountId": ACCOUNT,
            "productIds": [PRODUCT], "grantId": "ffffffff-ffff-4fff-8fff-ffffffffffff",
            "issuedAt": 1000, "expiresAt": 1120, "entitled": True,
            "versions": VERSIONS.copy(),
        })
        status, _, result = self.request("POST", "/v1/sessions/start",
                                          self.json_body({"grant": grant, "accountId": ACCOUNT,
                                                          "productIds": [PRODUCT],
                                                          "presenterId": uploaded["presenterId"],
                                                          "microphoneId": None}),
                                          token=token,
                                          headers={"Content-Type": "application/json"})
        self.assertEqual((status, result["code"]), (503, "GPU_VALIDATION_REQUIRED"))
        self.assertEqual(self.worker.calls, [])

    def test_start_rejects_extra_commands_before_grant_verification(self) -> None:
        token = self.pair()
        status, _, result = self.request("POST", "/v1/sessions/start",
                                          self.json_body({"grant": {}, "accountId": ACCOUNT,
                                                          "productIds": [PRODUCT],
                                                          "presenterId": "ffffffff-ffff-4fff-8fff-ffffffffffff",
                                                          "microphoneId": None,
                                                          "command": "anything"}),
                                          token=token,
                                          headers={"Content-Type": "application/json"})
        self.assertEqual((status, result["code"]), (400, "INVALID_START_REQUEST"))

    def test_slow_body_times_out(self) -> None:
        with patch("local_agent.http_server.SOCKET_TIMEOUT_SECONDS", 0.1), \
             patch("local_agent.http_server.BODY_DEADLINE_SECONDS", 0.2):
            connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
            connection.putrequest("POST", "/v1/pair")
            connection.putheader("Origin", ORIGIN)
            connection.putheader("Content-Type", "application/json")
            connection.putheader("Content-Length", "100")
            connection.endheaders()
            response = connection.getresponse()
            self.assertEqual(response.status, 408)
            connection.close()

    def test_concurrent_connections_are_bounded(self) -> None:
        for _ in range(MAX_CONCURRENT_CLIENTS):
            self.assertTrue(self.server._client_slots.acquire(blocking=False))
        try:
            try:
                status, _, _ = self.request("GET", "/v1/discovery")
                self.assertEqual(status, 503)
            except OSError:
                # Windows can reset a just-rejected socket before the client
                # reads the short 503 response. Both outcomes are fail-closed.
                pass
        finally:
            for _ in range(MAX_CONCURRENT_CLIENTS):
                self.server._client_slots.release()


if __name__ == "__main__":
    unittest.main()
