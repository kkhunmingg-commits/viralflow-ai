"""Fixture keys for normal device-registration boundaries, never app fallback."""
from __future__ import annotations

import base64
from pathlib import Path

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from local_agent.device_identity import DeviceIdentity
from local_agent.security import canonical_json


class FixtureProtector:
    def __init__(self):
        self._cipher = Fernet(Fernet.generate_key())

    def protect(self, data: bytes) -> bytes:
        return self._cipher.encrypt(data)

    def unprotect(self, data: bytes) -> bytes:
        return self._cipher.decrypt(data)


def registered_identity_fixture(root: Path, device_id: str) -> DeviceIdentity:
    root.mkdir(parents=True, exist_ok=True)
    protector = FixtureProtector()
    key = Ed25519PrivateKey.generate()
    private_der = key.private_bytes(serialization.Encoding.DER,
                                    serialization.PrivateFormat.PKCS8,
                                    serialization.NoEncryption())
    (root / "device.bin").write_bytes(protector.protect(canonical_json({
        "v": 1, "deviceId": device_id,
        "privateKey": base64.b64encode(private_der).decode("ascii"),
    })))
    return DeviceIdentity(root, protector=protector)
