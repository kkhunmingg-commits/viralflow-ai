"""Short lived cloud grants and local origin-bound pairing credentials."""

from __future__ import annotations

import base64
import hmac
import json
import re
import secrets
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any, Callable, Mapping

SIGNING_KEY_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")


class SecurityError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def canonical_json(value: object) -> bytes:
    """Match the recursive, key-sorted compact JSON used by the cloud signer."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False).encode("utf-8")


def _decode_base64url(value: str) -> bytes:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise SecurityError("INVALID_SIGNATURE")
    try:
        return base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
    except (ValueError, base64.binascii.Error) as exc:
        raise SecurityError("INVALID_SIGNATURE") from exc


def _uuid(value: object) -> str:
    try:
        if not isinstance(value, str):
            raise ValueError
        parsed = uuid.UUID(value)
        if str(parsed) != value.lower():
            raise ValueError
        return str(parsed)
    except ValueError as exc:
        raise SecurityError("INVALID_GRANT") from exc


def verify_ed25519(payload: bytes, signature: bytes, public_key_pem: bytes) -> None:
    """Fail closed when the packaged cryptography runtime is missing."""
    try:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives.serialization import load_pem_public_key
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    except ImportError as exc:
        raise SecurityError("SIGNATURE_VERIFIER_UNAVAILABLE") from exc
    try:
        key = load_pem_public_key(public_key_pem)
        if not isinstance(key, Ed25519PublicKey):
            raise SecurityError("INVALID_PUBLIC_KEY")
        key.verify(signature, payload)
    except InvalidSignature as exc:
        raise SecurityError("INVALID_SIGNATURE") from exc
    except (TypeError, ValueError) as exc:
        raise SecurityError("INVALID_PUBLIC_KEY") from exc


def verify_signed_envelope(
    signed: object,
    public_key_pem: bytes = b"",
    *,
    trusted_keys: Mapping[str, bytes] | None = None,
    retired_key_ids: frozenset[str] = frozenset(),
    verifier: Callable[[bytes, bytes, bytes], None] = verify_ed25519,
) -> dict[str, Any]:
    """Verify only installed trust anchors. A key ID is authenticated metadata.

    Retired IDs fail closed. Legacy single-key envelopes remain available during
    migration only when no retirement policy is set; they never fall back from
    an unknown modern key ID and cannot bypass retirement by omitting an ID.
    """
    if (not isinstance(signed, dict) or set(signed) not in
            ({"payload", "signature"}, {"payload", "signature", "keyId"})
            or not isinstance(signed.get("payload"), dict)):
        raise SecurityError("INVALID_SIGNED_ENVELOPE")
    signature = _decode_base64url(signed["signature"])
    if len(signature) != 64:
        raise SecurityError("INVALID_SIGNATURE")
    keys = trusted_keys or {}
    if (not isinstance(keys, Mapping) or len(keys) > 8
            or not isinstance(retired_key_ids, (set, frozenset))
            or any(not isinstance(key_id, str) or not SIGNING_KEY_ID.fullmatch(key_id)
                   or not isinstance(key, bytes) or not key
                   for key_id, key in keys.items())
            or any(not isinstance(key_id, str) or not SIGNING_KEY_ID.fullmatch(key_id)
                   for key_id in retired_key_ids)):
        raise SecurityError("INVALID_TRUST_CONFIGURATION")
    if "keyId" in signed:
        key_id = signed["keyId"]
        if not isinstance(key_id, str) or not SIGNING_KEY_ID.fullmatch(key_id):
            raise SecurityError("INVALID_SIGNING_KEY_ID")
        if key_id in retired_key_ids:
            raise SecurityError("SIGNING_KEY_RETIRED")
        public_key = keys.get(key_id)
        if public_key is None:
            raise SecurityError("UNKNOWN_SIGNING_KEY")
        signed_bytes = canonical_json({"keyId": key_id, "payload": signed["payload"]})
    else:
        if retired_key_ids:
            raise SecurityError("LEGACY_SIGNING_KEY_RETIRED")
        if not public_key_pem:
            raise SecurityError("REGISTRATION_UNAVAILABLE")
        public_key = public_key_pem
        signed_bytes = canonical_json(signed["payload"])
    verifier(signed_bytes, signature, public_key)
    return signed["payload"].copy()


def verify_device_message(signed: object, public_key_pem: bytes, *, purpose: str,
                          now: float, verifier: Callable[[bytes, bytes, bytes], None] = verify_ed25519,
                          trusted_keys: Mapping[str, bytes] | None = None,
                          retired_key_ids: frozenset[str] = frozenset(),
                          ) -> dict[str, Any]:
    """Validate the narrow, short-lived control-plane signed messages."""
    if not public_key_pem and not trusted_keys:
        raise SecurityError("REGISTRATION_UNAVAILABLE")
    fields = {
        "AI_LIVE_DEVICE_REGISTER": {"v", "purpose", "ownerId", "deviceId", "challengeId",
                                    "nonce", "issuedAt", "expiresAt", "versions"},
        "AI_LIVE_DEVICE_CERTIFICATE": {"v", "purpose", "ownerId", "deviceId",
                                       "publicKeyFingerprint", "issuedAt", "expiresAt", "versions"},
        "AI_LIVE_DEVICE_REVOKED": {"v", "purpose", "ownerId", "deviceId", "issuedAt", "expiresAt"},
    }
    if (purpose not in fields or not isinstance(signed, dict)
            or set(signed) not in ({"payload", "signature"}, {"payload", "signature", "keyId"})
            or not isinstance(signed["payload"], dict)):
        raise SecurityError("INVALID_DEVICE_MESSAGE")
    payload = signed["payload"]
    if (set(payload) != fields[purpose] or type(payload.get("v")) is not int
            or payload["v"] != 1 or payload.get("purpose") != purpose):
        raise SecurityError("INVALID_DEVICE_MESSAGE")
    verify_signed_envelope(signed, public_key_pem, trusted_keys=trusted_keys,
                           retired_key_ids=retired_key_ids, verifier=verifier)
    _uuid(payload.get("ownerId"))
    _uuid(payload.get("deviceId"))
    issued, expires = payload.get("issuedAt"), payload.get("expiresAt")
    max_ttl = 86400 if purpose == "AI_LIVE_DEVICE_CERTIFICATE" else 120
    if (type(issued) is not int or type(expires) is not int or expires <= issued
            or expires - issued > max_ttl or issued > now + 30 or expires <= now):
        raise SecurityError("DEVICE_MESSAGE_EXPIRED")
    if purpose == "AI_LIVE_DEVICE_REGISTER":
        _uuid(payload.get("challengeId"))
        if not isinstance(payload.get("nonce"), str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", payload["nonce"]):
            raise SecurityError("INVALID_DEVICE_MESSAGE")
    if purpose == "AI_LIVE_DEVICE_CERTIFICATE":
        if not isinstance(payload.get("publicKeyFingerprint"), str) or not re.fullmatch(
                r"[0-9a-f]{64}", payload["publicKeyFingerprint"]):
            raise SecurityError("INVALID_DEVICE_MESSAGE")
    if purpose != "AI_LIVE_DEVICE_REVOKED":
        versions = payload.get("versions")
        if (not isinstance(versions, dict) or set(versions) != {"web", "agent", "worker", "model"}
                or any(not isinstance(value, str) for value in versions.values())):
            raise SecurityError("INVALID_DEVICE_MESSAGE")
    return payload.copy()


@dataclass(frozen=True)
class Grant:
    owner_id: str
    device_id: str
    challenge: str
    account_id: str
    product_ids: tuple[str, ...]
    grant_id: str
    issued_at: int
    expires_at: int
    versions: dict[str, str]


def verify_grant(
    signed: object,
    public_key_pem: bytes,
    *,
    now: float | None = None,
    verifier: Callable[[bytes, bytes, bytes], None] = verify_ed25519,
    trusted_keys: Mapping[str, bytes] | None = None,
    retired_key_ids: frozenset[str] = frozenset(),
) -> Grant:
    if (not isinstance(signed, dict) or set(signed) not in
            ({"payload", "signature"}, {"payload", "signature", "keyId"})
            or not isinstance(signed.get("payload"), dict)):
        raise SecurityError("INVALID_GRANT")
    payload = signed["payload"]
    if set(payload) != {"v", "ownerId", "deviceId", "challenge", "accountId", "productIds",
                        "grantId", "issuedAt", "expiresAt", "entitled", "versions"}:
        raise SecurityError("INVALID_GRANT")
    verify_signed_envelope(signed, public_key_pem, trusted_keys=trusted_keys,
                           retired_key_ids=retired_key_ids, verifier=verifier)
    try:
        if type(payload.get("v")) is not int or payload["v"] != 1 or payload.get("entitled") is not True:
            raise SecurityError("ENTITLEMENT_REQUIRED")
        owner_id = _uuid(payload["ownerId"])
        device_id = _uuid(payload["deviceId"])
        account_id = _uuid(payload["accountId"])
        grant_id = _uuid(payload["grantId"])
        challenge = payload["challenge"]
        if not isinstance(challenge, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", challenge):
            raise SecurityError("INVALID_GRANT")
        products = payload["productIds"]
        if not isinstance(products, list) or not 1 <= len(products) <= 10:
            raise SecurityError("INVALID_GRANT")
        product_ids = tuple(_uuid(value) for value in products)
        if len(set(product_ids)) != len(product_ids):
            raise SecurityError("INVALID_GRANT")
        issued_at, expires_at = payload["issuedAt"], payload["expiresAt"]
        if (type(issued_at) is not int or type(expires_at) is not int
                or expires_at <= issued_at or expires_at - issued_at > 120):
            raise SecurityError("INVALID_GRANT")
        current = time.time() if now is None else now
        if issued_at > current + 30 or expires_at <= current:
            raise SecurityError("GRANT_EXPIRED")
        versions = payload["versions"]
        if (not isinstance(versions, dict) or set(versions) != {"web", "agent", "worker", "model"}
                or any(not isinstance(value, str) for value in versions.values())):
            raise SecurityError("INVALID_GRANT")
    except (KeyError, TypeError) as exc:
        raise SecurityError("INVALID_GRANT") from exc
    return Grant(owner_id, device_id, challenge, account_id, product_ids,
                 grant_id, issued_at, expires_at, dict(versions))


@dataclass
class Pairing:
    origin: str
    expires_at: float
    owner_id: str | None = None
    challenge: str | None = None
    challenge_expires_at: float = 0.0


class PairingStore:
    def __init__(self, code: str, *, token_ttl: int = 900, challenge_ttl: int = 120,
                 now: Callable[[], float] = time.time):
        if not isinstance(code, str) or len(code) < 8 or len(code) > 128:
            raise ValueError("Pairing code must be 8-128 characters supplied by the installer")
        self._code = code
        self._used = False
        self._tokens: dict[str, Pairing] = {}
        self._lock = threading.RLock()
        self._token_ttl = token_ttl
        self._challenge_ttl = challenge_ttl
        self._now = now

    def pair(self, code: str, origin: str) -> tuple[str, Pairing]:
        with self._lock:
            if self._used or not isinstance(code, str) or not hmac.compare_digest(code, self._code):
                raise SecurityError("PAIRING_DENIED")
            self._used = True
            self._code = ""  # never retained once redeemed
            token = secrets.token_urlsafe(32)
            pairing = Pairing(origin, self._now() + self._token_ttl)
            self._tokens[token] = pairing
            return token, pairing

    def authenticate(self, token: str, origin: str) -> Pairing:
        with self._lock:
            pairing = self._tokens.get(token)
            if pairing is None or pairing.expires_at <= self._now() or not hmac.compare_digest(pairing.origin, origin):
                raise SecurityError("LOCAL_AUTH_REQUIRED")
            return pairing

    def challenge(self, token: str, origin: str) -> tuple[str, float]:
        with self._lock:
            pairing = self.authenticate(token, origin)
            challenge = secrets.token_urlsafe(32)
            pairing.challenge = challenge
            pairing.challenge_expires_at = min(self._now() + self._challenge_ttl, pairing.expires_at)
            return challenge, pairing.challenge_expires_at

    def renew(self, token: str, origin: str) -> tuple[str, Pairing]:
        """Rotate an active bearer while keeping its verified owner binding."""
        with self._lock:
            pairing = self.authenticate(token, origin)
            replacement = secrets.token_urlsafe(32)
            pairing.expires_at = self._now() + self._token_ttl
            del self._tokens[token]
            self._tokens[replacement] = pairing
            return replacement, pairing

    def consume_grant(self, token: str, origin: str, grant: Grant, device_id: str) -> Pairing:
        with self._lock:
            pairing = self.authenticate(token, origin)
            if grant.device_id != device_id:
                raise SecurityError("DEVICE_NOT_REGISTERED")
            if (pairing.challenge is None or pairing.challenge_expires_at <= self._now()
                    or not hmac.compare_digest(pairing.challenge, grant.challenge)):
                raise SecurityError("CHALLENGE_REQUIRED")
            pairing.challenge = None
            pairing.challenge_expires_at = 0
            if pairing.owner_id is not None and pairing.owner_id != grant.owner_id:
                raise SecurityError("OWNER_MISMATCH")
            pairing.owner_id = grant.owner_id
            return pairing

    def owner(self, token: str, origin: str) -> str:
        pairing = self.authenticate(token, origin)
        if pairing.owner_id is None:
            raise SecurityError("OWNER_NOT_VERIFIED")
        return pairing.owner_id

    def bind_owner(self, token: str, origin: str, owner_id: str) -> Pairing:
        """Called only after a trusted certificate/grant was verified."""
        with self._lock:
            pairing = self.authenticate(token, origin)
            _uuid(owner_id)
            if pairing.owner_id is not None and pairing.owner_id != owner_id:
                raise SecurityError("OWNER_MISMATCH")
            pairing.owner_id = owner_id
            return pairing
