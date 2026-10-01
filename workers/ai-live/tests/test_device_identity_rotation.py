"""Pinned signing-ring migration and authenticated key-id contract tests."""
from __future__ import annotations

import base64
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from local_agent.agent import AgentConfig, AgentError, LocalAgent, VERSIONS
from local_agent.device_identity import DeviceIdentity
from local_agent.security import SecurityError, canonical_json, verify_device_message, verify_grant, verify_signed_envelope
from test_device_identity_fixture import FixtureProtector
from test_local_agent import ACCOUNT, DEVICE, ORIGIN, OWNER_A, OWNER_B, PRODUCT, supported_hardware


def public_pem(key):
    return key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)


def envelope(payload, key, key_id=None):
    signed_bytes = canonical_json(payload if key_id is None else {"keyId": key_id, "payload": payload})
    result = {"payload": payload, "signature": base64.urlsafe_b64encode(key.sign(signed_bytes)).rstrip(b"=").decode()}
    if key_id is not None:
        result["keyId"] = key_id
    return result


class KeyRingRotationTests(unittest.TestCase):
    def setUp(self):
        self.old, self.new = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
        self.ring = {"old-2026": public_pem(self.old), "new-2026": public_pem(self.new)}
        self.payload = {"v": 2, "message": "verified release", "issuedAt": 1000}

    def test_active_old_new_keys_verify_during_explicit_trusted_overlap(self):
        for key, key_id in ((self.old, "old-2026"), (self.new, "new-2026")):
            self.assertEqual(verify_signed_envelope(envelope(self.payload, key, key_id), trusted_keys=self.ring), self.payload)

    def test_unknown_retired_ids_and_omitted_id_downgrade_do_not_fallback(self):
        cases = [
            (envelope(self.payload, self.old, "unknown"), frozenset(), "UNKNOWN_SIGNING_KEY"),
            (envelope(self.payload, self.old, "old-2026"), frozenset({"old-2026"}), "SIGNING_KEY_RETIRED"),
            (envelope(self.payload, self.old), frozenset({"old-2026"}), "LEGACY_SIGNING_KEY_RETIRED"),
        ]
        for signed, retired, expected in cases:
            with self.subTest(code=expected), self.assertRaises(SecurityError) as denied:
                verify_signed_envelope(signed, public_pem(self.old), trusted_keys=self.ring, retired_key_ids=retired)
            self.assertEqual(denied.exception.code, expected)
        with self.assertRaises(SecurityError):
            verify_signed_envelope(envelope(self.payload, self.old), trusted_keys=self.ring)

    def test_key_id_is_signed_even_if_two_installed_ids_share_a_key_and_keys_cannot_arrive_in_payload(self):
        signed = envelope(self.payload, self.old, "old-2026")
        with self.assertRaises(SecurityError) as tampered:
            verify_signed_envelope({**signed, "keyId": "alias"},
                                   trusted_keys={**self.ring, "alias": public_pem(self.old)})
        self.assertEqual(tampered.exception.code, "INVALID_SIGNATURE")
        with self.assertRaises(SecurityError):
            verify_signed_envelope({**signed, "publicKey": public_pem(self.old).decode()}, trusted_keys=self.ring)
        altered = {**signed, "payload": {**signed["payload"], "message": "tampered"}}
        with self.assertRaises(SecurityError):
            verify_signed_envelope(altered, trusted_keys=self.ring)

    def test_explicit_single_key_legacy_migration_and_grants_use_same_normal_boundary(self):
        self.assertEqual(verify_signed_envelope(envelope(self.payload, self.old), public_pem(self.old)), self.payload)
        grant_payload = {"v": 1, "ownerId": OWNER_A, "deviceId": DEVICE, "challenge": "A" * 43,
                         "accountId": ACCOUNT, "productIds": [PRODUCT], "grantId": str(uuid.uuid4()),
                         "issuedAt": 1000, "expiresAt": 1120, "entitled": True, "versions": VERSIONS.copy()}
        grant = verify_grant(envelope(grant_payload, self.new, "new-2026"), b"", now=1000, trusted_keys=self.ring)
        self.assertEqual(grant.owner_id, OWNER_A)
        certificate = {"v": 1, "purpose": "AI_LIVE_DEVICE_CERTIFICATE", "ownerId": OWNER_A, "deviceId": DEVICE,
                       "publicKeyFingerprint": "a" * 64, "issuedAt": 1000, "expiresAt": 2000, "versions": VERSIONS.copy()}
        verified = verify_device_message(envelope(certificate, self.new, "new-2026"), b"",
                                         purpose="AI_LIVE_DEVICE_CERTIFICATE", now=1000, trusted_keys=self.ring)
        self.assertEqual(verified, certificate)

    @unittest.skipUnless(shutil.which("node"), "Cross-language signer requires Node")
    def test_node_keyed_canonical_signature_verifies_in_python(self):
        source = r"""
const {generateKeyPairSync,sign}=require('node:crypto');
const fs=require('node:fs'); const payload=JSON.parse(fs.readFileSync(0,'utf8'));
function sorted(x){return Array.isArray(x)?x.map(sorted):x!==null&&typeof x==='object'?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,sorted(v)])):x;}
const {publicKey,privateKey}=generateKeyPairSync('ed25519');const keyId='node-modern-2026';
const bytes=Buffer.from(JSON.stringify(sorted({keyId,payload})),'utf8');
const signature=sign(null,bytes,privateKey).toString('base64url');
process.stdout.write(JSON.stringify({signed:{payload,keyId,signature},publicKey:publicKey.export({type:'spki',format:'pem'})}));
"""
        # Keep the Node fixture explicit and never print its generated key material.
        process = subprocess.run([shutil.which("node"), "-e", source], input=json.dumps(self.payload),
                                 text=True, capture_output=True, timeout=10, check=True, shell=False)
        result = json.loads(process.stdout)
        self.assertEqual(verify_signed_envelope(result["signed"], trusted_keys={
            "node-modern-2026": result["publicKey"].encode("ascii")}), self.payload)


