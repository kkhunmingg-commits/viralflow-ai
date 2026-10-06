"""Consent-bound voice references using the existing Windows DPAPI envelope.

Reference PCM, speaker identity, provenance and consent evidence are encrypted
together with AES-GCM; DPAPI protects the random key. Decryption is in memory.
The caller must authenticate the signed owner and account before invoking this
library. Metadata is evidence to review, not automatic proof of legal rights.
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
from dataclasses import asdict, dataclass
from pathlib import Path

from local_agent.device_identity import SecretProtector, WindowsDPAPI, _safe_directory
from local_agent.security import SecurityError, canonical_json

MAX_VOICE_PACKS = 20
MAX_REFERENCE_BYTES = 16_000 * 2 * 30
MAX_CONSENT_BYTES = 256 * 1024
MAX_LIBRARY_BYTES = 40 * 1024 * 1024
ALLOWED_USAGE = frozenset({"synthesis", "cloning", "training"})


def _identifier(value: object) -> str:
    if not isinstance(value, str):
        raise SecurityError("VOICE_PACK_ID_INVALID")
    try:
        if str(uuid.UUID(value)) != value:
            raise ValueError
    except ValueError as exc:
        raise SecurityError("VOICE_PACK_ID_INVALID") from exc
    return value


def _label(value: object, *, limit: int = 300) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit or any(ord(c) < 32 for c in value):
        raise SecurityError("VOICE_PACK_METADATA_INVALID")
    return value.strip()


@dataclass(frozen=True)
class VoiceConsent:
    speaker_id: str
    speaker_identity: str
    rights_holder: str
    granted_to_owner: str
    consent_record_id: str
    signed_at: int
    allowed_usage: tuple[str, ...]
    commercial_allowed: bool
    voice_model_redistribution_allowed: bool
    consent_confirmed: bool
    expires_at: int | None = None


@dataclass(frozen=True)
class RecordingProvenance:
    source_identifier: str
    recorded_at: int
    recorder_identity: str
    transcript: str


@dataclass(frozen=True)
class AuthorizedVoiceReference:
    pack_id: str
    speaker_id: str
    reference_pcm16: bytes
    transcript: str
    fingerprint: str
    sample_rate_hz: int = 16_000


class VoicePackStore:
    def __init__(self, root: Path, *, protector: SecretProtector | None = None, now=time.time):
        _safe_directory(root)
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.root = root
        self.protector = protector or WindowsDPAPI()
        self.now = now
        self.lock = threading.RLock()

    def target(self, owner: str) -> Path:
        _identifier(owner)
        _safe_directory(self.root)
        target = self.root / (hashlib.sha256(owner.encode()).hexdigest() + ".voice.bin")
        if target.is_symlink() or (hasattr(target, "is_junction") and target.is_junction()) or (target.exists() and not target.is_file()):
            raise SecurityError("VOICE_PACK_STORAGE_INVALID")
        return target

    def _load(self, owner: str) -> list[dict]:
        from cryptography.exceptions import InvalidTag
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        target = self.target(owner)
        if not target.exists():
            return []
        if target.stat().st_size > MAX_LIBRARY_BYTES:
            raise SecurityError("VOICE_PACK_STORAGE_INVALID")
        try:
            payload = target.read_bytes()
            key_size = int.from_bytes(payload[:4], "big")
            if not 1 <= key_size <= 65536 or len(payload) < key_size + 32:
                raise ValueError
            key = self.protector.unprotect(payload[4:4 + key_size])
            start = 4 + key_size
            record = json.loads(AESGCM(key).decrypt(payload[start:start + 12], payload[start + 12:], owner.encode()))
            if (record["v"] != 1 or record["owner"] != owner or not isinstance(record["packs"], list)
                    or len(record["packs"]) > MAX_VOICE_PACKS):
                raise ValueError
            return record["packs"]
        except (KeyError, ValueError, TypeError, UnicodeDecodeError, InvalidTag) as exc:
            raise SecurityError("VOICE_PACK_STORAGE_INVALID") from exc

    def _save(self, owner: str, packs: list[dict]) -> None:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        key = AESGCM.generate_key(bit_length=256)
        protected = self.protector.protect(key)
        if not protected or len(protected) > 65536:
            raise SecurityError("VOICE_PACK_STORAGE_INVALID")
        nonce = secrets.token_bytes(12)
        payload = len(protected).to_bytes(4, "big") + protected + nonce + AESGCM(key).encrypt(
            nonce, canonical_json({"v": 1, "owner": owner, "packs": packs}), owner.encode())
        if len(payload) > MAX_LIBRARY_BYTES:
            raise SecurityError("VOICE_PACK_STORAGE_LIMIT")
        target = self.target(owner)
        temporary = self.root / (secrets.token_hex(16) + ".tmp")
        try:
            with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as output:
                output.write(payload)
                output.flush()
                os.fsync(output.fileno())
            self.target(owner)
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)

    def _customer(self, pack: dict) -> dict[str, object]:
        expired = pack["consent"]["expires_at"] is not None and self.now() >= pack["consent"]["expires_at"]
        return {key: pack[key] for key in ("id", "name", "account_ids", "presenter_ids", "updated_at")} | {
            "has_reference": bool(pack["reference"]),
            "status": "VOICE_CONSENT_REVOKED" if pack["revoked_at"] else "VOICE_CONSENT_EXPIRED" if expired else
                      "VOICE_PACK_RECORDED", "runtime_ready": False}

    def put(self, owner: str, *, name: str, account_ids: tuple[str, ...], presenter_ids: tuple[str, ...],
            consent: VoiceConsent, provenance: RecordingProvenance, reference_pcm16: bytes,
            consent_document: bytes, pack_id: str | None = None) -> dict[str, object]:
        _identifier(owner)
        name = _label(name, limit=80)
        if not isinstance(consent, VoiceConsent) or not isinstance(provenance, RecordingProvenance):
            raise SecurityError("VOICE_PACK_METADATA_INVALID")
        if (consent.granted_to_owner != owner or consent.consent_confirmed is not True
                or consent.commercial_allowed is not True):
            raise SecurityError("VOICE_CONSENT_REQUIRED")
        _identifier(consent.speaker_id)
        _label(consent.speaker_identity)
        _label(consent.rights_holder)
        _label(consent.consent_record_id)
        _label(provenance.source_identifier)
        _label(provenance.recorder_identity)
        _label(provenance.transcript, limit=2000)
        if (type(consent.signed_at) is not int or not 0 < consent.signed_at <= self.now()
                or type(provenance.recorded_at) is not int or not 0 < provenance.recorded_at <= self.now()
                or consent.expires_at is not None and (type(consent.expires_at) is not int or consent.expires_at <= self.now())
                or not isinstance(consent.allowed_usage, tuple) or not consent.allowed_usage
                or any(not isinstance(usage, str) for usage in consent.allowed_usage)
                or len(set(consent.allowed_usage)) != len(consent.allowed_usage)
                or not set(consent.allowed_usage).issubset(ALLOWED_USAGE)
                or type(consent.voice_model_redistribution_allowed) is not bool):
            raise SecurityError("VOICE_CONSENT_INVALID")
        for bindings in (account_ids, presenter_ids):
            if (not isinstance(bindings, tuple) or not 1 <= len(bindings) <= 20
                    or any(not isinstance(value, str) for value in bindings) or len(set(bindings)) != len(bindings)):
                raise SecurityError("VOICE_PACK_BINDING_REQUIRED")
            for value in bindings:
                _identifier(value)
        if (not isinstance(reference_pcm16, bytes) or not 16_000 * 2 * 3 <= len(reference_pcm16) <= MAX_REFERENCE_BYTES
                or len(reference_pcm16) % 2 or not any(reference_pcm16)):
            raise SecurityError("VOICE_REFERENCE_INVALID")
        if not isinstance(consent_document, bytes) or not 1 <= len(consent_document) <= MAX_CONSENT_BYTES:
            raise SecurityError("VOICE_CONSENT_EVIDENCE_REQUIRED")
        pack_id = _identifier(pack_id) if pack_id is not None else str(uuid.uuid4())
        with self.lock:
            packs = self._load(owner)
            if len(packs) >= MAX_VOICE_PACKS and not any(item["id"] == pack_id for item in packs):
                raise SecurityError("VOICE_PACK_STORAGE_LIMIT")
            pack = {"id": pack_id, "name": name, "account_ids": list(account_ids), "presenter_ids": list(presenter_ids),
                    "consent": asdict(consent), "provenance": asdict(provenance),
                    "reference": base64.b64encode(reference_pcm16).decode("ascii"),
                    "reference_sha256": hashlib.sha256(reference_pcm16).hexdigest(),
                    "consent_document": base64.b64encode(consent_document).decode("ascii"),
                    "consent_document_sha256": hashlib.sha256(consent_document).hexdigest(),
                    "sample_rate_hz": 16000, "updated_at": int(self.now()), "revoked_at": None}
            self._save(owner, [item for item in packs if item["id"] != pack_id] + [pack])
            return self._customer(pack)

    def list(self, owner: str) -> list[dict[str, object]]:
        with self.lock:
            return [self._customer(pack) for pack in self._load(owner)]

    def reference(self, owner: str, pack_id: str, *, account_id: str, presenter_id: str,
                  usage: str = "cloning") -> AuthorizedVoiceReference:
        for value in (owner, pack_id, account_id, presenter_id):
            _identifier(value)
        if usage not in ALLOWED_USAGE:
            raise SecurityError("VOICE_USAGE_NOT_ALLOWED")
        with self.lock:
            pack = next((pack for pack in self._load(owner) if pack["id"] == pack_id), None)
            if not pack:
                raise SecurityError("VOICE_PACK_NOT_FOUND")
            consent = pack["consent"]
            if (pack["revoked_at"] or consent["expires_at"] is not None and self.now() >= consent["expires_at"]
                    or consent["consent_confirmed"] is not True or consent["commercial_allowed"] is not True
                    or consent["granted_to_owner"] != owner):
                raise SecurityError("VOICE_CONSENT_REQUIRED")
            if account_id not in pack["account_ids"] or presenter_id not in pack["presenter_ids"]:
                raise SecurityError("VOICE_PACK_BINDING_MISMATCH")
            if usage not in consent["allowed_usage"]:
                raise SecurityError("VOICE_USAGE_NOT_ALLOWED")
            if usage == "training" and consent["voice_model_redistribution_allowed"] is not True:
                raise SecurityError("VOICE_MODEL_REDISTRIBUTION_REQUIRED")
            pcm = base64.b64decode(pack["reference"], validate=True)
            if hashlib.sha256(pcm).hexdigest() != pack["reference_sha256"]:
                raise SecurityError("VOICE_REFERENCE_INVALID")
            # Revocation/consent edits change the key used by any future voice cache.
            fingerprint = hashlib.sha256(canonical_json({"owner": owner, "account": account_id, "presenter": presenter_id,
                "pack": pack_id, "reference": pack["reference_sha256"], "consent": pack["consent_document_sha256"],
                "usage": usage, "updated_at": pack["updated_at"]})).hexdigest()
            return AuthorizedVoiceReference(pack_id, consent["speaker_id"], pcm, pack["provenance"]["transcript"], fingerprint)

    def revoke(self, owner: str, pack_id: str) -> None:
        _identifier(pack_id)
        with self.lock:
            packs = self._load(owner)
            pack = next((item for item in packs if item["id"] == pack_id), None)
            if pack is None:
                raise SecurityError("VOICE_PACK_NOT_FOUND")
            pack["revoked_at"] = int(self.now())
            self._save(owner, packs)

    def delete(self, owner: str, pack_id: str) -> None:
        _identifier(pack_id)
        with self.lock:
            packs = self._load(owner)
            if not any(pack["id"] == pack_id for pack in packs):
                raise SecurityError("VOICE_PACK_NOT_FOUND")
            self._save(owner, [pack for pack in packs if pack["id"] != pack_id])
