"""Per-install proof key protected by Windows DPAPI, never stored as plaintext.

DPAPI uses the current Windows user profile and machine (not LOCAL_MACHINE).
The packaged installer supplies a fixed storage root; no HTTP path is accepted.
"""

from __future__ import annotations

import base64
import ctypes
import hashlib
import json
import os
import secrets
import threading
import uuid
from pathlib import Path
from typing import Callable, Protocol

from .security import SecurityError, canonical_json


class SecretProtector(Protocol):
    def protect(self, data: bytes) -> bytes: ...
    def unprotect(self, data: bytes) -> bytes: ...


class WindowsDPAPI:
    """Native, user-bound DPAPI with interactive prompts disabled."""

    @staticmethod
    def _transform(data: bytes, decrypt: bool) -> bytes:
        if os.name != "nt" or not data or len(data) > 64 * 1024:
            raise SecurityError("DEVICE_SECRET_UNAVAILABLE")

        class Blob(ctypes.Structure):
            _fields_ = [("cbData", ctypes.c_ulong),
                        ("pbData", ctypes.POINTER(ctypes.c_ubyte))]

        source_buffer = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
        source = Blob(len(data), source_buffer)
        output = Blob()
        crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.LocalFree.argtypes = [ctypes.c_void_p]
        kernel32.LocalFree.restype = ctypes.c_void_p
        operation = crypt32.CryptUnprotectData if decrypt else crypt32.CryptProtectData
        operation.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p,
                              ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p,
                              ctypes.c_ulong, ctypes.POINTER(Blob)]
        operation.restype = ctypes.c_int
        if not operation(ctypes.byref(source), None, None, None, None, 1,
                         ctypes.byref(output)):
            raise SecurityError("DEVICE_SECRET_UNAVAILABLE")
        try:
            return ctypes.string_at(output.pbData, output.cbData)
        finally:
            if output.pbData:
                ctypes.memset(output.pbData, 0, output.cbData)
                kernel32.LocalFree(output.pbData)
            ctypes.memset(source_buffer, 0, len(data))

    def protect(self, data: bytes) -> bytes:
        return self._transform(data, False)

    def unprotect(self, data: bytes) -> bytes:
        return self._transform(data, True)


def _safe_directory(directory: Path) -> None:
    if not directory.is_absolute():
        raise SecurityError("DEVICE_STORAGE_INVALID")
    for item in (directory, *directory.parents):
        if item.is_symlink() or (hasattr(item, "is_junction") and item.is_junction()):
            raise SecurityError("DEVICE_STORAGE_INVALID")


