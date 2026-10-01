"""Actual Ed25519 device identity and signed server registration boundary."""
from __future__ import annotations

import base64
import json
import os
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from local_agent.agent import AgentConfig, AgentError, LocalAgent, VERSIONS
from local_agent.device_identity import DeviceIdentity, WindowsDPAPI
from local_agent.security import SecurityError, canonical_json, verify_ed25519
from test_device_identity_fixture import FixtureProtector
from test_local_agent import (ACCOUNT, ORIGIN, OWNER_A, OWNER_B, PRODUCT,
                              REFERENCE_JPEG, RecordingWorker, supported_hardware)


class DeviceIdentityTests(unittest.TestCase):
    def test_key_and_uuid_survive_reload_without_plaintext_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            protector = FixtureProtector()
            original = DeviceIdentity(root, protector=protector)
            original_id, original_key = original.device_id, original.public_key_pem
            original.save_certificate({"payload": {"public": "certificate"}, "signature": "test"})
            restored = DeviceIdentity(root, protector=protector)
            self.assertEqual(restored.device_id, original_id)
            self.assertEqual(restored.public_key_pem, original_key)
            self.assertEqual(restored.certificate, original.certificate)
            payload = {"deviceId": original_id, "message": "proof"}
            signature = base64.urlsafe_b64decode(restored.sign(payload) + "==")
            verify_ed25519(canonical_json(payload), signature, original_key.encode("ascii"))
            encrypted = (root / "device.bin").read_bytes()
            self.assertNotIn(original_id.encode("ascii"), encrypted)
            self.assertNotIn(b"privateKey", encrypted)
            self.assertFalse(any(item.name.endswith(".tmp") for item in root.iterdir()))

    @unittest.skipUnless(os.name == "nt", "DPAPI requires Windows")
    def test_real_windows_dpapi_first_run_and_tamper_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            original = DeviceIdentity(root)
            restored = DeviceIdentity(root)
            self.assertEqual(restored.device_id, original.device_id)
            self.assertEqual(restored.public_key_pem, original.public_key_pem)
            raw = (root / "device.bin").read_bytes()
            self.assertNotIn(b"privateKey", raw)
            (root / "device.bin").write_bytes(b"corrupt encrypted identity")
            with self.assertRaises(SecurityError) as denied:
                DeviceIdentity(root)
            self.assertEqual(denied.exception.code, "DEVICE_SECRET_UNAVAILABLE")
            # A corrupt install is not silently rotated to a new device.
            self.assertEqual((root / "device.bin").read_bytes(), b"corrupt encrypted identity")

    def test_cleanup_removes_managed_identity_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            identity = DeviceIdentity(root, protector=FixtureProtector())
            (root / "unmanaged.txt").write_text("keep", encoding="utf-8")
            identity.save_certificate({"payload": {}, "signature": "test"})
            identity.mark_revoked(1000)
            identity.cleanup()
            self.assertEqual([path.name for path in root.iterdir()], ["unmanaged.txt"])

    def test_non_absolute_storage_and_wrong_windows_profile_fail_closed(self):
        with self.assertRaises(SecurityError):
            DeviceIdentity(Path("relative"))
        if os.name != "nt":
            with self.assertRaises(SecurityError):
                WindowsDPAPI().protect(b"never plaintext fallback")


class DeviceRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.clock = [1000.0]
        self.cloud_key = Ed25519PrivateKey.generate()
        self.cloud_public = self.cloud_key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        self.identity = DeviceIdentity(Path(self.temp.name) / "identity", protector=FixtureProtector())
        self.worker = RecordingWorker()
        self.agent = self.make_agent()
        self.addCleanup(self.agent.close)
        self.token = str(self.agent.pair("registration-code", ORIGIN)["token"])

    def make_agent(self, *, identity=True, key=True, update="CURRENT"):
        config = AgentConfig(self.identity.device_id, "registration-code",
                             self.cloud_public if key else b"", Path(self.temp.name) / "references")
        return LocalAgent(config, device_identity=self.identity if identity else None,
                          hardware_probe=supported_hardware, worker=self.worker,
                          now=lambda: self.clock[0], test_only_realtime_validated=True,
                          update_status=lambda: update)

    def signed(self, payload):
        return {"payload": payload,
                "signature": base64.urlsafe_b64encode(self.cloud_key.sign(canonical_json(payload))).rstrip(b"=").decode()}

    def challenge(self, **changes):
        return self.signed({"v": 1, "purpose": "AI_LIVE_DEVICE_REGISTER",
                            "ownerId": OWNER_A, "deviceId": self.identity.device_id,
                            "challengeId": str(uuid.uuid4()), "nonce": "A" * 43,
                            "issuedAt": int(self.clock[0]), "expiresAt": int(self.clock[0]) + 120,
                            "versions": VERSIONS.copy(), **changes})

    def certificate(self, **changes):
        return self.signed({"v": 1, "purpose": "AI_LIVE_DEVICE_CERTIFICATE",
                            "ownerId": OWNER_A, "deviceId": self.identity.device_id,
                            "publicKeyFingerprint": self.identity.fingerprint,
                            "issuedAt": int(self.clock[0]), "expiresAt": int(self.clock[0]) + 86400,
                            "versions": VERSIONS.copy(), **changes})

    def register(self):
        proof = self.agent.device_proof(self.token, ORIGIN, self.challenge())
        verify_ed25519(canonical_json(proof["payload"]),
                       base64.urlsafe_b64decode(proof["signature"] + "=="),
                       proof["publicKey"].encode("ascii"))
        result = self.agent.install_certificate(self.token, ORIGIN, self.certificate())
        self.assertTrue(result["deviceAuthorized"])
        return result

    def test_registration_binds_owner_and_lease_proves_current_device(self):
        self.assertFalse(self.agent.status(self.token, ORIGIN)["deviceAuthorized"])
        self.register()
        challenge = self.agent.challenge(self.token, ORIGIN)
        proof = challenge["deviceProof"]
        self.assertEqual(proof["payload"]["purpose"], "AI_LIVE_LEASE_REQUEST")
        self.assertEqual(proof["payload"]["challenge"], challenge["challenge"])
        self.assertEqual(proof["payload"]["deviceId"], self.identity.device_id)
        verify_ed25519(canonical_json(proof["payload"]),
                       base64.urlsafe_b64decode(proof["signature"] + "=="),
                       self.identity.public_key_pem.encode("ascii"))

    def test_proof_rejects_invalid_signature_replay_expiry_device_user_and_version(self):
        original = self.challenge()
        tampered = {"payload": {**original["payload"], "ownerId": OWNER_B}, "signature": original["signature"]}
        cases = [(tampered, "INVALID_SIGNATURE"),
                 (self.challenge(expiresAt=999), "DEVICE_MESSAGE_EXPIRED"),
                 (self.challenge(deviceId=str(uuid.uuid4())), "DEVICE_NOT_REGISTERED"),
                 (self.challenge(versions={**VERSIONS, "agent": "9.0.0"}), "UPDATE_REQUIRED")]
        for request, code in cases:
            with self.subTest(code=code), self.assertRaises(AgentError) as denied:
                self.agent.device_proof(self.token, ORIGIN, request)
            self.assertEqual(denied.exception.code, code)
        self.agent.device_proof(self.token, ORIGIN, original)
        with self.assertRaises(AgentError) as replay:
            self.agent.device_proof(self.token, ORIGIN, original)
        self.assertEqual(replay.exception.code, "DEVICE_CHALLENGE_REPLAY")
        self.register()
        with self.assertRaises(AgentError) as wrong_user:
            self.agent.device_proof(self.token, ORIGIN, self.challenge(ownerId=OWNER_B))
        self.assertEqual(wrong_user.exception.code, "OWNER_MISMATCH")

    def test_wrong_certificate_key_or_owner_not_authorized(self):
        with self.assertRaises(AgentError):
            self.agent.install_certificate(self.token, ORIGIN, self.certificate(publicKeyFingerprint="0" * 64))
        self.register()
        with self.assertRaises(AgentError) as wrong_user:
            self.agent.install_certificate(self.token, ORIGIN, self.certificate(ownerId=OWNER_B))
        self.assertEqual(wrong_user.exception.code, "OWNER_MISMATCH")

    def test_revoke_requires_server_receipt_clears_identity_and_blocks_replay(self):
        self.register()
        old_certificate = self.identity.certificate
        challenge = self.agent.challenge(self.token, ORIGIN)["challenge"]
        reference = self.agent.upload_reference(self.token, ORIGIN, REFERENCE_JPEG, "image/jpeg")
        grant = self.signed({"v": 1, "ownerId": OWNER_A, "deviceId": self.identity.device_id,
                             "challenge": challenge, "accountId": ACCOUNT, "productIds": [PRODUCT],
                             "grantId": str(uuid.uuid4()), "issuedAt": 1000, "expiresAt": 1120,
                             "entitled": True, "versions": VERSIONS.copy()})
        self.agent.start(self.token, ORIGIN, {"grant": grant, "accountId": ACCOUNT,
                                            "productIds": [PRODUCT], "presenterId": reference["presenterId"],
                                            "microphoneId": None})
        with self.assertRaises(AgentError):
            self.agent.revoke_device(self.token, ORIGIN, {"deviceId": self.identity.device_id})
        receipt = self.signed({"v": 1, "purpose": "AI_LIVE_DEVICE_REVOKED", "ownerId": OWNER_A,
                               "deviceId": self.identity.device_id, "issuedAt": 1000, "expiresAt": 1120})
        self.assertFalse(self.agent.revoke_device(self.token, ORIGIN, receipt)["deviceAuthorized"])
        self.assertIsNone(self.identity.certificate)
        self.assertIn(("stop", OWNER_A), self.worker.calls)
        self.assertFalse(self.agent.status(self.token, ORIGIN)["sessionActive"])
        with self.assertRaises(AgentError) as replay:
            self.agent.install_certificate(self.token, ORIGIN, old_certificate)
        self.assertEqual(replay.exception.code, "DEVICE_NOT_REGISTERED")
        with self.assertRaises(AgentError):
            self.agent.challenge(self.token, ORIGIN)
        self.clock[0] = 1001
        self.register()

    def test_expired_certificate_refresh_same_owner_only(self):
        self.register()
        self.clock[0] = 87401
        # Pairing needs renewal; tests exercise a newly paired browser token.
        from local_agent.security import Pairing
        self.agent._pairings._tokens[self.token] = Pairing(ORIGIN, 89000, OWNER_A)
        self.assertFalse(self.agent.status(self.token, ORIGIN)["deviceAuthorized"])
        with self.assertRaises(AgentError):
            self.agent.device_proof(self.token, ORIGIN, self.challenge(ownerId=OWNER_B))
        self.register()

    def test_fresh_pairing_can_revoke_persisted_expired_certificate_only_for_signed_owner(self):
        self.register()
        old_certificate = self.identity.certificate
        self.agent.close()
        self.clock[0] = 87401
        restored = DeviceIdentity(self.identity.root, protector=self.identity._protector)
        config = AgentConfig(restored.device_id, "new-pairing-code", self.cloud_public,
                             Path(self.temp.name) / "references-after-restart")
        restarted = LocalAgent(config, device_identity=restored,
                               hardware_probe=supported_hardware, worker=self.worker,
                               now=lambda: self.clock[0])
        self.addCleanup(restarted.close)
        token = str(restarted.pair("new-pairing-code", ORIGIN)["token"])
        self.assertFalse(restarted.status(token, ORIGIN)["deviceAuthorized"])
        wrong_owner = self.signed({"v": 1, "purpose": "AI_LIVE_DEVICE_REVOKED", "ownerId": OWNER_B,
                                   "deviceId": restored.device_id, "issuedAt": 87401, "expiresAt": 87521})
        with self.assertRaises(AgentError) as denied:
            restarted.revoke_device(token, ORIGIN, wrong_owner)
        self.assertEqual(denied.exception.code, "OWNER_MISMATCH")
        self.assertIsNotNone(restored.certificate)
        receipt = self.signed({"v": 1, "purpose": "AI_LIVE_DEVICE_REVOKED", "ownerId": OWNER_A,
                               "deviceId": restored.device_id, "issuedAt": 87401, "expiresAt": 87521})
        result = restarted.revoke_device(token, ORIGIN, receipt)
        self.assertFalse(result["deviceAuthorized"])
        self.assertFalse(result["canStart"])
        self.assertIsNone(restored.certificate)
        with self.assertRaises(AgentError):
            restarted.install_certificate(token, ORIGIN, old_certificate)

    def test_no_identity_or_pinned_server_key_cannot_register_or_start(self):
        for identity, key in ((False, True), (True, False)):
            agent = self.make_agent(identity=identity, key=key)
            self.addCleanup(agent.close)
            token = str(agent.pair("registration-code", ORIGIN)["token"])
            self.assertFalse(agent.status(token, ORIGIN)["canStart"])
            with self.assertRaises(AgentError):
                agent.device_proof(token, ORIGIN, self.challenge())
            with self.assertRaises(AgentError):
                agent.start(token, ORIGIN, {})

    def test_expired_membership_signed_lease_blocks_registered_device(self):
        self.register()
        challenge = self.agent.challenge(self.token, ORIGIN)["challenge"]
        reference = self.agent.upload_reference(self.token, ORIGIN, REFERENCE_JPEG, "image/jpeg")
        grant = self.signed({"v": 1, "ownerId": OWNER_A, "deviceId": self.identity.device_id,
                             "challenge": challenge, "accountId": ACCOUNT, "productIds": [PRODUCT],
                             "grantId": str(uuid.uuid4()), "issuedAt": 1000, "expiresAt": 1120,
                             "entitled": False, "versions": VERSIONS.copy()})
        with self.assertRaises(AgentError) as denied:
            self.agent.start(self.token, ORIGIN, {"grant": grant, "accountId": ACCOUNT,
                                                  "productIds": [PRODUCT], "presenterId": reference["presenterId"],
                                                  "microphoneId": None})
        self.assertEqual(denied.exception.code, "ENTITLEMENT_REQUIRED")
        self.assertFalse(self.worker.calls)

    def test_update_required_blocks_registered_machine(self):
        self.register()
        self.agent._update_status = lambda: "RESTART_REQUIRED"
        view = self.agent.status(self.token, ORIGIN)
        self.assertEqual(view["updateStatus"], "RESTART_REQUIRED")
        self.assertEqual(view["state"], "UPDATE_REQUIRED")
        self.assertFalse(view["canStart"])


if __name__ == "__main__":
    unittest.main()
