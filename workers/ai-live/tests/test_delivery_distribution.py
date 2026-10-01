"""Real verified distribution pipeline; only HTTPS/DNS/OS boundaries are isolated."""
from __future__ import annotations
import base64
import hashlib
import http.client
import io
import json
import socket
import ssl
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from installer.delivery import DeliveryManager
from installer.build_windows import public_configuration
from local_agent.agent import AgentConfig, AgentError, LocalAgent, VERSIONS, _Session
from local_agent.http_server import AgentHTTPServer
from local_agent.security import SecurityError, canonical_json
from local_agent.update_transport import ReleaseTransport, _PinnedHTTPSConnection, trusted_origin
from local_agent.updater import SafeUpdater
from test_delivery import bundle

ORIGIN = "https://releases.example.test"
CUSTOMER = "https://viralflow-ai-blond.vercel.app"

class Response:
    def __init__(self, data: bytes, *, status: int = 200, headers: dict | None = None):
        self.stream = io.BytesIO(data)
        self.status = status
        self.headers = {"Content-Length": str(len(data)), **(headers or {})}
    def getheader(self, name, default=None): return self.headers.get(name, default)
    def read(self, size): return self.stream.read(size)

class Connection:
    def __init__(self, response: Response):
        self.response, self.requests, self.closed = response, [], False
    def request(self, method, path, headers): self.requests.append((method, path, headers))
    def getresponse(self): return self.response
    def close(self): self.closed = True

