"""Where LIVE Lite may send an AI-presenter stream.

Technical tests go to a loopback/private RTMP test server. A public platform
is allowed only after the owner records that the platform's policy permits an
AI presenter with an AI voice for this account. TikTok stays blocked until
TikTok Shop Thailand's position is verified; there is no evasion mode, and
the disclosure label is always burned into the video by the presenter engine.
"""
from __future__ import annotations

import ipaddress
import json
import os
import socket
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from direct_stream import GenericRTMPProvider, GenericRTMPSProvider, StreamError

TIKTOK_HOST_MARKERS = ("tiktok", "tiktokcdn", "tiktokv", "byteoversea", "ibytedtos", "musical.ly")
TEST = "TECHNICAL_TEST"
ATTESTED = "OWNER_ATTESTED_PLATFORM"


@dataclass(frozen=True)
class Destination:
    host: str
    kind: str  # TECHNICAL_TEST | OWNER_ATTESTED_PLATFORM
    commercial: bool
    platform: str | None = None
    evidence: str | None = None


def _private(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_private or ipaddress.ip_address(host).is_loopback
    except ValueError:
        pass
    try:
        addresses = {info[4][0] for info in socket.getaddrinfo(host, None)}
    except OSError:
        return False
    return bool(addresses) and all(ipaddress.ip_address(item.split("%")[0]).is_private for item in addresses)


def _attestation(path: Path | None) -> dict | None:
    if path is None or not path.is_file() or path.is_symlink() or path.stat().st_size > 64 * 1024:
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def classify(server_url: str, attestation_path: Path | None = None) -> Destination:
    try:
        host = (urlsplit(server_url).hostname or "").lower().rstrip(".")
    except ValueError:
        raise StreamError("STREAM_CREDENTIALS_INVALID") from None
    if not host:
        raise StreamError("STREAM_CREDENTIALS_INVALID")
    tiktok = any(marker in host for marker in TIKTOK_HOST_MARKERS)
    if not tiktok and _private(host):
        return Destination(host, TEST, False)
    record = _attestation(attestation_path)
    entries = record.get("platforms") if record else None
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, dict):
            continue
        hosts = entry.get("hosts")
        if (isinstance(hosts, list) and host in [str(item).lower() for item in hosts]
                and entry.get("ai_presenter_allowed") is True and entry.get("ai_voice_allowed") is True
                and isinstance(entry.get("platform"), str) and isinstance(entry.get("evidence"), str)
                and len(entry["evidence"].strip()) >= 8 and isinstance(entry.get("verified_at"), str)):
            return Destination(host, ATTESTED, True, entry["platform"], entry["evidence"].strip())
    raise StreamError("TIKTOK_AI_PRESENTER_POLICY_UNVERIFIED" if tiktok else "LITE_PLATFORM_POLICY_UNVERIFIED")


class LiteDestinationProvider:
    """Factory with the existing provider signature: (server_url, stream_key)."""
    def __init__(self, attestation_path: Path | None = None):
        configured = os.getenv("AI_LIVE_LITE_PLATFORM_ATTESTATION", "").strip()
        self.attestation_path = attestation_path or (Path(configured) if configured else None)
        self.last: Destination | None = None

    def __call__(self, server_url: str, stream_key: str, **kwargs):
        destination = classify(server_url, self.attestation_path)
        self.last = destination
        provider = GenericRTMPSProvider if urlsplit(server_url).scheme == "rtmps" else GenericRTMPProvider
        return provider(server_url, stream_key, **kwargs)
