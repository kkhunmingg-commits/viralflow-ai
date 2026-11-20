"""Owner-bound local presenter packs. Reference bytes and metadata stay encrypted.

This is a library of configuration, never evidence of renderer/GPU readiness.
The HTTP caller must verify the existing signed device certificate on every call.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import threading
import time
import uuid
from pathlib import Path

from worker_core import LiveError, image_dimensions
from .device_identity import SecretProtector, WindowsDPAPI, _safe_directory
from .security import SecurityError, canonical_json

MAX_PACKS = 20
MAX_BYTES = 4 * 1024 * 1024


class PresenterLibrary:
    def __init__(self, root: Path, *, protector: SecretProtector | None = None, now=time.time):
        _safe_directory(root)
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.root = root
        self.protector = protector or WindowsDPAPI()
        self.now = now
        self.lock = threading.RLock()

    @staticmethod
    def identifier(value: object) -> str:
        try:
            if not isinstance(value, str) or str(uuid.UUID(value)) != value:
                raise ValueError
            return value
        except ValueError as exc:
            raise SecurityError("PRESENTER_SELECTION_INVALID") from exc

    def target(self, owner: str) -> Path:
        self.identifier(owner)
        _safe_directory(self.root)
        path = self.root / (hashlib.sha256(owner.encode()).hexdigest() + ".bin")
        if path.is_symlink() or (path.exists() and not path.is_file()):
            raise SecurityError("PRESENTER_STORAGE_INVALID")
        return path

    def _load(self, owner: str) -> list[dict]:
        path = self.target(owner)
        if not path.exists():
            return []
        if path.stat().st_size > 120 * 1024 * 1024:
            raise SecurityError("PRESENTER_STORAGE_INVALID")
        try:
            # Only the per-file key is DPAPI-protected (its native input limit is 64 KiB).
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            from cryptography.exceptions import InvalidTag
            payload = path.read_bytes()
            key_size = int.from_bytes(payload[:4], "big")
            if not 1 <= key_size <= 65536 or len(payload) < key_size + 32:
                raise ValueError
            key = self.protector.unprotect(payload[4:4 + key_size])
            start = 4 + key_size
            record = json.loads(AESGCM(key).decrypt(payload[start:start + 12], payload[start + 12:], owner.encode()))
            if record["v"] != 1 or record["owner"] != owner or not isinstance(record["packs"], list) or len(record["packs"]) > MAX_PACKS:
                raise ValueError
            return record["packs"]
        except (KeyError, ValueError, TypeError, UnicodeDecodeError, InvalidTag) as exc:
            raise SecurityError("PRESENTER_STORAGE_INVALID") from exc

    def _save(self, owner: str, packs: list[dict]) -> None:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        key = AESGCM.generate_key(bit_length=256)
        protected = self.protector.protect(key)
        if not protected or len(protected) > 65536:
            raise SecurityError("PRESENTER_STORAGE_INVALID")
        nonce = secrets.token_bytes(12)
        payload = len(protected).to_bytes(4, "big") + protected + nonce + AESGCM(key).encrypt(
            nonce, canonical_json({"v": 1, "owner": owner, "packs": packs}), owner.encode())
        path = self.target(owner)
        temporary = self.root / (secrets.token_hex(16) + ".tmp")
        try:
            with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as output:
                output.write(payload)
                output.flush()
                os.fsync(output.fileno())
            self.target(owner)
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    @staticmethod
    def customer(pack: dict) -> dict:
        return {key: pack[key] for key in ("id", "name", "voiceLabel", "assignedAccountIds", "updatedAt", "consentConfirmed")} | {
            "hasReference": bool(pack["image"]),
            "status": "READY" if pack["image"] and pack["consentConfirmed"] and pack["voiceLabel"] else "SETUP_REQUIRED"}

    def list(self, owner: str) -> list[dict]:
        with self.lock:
            return [self.customer(pack) for pack in self._load(owner)]

    def put(self, owner: str, value: object) -> dict:
        fields = {"id", "name", "voiceLabel", "assignedAccountIds", "consentConfirmed", "image", "mediaType"}
        if not isinstance(value, dict) or set(value) != fields:
            raise SecurityError("PRESENTER_SELECTION_INVALID")
        pack_id = self.identifier(value["id"]) if value["id"] is not None else str(uuid.uuid4())
        name, voice = value["name"], value["voiceLabel"]
        accounts = value["assignedAccountIds"]
        if (not isinstance(name, str) or not 1 <= len(name.strip()) <= 80
                or not isinstance(voice, str) or len(voice.strip()) > 80
                or type(value["consentConfirmed"]) is not bool
                or not isinstance(accounts, list) or len(accounts) > 50
                or any(not isinstance(account, str) for account in accounts)
                or len(set(accounts)) != len(accounts)):
            raise SecurityError("PRESENTER_SELECTION_INVALID")
        for account in accounts:
            self.identifier(account)
        with self.lock:
            packs = self._load(owner)
            previous = next((pack for pack in packs if pack["id"] == pack_id), None)
            if value["id"] is not None and previous is None:
                raise SecurityError("PRESENTER_NOT_FOUND")
            if previous is None and len(packs) >= MAX_PACKS:
                raise SecurityError("PRESENTER_QUOTA")
            image, media = value["image"], value["mediaType"]
            if image is None:
                image, media = (previous["image"], previous["mediaType"]) if previous else (None, None)
            else:
                if not isinstance(image, str) or len(image) > (MAX_BYTES * 4 // 3 + 4) or media not in ("image/jpeg", "image/png"):
                    raise SecurityError("PRESENTER_IMAGE_INVALID")
                try:
                    data = base64.b64decode(image, validate=True)
                    width, height = image_dimensions(data, media)
                    if not data or len(data) > MAX_BYTES or not 0 < width <= 8192 or not 0 < height <= 8192 or width * height > 16_000_000:
                        raise ValueError
                except (ValueError, LiveError) as exc:
                    raise SecurityError("PRESENTER_IMAGE_INVALID") from exc
                if not value["consentConfirmed"]:
                    raise SecurityError("PRESENTER_CONSENT_REQUIRED")
            pack = {"id": pack_id, "name": name.strip(), "voiceLabel": voice.strip(), "assignedAccountIds": list(accounts),
                    "consentConfirmed": value["consentConfirmed"], "image": image, "mediaType": media,
                    "updatedAt": int(self.now() * 1000)}
            # Portable pack defaults are safe until an independently validated renderer
            # supplies advanced motion. Metadata cannot authorize rendering or broadcasting.
            pack["configuration"] = {"neutral": "neutral", "expressionProfile": {"intensity": 0.25, "allowed": ["neutral", "friendly", "listening"]},
                "gestureBank": ["neutral", "smile", "nod", "listening_pose"], "voiceBinding": voice.strip() or None,
                "safetyFallback": "neutral", "rendererCompatibility": ["MuseTalkCPUFloat32", "MuseTalkHybrid", "DittoRenderer"]}
            self._save(owner, [item for item in packs if item["id"] != pack_id] + [pack])
            return self.customer(pack)

    def delete(self, owner: str, pack_id: str) -> None:
        self.identifier(pack_id)
        with self.lock:
            packs = self._load(owner)
            if not any(pack["id"] == pack_id for pack in packs):
                raise SecurityError("PRESENTER_NOT_FOUND")
            self._save(owner, [pack for pack in packs if pack["id"] != pack_id])

    def reference(self, owner: str, pack_id: str) -> tuple[bytes, str]:
        self.identifier(pack_id)
        with self.lock:
            pack = next((pack for pack in self._load(owner) if pack["id"] == pack_id), None)
            if not pack or not pack["image"]:
                raise SecurityError("PRESENTER_NOT_FOUND")
            return base64.b64decode(pack["image"], validate=True), pack["mediaType"]
