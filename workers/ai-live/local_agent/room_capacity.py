"""Installed, signed benchmark evidence. No browser value enables concurrency."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from .hardware import HardwareSnapshot
from .security import SecurityError, canonical_json, verify_signed_envelope


def hardware_fingerprint(snapshot: HardwareSnapshot) -> str:
    # Free disk and microphone count are not stable benchmark identity fields.
    fields = ("os_name", "os_version", "cpu_name", "ram_gb", "gpu_name",
              "vram_gb", "driver_version", "compute_capability")
    return hashlib.sha256(canonical_json({key: getattr(snapshot, key) for key in fields})).hexdigest()


def verified_room_limit(path: Path, *, owner_id: str, device_id: str, versions: dict,
                        snapshot: HardwareSnapshot, now: float, public_key: bytes,
                        verifier, trusted_keys: dict, retired_key_ids: frozenset) -> int | None:
    """Absent/expired/different device, runtime or hardware evidence means unknown."""
    try:
        if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= 16384:
            return None
        with path.open("rb") as source:
            encoded = source.read(16385)
        if len(encoded) > 16384:
            return None
        payload = verify_signed_envelope(json.loads(encoded), public_key,
            verifier=verifier, trusted_keys=trusted_keys, retired_key_ids=retired_key_ids)
        fields = {"v", "purpose", "ownerId", "deviceId", "versions", "hardwareFingerprint",
                  "benchmarkId", "measuredAt", "expiresAt", "maximumRooms"}
        if (set(payload) != fields or type(payload["v"]) is not int or payload["v"] != 1
                or payload["purpose"] != "AI_LIVE_DEVICE_CAPACITY"
                or payload["ownerId"] != owner_id or payload["deviceId"] != device_id
                or payload["versions"] != versions
                or payload["hardwareFingerprint"] != hardware_fingerprint(snapshot)
                or not isinstance(payload["benchmarkId"], str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{16,80}", payload["benchmarkId"])
                or type(payload["maximumRooms"]) is not int or not 1 <= payload["maximumRooms"] <= 10
                or type(payload["measuredAt"]) is not int or type(payload["expiresAt"]) is not int
                or payload["measuredAt"] > now or payload["expiresAt"] <= now
                or not 0 < payload["expiresAt"] - payload["measuredAt"] <= 30 * 86400):
            return None
        return payload["maximumRooms"]
    except (OSError, ValueError, TypeError, KeyError, SecurityError):
        return None
