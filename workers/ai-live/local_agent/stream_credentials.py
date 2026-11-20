"""User-bound DPAPI storage for owner/account-bound LIVE publish credentials.

Only trusted local agent code calls load(); browser responses use metadata().
No plaintext fallback, cloud schema, or platform credential discovery exists.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import threading
from pathlib import Path

from direct_stream import StreamError, validate_transport
from .device_identity import SecretProtector, WindowsDPAPI, _safe_directory
from .security import SecurityError, canonical_json


class StreamCredentialStore:
    def __init__(self, root: Path, *, protector: SecretProtector | None = None):
        _safe_directory(root)
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        _safe_directory(root)
        self.root = root
        self._protector = protector or WindowsDPAPI()
        self._lock = threading.RLock()

    @staticmethod
    def _identifier(value: str) -> str:
        if not isinstance(value, str) or not value or len(value) > 256 or any(ord(c) < 33 for c in value):
            raise SecurityError("STREAM_OWNER_INVALID")
        return value

    def _target(self, account: str) -> Path:
        self._identifier(account)
        _safe_directory(self.root)
        target = self.root / ("stream-" + hashlib.sha256(account.encode()).hexdigest() + ".bin")
        if target.is_symlink() or (target.exists() and not target.is_file()):
            raise SecurityError("STREAM_STORAGE_INVALID")
        return target

    def _read(self, target: Path) -> dict[str, object]:
        if target.stat().st_size > 64 * 1024:
            raise SecurityError("STREAM_STORAGE_INVALID")
        try:
            value = json.loads(self._protector.unprotect(target.read_bytes()))
            if not isinstance(value, dict) or set(value) != {"v", "owner", "account", "server_url", "stream_key"} or value["v"] != 1:
                raise ValueError
            self._identifier(value["owner"])
            self._identifier(value["account"])
            validate_transport(value["server_url"], value["stream_key"])
            return value
        except (OSError, ValueError, TypeError, UnicodeDecodeError) as exc:
            raise SecurityError("STREAM_SECRET_UNAVAILABLE") from exc

    @staticmethod
    def _authorize(value: dict[str, object], owner: str, account: str) -> None:
        if (not hmac.compare_digest(value["owner"].encode(), owner.encode())
                or not hmac.compare_digest(value["account"].encode(), account.encode())):
            raise SecurityError("STREAM_OWNER_MISMATCH")

    def put(self, owner: str, account: str, server_url: str, stream_key: str) -> None:
        self._identifier(owner)
        try:
            validate_transport(server_url, stream_key)
        except StreamError as exc:
            raise SecurityError(exc.code) from exc
        with self._lock:
            target = self._target(account)
            if target.exists():
                self._authorize(self._read(target), owner, account)
            encrypted = self._protector.protect(canonical_json({"v": 1, "owner": owner, "account": account,
                "server_url": server_url, "stream_key": stream_key}))
            if not encrypted or len(encrypted) > 64 * 1024:
                raise SecurityError("STREAM_SECRET_UNAVAILABLE")
            temporary = self.root / ("stream-" + secrets.token_hex(16) + ".tmp")
            descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            try:
                with os.fdopen(descriptor, "wb") as output:
                    output.write(encrypted)
                    output.flush()
                    os.fsync(output.fileno())
                self._target(account)
                os.replace(temporary, target)
            finally:
                temporary.unlink(missing_ok=True)

    def load(self, owner: str, account: str) -> dict[str, str] | None:
        self._identifier(owner)
        with self._lock:
            target = self._target(account)
            if not target.exists():
                return None
            record = self._read(target)
            self._authorize(record, owner, account)
            return {"server_url": record["server_url"], "stream_key": record["stream_key"]}

    def metadata(self, owner: str, account: str) -> dict[str, object]:
        credentials = self.load(owner, account)
        # Deliberately no URL, key, token, host, or command in HTTP-safe metadata.
        return {"configured": credentials is not None, "account_id": account}

    def delete(self, owner: str, account: str) -> None:
        self._identifier(owner)
        with self._lock:
            target = self._target(account)
            if target.exists():
                self._authorize(self._read(target), owner, account)
                target.unlink()

    def revoke_owner(self, owner: str) -> None:
        self._identifier(owner)
        with self._lock:
            _safe_directory(self.root)
            for target in self.root.glob("stream-*.bin"):
                if target.is_symlink():
                    raise SecurityError("STREAM_STORAGE_INVALID")
                record = self._read(target)
                if hmac.compare_digest(record["owner"].encode(), owner.encode()):
                    target.unlink()
