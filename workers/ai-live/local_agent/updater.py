"""Explicitly confirmed, signed offline update delivery; no update server yet."""

from __future__ import annotations

import re
import json
import time
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit

from installer.delivery import DeliveryManager, MAX_ARCHIVE_BYTES
from .security import SecurityError, _decode_base64url, canonical_json, verify_ed25519


class SafeUpdater:
    def __init__(self, root: Path, public_key_pem: bytes, *,
                 allowed_hosts: frozenset[str], installed_versions: dict[str, str],
                 verifier: Callable[[bytes, bytes, bytes], None] = verify_ed25519,
                 now: Callable[[], float] = time.time,
                 delivery: DeliveryManager | None = None):
        self.root = root
        self.public_key_pem = public_key_pem
        self.allowed_hosts = allowed_hosts
        self.installed_versions = installed_versions.copy()
        self.verifier = verifier
        self.now = now
        self.delivery = delivery or DeliveryManager(root)
        self.manifest: dict[str, object] | None = None
        self.state = "NOT_CONFIGURED"

    def discover(self, signed: object) -> dict[str, object]:
        if not self.public_key_pem or not self.allowed_hosts:
            raise SecurityError("UPDATE_TRUST_NOT_CONFIGURED")
        if (not isinstance(signed, dict) or set(signed) != {"payload", "signature"}
                or not isinstance(signed.get("payload"), dict)):
            raise SecurityError("INVALID_UPDATE_MANIFEST")
        payload = signed["payload"]
        signature = _decode_base64url(signed["signature"])
        if len(signature) != 64:
            raise SecurityError("INVALID_UPDATE_MANIFEST")
        self.verifier(canonical_json(payload), signature, self.public_key_pem)
        if (set(payload) != {"v", "issuedAt", "expiresAt", "versions", "package"}
                or type(payload.get("v")) is not int or payload["v"] != 1
                or type(payload.get("issuedAt")) is not int
                or type(payload.get("expiresAt")) is not int
                or payload["issuedAt"] > self.now() + 30
                or payload["expiresAt"] <= self.now()
                or not 0 < payload["expiresAt"] - payload["issuedAt"] <= 7 * 86400):
            raise SecurityError("INVALID_UPDATE_MANIFEST")
        versions = payload["versions"]
        if (not isinstance(versions, dict) or set(versions) != {"web", "agent", "worker"}
                or any(not isinstance(value, str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", value)
                       for value in versions.values()) or len(set(versions.values())) != 1):
            raise SecurityError("INVALID_UPDATE_MANIFEST")
        item = payload["package"]
        if (not isinstance(item, dict) or set(item) != {"url", "sha256", "sizeBytes"}
                or not isinstance(item.get("url"), str)
                or not isinstance(item.get("sha256"), str)
                or not re.fullmatch(r"[a-f0-9]{64}", item["sha256"])
                or type(item.get("sizeBytes")) is not int
                or not 0 < item["sizeBytes"] <= MAX_ARCHIVE_BYTES):
            raise SecurityError("INVALID_UPDATE_MANIFEST")
        try:
            parsed = urlsplit(item["url"])
            allowed = (parsed.scheme == "https" and parsed.hostname in self.allowed_hosts
                       and parsed.port in (None, 443) and parsed.username is None
                       and parsed.password is None and not parsed.fragment
                       and parsed.path.startswith("/viralflow/ai-live/releases/"))
        except ValueError:
            allowed = False
        if not allowed:
            raise SecurityError("UPDATE_URL_NOT_ALLOWED")
        old = self.installed_versions.get("agent", "0.0.0")
        if tuple(map(int, versions["agent"].split("."))) < tuple(map(int, old.split("."))):
            raise SecurityError("UPDATE_DOWNGRADE_NOT_ALLOWED")
        # Keep an immutable-by-alias snapshot of the verified bytes. A caller
        # mutating its input after verification must not change the update plan.
        self.manifest = json.loads(canonical_json(payload))
        self.state = "AVAILABLE" if any(self.installed_versions.get(name) != version
                                         for name, version in versions.items()) else "CURRENT"
        return self.status()

    def apply(self, archive: Path, *, confirmed: bool = False, session_active: bool = False) -> dict[str, object]:
        if not confirmed:
            raise SecurityError("UPDATE_CONFIRMATION_REQUIRED")
        if session_active:
            raise SecurityError("STOP_LIVE_BEFORE_UPDATE")
        if self.manifest is None or self.state != "AVAILABLE":
            raise SecurityError("NO_VERIFIED_UPDATE")
        if not self.delivery.integration_configured:
            # Production delivery must provide the same packaged-runtime check
            # and exact OS integration transaction as setup. Do not pretend that
            # writing a pointer alone constitutes a complete runnable upgrade.
            raise SecurityError("UPDATE_INTEGRATION_REQUIRED")
        if self.manifest["expiresAt"] <= self.now():
            raise SecurityError("UPDATE_MANIFEST_EXPIRED")
        item = self.manifest["package"]
        if not archive.is_file() or archive.stat().st_size != item["sizeBytes"]:
            raise SecurityError("UPDATE_PACKAGE_INVALID")
        self.state = "UPDATING"
        try:
            self.delivery.install(archive, item["sha256"],
                                  expected_version=self.manifest["versions"]["agent"])
            self.state = "RESTART_REQUIRED"
        except BaseException:
            self.state = "ROLLED_BACK"
            raise
        return self.status()

    def status(self) -> dict[str, object]:
        return {"state": self.state, "updateAvailable": self.state == "AVAILABLE",
                "restartRequired": self.state == "RESTART_REQUIRED",
                "canStart": self.state in ("NOT_CONFIGURED", "CURRENT"),
                "serverConfigured": bool(self.public_key_pem and self.allowed_hosts),
                "applyReady": self.delivery.integration_configured}