class DistributionTests(unittest.TestCase):
    def setUp(self):
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
        self.key = Ed25519PrivateKey.generate()
        self.public = self.key.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)
        self.temp = tempfile.TemporaryDirectory()
        self.directory, self.connections = Path(self.temp.name), []
        self.root = self.directory / "LiveAgent"
        self.integrated = []
        self.delivery = DeliveryManager(self.root, integration=lambda exe: self.integrated.append(exe))
        archive, digest = bundle(self.directory, "0.2.0")
        self.previous = self.delivery.install(archive, digest)
        self.archive, self.digest = bundle(self.directory, "0.3.0")
        self.response = Response(self.archive.read_bytes())
        self.resolver = lambda *args, **kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))]
        self.transport = ReleaseTransport(ORIGIN, resolver=self.resolver, connection_factory=self.connection)
        self.updater = self.create_updater()

    def tearDown(self): self.temp.cleanup()
    def connection(self, host, address):
        self.assertEqual((host, address), ("releases.example.test", "8.8.8.8"))
        self.connections.append(Connection(self.response))
        return self.connections[-1]
    def create_updater(self, **override):
        params = dict(trusted_keys={"release-2026": self.public}, transport=self.transport,
                      installed_versions={"web": "0.2.0", "agent": "0.2.0", "worker": "0.2.0"},
                      now=lambda: 1000, delivery=self.delivery)
        params.update(override)
        return SafeUpdater(self.root, **params)
    def signed(self, **override):
        payload = {"v": 2, "issuedAt": 990, "expiresAt": 1100,
                   "versions": {name: "0.3.0" for name in ("web", "agent", "worker")},
                   "minimumVersions": {name: "0.2.0" for name in ("web", "agent", "worker")},
                   "mandatory": False, "rollbackVersion": "0.2.0",
                   "package": {"url": ORIGIN + "/viralflow/ai-live/releases/0.3.0/package.zip",
                               "sha256": self.digest, "sizeBytes": self.archive.stat().st_size}, **override}
        value = {"keyId": "release-2026", "payload": payload}
        return {**value, "signature": base64.urlsafe_b64encode(self.key.sign(canonical_json(value))).decode().rstrip("=")}

    def test_download_verify_stage_activate_no_cookie_and_cached_retry(self):
        self.updater.discover(self.signed())
        self.assertTrue(self.updater.status()["applyReady"])
        result = self.updater.deliver(confirmed=True)
        self.assertEqual(result["state"], "RESTART_REQUIRED")
        self.assertEqual(self.delivery.current()["version"], "0.3.0")
        self.assertTrue(self.delivery.verify_current())
        self.assertTrue((self.root / self.previous["release"]).is_dir())
        self.assertEqual(len(self.connections), 1)
        method, path, headers = self.connections[0].requests[0]
        self.assertEqual((method, path), ("GET", "/viralflow/ai-live/releases/0.3.0/package.zip"))
        self.assertNotIn("Cookie", headers)
        self.assertNotIn("Authorization", headers)
        self.assertTrue(self.connections[0].closed)
        self.assertNotIn("url", result)

    def test_mandatory_and_minimum_versions_block_start(self):
        for plan in (self.signed(mandatory=True), self.signed(minimumVersions={name: "0.3.0" for name in ("web", "agent", "worker")})):
            self.assertEqual(self.updater.discover(plan)["state"], "UPDATE_REQUIRED")
            self.assertFalse(self.updater.status()["canStart"])
        invalid = self.signed(minimumVersions={name: "0.4.0" for name in ("web", "agent", "worker")})
        with self.assertRaises(SecurityError): self.updater.discover(invalid)

    def test_failed_mandatory_update_blocks_real_signed_start_and_optional_retains_eligibility(self):
        from local_agent.device_identity import DeviceIdentity
        from test_device_identity_fixture import FixtureProtector
        from test_local_agent import ACCOUNT, OWNER_A, PRODUCT, REFERENCE_JPEG, RecordingWorker, supported_hardware
        import uuid
        identity = DeviceIdentity(self.root / "identity", protector=FixtureProtector())
        worker = RecordingWorker()
        agent = LocalAgent(AgentConfig(identity.device_id, "real-signed-pair", b"", self.root / "references",
                                     trusted_keys={"release-2026": self.public}),
                           device_identity=identity, worker=worker, now=lambda: 1000,
                           hardware_probe=supported_hardware, test_only_realtime_validated=True,
                           updater=self.updater)
        def sign(payload):
            value = {"keyId": "release-2026", "payload": payload}
            return {**value, "signature": base64.urlsafe_b64encode(self.key.sign(canonical_json(value))).decode().rstrip("=")}
        try:
            token = agent.pair("real-signed-pair", CUSTOMER)["token"]
            agent.install_certificate(token, CUSTOMER, sign({"v": 1, "purpose": "AI_LIVE_DEVICE_CERTIFICATE",
                "ownerId": OWNER_A, "deviceId": identity.device_id, "publicKeyFingerprint": identity.fingerprint,
                "issuedAt": 1000, "expiresAt": 2000, "versions": VERSIONS.copy()}))
            presenter = agent.upload_reference(token, CUSTOMER, REFERENCE_JPEG, "image/jpeg")["presenterId"]
            self.updater.discover(self.signed(mandatory=True))
            self.response = Response(b"x" * self.archive.stat().st_size)
            with self.assertRaises(SecurityError): self.updater.deliver(confirmed=True)
            self.assertEqual(self.updater.state, "ROLLED_BACK")
            self.assertEqual(agent.discovery()["updateStatus"], "UPDATE_REQUIRED")
            self.assertFalse(agent.status(token, CUSTOMER)["canStart"])
            challenge = agent.challenge(token, CUSTOMER)["challenge"]
            grant = sign({"v": 1, "ownerId": OWNER_A, "deviceId": identity.device_id,
                          "challenge": challenge, "accountId": ACCOUNT, "productIds": [PRODUCT],
                          "grantId": str(uuid.uuid4()), "issuedAt": 1000, "expiresAt": 1120,
                          "entitled": True, "versions": VERSIONS.copy()})
            with self.assertRaises(AgentError) as failure:
                agent.start(token, CUSTOMER, {"grant": grant, "accountId": ACCOUNT, "productIds": [PRODUCT],
                                            "presenterId": presenter, "microphoneId": None})
            self.assertEqual(failure.exception.code, "UPDATE_REQUIRED")
            self.assertEqual(worker.calls, [])
            self.updater.discover(self.signed())
            self.updater.state = "ROLLED_BACK"
            self.assertEqual(agent.discovery()["updateStatus"], "ROLLED_BACK")
            self.assertTrue(agent.status(token, CUSTOMER)["canStart"])
        finally:
            agent.close()

    def test_signature_expiry_tampering_and_retired_root_block(self):
        self.updater.discover(self.signed())
        self.updater.retired_key_ids = frozenset({"release-2026"})
        with self.assertRaises(SecurityError): self.updater.deliver(confirmed=True)
        self.assertEqual(self.connections, [])
        self.updater.retired_key_ids = frozenset()
        plan = self.signed()
        plan["keyId"] = "unknown"
        with self.assertRaises(SecurityError): self.updater.discover(plan)
        self.updater.retired_key_ids = frozenset({"release-2026"})
        with self.assertRaises(SecurityError): self.updater.discover(self.signed())
        self.updater.retired_key_ids = frozenset()
        with self.assertRaises(SecurityError): self.updater.discover(self.signed(expiresAt=999))
        plan = self.signed()
        plan["payload"]["package"]["sha256"] = "0" * 64
        with self.assertRaises(SecurityError): self.updater.discover(plan)

    def test_network_distribution_requires_signed_key_id_even_with_legacy_root(self):
        self.updater.public_key_pem = self.public
        payload = self.signed()["payload"]
        signed = {"payload": payload, "signature": base64.urlsafe_b64encode(
            self.key.sign(canonical_json(payload))).decode().rstrip("=")}
        with self.assertRaises(SecurityError): self.updater.discover(signed)
        self.assertEqual(self.connections, [])

    def test_confirmed_stopped_session_required_before_any_network(self):
        self.updater.discover(self.signed())
        for kwargs in ({}, {"confirmed": "yes"}, {"confirmed": True, "session_active": True}):
            with self.assertRaises(SecurityError): self.updater.deliver(**kwargs)
        self.assertEqual(self.connections, [])

    def test_exact_host_path_version_and_query_prevent_arbitrary_url(self):
        for url in ("http://releases.example.test/viralflow/ai-live/releases/0.3.0/package.zip",
                    ORIGIN + "/viralflow/ai-live/releases/0.3.0/package.zip?next=evil",
                    ORIGIN + "/viralflow/ai-live/releases/0.3.0/package.zip#fragment",
                    ORIGIN + "/viralflow/ai-live/releases/0.3.0/../package.zip",
                    ORIGIN + "/viralflow/ai-live/releases/0.4.0/package.zip",
                    "https://evil.example.test/viralflow/ai-live/releases/0.3.0/package.zip",
                    "https://releases.example.test:443/viralflow/ai-live/releases/0.3.0/package.zip"):
            item = self.signed()["payload"]["package"] | {"url": url}
            with self.assertRaises(SecurityError): self.updater.discover(self.signed(package=item))
        self.assertEqual(self.connections, [])

    def test_private_ip_and_mixed_dns_answers_block_connection(self):
        self.updater.discover(self.signed())
        for addresses in (["127.0.0.1"], ["10.0.0.1"], ["169.254.169.254"], ["::1"], ["8.8.8.8", "192.168.1.1"]):
            self.transport.resolver = lambda *args, **kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443)) for ip in addresses]
            with self.assertRaises(SecurityError): self.updater.deliver(confirmed=True)
        self.assertEqual(self.connections, [])
        self.assertEqual(self.delivery.current(), self.previous)

    def test_redirects_encoding_truncation_extra_bytes_and_hash_mismatch_roll_back(self):
        self.updater.discover(self.signed())
        data = self.archive.read_bytes()
        for response in (Response(data, status=302), Response(data, headers={"Content-Encoding": "gzip"}),
                         Response(data[:-1], headers={"Content-Length": str(len(data))}),
                         Response(data + b"x", headers={"Content-Length": str(len(data))}),
                         Response(b"x" * len(data))):
            self.response = response
            with self.assertRaises(SecurityError): self.updater.deliver(confirmed=True)
            self.assertEqual(self.delivery.current(), self.previous)
            self.assertEqual(list((self.root / "updates").glob("*.partial")), [])

    def test_failed_runtime_upgrade_restores_previous_pointer_and_integration(self):
        self.updater.discover(self.signed())
        def integration(exe):
            self.integrated.append(exe)
            if exe and exe.parent.name.startswith("0.3.0-"): raise RuntimeError("isolated integration failure")
        self.delivery.integration = integration
        with self.assertRaises(RuntimeError): self.updater.deliver(confirmed=True)
        self.assertEqual(self.updater.state, "ROLLED_BACK")
        self.assertEqual(self.delivery.current(), self.previous)
        self.assertTrue(self.delivery.verify_current())
        self.assertEqual(self.integrated[-1], self.delivery.executable())

    def test_verified_cache_survives_restart_repair_redownload_and_no_downgrade(self):
        self.updater.discover(self.signed())
        self.updater.deliver(confirmed=True)
        restarted = self.create_updater(installed_versions={name: "0.3.0" for name in ("web", "agent", "worker")})
        self.assertEqual(restarted.state, "CURRENT")
        self.assertTrue(restarted.status()["repairReady"])
        self.delivery.executable().write_bytes(b"corrupt")
        self.assertEqual(restarted.deliver(confirmed=True, repair=True)["state"], "RESTART_REQUIRED")
        self.assertTrue(self.delivery.verify_current())
        self.assertEqual(len(self.connections), 1)
        retired = self.create_updater(retired_key_ids=frozenset({"release-2026"}))
        self.assertIsNone(retired.manifest)

    def test_repair_refuses_wrong_release_and_expiry_during_download(self):
        self.updater.discover(self.signed())
        with self.assertRaises(SecurityError): self.updater.deliver(confirmed=True, repair=True)
        old_download = self.transport.download
        def expired_download(*args):
            path = old_download(*args)
            self.updater.now = lambda: 1200
            return path
        self.transport.download = expired_download
        with self.assertRaises(SecurityError): self.updater.deliver(confirmed=True)
        self.assertEqual(self.delivery.current(), self.previous)

    def test_tls_uses_verified_context_and_pinned_ip_with_hostname_sni(self):
        connection = _PinnedHTTPSConnection("releases.example.test", "8.8.8.8")
        self.assertEqual(connection._context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(connection._context.check_hostname)
        with patch("local_agent.update_transport.socket.create_connection") as create, patch.object(connection._context, "wrap_socket") as wrap:
            connection.connect()
            create.assert_called_once_with(("8.8.8.8", 443), 10)
            wrap.assert_called_once_with(create.return_value, server_hostname="releases.example.test")

    def test_bounded_dns_timeout_and_total_stream_deadline(self):
        self.updater.discover(self.signed())
        blocked = threading.Event()
        self.transport.resolver = lambda *args, **kwargs: blocked.wait(1)
        try:
            with patch("local_agent.update_transport.CONNECT_TIMEOUT", 0.01):
                with self.assertRaises(SecurityError): self.updater.deliver(confirmed=True)
                with self.assertRaises(SecurityError): self.updater.deliver(confirmed=True)
            self.assertEqual(self.connections, [])
        finally:
            blocked.set()
            self.transport._dns_thread.join(1)
        self.transport.resolver = self.resolver
        timestamps = iter([0, 121])
        self.transport.monotonic = lambda: next(timestamps)
        with self.assertRaises(SecurityError): self.updater.deliver(confirmed=True)
        self.assertEqual(self.delivery.current(), self.previous)

    def test_rollback_is_previous_fallback_metadata_and_never_authorizes_downgrade(self):
        with self.assertRaises(SecurityError): self.updater.discover(self.signed(rollbackVersion="0.3.0"))
        with self.assertRaises(SecurityError): self.updater.discover(self.signed(rollbackVersion="0.4.0"))
        with self.assertRaises(SecurityError): self.updater.discover(self.signed(
            versions={name: "0.1.0" for name in ("web", "agent", "worker")},
            minimumVersions={name: "0.1.0" for name in ("web", "agent", "worker")}, rollbackVersion=None,
            package=self.signed()["payload"]["package"] | {"url": ORIGIN + "/viralflow/ai-live/releases/0.1.0/package.zip"}))

    def test_public_packaging_configuration_never_accepts_private_or_extra_secrets(self):
        path = self.directory / "public.json"
        config = {"trustedKeys": {"release-2026": self.public.decode()}, "retiredKeyIds": ["old-2025"], "updateOrigin": ORIGIN}
        path.write_text(json.dumps(config))
        self.assertEqual(public_configuration(path), config)
        for invalid in (config | {"secret": "not allowed"}, config | {"trustedKeys": {"release-2026": "PRIVATE KEY"}}):
            path.write_text(json.dumps(invalid))
            with self.assertRaises((RuntimeError, ValueError)): public_configuration(path)
        for origin in ("http://x.test", "https://127.0.0.1", "https://x.test/path", "https://x.test?query", "https://user@x.test"):
            with self.assertRaises(SecurityError): trusted_origin(origin)

    def test_real_local_http_check_and_async_delivery_requires_pairing_and_blocks_duplicates(self):
        config = AgentConfig(device_id="d66c8d7f-8f3a-4603-9e84-1129b49d5f9a", pairing_code="code-12345678",
                             grant_public_key_pem=b"", data_dir=self.root / "references")
        agent = LocalAgent(config, updater=self.updater)
        server = AgentHTTPServer(agent, port=0)
        runner = threading.Thread(target=server.serve_forever, daemon=True)
        runner.start()
        def call(path, payload, token=None, origin=CUSTOMER):
            client = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=2)
            headers = {"Origin": origin, "Content-Type": "application/json"}
            if token: headers["Authorization"] = "Bearer " + token
            client.request("POST", path, json.dumps(payload), headers=headers)
            response = client.getresponse()
            result = (response.status, json.loads(response.read()))
            client.close()
            return result
        try:
            self.assertEqual(call("/v1/updates/check", {"manifest": self.signed()})[0], 401)
            token = call("/v1/pair", {"code": "code-12345678"})[1]["token"]
            self.assertEqual(call("/v1/updates/check", {"manifest": self.signed()}, token, "https://evil.test")[0], 403)
            status, data = call("/v1/updates/check", {"manifest": self.signed()}, token)
            self.assertEqual(status, 200)
            self.assertTrue(data["updateCanApply"])
            self.assertEqual(set(data), {"updateStatus", "updateCanApply", "updateCanRepair"})
            self.assertEqual(call("/v1/updates/apply", {"confirmed": False}, token)[0], 400)
            self.assertEqual(call("/v1/updates/apply", {"confirmed": True, "url": "evil"}, token)[0], 400)
            agent._sessions["isolated"] = _Session("isolated", "owner", 1100)
            self.assertEqual(call("/v1/updates/apply", {"confirmed": True}, token)[0], 409)
            agent._sessions.clear()
            self.assertEqual(call("/v1/updates/apply", {"confirmed": True}, token),
                             (202, {"updateStatus": "UPDATING", "updateCanApply": False, "updateCanRepair": False}))
            agent._update_thread.join(timeout=5)
            self.assertEqual(agent.discovery()["updateStatus"], "RESTART_REQUIRED")
            self.assertEqual(call("/v1/updates/apply", {"confirmed": True}, token)[0], 409)
            self.assertEqual(len(self.connections), 1)
            self.assertEqual(self.delivery.current()["version"], "0.3.0")
        finally:
            server.shutdown()
            runner.join(2)
            server.server_close()
            agent.close()

if __name__ == "__main__": unittest.main()
