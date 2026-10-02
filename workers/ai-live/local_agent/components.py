"""Signed, resumable managed runtime/model delivery; no execution or licensing.

Only the installed trust roots and pinned public release origin supply authority.
Partial archives are never runtime roots. Both required components activate as
one release after complete archive and expanded-file verification.
"""
from __future__ import annotations

import hashlib
import http.client
import json
import os
import re
import shutil
import socket
import threading
import time
import uuid
import zipfile
from pathlib import Path, PurePosixPath
from typing import Callable, Mapping
from urllib.parse import urlsplit

from installer.delivery import DeliveryError, _regular_path
from .security import SecurityError, canonical_json, verify_ed25519, verify_signed_envelope
from .update_transport import CHUNK_BYTES, ReleaseTransport, trusted_origin

COMPONENT_CHUNK_BYTES = 4 * 1024 * 1024
MAX_ARCHIVE_BYTES = 40 * 1024 ** 3
MAX_EXPANDED_BYTES = 64 * 1024 ** 3
MAX_PROFILE_BYTES = 128 * 1024 ** 3
MAX_MANIFEST_BYTES = 16 * 1024 * 1024
MAX_FILES = 40000
MAX_CHUNKS = 16384
DOWNLOAD_TIMEOUT = 6 * 3600
PROFILES = frozenset({"cpu-dev", "nvidia"})
REQUIRED_COMPONENTS = frozenset({"runtime", "models"})
MARKER = {"format": "viralflow-managed-components-v1"}
VERSION = r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
HASH = re.compile(r"[a-f0-9]{64}")
ETAG = re.compile(r'"[\x21\x23-\x7e]{1,200}"')


def _safe(path: Path, root: Path) -> Path:
    try:
        return _regular_path(path, root)
    except DeliveryError as exc:
        raise SecurityError("COMPONENT_PATH_INVALID") from exc


def _atomic_json(path: Path, value: object, root: Path) -> None:
    path = _safe(path, root)
    temporary = _safe(path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp"), root)
    descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(canonical_json(value))
            output.flush()
            os.fsync(output.fileno())
        _safe(path, root)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _hash_file(path: Path, cancel=None) -> str:
    hashed = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(CHUNK_BYTES), b""):
            if cancel and cancel.is_set():
                raise SecurityError("COMPONENT_DOWNLOAD_INTERRUPTED")
            hashed.update(block)
    return hashed.hexdigest()


