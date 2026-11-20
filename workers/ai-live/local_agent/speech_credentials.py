"""Owner's LIVE Lite cloud-voice key, encrypted at rest with Windows DPAPI.

The key never goes into environment variables, logs, the browser API or the
repository. Only the worker process of the same Windows user can decrypt it.
Metadata returned to callers says whether a key exists, never the key itself.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import threading
from pathlib import Path

from .device_identity import SecretProtector, WindowsDPAPI, _safe_directory
from .security import SecurityError, canonical_json

PROVIDERS = ("azure",)
_REGION = re.compile(r"^[a-z0-9]{3,40}$")
_KEY = re.compile(r"^[A-Za-z0-9]{32,128}$")


def default_root() -> Path:
    base = os.getenv("LOCALAPPDATA") or str(Path.home() / ".local" / "share")
    return Path(base) / "ViralFlow" / "lite-speech"


class SpeechKeyStore:
    def __init__(self, root: Path | None = None, *, protector: SecretProtector | None = None):
        self.root = Path(root) if root else default_root()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        _safe_directory(self.root)
        self._protector = protector or WindowsDPAPI()
        self._lock = threading.Lock()

    @property
    def _target(self) -> Path:
        target = self.root / "speech-key.bin"
        if target.is_symlink() or (target.exists() and not target.is_file()):
            raise SecurityError("SPEECH_KEY_STORAGE_INVALID")
        return target

    def put(self, provider: str, key: str, region: str) -> None:
        if provider not in PROVIDERS or not _KEY.fullmatch(key or "") or not _REGION.fullmatch(region or ""):
            raise SecurityError("SPEECH_KEY_INVALID")
        encrypted = self._protector.protect(canonical_json({"v": 1, "provider": provider, "key": key,
                                                            "region": region}))
        with self._lock:
            temporary = self.root / ("speech-" + secrets.token_hex(8) + ".tmp")
            descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            try:
                with os.fdopen(descriptor, "wb") as output:
                    output.write(encrypted)
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary, self._target)
            finally:
                temporary.unlink(missing_ok=True)

    def load(self) -> dict[str, str] | None:
        with self._lock:
            target = self._target
            if not target.exists():
                return None
            if target.stat().st_size > 64 * 1024:
                raise SecurityError("SPEECH_KEY_STORAGE_INVALID")
            try:
                record = json.loads(self._protector.unprotect(target.read_bytes()))
            except (ValueError, SecurityError):
                raise SecurityError("SPEECH_KEY_UNAVAILABLE") from None
        if (not isinstance(record, dict) or record.get("v") != 1 or record.get("provider") not in PROVIDERS
                or not _KEY.fullmatch(str(record.get("key"))) or not _REGION.fullmatch(str(record.get("region")))):
            raise SecurityError("SPEECH_KEY_UNAVAILABLE")
        return {"provider": record["provider"], "key": record["key"], "region": record["region"]}

    def metadata(self) -> dict[str, object]:
        try:
            record = self.load()
        except SecurityError:
            return {"configured": False, "error": "SPEECH_KEY_UNAVAILABLE"}
        return {"configured": record is not None,
                **({"provider": record["provider"], "region": record["region"]} if record else {})}

    def delete(self) -> None:
        with self._lock:
            self._target.unlink(missing_ok=True)
