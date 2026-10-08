"""Account-bound local AI LIVE orchestration. Release validation stays closed."""

from __future__ import annotations

import hmac
import os
import secrets
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Protocol, runtime_checkable

from worker_core import LiveError, image_dimensions

from .hardware import HardwareAssessment, HardwareSnapshot, HardwareTiers, assess_hardware, inspect_hardware
from .security import Grant, PairingStore, SecurityError, verify_device_message, verify_ed25519, verify_grant, verify_signed_envelope
from .device_identity import DeviceIdentity
from .updater import SafeUpdater
from .stream_credentials import StreamCredentialStore
from .presenter_library import PresenterLibrary
from .room_capacity import verified_room_limit

MAX_REFERENCE_BYTES = 4 * 1024 * 1024
MAX_REFERENCES = 5
VERSIONS = {"web": "0.5.0", "agent": "0.5.0", "worker": "0.5.0",
            "model": "musetalk-unvalidated"}
PROVIDER_MODE = "LOCAL_GPU"
REALTIME_VALIDATED = False  # Release gate; no environment or browser override.


class AgentError(RuntimeError):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(code)
        self.status = status
        self.code = code
        self.message = message


@runtime_checkable
class StreamProvider(Protocol):
    def start(self) -> None: ...
    def stop(self) -> None: ...
    def health(self) -> dict[str, object]: ...


class LocalEncoder:
    """Production stream boundary awaiting encoder and long-run GPU validation."""

    def start(self) -> None:
        raise AgentError(503, "ENCODER_NOT_VALIDATED", "ระบบถ่ายทอดสดยังไม่พร้อมใช้งาน")

    def stop(self) -> None:
        pass

    def health(self) -> dict[str, object]:
        return {"ready": False, "code": "ENCODER_NOT_VALIDATED"}


@runtime_checkable
class WorkerBoundary(Protocol):
    """Trusted local Python worker adapter, never a cloud/mock substitute."""

    def health(self) -> dict[str, object]: ...
    def start_session(self, owner_id: str, account_id: str,
                      product_ids: tuple[str, ...], presenter_path: Path,
                      microphone_id: str | None) -> str: ...
    def pause_session(self, owner_id: str, session_id: str) -> None: ...
    def resume_session(self, owner_id: str, session_id: str) -> None: ...
    def stop_session(self, owner_id: str, session_id: str) -> None: ...
    def recover_session(self, owner_id: str, session_id: str) -> None: ...


class UnavailableWorker:
    def health(self) -> dict[str, object]:
        return {"ready": False, "code": "WORKER_NOT_VALIDATED"}

    def start_session(self, *_args: object) -> str:
        raise AgentError(503, "WORKER_NOT_VALIDATED", "ระบบ AI LIVE ยังไม่พร้อมใช้งาน")

    def pause_session(self, *_args: object) -> None:
        raise AgentError(503, "WORKER_NOT_VALIDATED", "ระบบ AI LIVE ยังไม่พร้อมใช้งาน")

    def resume_session(self, *_args: object) -> None:
        raise AgentError(503, "WORKER_NOT_VALIDATED", "ระบบ AI LIVE ยังไม่พร้อมใช้งาน")

    def stop_session(self, *_args: object) -> None:
        # Safe cleanup is always available, even after a backend failure.
        pass

    def recover_session(self, *_args: object) -> None:
        raise AgentError(503, "WORKER_NOT_VALIDATED", "ระบบ AI LIVE ยังไม่พร้อมใช้งาน")


@dataclass(frozen=True)
class AgentConfig:
    device_id: str
    pairing_code: str
    grant_public_key_pem: bytes
    data_dir: Path
    allowed_origins: frozenset[str] = frozenset({
        "https://viralflow-ai-blond.vercel.app",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    })
    hardware_tiers: HardwareTiers = field(default_factory=HardwareTiers)
    trusted_keys: dict[str, bytes] = field(default_factory=dict)
    retired_key_ids: frozenset[str] = frozenset()

    def __post_init__(self) -> None:
        try:
            if str(uuid.UUID(self.device_id)) != self.device_id.lower():
                raise ValueError
        except ValueError as exc:
            raise ValueError("Device ID must be a UUID created by the installer") from exc
        if not self.data_dir.is_absolute() or self.data_dir.is_symlink():
            raise ValueError("Agent data directory must be absolute and non-symlinked")
        if not isinstance(self.grant_public_key_pem, bytes):
            raise ValueError("Cloud public key must be supplied by the trusted installer")
        if (not isinstance(self.trusted_keys, dict) or len(self.trusted_keys) > 8
                or any(not isinstance(key, str) or not isinstance(value, bytes)
                       for key, value in self.trusted_keys.items())
                or not isinstance(self.retired_key_ids, frozenset)):
            raise ValueError("Invalid installed trust configuration")


@dataclass
class _Reference:
    path: Path
    token: str
    owner_id: str | None = None


@dataclass
class _Session:
    session_id: str
    owner_id: str
    grant_expires_at: int
    state: str = "BUSY"
    recovery_attempts: int = 0
    account_id: str | None = None
    product_ids: tuple[str, ...] = ()
    started_at: int | None = None
    operation_lock: object = field(default_factory=threading.RLock, repr=False)