class DeviceBindingRotationTests(unittest.TestCase):
    def test_owner_continuity_survives_rotation_but_old_certificate_never_authorizes_start(self):
        old, new = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
        with tempfile.TemporaryDirectory() as directory:
            protector = FixtureProtector()
            identity = DeviceIdentity(Path(directory) / "identity", protector=protector)
            agent = LocalAgent(AgentConfig(identity.device_id, "rotation-pairing", public_pem(old),
                                          Path(directory) / "references"), device_identity=identity,
                               now=lambda: 1000, hardware_probe=supported_hardware)
            token = str(agent.pair("rotation-pairing", ORIGIN)["token"])
            certificate = {"v": 1, "purpose": "AI_LIVE_DEVICE_CERTIFICATE", "ownerId": OWNER_A,
                           "deviceId": identity.device_id, "publicKeyFingerprint": identity.fingerprint,
                           "issuedAt": 1000, "expiresAt": 2000, "versions": VERSIONS.copy()}
            agent.install_certificate(token, ORIGIN, envelope(certificate, old))
            agent.close()
            restored = DeviceIdentity(identity.root, protector=protector)
            self.assertEqual(restored.bound_owner, OWNER_A)
            config = AgentConfig(restored.device_id, "rotation-next-pair", b"", Path(directory) / "next-references",
                                 trusted_keys={"new-2026": public_pem(new)}, retired_key_ids=frozenset({"old-2026"}))
            rotated = LocalAgent(config, device_identity=restored, now=lambda: 1001, hardware_probe=supported_hardware)
            self.addCleanup(rotated.close)
            paired = str(rotated.pair("rotation-next-pair", ORIGIN)["token"])
            self.assertFalse(rotated.status(paired, ORIGIN)["deviceAuthorized"])
            self.assertFalse(rotated.status(paired, ORIGIN)["canStart"])
            challenge = {"v": 1, "purpose": "AI_LIVE_DEVICE_REGISTER", "ownerId": OWNER_B, "deviceId": restored.device_id,
                         "challengeId": str(uuid.uuid4()), "nonce": "B" * 43, "issuedAt": 1001, "expiresAt": 1121,
                         "versions": VERSIONS.copy()}
            with self.assertRaises(AgentError):
                rotated.device_proof(paired, ORIGIN, envelope(challenge, new, "new-2026"))
            challenge["ownerId"] = OWNER_A
            rotated.device_proof(paired, ORIGIN, envelope(challenge, new, "new-2026"))
            rotated.install_certificate(paired, ORIGIN, envelope({**certificate, "issuedAt": 1001, "expiresAt": 2001}, new, "new-2026"))
            self.assertTrue(rotated.status(paired, ORIGIN)["deviceAuthorized"])
            self.assertFalse(rotated.status(paired, ORIGIN)["canStart"])
            restored.mark_revoked(1002)
            self.assertIsNone(restored.bound_owner)


if __name__ == "__main__":
    unittest.main()
