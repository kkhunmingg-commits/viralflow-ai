"""Signed release plans and confirmed transactional delivery, never browser URLs."""
from __future__ import annotations
import json
import re
import time
from pathlib import Path
from typing import Callable, Mapping
from urllib.parse import urlsplit
from installer.delivery import DeliveryManager, MAX_ARCHIVE_BYTES, _regular_path, _write_json
from .security import SecurityError, canonical_json, verify_ed25519, verify_signed_envelope
from .update_transport import ReleaseTransport, validate_release_url

VERSION = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")

def version_tuple(value: str) -> tuple[int, ...]:
    if not isinstance(value, str) or not VERSION.fullmatch(value):
        raise SecurityError("INVALID_UPDATE_MANIFEST")
    return tuple(map(int, value.split(".")))

def component_versions(value: object, *, lockstep: bool) -> dict[str, str]:
    if not isinstance(value, dict) or set(value) != {"web", "agent", "worker"}:
        raise SecurityError("INVALID_UPDATE_MANIFEST")
    for item in value.values():
        version_tuple(item)
    if lockstep and len(set(value.values())) != 1:
        raise SecurityError("INVALID_UPDATE_MANIFEST")
    return value

class SafeUpdater:
    def __init__(self, root: Path, public_key_pem: bytes = b"", *,
                 allowed_hosts: frozenset[str] = frozenset(), installed_versions: dict[str, str],
                 trusted_keys: Mapping[str, bytes] | None = None,
                 retired_key_ids: frozenset[str] = frozenset(), update_origin: str | None = None,
                 verifier: Callable[[bytes, bytes, bytes], None] = verify_ed25519,
                 now: Callable[[], float] = time.time, delivery: DeliveryManager | None = None,
                 transport: ReleaseTransport | None = None):
        self.root, self.public_key_pem = root, public_key_pem
        self.trusted_keys, self.retired_key_ids = dict(trusted_keys or {}), retired_key_ids
        self.allowed_hosts, self.installed_versions = allowed_hosts, installed_versions.copy()
        self.verifier, self.now = verifier, now
        self.delivery = delivery or DeliveryManager(root)
        self.transport = transport or (ReleaseTransport(update_origin) if update_origin else None)
        self.manifest: dict[str, object] | None = None
        self.state = "NOT_CONFIGURED" if self.transport is None else "CURRENT"
        self._signed: dict[str, object] | None = None
        self._load_cached_plan()

    def _load_cached_plan(self) -> None:
        # Public cached metadata retains no authority without a current signature.
        path = _regular_path(self.root / "updates" / "manifest.json", self.root)
        if not path.exists():
            return
        try:
            if path.is_file() and path.stat().st_size <= 32 * 1024:
                self.discover(json.loads(path.read_text(encoding="utf-8")), persist=False)
        except (OSError, ValueError, SecurityError):
            self.manifest, self._signed = None, None

    def discover(self, signed: object, *, persist: bool = True) -> dict[str, object]:
        if not (self.public_key_pem or self.trusted_keys) or not (self.allowed_hosts or self.transport):
            raise SecurityError("UPDATE_TRUST_NOT_CONFIGURED")
        payload = verify_signed_envelope(signed, self.public_key_pem, trusted_keys=self.trusted_keys,
                                        retired_key_ids=self.retired_key_ids, verifier=self.verifier)
        if payload.get("v") == 2 and set(signed) != {"payload", "signature", "keyId"}:
            raise SecurityError("UPDATE_SIGNING_KEY_ID_REQUIRED")
        legacy = payload.get("v") == 1
        expected = {"v", "issuedAt", "expiresAt", "versions", "package"}
        if not legacy:
            expected |= {"minimumVersions", "mandatory", "rollbackVersion"}
        if (set(payload) != expected or type(payload.get("v")) is not int or payload["v"] not in (1, 2)
                or type(payload.get("issuedAt")) is not int or type(payload.get("expiresAt")) is not int
                or payload["issuedAt"] > self.now() + 30 or payload["expiresAt"] <= self.now()
                or not 0 < payload["expiresAt"] - payload["issuedAt"] <= 7 * 86400):
            raise SecurityError("INVALID_UPDATE_MANIFEST")
        versions = component_versions(payload["versions"], lockstep=True)
        if not legacy:
            minimum = component_versions(payload["minimumVersions"], lockstep=True)
            rollback = payload["rollbackVersion"]
            if (type(payload["mandatory"]) is not bool
                    or any(version_tuple(minimum[name]) > version_tuple(versions[name]) for name in minimum)
                    or rollback is not None and version_tuple(rollback) >= version_tuple(versions["agent"])):
                raise SecurityError("INVALID_UPDATE_MANIFEST")
        item = payload["package"]
        if (not isinstance(item, dict) or set(item) != {"url", "sha256", "sizeBytes"}
                or not isinstance(item.get("url"), str) or not isinstance(item.get("sha256"), str)
                or not re.fullmatch(r"[a-f0-9]{64}", item["sha256"])
                or type(item.get("sizeBytes")) is not int or not 0 < item["sizeBytes"] <= MAX_ARCHIVE_BYTES):
            raise SecurityError("INVALID_UPDATE_MANIFEST")
        if self.transport and not legacy:
            validate_release_url(item["url"], self.transport.origin, versions["agent"])
        elif legacy and self.transport is None:
            # Legacy offline fixture plans can never enter network distribution.
            try:
                parsed = urlsplit(item["url"])
                allowed = (parsed.scheme == "https" and parsed.hostname in self.allowed_hosts
                           and parsed.port in (None, 443) and not parsed.username and not parsed.password
                           and not parsed.fragment and not parsed.query
                           and parsed.path == "/viralflow/ai-live/releases/" + versions["agent"] + ".zip")
            except ValueError:
                allowed = False
            if not allowed:
                raise SecurityError("UPDATE_URL_NOT_ALLOWED")
        else:
            raise SecurityError("UPDATE_DISTRIBUTION_NOT_CONFIGURED")
        old = self.installed_versions.get("agent", "0.0.0")
        if version_tuple(versions["agent"]) < version_tuple(old):
            raise SecurityError("UPDATE_DOWNGRADE_NOT_ALLOWED")
        self.manifest, self._signed = json.loads(canonical_json(payload)), json.loads(canonical_json(signed))
        changed = any(self.installed_versions.get(name) != value for name, value in versions.items())
        mandatory = not legacy and (payload["mandatory"] or any(
            version_tuple(self.installed_versions.get(name, "0.0.0")) < version_tuple(minimum[name]) for name in minimum))
        self.state = "UPDATE_REQUIRED" if changed and mandatory else "AVAILABLE" if changed else "CURRENT"
        if persist and self.transport is not None:
            directory = _regular_path(self.root / "updates", self.root)
            directory.mkdir(exist_ok=True)
            _write_json(directory / "manifest.json", self._signed)
        return self.status()

    def validate_operation(self, *, confirmed: bool, session_active: bool, repair: bool = False) -> None:
        if confirmed is not True:
            raise SecurityError("UPDATE_CONFIRMATION_REQUIRED")
        if session_active:
            raise SecurityError("STOP_LIVE_BEFORE_UPDATE")
        valid_states = ("CURRENT", "AVAILABLE", "UPDATE_REQUIRED", "ROLLED_BACK") if repair else ("AVAILABLE", "UPDATE_REQUIRED", "ROLLED_BACK")
        if self.manifest is None or self.state not in valid_states:
            raise SecurityError("NO_VERIFIED_UPDATE")
        self._reverify_plan()
        if not self.delivery.integration_configured:
            raise SecurityError("UPDATE_INTEGRATION_REQUIRED")
        if self.manifest["expiresAt"] <= self.now():
            raise SecurityError("UPDATE_MANIFEST_EXPIRED")
        if repair:
            current = self.delivery.current()
            if not current or current["version"] != self.manifest["versions"]["agent"]:
                raise SecurityError("REPAIR_PACKAGE_VERSION_MISMATCH")

    def _reverify_plan(self) -> None:
        payload = verify_signed_envelope(self._signed, self.public_key_pem,
                                        trusted_keys=self.trusted_keys, retired_key_ids=self.retired_key_ids,
                                        verifier=self.verifier)
        if canonical_json(payload) != canonical_json(self.manifest):
            raise SecurityError("UPDATE_PLAN_CHANGED")

    def _install(self, archive: Path, *, repair: bool) -> dict[str, object]:
        self._reverify_plan()
        item = self.manifest["package"]
        if not archive.is_file() or archive.stat().st_size != item["sizeBytes"]:
            raise SecurityError("UPDATE_PACKAGE_INVALID")
        if self.manifest["expiresAt"] <= self.now():
            raise SecurityError("UPDATE_MANIFEST_EXPIRED")
        self.delivery.install(archive, item["sha256"], repair=repair,
                              expected_version=self.manifest["versions"]["agent"])
        self.state = "RESTART_REQUIRED"
        return self.status()

    def apply(self, archive: Path, *, confirmed: bool = False, session_active: bool = False) -> dict[str, object]:
        self.validate_operation(confirmed=confirmed, session_active=session_active)
        self.state = "UPDATING"
        try:
            return self._install(archive, repair=False)
        except BaseException:
            self.state = "ROLLED_BACK"
            raise

    def deliver(self, *, confirmed: bool = False, session_active: bool = False,
                repair: bool = False, prevalidated: bool = False) -> dict[str, object]:
        if not prevalidated:
            self.validate_operation(confirmed=confirmed, session_active=session_active, repair=repair)
        if self.transport is None or self.manifest is None or self.manifest["v"] != 2:
            raise SecurityError("UPDATE_DISTRIBUTION_NOT_CONFIGURED")
        self.state = "UPDATING"
        try:
            archive = self.transport.download(self.manifest["package"], self.manifest["versions"]["agent"], self.root / "updates")
            return self._install(archive, repair=repair)
        except BaseException:
            self.state = "ROLLED_BACK"
            raise

    def status(self) -> dict[str, object]:
        valid = self.manifest is not None and self.manifest["expiresAt"] > self.now()
        current = self.delivery.current()
        return {"state": self.state, "updateAvailable": self.state in ("AVAILABLE", "UPDATE_REQUIRED"),
                "restartRequired": self.state == "RESTART_REQUIRED",
                "canStart": self.state in ("NOT_CONFIGURED", "CURRENT") or
                            self.state in ("AVAILABLE", "ROLLED_BACK") and not self.requires_update(),
                "serverConfigured": bool((self.public_key_pem or self.trusted_keys) and self.transport),
                "applyReady": bool(valid and self.transport and self.delivery.integration_configured
                                   and self.state in ("AVAILABLE", "UPDATE_REQUIRED", "ROLLED_BACK")),
                "repairReady": bool(valid and self.transport and self.delivery.integration_configured
                                    and self.state in ("CURRENT", "ROLLED_BACK") and current
                                    and current["version"] == self.manifest["versions"]["agent"])}

    def requires_update(self) -> bool:
        if self.manifest is None:
            return False
        if self.manifest["v"] == 1:
            return self.state in ("AVAILABLE", "ROLLED_BACK")
        changed = any(self.installed_versions.get(name) != value for name, value in self.manifest["versions"].items())
        return bool(changed and self.manifest["mandatory"] or any(
            version_tuple(self.installed_versions.get(name, "0.0.0")) < version_tuple(value)
            for name, value in self.manifest["minimumVersions"].items()))
