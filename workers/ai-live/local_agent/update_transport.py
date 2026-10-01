"""Pinned HTTPS release delivery. Network boundaries alone are injectable in tests."""

from __future__ import annotations

import hashlib
import http.client
import ipaddress
import os
import re
import queue
import socket
import ssl
import time
import threading
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit

from installer.delivery import MAX_ARCHIVE_BYTES, _regular_path
from .security import SecurityError

CONNECT_TIMEOUT = 10
READ_TIMEOUT = 15
TOTAL_TIMEOUT = 120
CHUNK_BYTES = 64 * 1024
RELEASE_PATH = re.compile(r"^/viralflow/ai-live/releases/(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)/package\.zip$")


def trusted_origin(value: str) -> tuple[str, str]:
    try:
        parsed = urlsplit(value)
        if (parsed.scheme != "https" or parsed.port not in (None, 443)
                or not parsed.hostname or parsed.username or parsed.password
                or parsed.path not in ("", "/") or parsed.query or parsed.fragment
                or not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", parsed.hostname)
                or parsed.hostname.endswith(".") or len(parsed.hostname) > 253):
            raise ValueError
        # Literal addresses are never configured as a release service.
        try:
            ipaddress.ip_address(parsed.hostname)
        except ValueError:
            pass
        else:
            raise ValueError
        return "https://" + parsed.hostname, parsed.hostname
    except (TypeError, ValueError) as exc:
        raise SecurityError("UPDATE_ORIGIN_NOT_ALLOWED") from exc


def validate_release_url(url: str, origin: str, version: str) -> tuple[str, str]:
    canonical_origin, host = trusted_origin(origin)
    try:
        parsed = urlsplit(url)
        if (url != canonical_origin + "/viralflow/ai-live/releases/" + version + "/package.zip"
                or parsed.scheme != "https" or parsed.hostname != host
                or parsed.port is not None or parsed.username or parsed.password
                or parsed.query or parsed.fragment or not RELEASE_PATH.fullmatch(parsed.path)):
            raise ValueError
    except (TypeError, ValueError) as exc:
        raise SecurityError("UPDATE_URL_NOT_ALLOWED") from exc
    return host, parsed.path


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """Connect to a validated numeric address while preserving TLS hostname/SNI."""

    def __init__(self, host: str, address: str):
        super().__init__(host, 443, timeout=CONNECT_TIMEOUT, context=ssl.create_default_context())
        self.address = address

    def connect(self) -> None:
        raw = socket.create_connection((self.address, 443), CONNECT_TIMEOUT)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
            self.sock.settimeout(READ_TIMEOUT)
        except BaseException:
            raw.close()
            raise


class ReleaseTransport:
    def __init__(self, origin: str, *, resolver: Callable = socket.getaddrinfo,
                 connection_factory: Callable = _PinnedHTTPSConnection,
                 monotonic: Callable[[], float] = time.monotonic):
        self.origin, self.host = trusted_origin(origin)
        self.resolver = resolver
        self.connection_factory = connection_factory
        self.monotonic = monotonic
        self._dns_thread: threading.Thread | None = None
        self._dns_lock = threading.Lock()

    def _public_address(self) -> str:
        try:
            # OS resolver APIs have no portable timeout. Bound one daemon query
            # per transport; a stuck lookup cannot cause an unbounded thread pool.
            with self._dns_lock:
                if self._dns_thread is not None and self._dns_thread.is_alive():
                    raise SecurityError("UPDATE_DNS_BUSY")
                result: queue.Queue = queue.Queue(maxsize=1)
                def resolve() -> None:
                    try:
                        result.put(self.resolver(self.host, 443, type=socket.SOCK_STREAM))
                    except Exception:
                        result.put(None)
                self._dns_thread = threading.Thread(target=resolve, daemon=True, name="ai-live-release-dns")
                self._dns_thread.start()
            try:
                answers = result.get(timeout=CONNECT_TIMEOUT)
            except queue.Empty as exc:
                raise SecurityError("UPDATE_DNS_TIMEOUT") from exc
            if answers is None:
                raise ValueError
            addresses = [item[4][0] for item in answers]
            if not addresses or len(addresses) > 32:
                raise ValueError
            for value in addresses:
                address = ipaddress.ip_address(value)
                if (not address.is_global or address.is_private or address.is_loopback
                        or address.is_link_local or address.is_multicast or address.is_reserved
                        or address.is_unspecified or getattr(address, "ipv4_mapped", None)):
                    raise ValueError
            return addresses[0]
        except (OSError, TypeError, ValueError, IndexError) as exc:
            raise SecurityError("UPDATE_NETWORK_NOT_ALLOWED") from exc

    def download(self, item: dict[str, object], version: str, directory: Path) -> Path:
        host, path = validate_release_url(item["url"], self.origin, version)
        size, digest = item["sizeBytes"], item["sha256"]
        if (type(size) is not int or not 0 < size <= MAX_ARCHIVE_BYTES
                or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest)):
            raise SecurityError("UPDATE_PACKAGE_INVALID")
        directory = _regular_path(directory, directory)
        directory.mkdir(parents=True, exist_ok=True)
        target = _regular_path(directory / (digest + ".zip"), directory)
        if target.exists():
            if target.is_file() and target.stat().st_size == size:
                with target.open("rb") as source:
                    cached = hashlib.file_digest(source, "sha256") if hasattr(hashlib, "file_digest") else None
                    if cached is None:
                        cached = hashlib.sha256()
                        for chunk in iter(lambda: source.read(CHUNK_BYTES), b""):
                            cached.update(chunk)
                if cached.hexdigest() == digest:
                    return target
            target.unlink()
        partial = _regular_path(directory / (digest + ".partial"), directory)
        # A stale incomplete transfer has no authority and never becomes active.
        partial.unlink(missing_ok=True)
        deadline = self.monotonic() + TOTAL_TIMEOUT
        connection = None
        try:
            connection = self.connection_factory(host, self._public_address())
            connection.request("GET", path, headers={"Host": host, "Accept": "application/zip",
                                                     "Accept-Encoding": "identity", "Connection": "close"})
            response = connection.getresponse()
            # Redirects, partial/range responses and compressed transfers are rejected.
            if (response.status != 200 or response.getheader("Content-Encoding", "identity") != "identity"
                    or response.getheader("Transfer-Encoding") is not None):
                raise SecurityError("UPDATE_DOWNLOAD_REJECTED")
            if response.getheader("Content-Length") != str(size):
                raise SecurityError("UPDATE_PACKAGE_SIZE_MISMATCH")
            descriptor = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            counted, hashed = 0, hashlib.sha256()
            with os.fdopen(descriptor, "wb") as output:
                while True:
                    if self.monotonic() > deadline:
                        raise SecurityError("UPDATE_DOWNLOAD_TIMEOUT")
                    chunk = response.read(min(CHUNK_BYTES, size - counted + 1))
                    if not chunk:
                        break
                    counted += len(chunk)
                    if counted > size:
                        raise SecurityError("UPDATE_PACKAGE_SIZE_MISMATCH")
                    hashed.update(chunk)
                    output.write(chunk)
                if counted != size or hashed.hexdigest() != digest:
                    raise SecurityError("UPDATE_PACKAGE_INTEGRITY_FAILED")
                output.flush()
                os.fsync(output.fileno())
            os.replace(partial, target)
            return target
        except SecurityError:
            raise
        except (OSError, http.client.HTTPException) as exc:
            raise SecurityError("UPDATE_DOWNLOAD_FAILED") from exc
        finally:
            if connection is not None:
                connection.close()
            partial.unlink(missing_ok=True)
