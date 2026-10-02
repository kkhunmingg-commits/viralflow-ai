"""Verified versioned installs with atomic activation and bounded rollback.

The setup application supplies a pinned archive digest; the updater supplies a
signature-verified digest. Neither receives arbitrary commands or network URLs.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import uuid
import zipfile
from pathlib import Path, PurePosixPath
from typing import Callable

MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
MAX_EXPANDED_BYTES = 512 * 1024 * 1024
MAX_FILES = 4096
MARKER = "viralflow-local-live-agent-v1"
VERSION_PATTERN = r"[0-9]+\.[0-9]+\.[0-9]+"


class DeliveryError(ValueError):
    """The GUI translates these internal codes into safe customer messages."""


def _regular_path(path: Path, boundary: Path) -> Path:
    """Reject links/junctions and prove every managed path stays inside root."""
    if ".." in path.parts or ".." in boundary.parts:
        raise DeliveryError("UNSAFE_INSTALL_PATH")
    absolute = path.absolute()
    if not absolute.is_relative_to(boundary.absolute()):
        raise DeliveryError("PATH_OUTSIDE_INSTALL")
    for current in (absolute, *absolute.parents):
        try:
            attributes = getattr(current.lstat(), "st_file_attributes", 0)
        except FileNotFoundError:
            attributes = 0
        if current.is_symlink() or attributes & 0x400:
            raise DeliveryError("UNSAFE_INSTALL_PATH")
    return absolute


def _write_json(path: Path, value: object) -> None:
    temporary = path.with_name(path.name + ".new")
    if temporary.is_symlink():
        raise DeliveryError("UNSAFE_INSTALL_PATH")
    descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(value, output, sort_keys=True, separators=(",", ":"))
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


class DeliveryManager:
    def __init__(self, root: Path, *, integration: Callable[[Path | None], None] | None = None):
        if not root.is_absolute() or root == Path(root.anchor) or root.name != "LiveAgent":
            raise DeliveryError("INVALID_INSTALL_ROOT")
        self.root = _regular_path(root, root)
        self.integration_configured = integration is not None
        self.integration = integration or (lambda _executable: None)
        self.state = "NOT_INSTALLED"
        self._read_marker()

    def _read_marker(self) -> None:
        if self.root.exists():
            marker = _regular_path(self.root / "managed.json", self.root)
            try:
                value = json.loads(marker.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                # Never claim/delete someone else's existing directory.
                if any(self.root.iterdir()):
                    raise DeliveryError("UNMANAGED_INSTALL_ROOT")
                return
            if value != {"format": MARKER}:
                raise DeliveryError("UNMANAGED_INSTALL_ROOT")
            self.state = "INSTALLED"

    def current(self) -> dict[str, object] | None:
        pointer = _regular_path(self.root / "current.json", self.root)
        if not pointer.exists():
            return None
        try:
            value = json.loads(pointer.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise DeliveryError("INVALID_INSTALL_RECORD") from exc
        if (not isinstance(value, dict) or set(value) != {"version", "release", "files"}
                or not isinstance(value["version"], str)
                or not re.fullmatch(VERSION_PATTERN, value["version"])
                or not isinstance(value["release"], str)
                or not re.fullmatch(r"releases/[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}", value["release"])
                or not isinstance(value["files"], dict)):
            raise DeliveryError("INVALID_INSTALL_RECORD")
        return value

    def executable(self) -> Path | None:
        record = self.current()
        if record is None:
            return None
        return _regular_path(self.root / str(record["release"]) / "LocalLiveAgent.exe", self.root)

    def verify_current(self) -> bool:
        record = self.current()
        if record is None:
            return False
        release = _regular_path(self.root / str(record["release"]), self.root)
        for relative, digest in record["files"].items():
            try:
                path = _regular_path(release / relative, self.root)
                if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                    return False
            except (OSError, DeliveryError):
                return False
        return True

    def _archive(self, archive: Path, expected_sha256: str) -> tuple[zipfile.ZipFile, dict[str, object]]:
        if (not archive.is_file() or archive.stat().st_size > MAX_ARCHIVE_BYTES
                or not re.fullmatch(r"[a-f0-9]{64}", expected_sha256)
                or hashlib.sha256(archive.read_bytes()).hexdigest() != expected_sha256):
            raise DeliveryError("PACKAGE_INTEGRITY_FAILED")
        package = zipfile.ZipFile(archive)
        infos = package.infolist()
        if not 1 < len(infos) <= MAX_FILES or sum(info.file_size for info in infos) > MAX_EXPANDED_BYTES:
            package.close()
            raise DeliveryError("PACKAGE_TOO_LARGE")
        names = [info.filename for info in infos]
        if len(names) != len({name.casefold() for name in names}):
            package.close()
            raise DeliveryError("DUPLICATE_PACKAGE_FILE")
        for info in infos:
            path = PurePosixPath(info.filename)
            if (path.is_absolute() or ".." in path.parts or "\\" in info.filename
                    or ":" in info.filename or info.is_dir()
                    or any(part.endswith((".", " ")) or re.fullmatch(
                        r"(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?", part) for part in path.parts)
                    or ((info.external_attr >> 16) & 0o170000) == 0o120000):
                package.close()
                raise DeliveryError("UNSAFE_PACKAGE_FILE")
        try:
            manifest = json.loads(package.read("bundle.json"))
            if (set(manifest) != {"format", "version", "files"}
                    or manifest["format"] != MARKER
                    or not re.fullmatch(VERSION_PATTERN, manifest["version"])
                    or not isinstance(manifest["files"], dict)
                    or set(names) != set(manifest["files"]) | {"bundle.json"}
                    or "LocalLiveAgent.exe" not in manifest["files"]
                    or any(not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest)
                           for digest in manifest["files"].values())):
                raise DeliveryError("INVALID_PACKAGE_MANIFEST")
        except (KeyError, ValueError, TypeError) as exc:
            package.close()
            raise DeliveryError("INVALID_PACKAGE_MANIFEST") from exc
        return package, manifest

    def install(self, archive: Path, expected_sha256: str, *, repair: bool = False,
                expected_version: str | None = None) -> dict[str, object]:
        self._read_marker()
        package, manifest = self._archive(archive, expected_sha256)
        if expected_version is not None and manifest["version"] != expected_version:
            package.close()
            raise DeliveryError("PACKAGE_VERSION_MISMATCH")
        old = self.current()
        old_version = tuple(map(int, str(old["version"]).split("."))) if old else None
        new_version = tuple(map(int, str(manifest["version"]).split(".")))
        if old_version and new_version < old_version:
            package.close()
            raise DeliveryError("DOWNGRADE_NOT_ALLOWED")
        if old and old["version"] == manifest["version"] and self.verify_current() and not repair:
            package.close()
            self.state = "CURRENT"
            return old
        self.root.mkdir(parents=True, exist_ok=True)
        if not (self.root / "managed.json").exists():
            _write_json(self.root / "managed.json", {"format": MARKER})
        releases = _regular_path(self.root / "releases", self.root)
        releases.mkdir(exist_ok=True)
        release_name = f"{manifest['version']}-{uuid.uuid4().hex[:12]}"
        staged = _regular_path(releases / release_name, self.root)
        staged.mkdir()
        self.state = "UPDATING" if old else "INSTALLING"
        promoted = False
        try:
            for relative, digest in manifest["files"].items():
                data = package.read(relative)
                if hashlib.sha256(data).hexdigest() != digest:
                    raise DeliveryError("PACKAGE_INTEGRITY_FAILED")
                target = _regular_path(staged / relative, self.root)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
            record = {"version": manifest["version"], "release": f"releases/{release_name}",
                      "files": manifest["files"]}
            # Runtime import/self-test callback + exact OS integration before activation.
            self.integration(staged / "LocalLiveAgent.exe")
            _write_json(self.root / "current.json", record)
            promoted = True
            self.state = "RESTART_REQUIRED" if old else "INSTALLED"
            return record
        except BaseException:
            self.state = "ROLLED_BACK" if old else "INSTALL_FAILED"
            try:
                self.integration(self.root / str(old["release"]) / "LocalLiveAgent.exe" if old else None)
            except Exception:
                # Preserve the original failure; current.json still points at old release.
                pass
            raise
        finally:
            package.close()
            if not promoted:
                shutil.rmtree(_regular_path(staged, self.root))

    def uninstall(self) -> None:
        self._read_marker()
        if not self.root.exists():
            self.state = "NOT_INSTALLED"
            return
        self.integration(None)
        # The signed component catalog identifies runtime/model files exactly;
        # foreign files in its cache or release trees survive uninstall.
        from local_agent.components import remove_managed_components
        remove_managed_components(_regular_path(self.root / "components", self.root))
        # Remove only this application's known managed children; unknown files stay.
        for name in ("releases", "references", "identity", "updates", "worker", "live-credentials"):
            target = _regular_path(self.root / name, self.root)
            if target.exists():
                for child in target.rglob("*"):
                    _regular_path(child, self.root)
                shutil.rmtree(target)
        for name in ("current.json", "managed.json", "config.json", "maintenance.exe"):
            _regular_path(self.root / name, self.root).unlink(missing_ok=True)
        self.state = "NOT_INSTALLED"
