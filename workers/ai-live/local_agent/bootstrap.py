"""Signed, allowlisted installer/update plan; no network or command execution."""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit

from .security import SecurityError, _decode_base64url, canonical_json, verify_ed25519

ARTIFACT_FILES = {
    "agent": "agent.bundle",
    "worker": "worker.bundle",
    "ffmpeg": "ffmpeg.bundle",
    "model": "model.bundle",
}
MAX_STAGED_BYTES = 64 * 1024 * 1024  # large models need a future streaming installer


@dataclass(frozen=True)
class Artifact:
    name: str
    version: str
    url: str
    sha256: str
    size_bytes: int


class BootstrapManager:
    def __init__(self, root: Path, public_key_pem: bytes, *,
                 allowed_hosts: frozenset[str],
                 verifier: Callable[[bytes, bytes, bytes], None] = verify_ed25519):
        if not root.is_absolute() or root.is_symlink():
            raise ValueError("Installer root must be an absolute, non-symlink path")
        self.root = root
        self.public_key_pem = public_key_pem
        self.allowed_hosts = allowed_hosts
        self.verifier = verifier
        self.artifacts: dict[str, Artifact] = {}
        self.state = "NOT_INSTALLED"
        self.last_error: str | None = None

    def load_manifest(self, signed: object) -> dict[str, Artifact]:
        if (not isinstance(signed, dict) or set(signed) != {"payload", "signature"}
                or not isinstance(signed.get("payload"), dict)):
            raise SecurityError("INVALID_INSTALL_MANIFEST")
        payload = signed["payload"]
        signature = _decode_base64url(signed.get("signature"))
        if len(signature) != 64:
            raise SecurityError("INVALID_INSTALL_MANIFEST")
        self.verifier(canonical_json(payload), signature, self.public_key_pem)
        if (set(payload) != {"v", "artifacts"} or type(payload.get("v")) is not int
                or payload["v"] != 1 or not isinstance(payload.get("artifacts"), list)):
            raise SecurityError("INVALID_INSTALL_MANIFEST")
        artifacts: dict[str, Artifact] = {}
        for item in payload["artifacts"]:
            if not isinstance(item, dict):
                raise SecurityError("INVALID_INSTALL_MANIFEST")
            if set(item) != {"name", "version", "url", "sha256", "sizeBytes"}:
                raise SecurityError("INVALID_INSTALL_MANIFEST")
            name = item.get("name")
            version = item.get("version")
            url = item.get("url")
            digest = item.get("sha256")
            size = item.get("sizeBytes")
            if (name not in ARTIFACT_FILES or name in artifacts
                    or not isinstance(version, str) or not version or len(version) > 64
                    or not isinstance(url, str) or not isinstance(digest, str)
                    or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest)
                    or type(size) is not int or not 0 < size <= 40 * 1024 ** 3):
                raise SecurityError("INVALID_INSTALL_MANIFEST")
            try:
                parsed = urlsplit(url)
                url_allowed = (parsed.scheme == "https" and parsed.hostname in self.allowed_hosts
                               and parsed.username is None and parsed.password is None
                               and parsed.port in (None, 443) and not parsed.fragment
                               and parsed.path.startswith("/viralflow/ai-live/"))
            except ValueError:
                url_allowed = False
            if not url_allowed:
                raise SecurityError("INSTALL_URL_NOT_ALLOWED")
            artifacts[name] = Artifact(name, version, url, digest, size)
        if not artifacts:
            raise SecurityError("INVALID_INSTALL_MANIFEST")
        self.artifacts = artifacts
        self.state = "INSTALLING"
        return artifacts.copy()

    def _target(self, name: str) -> Path:
        if name not in ARTIFACT_FILES:
            raise SecurityError("INVALID_ARTIFACT")
        if self.root.is_symlink():
            raise SecurityError("INSTALL_ROOT_CHANGED")
        target = self.root / ARTIFACT_FILES[name]
        if target.is_symlink():
            raise SecurityError("INSTALL_TARGET_CHANGED")
        return target

    def stage_verified_bytes(self, name: str, content: bytes) -> None:
        """Called by the trusted installer after its fixed URL fetch completes.

        This is intentionally not exposed through the loopback API. Large model
        transfer and executable installation are deferred until GPU validation.
        """
        item = self.artifacts.get(name)
        if item is None:
            raise SecurityError("INVALID_ARTIFACT")
        if (len(content) != item.size_bytes or len(content) > MAX_STAGED_BYTES
                or hashlib.sha256(content).hexdigest() != item.sha256):
            raise SecurityError("ARTIFACT_HASH_MISMATCH")
        self.root.mkdir(parents=True, exist_ok=True)
        target = self._target(name)
        temporary = self.root / (ARTIFACT_FILES[name] + ".staging")
        if temporary.is_symlink():
            raise SecurityError("INSTALL_TARGET_CHANGED")
        if temporary.exists():
            if not temporary.is_file():
                raise SecurityError("INSTALL_TARGET_CHANGED")
            temporary.unlink()
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(descriptor, "wb") as output:
                output.write(content)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
        self.state = "READY" if not self.repair_needed() else "INSTALLING"

    def repair_needed(self) -> list[str]:
        missing = []
        for name, item in self.artifacts.items():
            target = self._target(name)
            try:
                if (not target.is_file() or target.stat().st_size != item.size_bytes
                        or hashlib.sha256(target.read_bytes()).hexdigest() != item.sha256):
                    missing.append(name)
            except OSError:
                missing.append(name)
        return missing

    def status(self) -> dict[str, object]:
        missing = self.repair_needed()
        dependencies_present = {"worker", "ffmpeg"}.issubset(self.artifacts) and not any(
            name in missing for name in ("worker", "ffmpeg"))
        first_run_complete = {"agent", "worker", "ffmpeg"}.issubset(self.artifacts) and not missing
        return {
            "state": self.state,
            "firstRunComplete": first_run_complete,
            "dependencyStatus": "READY" if dependencies_present else "REQUIRED",
            "modelDownloadStatus": "READY" if "model" in self.artifacts and "model" not in missing else "PENDING",
            "updateStatus": "REQUIRED" if self.state == "UPDATE_REQUIRED" else "CURRENT",
            "repairAvailable": bool(missing),
            "missingArtifacts": missing,
        }

    def check_updates(self, installed_versions: dict[str, str]) -> list[str]:
        """Compare only names from the verified manifest; never fetch a URL."""
        updates = [name for name, artifact in self.artifacts.items()
                   if installed_versions.get(name) != artifact.version]
        if updates:
            self.state = "UPDATE_REQUIRED"
        return updates

    def uninstall_cleanup(self) -> None:
        """Remove only fixed managed artifact names; caller handles OS uninstall."""
        for name in ARTIFACT_FILES:
            self._target(name).unlink(missing_ok=True)
            temporary = self.root / (ARTIFACT_FILES[name] + ".staging")
            if temporary.is_symlink():
                raise SecurityError("INSTALL_TARGET_CHANGED")
            temporary.unlink(missing_ok=True)
        self.artifacts.clear()
        self.state = "NOT_INSTALLED"