def _relative(value: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 240:
        raise SecurityError("COMPONENT_FILE_INVALID")
    path = PurePosixPath(value)
    if (path.is_absolute() or str(path) != value or ".." in path.parts
            or "\\" in value or ":" in value or any(ord(c) < 32 for c in value)
            or any(part.endswith((".", " ")) or re.fullmatch(
                r"(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?", part) for part in path.parts)):
        raise SecurityError("COMPONENT_FILE_INVALID")
    return value


def _version(value: object) -> tuple[int, ...]:
    if not isinstance(value, str) or not re.fullmatch(VERSION, value) or len(value) > 32:
        raise SecurityError("COMPONENT_MANIFEST_INVALID")
    return tuple(map(int, value.split(".")))


def _release_identity(payload: dict[str, object]) -> str:
    """Renewing a signature lifetime cannot change the immutable artifacts."""
    content = {key: payload[key] for key in ("v", "releaseVersion", "profiles")}
    return hashlib.sha256(canonical_json(content)).hexdigest()


def _url(url: str, origin: str, expected_path: str) -> tuple[str, str]:
    canonical, host = trusted_origin(origin)
    if url != canonical + expected_path:
        raise SecurityError("COMPONENT_URL_NOT_ALLOWED")
    return host, expected_path


class ComponentTransport(ReleaseTransport):
    """Reuse release DNS pinning, public-address denial, and verified TLS sockets."""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._active_connection = None

    def cancel(self) -> None:
        connection = self._active_connection
        if connection:
            try:
                if getattr(connection, "sock", None):
                    connection.sock.shutdown(socket.SHUT_RDWR)
                connection.close()
            except OSError:
                pass

    def fetch_manifest(self, url: str, *, cancel: threading.Event | None = None) -> tuple[object, str]:
        if cancel and cancel.is_set():
            raise SecurityError("COMPONENT_DOWNLOAD_INTERRUPTED")
        parsed = urlsplit(url)
        match = re.fullmatch(r"/viralflow/ai-live/components/(" + VERSION + r")/manifest\.json", parsed.path)
        if not match:
            raise SecurityError("COMPONENT_URL_NOT_ALLOWED")
        host, path = _url(url, self.origin, parsed.path)
        connection = self.connection_factory(host, self._public_address())
        self._active_connection = connection
        try:
            connection.request("GET", path, headers={"Host": host, "Accept-Encoding": "identity", "Connection": "close"})
            response = connection.getresponse()
            raw_size = response.getheader("Content-Length", "")
            if (response.status != 200 or not raw_size.isdigit() or not 0 < int(raw_size) <= MAX_MANIFEST_BYTES
                    or response.getheader("Content-Encoding", "identity") != "identity"
                    or response.getheader("Transfer-Encoding") is not None):
                raise SecurityError("COMPONENT_MANIFEST_DOWNLOAD_REJECTED")
            data = response.read(int(raw_size) + 1)
            if cancel and cancel.is_set():
                raise SecurityError("COMPONENT_DOWNLOAD_INTERRUPTED")
            if len(data) != int(raw_size):
                raise SecurityError("COMPONENT_MANIFEST_DOWNLOAD_REJECTED")
            return json.loads(data), match.group(1)
        except (OSError, ValueError, http.client.HTTPException) as exc:
            if isinstance(exc, SecurityError):
                raise
            if cancel and cancel.is_set():
                raise SecurityError("COMPONENT_DOWNLOAD_INTERRUPTED") from exc
            raise SecurityError("COMPONENT_DOWNLOAD_FAILED") from exc
        finally:
            connection.close()
            self._active_connection = None

    @staticmethod
    def _verified_prefix(partial: Path, chunks: list[dict[str, object]], cancel=None) -> int:
        if not partial.exists():
            return 0
        verified = 0
        with partial.open("rb") as source:
            for item in chunks:
                if cancel and cancel.is_set():
                    raise SecurityError("COMPONENT_DOWNLOAD_INTERRUPTED")
                data = source.read(item["sizeBytes"])
                if len(data) != item["sizeBytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
                    break
                verified += len(data)
        # Corrupt/incomplete tails have no authority and are safely re-fetched.
        with partial.open("r+b") as output:
            output.truncate(verified)
        return verified

    def download(self, item: dict[str, object], version: str, profile: str, directory: Path,
                 *, progress: Callable[[int], None] | None = None, cancel: threading.Event | None = None) -> Path:
        _version(version)
        if (profile not in PROFILES or item.get("name") not in REQUIRED_COMPONENTS
                or type(item.get("sizeBytes")) is not int or not 0 < item["sizeBytes"] <= MAX_ARCHIVE_BYTES
                or not isinstance(item.get("sha256"), str) or not HASH.fullmatch(item["sha256"])
                or not isinstance(item.get("chunks"), list) or not 1 <= len(item["chunks"]) <= MAX_CHUNKS
                or any(not isinstance(chunk, dict) or set(chunk) != {"sha256", "sizeBytes"}
                    or type(chunk["sizeBytes"]) is not int or not 0 < chunk["sizeBytes"] <= COMPONENT_CHUNK_BYTES
                    or not isinstance(chunk["sha256"], str) or not HASH.fullmatch(chunk["sha256"]) for chunk in item["chunks"])
                or sum(chunk["sizeBytes"] for chunk in item["chunks"]) != item["sizeBytes"]):
            raise SecurityError("COMPONENT_MANIFEST_INVALID")
        host, path = _url(item["url"], self.origin,
            f"/viralflow/ai-live/components/{version}/{profile}/{item['name']}-{item['sha256']}.zip")
        directory = _safe(directory, directory)
        directory.mkdir(parents=True, exist_ok=True)
        if cancel and cancel.is_set():
            raise SecurityError("COMPONENT_DOWNLOAD_INTERRUPTED")
        target = _safe(directory / (item["sha256"] + ".zip"), directory)
        if target.exists():
            if target.is_file() and target.stat().st_size == item["sizeBytes"] and _hash_file(target, cancel) == item["sha256"]:
                if progress:
                    progress(item["sizeBytes"])
                return target
            target.unlink()
        partial = _safe(directory / (item["sha256"] + ".partial"), directory)
        metadata = _safe(directory / (item["sha256"] + ".resume.json"), directory)
        prefix = self._verified_prefix(partial, item["chunks"], cancel)
        if prefix == item["sizeBytes"]:
            if _hash_file(partial, cancel) == item["sha256"]:
                os.replace(partial, target)
                metadata.unlink(missing_ok=True)
                if progress:
                    progress(prefix)
                return target
            partial.unlink()
            prefix = 0
        etag = None
        if metadata.exists() and metadata.stat().st_size <= 1024:
            try:
                value = json.loads(metadata.read_bytes())
                if isinstance(value, dict) and set(value) == {"etag"} and isinstance(value["etag"], str) and ETAG.fullmatch(value["etag"]):
                    etag = value["etag"]
            except (ValueError, OSError):
                pass
        headers = {"Host": host, "Accept": "application/zip", "Accept-Encoding": "identity", "Connection": "close"}
        if prefix and etag:
            headers.update({"Range": f"bytes={prefix}-", "If-Range": etag})
        else:
            prefix = 0
        connection = None
        deadline = self.monotonic() + DOWNLOAD_TIMEOUT
        try:
            if cancel and cancel.is_set():
                raise SecurityError("COMPONENT_DOWNLOAD_INTERRUPTED")
            connection = self.connection_factory(host, self._public_address())
            self._active_connection = connection
            connection.request("GET", path, headers=headers)
            response = connection.getresponse()
            new_etag = response.getheader("ETag", "")
            if (response.getheader("Content-Encoding", "identity") != "identity"
                    or response.getheader("Transfer-Encoding") is not None or not ETAG.fullmatch(new_etag)):
                raise SecurityError("COMPONENT_DOWNLOAD_REJECTED")
            if response.status == 206 and prefix:
                if (new_etag != etag or response.getheader("Content-Range") !=
                        f"bytes {prefix}-{item['sizeBytes'] - 1}/{item['sizeBytes']}"):
                    raise SecurityError("COMPONENT_RESUME_REJECTED")
            elif response.status == 200:
                prefix = 0  # If-Range failed: verify a complete fresh body instead.
            else:
                raise SecurityError("COMPONENT_DOWNLOAD_REJECTED")
            if response.getheader("Content-Length") != str(item["sizeBytes"] - prefix):
                raise SecurityError("COMPONENT_PACKAGE_SIZE_MISMATCH")
            _atomic_json(metadata, {"etag": new_etag}, directory)
            _safe(partial, directory)
            descriptor = os.open(partial, os.O_WRONLY | os.O_CREAT | (os.O_APPEND if prefix else os.O_TRUNC), 0o600)
            counted = prefix
            with os.fdopen(descriptor, "wb") as output:
                if progress:
                    progress(counted)
                while counted < item["sizeBytes"]:
                    if cancel and cancel.is_set():
                        raise SecurityError("COMPONENT_DOWNLOAD_INTERRUPTED")
                    if self.monotonic() > deadline:
                        raise SecurityError("COMPONENT_DOWNLOAD_TIMEOUT")
                    block = response.read(min(CHUNK_BYTES, item["sizeBytes"] - counted))
                    if not block:
                        raise SecurityError("COMPONENT_DOWNLOAD_INTERRUPTED")
                    counted += len(block)
                    if counted > item["sizeBytes"]:
                        raise SecurityError("COMPONENT_PACKAGE_SIZE_MISMATCH")
                    output.write(block)
                    if progress:
                        progress(counted)
                if response.read(1):
                    raise SecurityError("COMPONENT_PACKAGE_SIZE_MISMATCH")
                output.flush()
                os.fsync(output.fileno())
            if _hash_file(partial, cancel) != item["sha256"]:
                partial.unlink()
                metadata.unlink(missing_ok=True)
                raise SecurityError("COMPONENT_PACKAGE_INTEGRITY_FAILED")
            os.replace(_safe(partial, directory), _safe(target, directory))
            metadata.unlink(missing_ok=True)
            return target
        except (OSError, http.client.HTTPException) as exc:
            if cancel and cancel.is_set():
                raise SecurityError("COMPONENT_DOWNLOAD_INTERRUPTED") from exc
            raise SecurityError("COMPONENT_DOWNLOAD_FAILED") from exc
        finally:
            if connection:
                connection.close()
            self._active_connection = None


class BootstrapManager:
    def __init__(self, root: Path, public_key_pem: bytes = b"", *, trusted_keys: Mapping[str, bytes] | None = None,
                 retired_key_ids: frozenset[str] = frozenset(), release_origin: str | None = None,
                 profile: str = "cpu-dev", transport: ComponentTransport | None = None,
                 verifier: Callable = verify_ed25519, now: Callable = time.time, progress: Callable | None = None):
        if not root.is_absolute() or root.name != "components" or profile not in PROFILES:
            raise SecurityError("COMPONENT_CONFIGURATION_INVALID")
        self.root = _safe(root, root)
        self.public_key_pem, self.trusted_keys = public_key_pem, dict(trusted_keys or {})
        self.retired_key_ids, self.profile = retired_key_ids, profile
        self.transport = transport or (ComponentTransport(release_origin) if release_origin else None)
        self.verifier, self.now, self.progress = verifier, now, progress
        self._signed = self.manifest = None
        self._lock = threading.Lock()
        self._activation_lock = threading.Lock()
        self._cancel = threading.Event()
        self._stamp: tuple | None = None
        self._catalog_cache = None
        self._last_progress = 0.0
        self.state = "NOT_CONFIGURED"
        self.bytes_received = self.total_bytes = 0
        self._check_root()
        cached = _safe(self.root / "manifest.json", self.root)
        if self.transport and (self.public_key_pem or self.trusted_keys) and cached.exists():
            try:
                if cached.stat().st_size <= MAX_MANIFEST_BYTES:
                    self.load_manifest(json.loads(cached.read_bytes()), persist=False)
            except (OSError, ValueError):
                self.state = "NOT_CONFIGURED"

    def _check_root(self) -> None:
        if not self.root.exists():
            return
        marker = _safe(self.root / "managed.json", self.root)
        try:
            if marker.stat().st_size > 1024 or json.loads(marker.read_bytes()) != MARKER:
                raise ValueError
        except (OSError, ValueError) as exc:
            if any(self.root.iterdir()):
                raise SecurityError("COMPONENT_ROOT_UNMANAGED") from exc

    def _create_root(self) -> None:
        self._check_root()
        self.root.mkdir(parents=True, exist_ok=True)
        marker = _safe(self.root / "managed.json", self.root)
        if not marker.exists():
            _atomic_json(marker, MARKER, self.root)

    def _validate_manifest(self, signed: object, *, check_expiry: bool = True) -> dict[str, object]:
        if not self.transport or not (self.public_key_pem or self.trusted_keys):
            raise SecurityError("COMPONENT_TRUST_NOT_CONFIGURED")
        if len(canonical_json(signed)) > MAX_MANIFEST_BYTES or not isinstance(signed, dict) or set(signed) != {"payload", "signature", "keyId"}:
            raise SecurityError("COMPONENT_MANIFEST_INVALID")
        payload = verify_signed_envelope(signed, self.public_key_pem, trusted_keys=self.trusted_keys,
            retired_key_ids=self.retired_key_ids, verifier=self.verifier)
        if (set(payload) != {"v", "releaseVersion", "issuedAt", "expiresAt", "profiles"}
                or type(payload["v"]) is not int or payload["v"] != 1
                or type(payload["issuedAt"]) is not int or type(payload["expiresAt"]) is not int
                or payload["issuedAt"] > self.now() + 30 or check_expiry and payload["expiresAt"] <= self.now()
                or not 0 < payload["expiresAt"] - payload["issuedAt"] <= 7 * 86400
                or not isinstance(payload["profiles"], dict) or not payload["profiles"]
                or not set(payload["profiles"]).issubset(PROFILES)):
            raise SecurityError("COMPONENT_MANIFEST_INVALID")
        _version(payload["releaseVersion"])
        for profile, items in payload["profiles"].items():
            if not isinstance(items, list) or len(items) != 2:
                raise SecurityError("COMPONENT_MANIFEST_INVALID")
            names, paths, total = set(), set(), 0
            for item in items:
                if (not isinstance(item, dict) or set(item) != {"name", "version", "url", "sha256", "sizeBytes", "expandedBytes", "files", "chunks"}
                        or item["name"] not in REQUIRED_COMPONENTS or item["name"] in names
                        or not isinstance(item["sha256"], str) or not HASH.fullmatch(item["sha256"])
                        or type(item["sizeBytes"]) is not int or not 0 < item["sizeBytes"] <= MAX_ARCHIVE_BYTES
                        or type(item["expandedBytes"]) is not int or not 0 < item["expandedBytes"] <= MAX_EXPANDED_BYTES
                        or not isinstance(item["files"], dict) or not 1 <= len(item["files"]) <= MAX_FILES
                        or not isinstance(item["chunks"], list) or not 1 <= len(item["chunks"]) <= MAX_CHUNKS):
                    raise SecurityError("COMPONENT_MANIFEST_INVALID")
                _version(item["version"])
                _url(item["url"], self.transport.origin,
                    f"/viralflow/ai-live/components/{payload['releaseVersion']}/{profile}/{item['name']}-{item['sha256']}.zip")
                names.add(item["name"])
                expanded = 0
                for relative, file in item["files"].items():
                    _relative(relative)
                    if (not isinstance(file, dict) or set(file) != {"sha256", "sizeBytes"}
                            or not isinstance(file["sha256"], str) or not HASH.fullmatch(file["sha256"])
                            or type(file["sizeBytes"]) is not int or not 0 <= file["sizeBytes"] <= MAX_EXPANDED_BYTES
                            or relative.casefold() in paths or relative.split("/")[0] not in
                            ({"runtime", "worker"} if item["name"] == "runtime" else {"models"})):
                        raise SecurityError("COMPONENT_MANIFEST_INVALID")
                    paths.add(relative.casefold())
                    expanded += file["sizeBytes"]
                if expanded != item["expandedBytes"]:
                    raise SecurityError("COMPONENT_MANIFEST_INVALID")
                chunk_size = 0
                for chunk in item["chunks"]:
                    if (not isinstance(chunk, dict) or set(chunk) != {"sha256", "sizeBytes"}
                            or not isinstance(chunk["sha256"], str) or not HASH.fullmatch(chunk["sha256"])
                            or type(chunk["sizeBytes"]) is not int or not 0 < chunk["sizeBytes"] <= COMPONENT_CHUNK_BYTES):
                        raise SecurityError("COMPONENT_MANIFEST_INVALID")
                    chunk_size += chunk["sizeBytes"]
                if chunk_size != item["sizeBytes"]:
                    raise SecurityError("COMPONENT_MANIFEST_INVALID")
                if item["name"] == "runtime" and not {"runtime/python.exe", "runtime/ffmpeg.exe", "worker/managed_worker_entry.py"}.issubset(item["files"]):
                    raise SecurityError("COMPONENT_MANIFEST_INVALID")
                total += item["sizeBytes"] + item["expandedBytes"]
            if total > MAX_PROFILE_BYTES or names != REQUIRED_COMPONENTS:
                raise SecurityError("COMPONENT_MANIFEST_INVALID")
        return json.loads(canonical_json(payload))

    def fetch_manifest(self, url: str) -> dict[str, object]:
        if not self.transport:
            raise SecurityError("COMPONENT_TRUST_NOT_CONFIGURED")
        signed, expected_version = self.transport.fetch_manifest(url, cancel=self._cancel)
        payload = self._validate_manifest(signed)
        if payload["releaseVersion"] != expected_version:
            raise SecurityError("COMPONENT_MANIFEST_INVALID")
        return self.load_manifest(signed)

    def cancel(self) -> None:
        """Terminal cancellation for agent shutdown; a new manager can retry."""
        with self._activation_lock:
            self._cancel.set()
        operation = getattr(self.transport, "cancel", None)
        if operation:
            operation()

    def load_manifest(self, signed: object, *, persist: bool = True) -> dict[str, object]:
        if not self._lock.acquire(blocking=False):
            raise SecurityError("COMPONENT_OPERATION_BUSY")
        try:
            return self._load_manifest(signed, persist=persist)
        finally:
            self._lock.release()

    def _load_manifest(self, signed: object, *, persist: bool = True) -> dict[str, object]:
        payload = self._validate_manifest(signed)
        old = self._record()
        if old and _version(payload["releaseVersion"]) < _version(old["releaseVersion"]):
            raise SecurityError("COMPONENT_DOWNGRADE_NOT_ALLOWED")
        if (old and old["releaseVersion"] == payload["releaseVersion"]
                and old["manifestSha256"] != _release_identity(payload)):
            raise SecurityError("COMPONENT_RELEASE_NOT_IMMUTABLE")
        if (self.manifest and self.manifest["releaseVersion"] == payload["releaseVersion"]
                and _release_identity(self.manifest) != _release_identity(payload)):
            raise SecurityError("COMPONENT_RELEASE_NOT_IMMUTABLE")
        self.manifest, self._signed = payload, json.loads(canonical_json(signed))
        self.total_bytes = sum(item["sizeBytes"] for item in payload["profiles"].get(self.profile, []))
        self.state = "REQUIRED" if self.profile in payload["profiles"] else "PROFILE_UNAVAILABLE"
        if old and self.profile in payload["profiles"]:
            self.state = "VERIFY_REQUIRED" if old["releaseVersion"] == payload["releaseVersion"] and old["profile"] == self.profile else "UPDATE_REQUIRED"
        if persist:
            self._create_root()
            _atomic_json(self.root / "manifest.json", self._signed, self.root)
        return self.status()

    def _record(self) -> dict[str, object] | None:
        path = _safe(self.root / "active.json", self.root)
        if not path.exists():
            return None
        try:
            if path.stat().st_size > 2048:
                raise ValueError
            record = json.loads(path.read_bytes())
            if (not isinstance(record, dict) or set(record) != {"v", "releaseVersion", "profile", "release", "manifestSha256"}
                    or record["v"] != 1 or record["profile"] not in PROFILES
                    or not isinstance(record["manifestSha256"], str) or not HASH.fullmatch(record["manifestSha256"])
                    or record["release"] != "releases/" + record["releaseVersion"] + "-" + record["release"].rsplit("-", 1)[-1]
                    or not re.fullmatch(r"releases/" + VERSION + r"-[a-f0-9]{32}", record["release"])):
                raise ValueError
            _version(record["releaseVersion"])
            return record
        except (OSError, ValueError, TypeError, KeyError) as exc:
            raise SecurityError("COMPONENT_ACTIVE_RECORD_INVALID") from exc

    def _catalog(self, record: dict[str, object] | None = None) -> tuple[Path, dict[str, dict[str, object]], tuple]:
        record = record or self._record()
        if record is None:
            raise SecurityError("COMPONENT_NOT_INSTALLED")
        release = _safe(self.root / record["release"], self.root)
        manifest_path = _safe(release / "release-manifest.json", self.root)
        if manifest_path.stat().st_size > MAX_MANIFEST_BYTES:
            raise SecurityError("COMPONENT_MANIFEST_INVALID")
        signed = json.loads(manifest_path.read_bytes())
        payload = self._validate_manifest(signed, check_expiry=False)
        if (payload["releaseVersion"] != record["releaseVersion"] or record["profile"] != self.profile
                or _release_identity(payload) != record["manifestSha256"]):
            raise SecurityError("COMPONENT_ACTIVE_RECORD_INVALID")
        files = {name: file for item in payload["profiles"][self.profile] for name, file in item["files"].items()}
        profile_path = _safe(release / "release-profile.json", self.root)
        if profile_path.stat().st_size > 1024 or json.loads(profile_path.read_bytes()) != {"profile": record["profile"]}:
            raise SecurityError("COMPONENT_ACTIVE_RECORD_INVALID")
        fingerprint = [hashlib.sha256(canonical_json(record)).hexdigest()]
        for name in ("release-manifest.json", "release-profile.json", *sorted(files)):
            path = _safe(release / name, self.root)
            stat = path.stat()
            if not path.is_file() or name in files and stat.st_size != files[name]["sizeBytes"]:
                raise SecurityError("COMPONENT_INTEGRITY_FAILED")
            fingerprint.append((name, stat.st_size, stat.st_mtime_ns, stat.st_ino, False))
        expected_files = set(files) | {"release-manifest.json", "release-profile.json"}
        actual = set()
        for path in release.rglob("*"):
            relative = _safe(path, self.root).relative_to(release).as_posix()
            if path.is_file():
                if relative not in expected_files:
                    raise SecurityError("COMPONENT_INTEGRITY_FAILED")
                actual.add(relative)
            elif path.is_dir():
                stat = path.stat()
                fingerprint.append((relative, stat.st_size, stat.st_mtime_ns, stat.st_ino, True))
        if actual != expected_files:
            raise SecurityError("COMPONENT_INTEGRITY_FAILED")
        stat = release.stat()
        fingerprint.append(("", stat.st_size, stat.st_mtime_ns, stat.st_ino, True))
        return release, files, (fingerprint[0], *sorted(fingerprint[1:], key=lambda item: (item[0], item[4])))

    def verify_current(self) -> bool:
        try:
            release, files, fingerprint = self._catalog()
            for name, file in files.items():
                if _hash_file(_safe(release / name, self.root), self._cancel) != file["sha256"]:
                    raise SecurityError("COMPONENT_INTEGRITY_FAILED")
            if self._catalog()[2] != fingerprint:
                raise SecurityError("COMPONENT_INTEGRITY_FAILED")
            self._stamp = fingerprint
            self._catalog_cache = (release, files)
            if (self.manifest and self.manifest["expiresAt"] > self.now()
                    and self._record()["manifestSha256"] == _release_identity(self.manifest)):
                self.state = "READY"
            return True
        except (OSError, ValueError, KeyError):
            self._stamp = None
            if self.manifest:
                self.state = "REPAIR_REQUIRED"
            return False

    def runtime_root(self) -> Path | None:
        if self._stamp is None or not self.manifest or self.manifest["expiresAt"] <= self.now():
            return None
        try:
            record = self._record()
            if record and record["manifestSha256"] != _release_identity(self.manifest):
                self.state = "UPDATE_REQUIRED"
                return None
            if not record or hashlib.sha256(canonical_json(record)).hexdigest() != self._stamp[0] or not self._catalog_cache:
                raise SecurityError("COMPONENT_INTEGRITY_FAILED")
            release, _files = self._catalog_cache
            for name, size, modified, inode, directory in self._stamp[1:]:
                path = _safe(release / name, self.root)
                stat = path.stat()
                if (stat.st_size, stat.st_mtime_ns, stat.st_ino, path.is_dir()) != (size, modified, inode, directory):
                    raise SecurityError("COMPONENT_INTEGRITY_FAILED")
            return release
        except (OSError, ValueError, KeyError):
            pass
        self._stamp = None
        self.state = "REPAIR_REQUIRED" if self.manifest else "NOT_CONFIGURED"
        return None

    def _report(self, state: str, received: int | None = None, *, force: bool = False) -> None:
        self.state = state
        if received is not None:
            self.bytes_received = max(0, min(received, self.total_bytes))
        now = time.monotonic()
        if self.progress and (force or now - self._last_progress >= 0.25):
            self._last_progress = now
            try:
                self.progress(self.status())
            except Exception:
                pass  # UI progress has no authority over verification/activation.

    def _remove_tree(self, path: Path) -> None:
        path = _safe(path, self.root)
        if path.exists():
            for child in path.rglob("*"):
                _safe(child, self.root)
            shutil.rmtree(path)

    def _remove_catalog_release(self, path: Path) -> set[str]:
        """Delete exact catalog-owned paths; preserve unknown nested files."""
        path = _safe(path, self.root)
        manifest = _safe(path / "release-manifest.json", self.root)
        profile_marker = _safe(path / "release-profile.json", self.root)
        digests: set[str] = set()
        if not manifest.is_file() or manifest.stat().st_size > MAX_MANIFEST_BYTES:
            return digests
        try:
            payload = json.loads(manifest.read_bytes())["payload"]
            if profile_marker.stat().st_size > 1024:
                raise ValueError
            profile = json.loads(profile_marker.read_bytes())["profile"]
            if profile not in PROFILES:
                raise ValueError
            files = set()
            for items in (payload["profiles"][profile],):
                for item in items:
                    if item["name"] not in REQUIRED_COMPONENTS or not HASH.fullmatch(item["sha256"]):
                        raise ValueError
                    digests.add(item["sha256"])
                    for relative in item["files"]:
                        _relative(relative)
                        if relative.split("/")[0] not in {"runtime", "worker", "models"}:
                            raise ValueError
                        files.add(relative)
            if len(files) > MAX_FILES * 2:
                raise ValueError
            # Preflight every path before removing any owned file.
            targets = [_safe(path / relative, self.root) for relative in files]
            for target in targets:
                if target.exists() and not target.is_file():
                    raise ValueError
            for target in targets:
                target.unlink(missing_ok=True)
            manifest.unlink()
            profile_marker.unlink()
            for directory in sorted((item for item in path.rglob("*") if item.is_dir()), key=lambda item: len(item.parts), reverse=True):
                _safe(directory, self.root)
                if not any(directory.iterdir()):
                    directory.rmdir()
            if not any(path.iterdir()):
                path.rmdir()
        except (OSError, ValueError, KeyError, TypeError):
            return set()
        return digests

    def _extract(self, archive: Path, item: dict[str, object], staged: Path, cancel=None) -> None:
        if archive.stat().st_size != item["sizeBytes"] or _hash_file(archive, cancel) != item["sha256"]:
            raise SecurityError("COMPONENT_PACKAGE_INTEGRITY_FAILED")
        try:
            with zipfile.ZipFile(archive) as package:
                infos = package.infolist()
                if len(infos) != len(item["files"]) or {info.filename for info in infos} != set(item["files"]):
                    raise SecurityError("COMPONENT_ARCHIVE_INVALID")
                if len({info.filename.casefold() for info in infos}) != len(infos):
                    raise SecurityError("COMPONENT_ARCHIVE_INVALID")
                for info in infos:
                    _relative(info.filename)
                    mode = (info.external_attr >> 16) & 0o170000
                    file = item["files"][info.filename]
                    if (info.is_dir() or mode not in (0, 0o100000) or info.flag_bits & 1
                            or info.file_size != file["sizeBytes"] or info.file_size > MAX_EXPANDED_BYTES):
                        raise SecurityError("COMPONENT_ARCHIVE_INVALID")
                    target = _safe(staged / info.filename, self.root)
                    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    _safe(target, self.root)
                    descriptor = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                    hashed, counted = hashlib.sha256(), 0
                    with package.open(info) as source, os.fdopen(descriptor, "wb") as output:
                        while True:
                            if cancel and cancel.is_set():
                                raise SecurityError("COMPONENT_DOWNLOAD_INTERRUPTED")
                            block = source.read(min(CHUNK_BYTES, file["sizeBytes"] - counted + 1))
                            if not block:
                                break
                            counted += len(block)
                            if counted > file["sizeBytes"]:
                                raise SecurityError("COMPONENT_PACKAGE_INTEGRITY_FAILED")
                            hashed.update(block)
                            output.write(block)
                        if counted != file["sizeBytes"] or hashed.hexdigest() != file["sha256"]:
                            raise SecurityError("COMPONENT_PACKAGE_INTEGRITY_FAILED")
                        output.flush()
                        os.fsync(output.fileno())
        except (zipfile.BadZipFile, RuntimeError, EOFError) as exc:
            raise SecurityError("COMPONENT_ARCHIVE_INVALID") from exc

    def install(self, *, repair: bool = False, session_active: bool = False,
                cancel: threading.Event | None = None) -> dict[str, object]:
        if session_active:
            raise SecurityError("STOP_LIVE_BEFORE_COMPONENT_UPDATE")
        if not self._lock.acquire(blocking=False):
            raise SecurityError("COMPONENT_OPERATION_BUSY")
        staged = None
        promoted = False
        manager = self
        class CombinedCancel:
            def is_set(self):
                return manager._cancel.is_set() or bool(cancel and cancel.is_set())
        cancelled = CombinedCancel()
        try:
            if cancelled.is_set():
                raise SecurityError("COMPONENT_DOWNLOAD_INTERRUPTED")
            payload = self._validate_manifest(self._signed)
            if self.profile not in payload["profiles"]:
                raise SecurityError("COMPONENT_PROFILE_UNAVAILABLE")
            if canonical_json(payload) != canonical_json(self.manifest):
                raise SecurityError("COMPONENT_PLAN_CHANGED")
            old = self._record()
            if old and _version(payload["releaseVersion"]) < _version(old["releaseVersion"]):
                raise SecurityError("COMPONENT_DOWNGRADE_NOT_ALLOWED")
            if old and old["releaseVersion"] == payload["releaseVersion"] and not repair and self.verify_current():
                return self.status()
            self._create_root()
            releases = _safe(self.root / "releases", self.root)
            downloads = _safe(self.root / "downloads", self.root)
            releases.mkdir(exist_ok=True)
            downloads.mkdir(exist_ok=True)
            # Clean only our interrupted transaction directories, never releases.
            for previous in releases.glob(".staging-*"):
                self._remove_catalog_release(previous)
            items = payload["profiles"][self.profile]
            required_free = sum(item["sizeBytes"] + item["expandedBytes"] for item in items)
            if shutil.disk_usage(self.root).free < required_free:
                raise SecurityError("COMPONENT_DISK_SPACE_REQUIRED")
            self.bytes_received = 0
            staged = _safe(releases / (".staging-" + uuid.uuid4().hex), self.root)
            staged.mkdir(mode=0o700)
            _atomic_json(staged / "release-manifest.json", self._signed, self.root)
            _atomic_json(staged / "release-profile.json", {"profile": self.profile}, self.root)
            received = 0
            for item in items:
                if cancelled.is_set():
                    raise SecurityError("COMPONENT_DOWNLOAD_INTERRUPTED")
                self._report("DOWNLOADING", received, force=True)
                archive = self.transport.download(item, payload["releaseVersion"], self.profile, downloads,
                    progress=lambda count, base=received: self._report("DOWNLOADING", base + count), cancel=cancelled)
                received += item["sizeBytes"]
                self._report("VERIFYING", received, force=True)
                self._extract(_safe(archive, self.root), item, staged, cancelled)
            self._validate_manifest(self._signed)  # expiry/trust can change during a long transfer.
            if cancelled.is_set():
                raise SecurityError("COMPONENT_DOWNLOAD_INTERRUPTED")
            final_name = payload["releaseVersion"] + "-" + uuid.uuid4().hex
            final = _safe(releases / final_name, self.root)
            os.replace(staged, final)
            staged = final
            record = {"v": 1, "releaseVersion": payload["releaseVersion"], "profile": self.profile,
                "release": "releases/" + final_name, "manifestSha256": _release_identity(payload)}
            # Validate the complete staged catalog before touching the active
            # pointer. A failed transaction cannot supersede the old release.
            final_root, final_files, stamp = self._catalog(record)
            with self._activation_lock:
                if cancelled.is_set():
                    raise SecurityError("COMPONENT_DOWNLOAD_INTERRUPTED")
                _atomic_json(self.root / "active.json", record, self.root)
                promoted = True
            self._stamp = stamp
            self._catalog_cache = (final_root, final_files)
            self._report("READY", self.total_bytes, force=True)
            return self.status()
        except (OSError, ValueError) as exc:
            self._stamp = None
            self._report("INTERRUPTED" if isinstance(exc, SecurityError) and exc.code == "COMPONENT_DOWNLOAD_INTERRUPTED" else "FAILED", force=True)
            if isinstance(exc, SecurityError):
                raise
            raise SecurityError("COMPONENT_INSTALL_FAILED") from exc
        finally:
            if staged and not promoted:
                self._remove_catalog_release(staged)
            self._lock.release()

    def status(self) -> dict[str, object]:
        if self.state == "READY":
            self.runtime_root()
        if self.manifest and self.manifest["expiresAt"] <= self.now():
            self._stamp = None
            self.state = "NOT_CONFIGURED"
        configured = bool(self.transport and (self.public_key_pem or self.trusted_keys) and self.manifest
                          and self.profile in self.manifest["profiles"] and self.manifest["expiresAt"] > self.now())
        return {"state": self.state, "bytesReceived": self.bytes_received, "totalBytes": self.total_bytes,
                "canPrepare": configured and self.state not in {"DOWNLOADING", "VERIFYING", "READY"}}

    def uninstall_cleanup(self) -> None:
        self.cancel()
        if not self._lock.acquire(blocking=False):
            raise SecurityError("COMPONENT_OPERATION_BUSY")
        try:
            self._check_root()
            digests = set()
            if self.manifest:
                digests.update(item["sha256"] for items in self.manifest["profiles"].values() for item in items)
            else:
                cached = _safe(self.root / "manifest.json", self.root)
                try:
                    if cached.stat().st_size <= MAX_MANIFEST_BYTES:
                        value = json.loads(cached.read_bytes())["payload"]
                        digests.update(item["sha256"] for items in value["profiles"].values() for item in items if isinstance(item["sha256"], str) and HASH.fullmatch(item["sha256"]))
                except (OSError, ValueError, KeyError, TypeError):
                    pass
            releases = _safe(self.root / "releases", self.root)
            if releases.exists():
                for release in releases.iterdir():
                    if re.fullmatch(r"(?:" + VERSION + r"-[a-f0-9]{32}|\.staging-[a-f0-9]{32})", release.name):
                        digests.update(self._remove_catalog_release(release))
                if not any(releases.iterdir()):
                    releases.rmdir()
            downloads = _safe(self.root / "downloads", self.root)
            if downloads.exists():
                for digest in digests:
                    for suffix in (".zip", ".partial", ".resume.json"):
                        _safe(downloads / (digest + suffix), self.root).unlink(missing_ok=True)
                if not any(downloads.iterdir()):
                    downloads.rmdir()
            for name in ("active.json", "manifest.json", "managed.json"):
                _safe(self.root / name, self.root).unlink(missing_ok=True)
            self.manifest = self._signed = self._stamp = None
            self.state = "NOT_CONFIGURED"
            self.bytes_received = self.total_bytes = 0
        finally:
            self._lock.release()


def remove_managed_components(root: Path) -> None:
    """OS uninstall helper: unrelated/unmarked directories remain untouched."""
    try:
        BootstrapManager(root).uninstall_cleanup()
    except SecurityError as exc:
        if exc.code in {"COMPONENT_ROOT_UNMANAGED", "COMPONENT_PATH_INVALID"}:
            return
        raise