class LocalAgent:
    def __init__(
        self,
        config: AgentConfig,
        *,
        worker: WorkerBoundary | None = None,
        hardware_probe: Callable[[], HardwareSnapshot] | None = None,
        grant_signature_verifier: Callable[[bytes, bytes, bytes], None] = verify_ed25519,
        now: Callable[[], float] = time.time,
        test_only_realtime_validated: bool = False,
        test_only_verified_room_capacity: int | None = None,
        device_identity: DeviceIdentity | None = None,
        update_status: Callable[[], str] | None = None,
        updater: SafeUpdater | None = None,
        stream_credentials: StreamCredentialStore | None = None,
        stream_setup_callback: Callable[[str, str], None] | None = None,
        components=None,
        component_manifest_url: str | None = None,
        presenter_library: PresenterLibrary | None = None,
    ) -> None:
        self.config = config
        self._now = now
        self._pairings = PairingStore(config.pairing_code, now=now)
        self._worker = worker or UnavailableWorker()
        self._hardware_probe = hardware_probe or (lambda: inspect_hardware(config.data_dir))
        self._grant_signature_verifier = grant_signature_verifier
        self._validated = REALTIME_VALIDATED or test_only_realtime_validated
        if test_only_verified_room_capacity is not None and (
                type(test_only_verified_room_capacity) is not int or not 1 <= test_only_verified_room_capacity <= 10
                or not test_only_realtime_validated):
            raise ValueError("Capacity test fixtures require the explicit test-only validation boundary")
        self._test_room_capacity = test_only_verified_room_capacity
        self._references: dict[str, _Reference] = {}
        self._presenter_library = presenter_library or PresenterLibrary(config.data_dir / "library")
        self._sessions: dict[str, _Session] = {}
        self._starting: set[tuple[str, str]] = set()
        self._authorization_generation = 0
        self._closing = False
        self._used_grants: set[str] = set()
        self._device_identity = device_identity
        self._update_status = update_status or (lambda: "CURRENT")
        self._updater = updater
        self._stream_credentials = stream_credentials
        self._stream_setup_callback = stream_setup_callback
        self._stream_authorizations: dict[tuple[str, str], float] = {}
        self._update_thread: threading.Thread | None = None
        self._components = components
        self._component_manifest_url = component_manifest_url
        self._component_thread: threading.Thread | None = None
        self._component_cancel = threading.Event()
        self._ai_warmup_thread: threading.Thread | None = None
        self._ai_warming = False
        self._product_contexts: dict[tuple[str, str], tuple[float, tuple[str, ...]]] = {}
        self._used_registration_challenges: dict[str, int] = {}
        if device_identity is not None and device_identity.device_id != config.device_id:
            raise ValueError("Device identity does not match the installed configuration")
        self._lock = threading.RLock()
        config.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        if config.data_dir.is_symlink():
            raise ValueError("Agent data directory must not be a symlink")

    @staticmethod
    def _safe_error(exc: SecurityError) -> AgentError:
        code = exc.code
        if code in ("PAIRING_DENIED", "LOCAL_AUTH_REQUIRED", "OWNER_NOT_VERIFIED"):
            return AgentError(401, code, "กรุณาเชื่อมต่อเครื่องนี้อีกครั้ง")
        if code in ("OWNER_MISMATCH", "DEVICE_NOT_REGISTERED"):
            return AgentError(403, code, "บัญชีหรือเครื่องนี้ไม่ได้รับอนุญาต")
        if code == "SIGNATURE_VERIFIER_UNAVAILABLE":
            return AgentError(503, code, "ต้องติดตั้งส่วนเสริมความปลอดภัย")
        if code == "REGISTRATION_UNAVAILABLE":
            return AgentError(503, code, "ส่วนเสริมยังอยู่ระหว่างการเตรียมความพร้อม")
        if code == "UPDATE_REQUIRED":
            return AgentError(426, code, "ต้องอัปเดตส่วนเสริม AI LIVE")
        return AgentError(403, code, "ไม่สามารถตรวจสอบสิทธิ์ AI LIVE")

    def pair(self, code: str, origin: str) -> dict[str, object]:
        try:
            token, pairing = self._pairings.pair(code, origin)
        except SecurityError as exc:
            raise self._safe_error(exc) from exc
        return {"token": token, "expiresAt": int(pairing.expires_at),
                "deviceId": self.config.device_id}

    def authenticate(self, token: str, origin: str) -> None:
        try:
            self._pairings.authenticate(token, origin)
        except SecurityError as exc:
            raise self._safe_error(exc) from exc

    def challenge(self, token: str, origin: str) -> dict[str, object]:
        try:
            self._authorized_device(token, origin)
            challenge, expires = self._pairings.challenge(token, origin)
        except SecurityError as exc:
            raise self._safe_error(exc) from exc
        proof_payload = {"v": 1, "purpose": "AI_LIVE_LEASE_REQUEST",
                         "deviceId": self.config.device_id, "challenge": challenge,
                         "issuedAt": int(self._now()), "expiresAt": int(expires),
                         "versions": VERSIONS.copy()}
        return {"challenge": challenge, "expiresAt": int(expires),
                "deviceProof": {"payload": proof_payload,
                                "signature": self._device_identity.sign(proof_payload)}}

    def _certificate(self) -> dict[str, object]:
        identity = self._device_identity
        if identity is None or identity.certificate is None:
            raise SecurityError("DEVICE_NOT_REGISTERED")
        payload = verify_device_message(identity.certificate, self.config.grant_public_key_pem,
                                        purpose="AI_LIVE_DEVICE_CERTIFICATE", now=self._now(),
                                        verifier=self._grant_signature_verifier,
                                        trusted_keys=self.config.trusted_keys,
                                        retired_key_ids=self.config.retired_key_ids)
        if (payload["deviceId"] != identity.device_id
                or payload["publicKeyFingerprint"] != identity.fingerprint
                or payload["issuedAt"] <= identity.revoked_at):
            raise SecurityError("DEVICE_NOT_REGISTERED")
        if payload["versions"] != VERSIONS:
            raise SecurityError("UPDATE_REQUIRED")
        return payload

    def _authorized_device(self, token: str, origin: str) -> dict[str, object]:
        payload = self._certificate()
        pairing = self._pairings.authenticate(token, origin)
        if pairing.owner_id != payload["ownerId"]:
            raise SecurityError("OWNER_NOT_VERIFIED")
        return payload

    def _stored_certificate_owner(self) -> str | None:
        """An expired certificate may refresh only its original signed owner."""
        identity = self._device_identity
        if identity is None:
            return None
        if identity.bound_owner is not None:
            return identity.bound_owner
        if identity.certificate is None:
            return None
        stored = identity.certificate.get("payload", {})
        issued = stored.get("issuedAt") if isinstance(stored, dict) else None
        if type(issued) is not int or issued > self._now() + 30:
            raise SecurityError("INVALID_DEVICE_MESSAGE")
        payload = verify_device_message(identity.certificate, self.config.grant_public_key_pem,
                                        purpose="AI_LIVE_DEVICE_CERTIFICATE", now=issued,
                                        verifier=self._grant_signature_verifier,
                                        trusted_keys=self.config.trusted_keys,
                                        retired_key_ids=self.config.retired_key_ids)
        if (payload["deviceId"] != identity.device_id
                or payload["publicKeyFingerprint"] != identity.fingerprint):
            raise SecurityError("DEVICE_NOT_REGISTERED")
        return payload["ownerId"]

    def device_proof(self, token: str, origin: str, challenge: object) -> dict[str, object]:
        self.authenticate(token, origin)
        try:
            payload = verify_device_message(challenge, self.config.grant_public_key_pem,
                                            purpose="AI_LIVE_DEVICE_REGISTER", now=self._now(),
                                            verifier=self._grant_signature_verifier,
                                        trusted_keys=self.config.trusted_keys,
                                        retired_key_ids=self.config.retired_key_ids)
            identity = self._device_identity
            if identity is None or payload["deviceId"] != identity.device_id:
                raise SecurityError("DEVICE_NOT_REGISTERED")
            if payload["versions"] != VERSIONS:
                raise SecurityError("UPDATE_REQUIRED")
            bound_owner = self._pairings.authenticate(token, origin).owner_id
            if bound_owner is not None and bound_owner != payload["ownerId"]:
                raise SecurityError("OWNER_MISMATCH")
            if identity.certificate is not None:
                if self._stored_certificate_owner() != payload["ownerId"]:
                    raise SecurityError("OWNER_MISMATCH")
            with self._lock:
                self._used_registration_challenges = {
                    key: expires for key, expires in self._used_registration_challenges.items()
                    if expires > self._now()}
                if (payload["challengeId"] in self._used_registration_challenges
                        or len(self._used_registration_challenges) >= 64):
                    raise SecurityError("DEVICE_CHALLENGE_REPLAY")
                self._used_registration_challenges[payload["challengeId"]] = payload["expiresAt"]
            return {"payload": payload, "publicKey": identity.public_key_pem,
                    "signature": identity.sign(payload)}
        except SecurityError as exc:
            raise self._safe_error(exc) from exc

    def install_certificate(self, token: str, origin: str, certificate: object) -> dict[str, object]:
        self.authenticate(token, origin)
        try:
            payload = verify_device_message(certificate, self.config.grant_public_key_pem,
                                            purpose="AI_LIVE_DEVICE_CERTIFICATE", now=self._now(),
                                            verifier=self._grant_signature_verifier,
                                        trusted_keys=self.config.trusted_keys,
                                        retired_key_ids=self.config.retired_key_ids)
            identity = self._device_identity
            if (identity is None or payload["deviceId"] != identity.device_id
                    or payload["publicKeyFingerprint"] != identity.fingerprint
                    or payload["issuedAt"] <= identity.revoked_at):
                raise SecurityError("DEVICE_NOT_REGISTERED")
            if payload["versions"] != VERSIONS:
                raise SecurityError("UPDATE_REQUIRED")
            if identity.certificate is not None and self._stored_certificate_owner() != payload["ownerId"]:
                raise SecurityError("OWNER_MISMATCH")
            self._pairings.bind_owner(token, origin, payload["ownerId"])
            identity.save_certificate(certificate)
        except SecurityError as exc:
            raise self._safe_error(exc) from exc
        return self._view(token, origin)

    def revoke_device(self, token: str, origin: str, receipt: object) -> dict[str, object]:
        self.authenticate(token, origin)
        try:
            payload = verify_device_message(receipt, self.config.grant_public_key_pem,
                                            purpose="AI_LIVE_DEVICE_REVOKED", now=self._now(),
                                            verifier=self._grant_signature_verifier,
                                        trusted_keys=self.config.trusted_keys,
                                        retired_key_ids=self.config.retired_key_ids)
            if payload["deviceId"] != self.config.device_id:
                raise SecurityError("OWNER_MISMATCH")
            if self._device_identity is None:
                raise SecurityError("DEVICE_NOT_REGISTERED")
            pairing = self._pairings.authenticate(token, origin)
            if pairing.owner_id is None:
                # Revocation must work after reconnecting the browser, even if
                # membership/certificate expiry prevents a new registration.
                # The expired certificate is trusted for identity binding only;
                # Start still requires an unexpired certificate and fresh lease.
                if self._stored_certificate_owner() != payload["ownerId"]:
                    raise SecurityError("OWNER_MISMATCH")
                self._pairings.bind_owner(token, origin, payload["ownerId"])
            owner_id = self._pairings.owner(token, origin)
            if payload["ownerId"] != owner_id:
                raise SecurityError("OWNER_MISMATCH")
            with self._lock:
                self._authorization_generation += 1
                self._device_identity.mark_revoked(payload["issuedAt"])
                if self._stream_credentials:
                    self._stream_credentials.revoke_owner(owner_id)
                self._stream_authorizations = {key: expiry for key, expiry in self._stream_authorizations.items() if key[0] != owner_id}
                for session in self._sessions.values():
                    if session.owner_id == owner_id and session.state != "STOPPED":
                        self._worker.stop_session(owner_id, session.session_id)
                        session.state = "STOPPED"
        except SecurityError as exc:
            raise self._safe_error(exc) from exc
        return self._view(token, origin)

    def renew(self, token: str, origin: str) -> dict[str, object]:
        try:
            replacement, pairing = self._pairings.renew(token, origin)
        except SecurityError as exc:
            raise self._safe_error(exc) from exc
        with self._lock:
            for reference in self._references.values():
                if hmac.compare_digest(reference.token, token):
                    reference.token = replacement
        return {"token": replacement, "expiresAt": int(pairing.expires_at),
                "deviceId": self.config.device_id}

    def discovery(self) -> dict[str, object]:
        return {"state": "READY", "versions": VERSIONS.copy(), "paired": False,
                "deviceAuthorized": False, **self._update_view()}

    def _update_view(self) -> dict[str, object]:
        state = self._current_update_status()
        status = self._updater.status() if self._updater is not None else {}
        return {"updateStatus": state,
                "updateCanApply": state not in ("UPDATING", "RESTART_REQUIRED") and status.get("applyReady") is True,
                "updateCanRepair": state not in ("UPDATING", "RESTART_REQUIRED") and status.get("repairReady") is True}

    def check_update(self, token: str, origin: str, manifest: object) -> dict[str, object]:
        self.authenticate(token, origin)
        with self._lock:
            if self._updater is None:
                raise AgentError(503, "UPDATE_NOT_CONFIGURED", "ส่วนเสริมยังไม่พร้อมสำหรับการอัปเดต")
            if self._current_update_status() in ("UPDATING", "RESTART_REQUIRED"):
                raise AgentError(409, "UPDATE_BUSY", "กรุณารอให้อัปเดตเสร็จและเปิดส่วนเสริมใหม่")
            try:
                self._updater.discover(manifest)
            except (SecurityError, ValueError, OSError) as exc:
                raise AgentError(403, "UPDATE_PLAN_INVALID", "ไม่สามารถตรวจสอบการอัปเดตได้") from exc
            return self._update_view()

    def apply_update(self, token: str, origin: str, *, confirmed: bool, repair: bool = False) -> dict[str, object]:
        self.authenticate(token, origin)
        with self._lock:
            if self._component_thread is not None and self._component_thread.is_alive():
                raise AgentError(409, "COMPONENTS_BUSY", "กรุณารอให้เตรียมเครื่องเสร็จ")
            if self._updater is None or self._updater.transport is None:
                raise AgentError(503, "UPDATE_NOT_CONFIGURED", "ส่วนเสริมยังไม่พร้อมสำหรับการอัปเดต")
            active = any(session.state != "STOPPED" for session in self._sessions.values())
            try:
                self._updater.validate_operation(confirmed=confirmed, session_active=active, repair=repair)
            except SecurityError as exc:
                if exc.code == "STOP_LIVE_BEFORE_UPDATE":
                    raise AgentError(409, exc.code, "กรุณาหยุด AI LIVE ก่อนอัปเดต") from exc
                raise AgentError(409, "UPDATE_NOT_READY", "กรุณาตรวจสอบและยืนยันการอัปเดตอีกครั้ง") from exc
            self._updater.state = "UPDATING"

            def execute() -> None:
                try:
                    self._updater.deliver(confirmed=True, repair=repair, prevalidated=True)
                except Exception:
                    # No network URL, TLS details or filesystem path goes to UI.
                    self._updater.state = "ROLLED_BACK"

            self._update_thread = threading.Thread(target=execute, name="ai-live-update", daemon=False)
            result = self._update_view()
            self._update_thread.start()
            return result

    def _assessment(self) -> HardwareAssessment:
        try:
            return assess_hardware(self._hardware_probe(), self.config.hardware_tiers)
        except Exception:
            # No OS/driver traceback or local path is ever returned to the UI.
            return HardwareAssessment(False, "UNSUPPORTED", True,
                                      ("ไม่สามารถตรวจสอบเครื่องนี้ได้",),
                                      {"marker": "GPU_VALIDATION_REQUIRED", "codes": ["HARDWARE_CHECK_FAILED"]})

    def _room_capacity(self, owner_id: str | None) -> dict[str, object]:
        with self._lock:
            # Errors retain their lease until Stop proves resources were released.
            active = sum(session.state != "STOPPED" for session in self._sessions.values()) + len(self._starting)
        maximum = self._test_room_capacity
        if maximum is None and owner_id:
            try:
                maximum = verified_room_limit(self.config.data_dir / "room-capacity.json",
                    owner_id=owner_id, device_id=self.config.device_id, versions=VERSIONS,
                    snapshot=self._hardware_probe(), now=self._now(), public_key=self.config.grant_public_key_pem,
                    verifier=self._grant_signature_verifier, trusted_keys=self.config.trusted_keys,
                    retired_key_ids=self.config.retired_key_ids)
            except Exception:
                maximum = None
        return {"status": "VERIFIED" if maximum is not None else "UNVERIFIED_CAPACITY",
                "maximumRooms": maximum, "activeRooms": active,
                "canStartAnotherRoom": maximum is not None and active < maximum}

    def _room_views(self, owner_id: str | None) -> list[dict[str, object]]:
        if not owner_id:
            return []
        with self._lock:
            # Return the latest room per account, not an unbounded diagnostic history.
            latest = {session.account_id: session for session in self._sessions.values()
                      if session.owner_id == owner_id and session.account_id}
            records = list(latest.values())
        result = []
        observed = getattr(self._worker, "customer_stream", None)
        for record in records:
            stream = {"phase": "STOPPED" if record.state == "STOPPED" else "PREPARING", "connectionQuality": "UNAVAILABLE"}
            if callable(observed) and record.state != "STOPPED":
                try:
                    candidate = observed(owner_id, record.session_id)
                    phases = {"IDLE", "PREPARING", "CONNECTING", "LIVE", "RECONNECTING", "STOPPING", "STOPPED", "SETUP_REQUIRED", "ERROR"}
                    qualities = {"GOOD", "FAIR", "PROBLEM", "UNAVAILABLE"}
                    stream = {"phase": candidate.get("phase") if candidate.get("phase") in phases else "PREPARING",
                              "connectionQuality": candidate.get("connectionQuality") if candidate.get("connectionQuality") in qualities else "UNAVAILABLE"}
                    if stream["phase"] == "ERROR":
                        with self._lock:
                            if record.state != "STOPPED":
                                record.state = "ERROR"
                except Exception:
                    with self._lock:
                        if record.state != "STOPPED":
                            record.state = "ERROR"
                    stream = {"phase": "ERROR", "connectionQuality": "PROBLEM"}
            result.append({"accountId": record.account_id, "sessionId": record.session_id,
                "state": record.state, "currentProductId": record.product_ids[0] if record.product_ids else None,
                "sessionStartedAt": record.started_at, "customerStream": stream})
        return ([room for room in result if room["state"] != "STOPPED"]
                + [room for room in reversed(result) if room["state"] == "STOPPED"])[:10]

    def rooms(self, token: str, origin: str) -> dict[str, object]:
        return self._view(token, origin)

    def sync_product_context(self, token: str, origin: str, signed: object) -> dict[str, object]:
        """Account products come only from the existing authenticated cloud data.

        A customer cannot supply facts, another owner/account or a model path.
        Verified snapshots survive temporary cloud disconnection in active rooms.
        Starting a new room still requires a fresh signed context and lease.
        """
        self.authenticate(token, origin)
        try:
            certificate = self._authorized_device(token, origin)
            payload = verify_signed_envelope(signed, self.config.grant_public_key_pem,
                verifier=self._grant_signature_verifier, trusted_keys=self.config.trusted_keys,
                retired_key_ids=self.config.retired_key_ids)
            required = {"v", "purpose", "ownerId", "deviceId", "accountId", "productIds", "products", "issuedAt", "expiresAt", "versions"}
            if (set(payload) != required or type(payload["v"]) is not int or payload["v"] != 1
                    or payload["purpose"] != "AI_LIVE_PRODUCT_CONTEXT" or payload["versions"] != VERSIONS
                    or payload["ownerId"] != certificate["ownerId"] or payload["deviceId"] != self.config.device_id):
                raise SecurityError("LOCAL_PRODUCT_SCOPE_MISMATCH")
            account = str(uuid.UUID(payload["accountId"]))
            products = payload["productIds"]
            if (not isinstance(products, list) or not 1 <= len(products) <= 10
                    or len(set(products)) != len(products) or any(str(uuid.UUID(value)) != value for value in products)
                    or not isinstance(payload["products"], list) or len(payload["products"]) != len(products)
                    or {product.get("productId") for product in payload["products"] if isinstance(product, dict)} != set(products)
                    or type(payload["issuedAt"]) is not int or type(payload["expiresAt"]) is not int
                    or not 0 < payload["expiresAt"] - payload["issuedAt"] <= 120
                    or payload["issuedAt"] > self._now() + 30 or payload["expiresAt"] <= self._now()):
                raise SecurityError("LOCAL_PRODUCT_CONTEXT_INVALID")
            sync = getattr(self._worker, "sync_product_context", None)
            if not callable(sync):
                raise AgentError(503, "LOCAL_AI_UNAVAILABLE", "AI ยังอยู่ระหว่างเตรียมพร้อม")
            # Preserve original server signature for the independent shared
            # compliance authority. Product facts alone never authorize speech.
            compliance_sync = getattr(self._worker, "sync_compliance_context", None)
            if callable(compliance_sync):
                compliance_sync(certificate["ownerId"], account, signed)
            product_facts = [{name: product[name] for name in ("productId", "name", "version", "facts")}
                             for product in payload["products"]]
            sync(certificate["ownerId"], account, product_facts)
            with self._lock:
                key = (certificate["ownerId"], account)
                if key not in self._product_contexts and len(self._product_contexts) >= 10:
                    raise AgentError(409, "ROOM_CAPACITY_REACHED", "ใช้จำนวนห้องครบแล้ว")
                self._product_contexts[key] = (payload["expiresAt"], tuple(products))
        except SecurityError as exc:
            raise self._safe_error(exc) from None
        except (ValueError, TypeError, KeyError, AttributeError):
            raise AgentError(422, "LOCAL_PRODUCT_CONTEXT_INVALID", "ตรวจสอบข้อมูลสินค้าไม่สำเร็จ") from None
        return {"synced": True}

    def warmup_ai(self, token: str, origin: str, selection: dict | None = None) -> dict[str, object]:
        self.authenticate(token, origin)
        try:
            certificate = self._authorized_device(token, origin)
        except SecurityError as exc:
            raise self._safe_error(exc) from None
        warmup = getattr(self._worker, "warmup", None)
        arguments = ()
        if selection is not None:
            if (not isinstance(selection, dict)
                    or set(selection) != {"accountId", "productIds", "presenterId", "microphoneId"}
                    or not isinstance(selection["accountId"], str)
                    or not isinstance(selection["presenterId"], str)
                    or not isinstance(selection["productIds"], list)
                    or not 1 <= len(selection["productIds"]) <= 10
                    or any(not isinstance(value, str) for value in selection["productIds"])):
                raise AgentError(422, "LOCAL_AI_WARMUP_REQUIRED", "กรุณาเลือกบัญชี สินค้า และคน LIVE")
            owner, account = certificate["ownerId"], selection["accountId"]
            context = self._product_contexts.get((owner, account))
            reference = self._references.get(selection["presenterId"])
            if (not context or context[0] <= self._now() or tuple(selection["productIds"]) != context[1]
                    or not reference or reference.token != token or selection["microphoneId"] not in (None, "default")):
                raise AgentError(403, "LOCAL_AI_SELECTION_NOT_ALLOWED", "กรุณาเตรียมข้อมูลบัญชีใหม่")
            reference.owner_id = owner
            warmup = getattr(self._worker, "prepare_room", None)
            arguments = (owner, account, tuple(selection["productIds"]), reference.path, selection["microphoneId"])
        if not callable(warmup):
            raise AgentError(503, "LOCAL_AI_UNAVAILABLE", "AI ยังอยู่ระหว่างเตรียมพร้อม")
        with self._lock:
            if self._closing:
                raise AgentError(503, "WORKER_UNAVAILABLE", "กรุณาเปิด ViralFlow ใหม่")
            if self._ai_warming:
                return {"preparing": True}
            self._ai_warming = True
            def execute():
                try:
                    warmup(*arguments)
                except Exception:
                    pass  # raw native errors remain in local diagnostics
                finally:
                    with self._lock:
                        self._ai_warming = False
            self._ai_warmup_thread = threading.Thread(target=execute, name="viralflow-local-ai-warmup", daemon=True)
            self._ai_warmup_thread.start()
        return {"preparing": True}

    def ai_status(self, token: str, origin: str, session_id: str) -> dict[str, object]:
        session = self._owned_session(token, origin, session_id)
        observe = getattr(self._worker, "session_ai_status", None)
        if not callable(observe):
            return {"available": False, "lastComment": None, "currentResponse": None, "activity": []}
        value = observe(session.owner_id, session_id)
        safe_text = lambda text: text if isinstance(text, str) and 0 < len(text) <= 1000 else None
        return {"available": value.get("readiness", {}).get("ready") is True,
                "lastComment": safe_text(value.get("lastComment")), "currentResponse": safe_text(value.get("currentResponse")),
                "activity": [text for text in value.get("activity", []) if text in
                             {"กำลังตอบผู้ชม", "กำลังพูด", "หยุดตอบผู้ชมชั่วคราว", "ตอบผู้ชมต่อ"}][-10:]}

    def submit_comment(self, token: str, origin: str, session_id: str, comment: dict[str, object]) -> dict[str, object]:
        session = self._owned_session(token, origin, session_id)
        try:
            self._authorized_device(token, origin)
        except SecurityError as exc:
            raise self._safe_error(exc) from None
        with session.operation_lock:
            if session.state not in ("BUSY", "PAUSED"):
                raise AgentError(409, "SESSION_NOT_RUNNING", "ห้อง LIVE ไม่ได้กำลังทำงาน")
            submit = getattr(self._worker, "submit_comment", None)
            if not callable(submit):
                raise AgentError(503, "LOCAL_AI_UNAVAILABLE", "AI ยังอยู่ระหว่างเตรียมพร้อม")
            return submit(session.owner_id, session_id, comment)

    def queue_speech(self, token: str, origin: str, session_id: str, speech: dict[str, object]) -> dict[str, object]:
        session = self._owned_session(token, origin, session_id)
        try:
            self._authorized_device(token, origin)
        except SecurityError as exc:
            raise self._safe_error(exc) from None
        with session.operation_lock:
            if session.state not in ("BUSY", "PAUSED"):
                raise AgentError(409, "SESSION_NOT_RUNNING", "ห้อง LIVE ไม่ได้กำลังทำงาน")
            queue = getattr(self._worker, "queue_speech", None)
            if not callable(queue):
                raise AgentError(503, "LOCAL_AI_UNAVAILABLE", "AI ยังอยู่ระหว่างเตรียมพร้อม")
            return queue(session.owner_id, session_id, speech)

    def _components_view(self, *, authorized: bool = False) -> dict[str, object]:
        """Only progress and customer-safe states cross the loopback boundary."""
        if self._components is None:
            return {"state": "NOT_CONFIGURED", "bytesReceived": 0, "totalBytes": 0, "canPrepare": False}
        try:
            raw = self._components.status()
            state = raw.get("state")
            mapped = {"REQUIRED": "NOT_CONFIGURED", "UPDATE_REQUIRED": "NOT_CONFIGURED",
                      "VERIFY_REQUIRED": "NOT_CONFIGURED", "FAILED": "ERROR", "INTERRUPTED": "ERROR",
                      "PROFILE_UNAVAILABLE": "ERROR"}.get(state, state)
            if mapped not in {"NOT_CONFIGURED", "CHECKING", "DOWNLOADING", "VERIFYING", "INSTALLING", "READY", "REPAIR_REQUIRED", "ERROR"}:
                mapped = "ERROR"
            total = raw.get("totalBytes", 0)
            received = raw.get("bytesReceived", 0)
            if type(total) is not int or not 0 <= total <= 128 * 1024**3:
                total = 0
            if type(received) is not int:
                received = 0
            codes = self._assessment().diagnostics.get("codes", []) if authorized else ["AUTHORIZATION_REQUIRED"]
            # A missing bundled encoder can be restored by this preparation.
            # Physical driver/hardware restrictions still block GPU downloads.
            compatible = not codes or all(code == "ENCODER_REQUIRED" for code in codes)
            if self._components.profile == "cpu-dev":
                from provider_config import dev_fallback_enabled
                compatible = dev_fallback_enabled() and all(code in {
                    "ENCODER_REQUIRED", "NVIDIA_GPU_REQUIRED", "NVIDIA_DRIVER_REQUIRED", "GPU_MODEL_REQUIRED", "GPU_VRAM_REQUIRED"
                } for code in codes)
            can_prepare = bool(authorized and compatible and self._component_manifest_url
                               and self._components.transport
                               and (self.config.grant_public_key_pem or self.config.trusted_keys)
                               and mapped not in {"CHECKING", "DOWNLOADING", "VERIFYING", "INSTALLING", "READY"}
                               and not self._component_cancel.is_set())
            return {"state": mapped, "bytesReceived": max(0, min(received, total)),
                    "totalBytes": total, "canPrepare": can_prepare}
        except Exception:
            return {"state": "ERROR", "bytesReceived": 0, "totalBytes": 0, "canPrepare": False}

    def components_status(self, token: str, origin: str) -> dict[str, object]:
        self.authenticate(token, origin)
        try:
            self._authorized_device(token, origin)
            authorized = True
        except SecurityError:
            authorized = False
        return {"components": self._components_view(authorized=authorized)}

    def prepare_components(self, token: str, origin: str, signed: object, *, repair: bool = False) -> dict[str, object]:
        """Entitled account/device lease, installed catalog URL; no browser commands."""
        self.authenticate(token, origin)
        if type(repair) is not bool:
            raise AgentError(400, "INVALID_PREPARATION_REQUEST", "ข้อมูลไม่ถูกต้อง")
        try:
            certificate = self._authorized_device(token, origin)
            grant = verify_grant(signed, self.config.grant_public_key_pem, now=self._now(),
                verifier=self._grant_signature_verifier, trusted_keys=self.config.trusted_keys,
                retired_key_ids=self.config.retired_key_ids)
            if grant.versions != VERSIONS or certificate["ownerId"] != grant.owner_id:
                raise SecurityError("OWNER_MISMATCH")
            self._pairings.consume_grant(token, origin, grant, self.config.device_id)
        except SecurityError as exc:
            raise self._safe_error(exc) from exc
        with self._lock:
            if grant.grant_id in self._used_grants:
                raise AgentError(403, "GRANT_REPLAY", "กรุณาตรวจสอบสิทธิ์อีกครั้ง")
            if ((self._component_thread and self._component_thread.is_alive())
                    or any(session.state != "STOPPED" for session in self._sessions.values())
                    or self._current_update_status() in ("UPDATING", "RESTART_REQUIRED", "REQUIRED", "UPDATE_REQUIRED")):
                raise AgentError(409, "COMPONENTS_BUSY", "กรุณาหยุด LIVE หรือรอการเตรียมเครื่องให้เสร็จ")
            if not self._components_view(authorized=True)["canPrepare"]:
                raise AgentError(503, "COMPONENTS_NOT_READY", "ยังไม่สามารถเตรียมเครื่องนี้ได้")
            self._used_grants.add(grant.grant_id)
            self._components.state = "CHECKING"
            def execute() -> None:
                try:
                    self._components.fetch_manifest(self._component_manifest_url)
                    if self._component_cancel.is_set():
                        return
                    self._components.install(repair=repair, cancel=self._component_cancel)
                except Exception:
                    # Paths, model/provider names and native/network errors stay local.
                    self._components.state = "ERROR"
            self._component_thread = threading.Thread(target=execute, name="viralflow-prepare", daemon=False)
            self._component_thread.start()
            return {"components": self._components_view(authorized=True)}

    def _current_update_status(self) -> str:
        try:
            update = self._update_status()
        except Exception:
            return "REQUIRED"
        if update in ("REQUIRED", "RESTART_REQUIRED"):
            return update
        if self._updater is not None:
            update = self._updater.state
            if update == "ROLLED_BACK" and self._updater.requires_update():
                return "UPDATE_REQUIRED"
        return update if update in ("AVAILABLE", "UPDATING", "RESTART_REQUIRED", "REQUIRED", "CURRENT",
                                   "UPDATE_REQUIRED", "NOT_CONFIGURED", "ROLLED_BACK") else "REQUIRED"

    def _view(self, token: str, origin: str) -> dict[str, object]:
        self.authenticate(token, origin)
        owner_id = self._pairings.authenticate(token, origin).owner_id
        hardware = self._assessment()
        with self._lock:
            active = next((session for session in self._sessions.values()
                           if owner_id is not None and session.owner_id == owner_id
                           and session.state in ("BUSY", "PAUSED", "STOPPING")), None)
            failed = next((session for session in reversed(tuple(self._sessions.values()))
                           if owner_id is not None and session.owner_id == owner_id
                           and session.state == "ERROR"), None)
        try:
            self._authorized_device(token, origin)
            authorized = True
        except SecurityError:
            authorized = False
        worker_health = self._worker.health() if authorized else {}
        worker_ready = authorized and worker_health.get("ready") is True
        update = self._current_update_status()
        if active:
            state, message, reasons = active.state, "AI LIVE กำลังทำงาน" if active.state == "BUSY" else "AI LIVE หยุดชั่วคราว", []
        elif failed:
            state, message, reasons = "ERROR", "AI LIVE ขัดข้อง", ["ลองกู้คืนหรือหยุดรายการ"]
        elif update in ("UPDATING", "RESTART_REQUIRED", "REQUIRED", "UPDATE_REQUIRED"):
            state, message, reasons = "UPDATE_REQUIRED", "ต้องอัปเดตส่วนเสริม AI LIVE", []
        elif not authorized:
            state, message, reasons = "READY", "กรุณาอนุญาตให้เครื่องนี้ใช้งาน", []
        elif not hardware.compatible:
            state, message, reasons = "GPU_REQUIRED", "เครื่องนี้ยังไม่รองรับ AI LIVE", list(hardware.customer_reasons)
        elif not self._validated or not worker_ready:
            state, message, reasons = "STARTING", "AI LIVE ยังอยู่ระหว่างการเตรียมความพร้อม", ["กำลังรอการทดสอบการแสดงสดบนเครื่องที่รองรับ"]
        else:
            state, message, reasons = "READY", "พร้อมสำหรับ AI LIVE", []
        result: dict[str, object] = {
            "state": state, "message": message, "reasons": reasons,
            "paired": True,
            "canStart": state == "READY" and authorized and self._validated and worker_ready,
            "sessionActive": active is not None or failed is not None,
            "versions": VERSIONS.copy(),
            "deviceAuthorized": authorized,
            **self._update_view(),
            "machineReady": hardware.compatible,
            "capacity": self._room_capacity(owner_id),
            "rooms": self._room_views(owner_id),
            "aiReadiness": {"brain": "READY" if worker_health.get("brain_ready") is True else "PREPARING",
                            "voice": "READY" if worker_health.get("tts_ready") is True else "PREPARING",
                            "presenter": "READY" if worker_health.get("presenter_ready") is True and worker_health.get("warmup_passed") is True else "PREPARING",
                            "encoder": "READY" if worker_health.get("encoder_ready") is True and worker_health.get("warmup_passed") is True else "PREPARING"},
        }
        result["canStart"] = (authorized and self._validated and worker_ready and hardware.compatible
            and update not in ("UPDATING", "RESTART_REQUIRED", "REQUIRED", "UPDATE_REQUIRED")
            and result["capacity"]["canStartAnotherRoom"])
        if self._components is not None:
            result["components"] = self._components_view(authorized=authorized)
            if result["components"]["state"] != "READY":
                result["canStart"] = False
        if "NVIDIA_DRIVER_REQUIRED" in hardware.diagnostics.get("codes", []):
            result["hardwareAdvice"] = "DRIVER_UPDATE_REQUIRED"
        visible_session = active or failed
        if visible_session:
            if visible_session.account_id:
                result.update({"activeAccountId": visible_session.account_id,
                               "currentProductId": visible_session.product_ids[0] if visible_session.product_ids else None,
                               "sessionStartedAt": visible_session.started_at})
            result["sessionId"] = visible_session.session_id
            observed = getattr(self._worker, "customer_stream", None)
            if callable(observed):
                stream_view = next((room["customerStream"] for room in result["rooms"]
                                    if room["sessionId"] == visible_session.session_id),
                                   {"phase": "ERROR", "connectionQuality": "PROBLEM"})
                result["customerStream"] = stream_view
                if stream_view.get("phase") == "ERROR":
                    with self._lock:
                        visible_session.state = "ERROR"
                    result.update({"state": "ERROR", "message": "ต้องตรวจสอบการ LIVE", "canStart": False})
                elif stream_view.get("phase") == "STOPPING":
                    result.update({"state": "STOPPING", "message": "กำลังหยุด", "canStart": False})
        elif owner_id:
            stopped = any(session.owner_id == owner_id and session.state == "STOPPED" for session in self._sessions.values())
            result["customerStream"] = {"phase": "STOPPED" if stopped else "SETUP_REQUIRED", "connectionQuality": "UNAVAILABLE"}
        return result

    def status(self, token: str, origin: str) -> dict[str, object]:
        return self._view(token, origin)

    def hardware(self, token: str, origin: str) -> dict[str, object]:
        result = self._view(token, origin)
        hardware = self._assessment()
        result["machineStatus"] = hardware.customer()
        return result

    def developer_diagnostics(self) -> dict[str, object]:
        """Trusted local installer diagnostics; never served on the browser API."""
        return {"providerMode": PROVIDER_MODE, "realtimeValidated": self._validated,
                "hardware": self._assessment().diagnostics,
                "worker": self._worker.health()}

    def upload_reference(self, token: str, origin: str, image: bytes,
                         media_type: str) -> dict[str, str]:
        self.authenticate(token, origin)
        if not image or len(image) > MAX_REFERENCE_BYTES:
            raise AgentError(413, "INVALID_REFERENCE_SIZE", "รูปภาพมีขนาดไม่ถูกต้อง")
        if media_type == "image/jpeg" and image.startswith(b"\xff\xd8") and image.endswith(b"\xff\xd9"):
            suffix = ".jpg"
        elif media_type == "image/png" and image.startswith(b"\x89PNG\r\n\x1a\n"):
            suffix = ".png"
        else:
            raise AgentError(415, "INVALID_REFERENCE_TYPE", "กรุณาใช้รูปภาพ JPEG หรือ PNG")
        try:
            width, height = image_dimensions(image, media_type)
        except LiveError as exc:
            raise AgentError(415, "INVALID_REFERENCE_IMAGE", "รูปภาพไม่ถูกต้อง") from exc
        if (width < 1 or height < 1 or width > 8192 or height > 8192
                or width * height > 16_000_000):
            raise AgentError(422, "INVALID_REFERENCE_IMAGE", "รูปภาพมีขนาดไม่ถูกต้อง")
        with self._lock:
            if len(self._references) >= MAX_REFERENCES:
                raise AgentError(507, "REFERENCE_QUOTA", "พื้นที่รูปภาพเต็ม")
            presenter_id = str(uuid.uuid4())
            path = self.config.data_dir / f"{presenter_id}{suffix}"
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            try:
                with os.fdopen(descriptor, "wb") as output:
                    output.write(image)
            except Exception:
                path.unlink(missing_ok=True)
                raise
            self._references[presenter_id] = _Reference(path, token)
        return {"presenterId": presenter_id}

    def _presenter_owner(self, token: str, origin: str) -> str:
        self.authenticate(token, origin)
        try:
            return str(self._authorized_device(token, origin)["ownerId"])
        except SecurityError as exc:
            raise self._safe_error(exc) from exc

    def list_presenters(self, token: str, origin: str) -> dict[str, object]:
        owner = self._presenter_owner(token, origin)
        return {"presenters": self._presenter_library.list(owner)}

    def save_presenter(self, token: str, origin: str, body: object) -> dict[str, object]:
        owner = self._presenter_owner(token, origin)
        try:
            return {"presenter": self._presenter_library.put(owner, body)}
        except SecurityError as exc:
            raise AgentError(422, "PRESENTER_NOT_READY", "กรุณาตรวจสอบชื่อ รูปภาพ และการอนุญาตใช้ภาพ") from exc

    def delete_presenter(self, token: str, origin: str, presenter_id: str) -> dict[str, object]:
        owner = self._presenter_owner(token, origin)
        with self._lock:
            if any(session.owner_id == owner and session.state != "STOPPED" for session in self._sessions.values()):
                raise AgentError(409, "PRESENTER_BUSY", "กรุณาหยุด LIVE ก่อนลบคน LIVE")
            try:
                self._presenter_library.delete(owner, presenter_id)
            except SecurityError as exc:
                raise AgentError(404, "PRESENTER_NOT_FOUND", "ไม่พบคน LIVE") from exc
        return {"deleted": True}

    def presenter_reference(self, token: str, origin: str, presenter_id: str) -> tuple[bytes, str]:
        owner = self._presenter_owner(token, origin)
        try:
            return self._presenter_library.reference(owner, presenter_id)
        except SecurityError as exc:
            raise AgentError(404, "PRESENTER_NOT_FOUND", "ไม่พบรูปคน LIVE") from exc

    def _owned_session(self, token: str, origin: str, session_id: str) -> _Session:
        try:
            owner = self._pairings.owner(token, origin)
        except SecurityError as exc:
            raise self._safe_error(exc) from exc
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None or session.owner_id != owner:
                raise AgentError(404, "SESSION_NOT_FOUND", "ไม่พบรายการถ่ายทอดสด")
            return session

    def preview_frame(self, token: str, origin: str, session_id: str) -> bytes | None:
        self.authenticate(token, origin)
        session = self._owned_session(token, origin, session_id)
        # Preview does not grant a membership or production-validation bypass.
        try:
            self._authorized_device(token, origin)
        except SecurityError as exc:
            raise self._safe_error(exc) from exc
        if not self._validated or session.state not in ("BUSY", "PAUSED"):
            return None
        read_frame = getattr(self._worker, "preview_frame", None)
        frame = read_frame(session.owner_id, session_id) if callable(read_frame) else None
        if frame is not None and (not isinstance(frame, bytes) or len(frame) > MAX_REFERENCE_BYTES
                                 or not frame.startswith(b"\xff\xd8") or not frame.endswith(b"\xff\xd9")):
            raise AgentError(503, "PREVIEW_UNAVAILABLE", "ยังไม่มีภาพจากระบบ")
        return frame

    def request_stream_setup(self, token: str, origin: str, signed: object) -> dict[str, object]:
        """A server lease opens the native dialog; no browser receives the key."""
        self.authenticate(token, origin)
        try:
            certificate = self._authorized_device(token, origin)
            grant = verify_grant(signed, self.config.grant_public_key_pem, now=self._now(),
                verifier=self._grant_signature_verifier, trusted_keys=self.config.trusted_keys,
                retired_key_ids=self.config.retired_key_ids)
            if grant.versions != VERSIONS or certificate["ownerId"] != grant.owner_id:
                raise SecurityError("OWNER_MISMATCH")
            self._pairings.consume_grant(token, origin, grant, self.config.device_id)
        except SecurityError as exc:
            raise self._safe_error(exc) from exc
        if not self._stream_credentials or not self._stream_setup_callback:
            raise AgentError(503, "STREAM_SETUP_UNAVAILABLE", "ต้องเตรียมส่วนเสริมให้พร้อมก่อน")
        with self._lock:
            if grant.grant_id in self._used_grants:
                raise AgentError(403, "GRANT_REPLAY", "กรุณาตรวจสอบสิทธิ์อีกครั้ง")
            if any(session.state in ("BUSY", "PAUSED", "STOPPING") for session in self._sessions.values()):
                raise AgentError(409, "SESSION_BUSY", "กรุณาหยุด LIVE ก่อนตั้งค่า")
            self._used_grants.add(grant.grant_id)
            self._stream_authorizations = {key: expiry for key, expiry in self._stream_authorizations.items() if expiry > self._now()}
            self._stream_authorizations[(grant.owner_id, grant.account_id)] = grant.expires_at
            configured = self._stream_credentials.metadata(grant.owner_id, grant.account_id)["configured"]
        self._stream_setup_callback(grant.owner_id, grant.account_id)
        return {"configured": configured}

    def save_stream_setup(self, owner_id: str, account_id: str, server_url: str, stream_key: str) -> None:
        """Native UI only. A short-lived server-approved account grant is required."""
        with self._lock:
            expiry = self._stream_authorizations.get((owner_id, account_id), 0)
            if not self._stream_credentials or expiry <= self._now():
                raise AgentError(403, "STREAM_SETUP_EXPIRED", "กรุณาเปิดตั้งค่าการ LIVE ใหม่จาก ViralFlow")
            try:
                self._stream_credentials.put(owner_id, account_id, server_url, stream_key)
            except SecurityError as exc:
                raise AgentError(422, "STREAM_SETUP_INVALID", "ข้อมูลการ LIVE ไม่ถูกต้อง") from exc
            self._stream_authorizations.pop((owner_id, account_id), None)

    def start(self, token: str, origin: str, body: dict[str, object]) -> dict[str, object]:
        self.authenticate(token, origin)
        try:
            certificate = self._authorized_device(token, origin)
            grant = verify_grant(body.get("grant"), self.config.grant_public_key_pem,
                                 now=self._now(), verifier=self._grant_signature_verifier,
                                        trusted_keys=self.config.trusted_keys,
                                        retired_key_ids=self.config.retired_key_ids)
            self._pairings.consume_grant(token, origin, grant, self.config.device_id)
            if certificate["ownerId"] != grant.owner_id:
                raise SecurityError("OWNER_MISMATCH")
        except SecurityError as exc:
            raise self._safe_error(exc) from exc
        if grant.versions != VERSIONS:
            raise AgentError(426, "UPDATE_REQUIRED", "ต้องอัปเดต AI LIVE")
        if self._current_update_status() in ("UPDATING", "RESTART_REQUIRED", "REQUIRED", "UPDATE_REQUIRED"):
            raise AgentError(426, "UPDATE_REQUIRED", "ต้องอัปเดต AI LIVE")
        try:
            selected_account = str(uuid.UUID(body["accountId"]))  # type: ignore[arg-type]
            selected_products = tuple(str(uuid.UUID(value)) for value in body["productIds"])  # type: ignore[union-attr,arg-type]
        except (KeyError, TypeError, ValueError, AttributeError) as exc:
            raise AgentError(403, "GRANT_SCOPE_MISMATCH", "บัญชีหรือสินค้าไม่ได้รับอนุญาต") from exc
        if selected_account != grant.account_id or selected_products != grant.product_ids:
            raise AgentError(403, "GRANT_SCOPE_MISMATCH", "บัญชีหรือสินค้าไม่ได้รับอนุญาต")
        if callable(getattr(self._worker, "sync_product_context", None)):
            context = self._product_contexts.get((grant.owner_id, grant.account_id))
            if context is None or context[0] <= self._now() or context[1] != grant.product_ids:
                raise AgentError(409, "LOCAL_PRODUCT_CONTEXT_REQUIRED", "กรุณาตรวจสอบข้อมูลสินค้าอีกครั้ง")
        microphone_id = body.get("microphoneId")
        if microphone_id not in (None, "default"):
            raise AgentError(422, "MICROPHONE_NOT_ALLOWED", "ไม่พบไมโครโฟนที่เลือก")
        presenter_id = body.get("presenterId")
        if not isinstance(presenter_id, str):
            raise AgentError(422, "PRESENTER_REQUIRED", "กรุณาเลือกรูปผู้นำเสนอ")
        # Slow runtime inspection/start must never hold the registry lock needed
        # to stop another room. Admission below reserves a slot atomically.
        hardware = self._assessment()
        worker_ready = self._worker.health().get("ready") is True
        with self._lock:
            if self._closing:
                raise AgentError(503, "WORKER_UNAVAILABLE", "กรุณาเปิด ViralFlow ใหม่")
            if self._current_update_status() in ("UPDATING", "RESTART_REQUIRED", "REQUIRED", "UPDATE_REQUIRED"):
                raise AgentError(426, "UPDATE_REQUIRED", "ต้องอัปเดต AI LIVE")
            if grant.grant_id in self._used_grants:
                raise AgentError(403, "GRANT_REPLAY", "ไม่สามารถตรวจสอบสิทธิ์ AI LIVE")
            self._used_grants.add(grant.grant_id)
            reference = self._references.get(presenter_id)
            if reference is None or not hmac.compare_digest(reference.token, token):
                raise AgentError(404, "PRESENTER_NOT_FOUND", "ไม่พบรูปผู้นำเสนอ")
            if any(session.state != "STOPPED" and session.owner_id == grant.owner_id
                   and session.account_id == grant.account_id for session in self._sessions.values()) or (
                       grant.owner_id, grant.account_id) in self._starting:
                raise AgentError(409, "SESSION_BUSY", "บัญชีนี้กำลัง LIVE อยู่")
            if self._components is not None and self._components_view(authorized=True)["state"] != "READY":
                raise AgentError(503, "COMPONENTS_REQUIRED", "กรุณารอให้เตรียมเครื่องเสร็จ")
            if not hardware.compatible:
                raise AgentError(503, "GPU_REQUIRED", "เครื่องนี้ยังไม่รองรับ AI LIVE")
            if not self._validated:
                raise AgentError(503, "GPU_VALIDATION_REQUIRED", "AI LIVE ยังอยู่ระหว่างการเตรียมความพร้อม")
            if not worker_ready:
                raise AgentError(503, "WORKER_NOT_VALIDATED", "ระบบ AI LIVE ยังไม่พร้อมใช้งาน")
            capacity = self._room_capacity(grant.owner_id)
            if capacity["status"] == "UNVERIFIED_CAPACITY":
                raise AgentError(503, "UNVERIFIED_CAPACITY", "ยังไม่ได้ทดสอบจำนวนห้องพร้อมกัน")
            if not capacity["canStartAnotherRoom"]:
                raise AgentError(409, "ROOM_CAPACITY_REACHED", "เครื่องนี้กำลังใช้จำนวนห้องที่รองรับครบแล้ว")
            reference.owner_id = grant.owner_id
            reservation = (grant.owner_id, grant.account_id)
            self._starting.add(reservation)
            authorization_generation = self._authorization_generation
        try:
            try:
                session_id = self._worker.start_session(grant.owner_id, grant.account_id,
                                                        grant.product_ids, reference.path,
                                                        microphone_id)
            except AgentError:
                raise
            except Exception as exc:
                raise AgentError(503, "WORKER_START_FAILED", "ไม่สามารถเริ่ม AI LIVE") from exc
            try:
                session_id = str(uuid.UUID(session_id))
            except (ValueError, TypeError) as exc:
                raise AgentError(503, "WORKER_INVALID_SESSION", "ไม่สามารถเริ่ม AI LIVE") from exc
            # Revoke/exit may race slow model preparation. Stop the newly-created
            # owned room instead of admitting it after its authorization changed.
            with self._lock:
                revoked = (self._closing or authorization_generation != self._authorization_generation
                           or grant.expires_at <= self._now())
                if not revoked:
                    if session_id in self._sessions:
                        raise AgentError(503, "WORKER_INVALID_SESSION", "ไม่สามารถเริ่ม AI LIVE")
                    self._sessions[session_id] = _Session(session_id, grant.owner_id, grant.expires_at,
                        account_id=grant.account_id, product_ids=tuple(grant.product_ids), started_at=int(self._now() * 1000))
            if revoked:
                try:
                    self._worker.stop_session(grant.owner_id, session_id)
                except Exception as exc:
                    with self._lock:
                        self._sessions[session_id] = _Session(session_id, grant.owner_id, grant.expires_at,
                            state="STOPPING" if getattr(exc, "code", None) == "WORKER_STOP_PENDING" else "ERROR",
                            account_id=grant.account_id, product_ids=tuple(grant.product_ids), started_at=int(self._now() * 1000))
                raise AgentError(403, "DEVICE_REVOKED", "เครื่องนี้ไม่ได้รับอนุญาตให้ LIVE")
            # The worker copied the bounded reference into its own room storage.
            # Ephemeral browser uploads should not consume the next room's quota.
            with self._lock:
                self._references.pop(presenter_id, None)
            reference.path.unlink(missing_ok=True)
        finally:
            with self._lock:
                self._starting.discard(reservation)
        result = self._view(token, origin)
        result.update({"sessionId": session_id, "activeAccountId": grant.account_id,
                       "currentProductId": grant.product_ids[0] if grant.product_ids else None,
                       "sessionStartedAt": self._sessions[session_id].started_at})
        return result

    def pause(self, token: str, origin: str, session_id: str) -> dict[str, object]:
        session = self._owned_session(token, origin, session_id)
        with session.operation_lock:
            if session.state != "BUSY":
                raise AgentError(409, "SESSION_NOT_RUNNING", "AI LIVE ไม่ได้กำลังทำงาน")
            self._worker.pause_session(session.owner_id, session_id)
            session.state = "PAUSED"
        return self._view(token, origin)

    def resume(self, token: str, origin: str, session_id: str) -> dict[str, object]:
        session = self._owned_session(token, origin, session_id)
        with session.operation_lock:
            if session.state != "PAUSED":
                raise AgentError(409, "SESSION_NOT_PAUSED", "AI LIVE ไม่ได้หยุดชั่วคราว")
            if not self._validated or not self._assessment().compatible:
                raise AgentError(503, "GPU_VALIDATION_REQUIRED", "AI LIVE ยังไม่พร้อมใช้งาน")
            self._worker.resume_session(session.owner_id, session_id)
            session.state = "BUSY"
        return self._view(token, origin)

    def stop(self, token: str, origin: str, session_id: str) -> dict[str, object]:
        # Deliberately no entitlement, version, hardware, or grant-expiry check.
        session = self._owned_session(token, origin, session_id)
        with session.operation_lock:
            if session.state != "STOPPED":
                session.state = "STOPPING"
                try:
                    self._worker.stop_session(session.owner_id, session_id)
                except AgentError as exc:
                    session.state = "STOPPING" if exc.code == "WORKER_STOP_PENDING" else "ERROR"
                    raise
                except Exception as exc:
                    session.state = "ERROR"
                    raise AgentError(503, "WORKER_STOP_FAILED", "ไม่สามารถหยุด AI LIVE") from exc
                session.state = "STOPPED"
        return self._view(token, origin)

    def recover(self, token: str, origin: str, session_id: str) -> dict[str, object]:
        session = self._owned_session(token, origin, session_id)
        with session.operation_lock:
            if session.state != "ERROR" or session.recovery_attempts >= 1:
                raise AgentError(409, "RECOVERY_UNAVAILABLE", "ไม่สามารถกู้คืน AI LIVE")
            if (session.grant_expires_at <= self._now() or not self._validated
                    or not self._assessment().compatible):
                raise AgentError(503, "RECOVERY_UNAVAILABLE", "ไม่สามารถกู้คืน AI LIVE")
            session.recovery_attempts += 1
            try:
                self._worker.recover_session(session.owner_id, session_id)
            except Exception as exc:
                raise AgentError(503, "RECOVERY_FAILED", "ไม่สามารถกู้คืน AI LIVE") from exc
            session.state = "BUSY"
        return self._view(token, origin)

    def report_worker_failure(self, session_id: str) -> None:
        """Trusted worker callback after a crash; never exposed over HTTP."""
        with self._lock:
            session = self._sessions.get(session_id)
            if session and session.state in ("BUSY", "PAUSED", "STOPPING"):
                session.state = "ERROR"

    def close(self) -> None:
        with self._lock:
            self._closing = True
            self._authorization_generation += 1
        self._component_cancel.set()
        self._product_contexts.clear()
        if self._components is not None:
            self._components.cancel()
        if self._component_thread is not None and self._component_thread is not threading.current_thread():
            self._component_thread.join(timeout=35)
        with self._lock:
            for session in self._sessions.values():
                if session.state in ("BUSY", "PAUSED", "STOPPING", "ERROR"):
                    try:
                        self._worker.stop_session(session.owner_id, session.session_id)
                    except Exception:
                        pass
                    session.state = "STOPPED"
            for reference in self._references.values():
                reference.path.unlink(missing_ok=True)
            self._references.clear()
            close_worker = getattr(self._worker, "close", None)
            if callable(close_worker):
                close_worker()
            self._stream_authorizations.clear()
