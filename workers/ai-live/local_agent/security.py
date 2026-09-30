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
from typing import Any, Callable


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
) -> Grant:
    if (not isinstance(signed, dict) or set(signed) != {"payload", "signature"}
            or not isinstance(signed.get("payload"), dict)):
        raise SecurityError("INVALID_GRANT")
    payload = signed["payload"]
    if set(payload) != {"v", "ownerId", "deviceId", "challenge", "accountId", "productIds",
                        "grantId", "issuedAt", "expiresAt", "entitled", "versions"}:
        raise SecurityError("INVALID_GRANT")
    signature = _decode_base64url(signed.get("signature"))
    if len(signature) != 64:
        raise SecurityError("INVALID_SIGNATURE")
    verifier(canonical_json(payload), signature, public_key_pem)
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