class DeviceIdentity:
    """Stable UUID plus Ed25519 key. Certificates are not membership authority."""

    def __init__(self, root: Path, *, protector: SecretProtector | None = None):
        _safe_directory(root)
        self.root = root
        self._protector = protector or WindowsDPAPI()
        self._lock = threading.RLock()
        self._private_key = None
        self.device_id = ""
        self.certificate: dict[str, object] | None = None
        self.revoked_at = 0
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        _safe_directory(root)
        self._load_or_create()

    def _target(self, name: str) -> Path:
        if name not in ("device.bin", "certificate.bin", "revocation.bin"):
            raise SecurityError("DEVICE_STORAGE_INVALID")
        _safe_directory(self.root)
        target = self.root / name
        if target.is_symlink() or (target.exists() and not target.is_file()):
            raise SecurityError("DEVICE_STORAGE_INVALID")
        return target

    def _write(self, name: str, value: object, *, create_only: bool = False) -> bool:
        encrypted = self._protector.protect(canonical_json(value))
        if not encrypted or len(encrypted) > 64 * 1024:
            raise SecurityError("DEVICE_SECRET_UNAVAILABLE")
        target = self._target(name)
        temporary = self.root / (name + "." + secrets.token_hex(8) + ".tmp")
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(descriptor, "wb") as output:
                output.write(encrypted)
                output.flush()
                os.fsync(output.fileno())
            _safe_directory(self.root)
            self._target(name)
            if create_only:
                try:
                    os.link(temporary, target)
                except FileExistsError:
                    return False
            else:
                os.replace(temporary, target)
            return True
        finally:
            temporary.unlink(missing_ok=True)

    def _read(self, name: str) -> object:
        target = self._target(name)
        if target.stat().st_size > 64 * 1024:
            raise SecurityError("DEVICE_STORAGE_INVALID")
        try:
            return json.loads(self._protector.unprotect(target.read_bytes()))
        except (ValueError, UnicodeDecodeError, OSError) as exc:
            raise SecurityError("DEVICE_SECRET_UNAVAILABLE") from exc

    def _load_or_create(self) -> None:
        try:
            from cryptography.hazmat.primitives import serialization
            from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        except ImportError as exc:
            raise SecurityError("SIGNATURE_VERIFIER_UNAVAILABLE") from exc
        target = self._target("device.bin")
        if target.exists():
            record = self._read("device.bin")
            try:
                if (not isinstance(record, dict) or set(record) != {"v", "deviceId", "privateKey"}
                        or type(record["v"]) is not int or record["v"] != 1):
                    raise ValueError
                device_id = str(uuid.UUID(record["deviceId"]))
                if device_id != record["deviceId"]:
                    raise ValueError
                key_bytes = base64.b64decode(record["privateKey"], validate=True)
                private_key = serialization.load_der_private_key(key_bytes, password=None)
                if not isinstance(private_key, Ed25519PrivateKey):
                    raise ValueError
            except (KeyError, TypeError, ValueError) as exc:
                # Never rotate the identity silently when a stored secret is invalid.
                raise SecurityError("DEVICE_SECRET_UNAVAILABLE") from exc
        else:
            device_id = str(uuid.uuid4())
            private_key = Ed25519PrivateKey.generate()
            key_bytes = private_key.private_bytes(serialization.Encoding.DER,
                                                  serialization.PrivateFormat.PKCS8,
                                                  serialization.NoEncryption())
            created = self._write("device.bin", {"v": 1, "deviceId": device_id,
                                                  "privateKey": base64.b64encode(key_bytes).decode("ascii")},
                                  create_only=True)
            if not created:
                self._load_or_create()
                return
        self.device_id = device_id
        self._private_key = private_key
        if self._target("certificate.bin").exists():
            certificate = self._read("certificate.bin")
            if not isinstance(certificate, dict):
                raise SecurityError("DEVICE_STORAGE_INVALID")
            self.certificate = certificate
        if self._target("revocation.bin").exists():
            record = self._read("revocation.bin")
            if (not isinstance(record, dict) or set(record) != {"revokedAt"}
                    or type(record["revokedAt"]) is not int or record["revokedAt"] < 0):
                raise SecurityError("DEVICE_STORAGE_INVALID")
            self.revoked_at = record["revokedAt"]

    @property
    def public_key_pem(self) -> str:
        from cryptography.hazmat.primitives import serialization
        return self._private_key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        ).decode("ascii")

    @property
    def fingerprint(self) -> str:
        from cryptography.hazmat.primitives import serialization
        public_der = self._private_key.public_key().public_bytes(
            serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
        return hashlib.sha256(public_der).hexdigest()

    def sign(self, payload: object) -> str:
        with self._lock:
            signature = self._private_key.sign(canonical_json(payload))
        return base64.urlsafe_b64encode(signature).rstrip(b"=").decode("ascii")

    def save_certificate(self, certificate: dict[str, object]) -> None:
        with self._lock:
            self._write("certificate.bin", certificate)
            self.certificate = certificate

    def clear_certificate(self) -> None:
        with self._lock:
            self._target("certificate.bin").unlink(missing_ok=True)
            self.certificate = None

    def mark_revoked(self, issued_at: int) -> None:
        with self._lock:
            self.revoked_at = max(self.revoked_at, issued_at)
            self._write("revocation.bin", {"revokedAt": self.revoked_at})
            self.clear_certificate()

    def cleanup(self) -> None:
        """Installer-only full cleanup of this fixed managed identity directory."""
        with self._lock:
            for name in ("device.bin", "certificate.bin", "revocation.bin"):
                self._target(name).unlink(missing_ok=True)
            self.certificate = None
