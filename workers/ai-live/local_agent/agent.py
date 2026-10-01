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
from .security import Grant, PairingStore, SecurityError, verify_device_message, verify_ed25519, verify_grant
from .device_identity import DeviceIdentity
from .updater import SafeUpdater

MAX_REFERENCE_BYTES = 4 * 1024 * 1024
MAX_REFERENCES = 5
VERSIONS = {"web": "0.3.0", "agent": "0.3.0", "worker": "0.3.0",
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
        device_identity: DeviceIdentity | None = None,
        update_status: Callable[[], str] | None = None,
        updater: SafeUpdater | None = None,
    ) -> None:
        self.config = config
        self._now = now
        self._pairings = PairingStore(config.pairing_code, now=now)
        self._worker = worker or UnavailableWorker()
        self._hardware_probe = hardware_probe or (lambda: inspect_hardware(config.data_dir))
        self._grant_signature_verifier = grant_signature_verifier
        self._validated = REALTIME_VALIDATED or test_only_realtime_validated
        self._references: dict[str, _Reference] = {}
        self._sessions: dict[str, _Session] = {}
        self._used_grants: set[str] = set()
        self._device_identity = device_identity
        self._update_status = update_status or (lambda: "CURRENT")
        self._updater = updater
        self._update_thread: threading.Thread | None = None
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
                self._device_identity.mark_revoked(payload["issuedAt"])
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
        worker_ready = self._worker.health().get("ready") is True
        try:
            self._authorized_device(token, origin)
            authorized = True
        except SecurityError:
            authorized = False
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
        }
        visible_session = active or failed
        if visible_session:
            result["sessionId"] = visible_session.session_id
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
        microphone_id = body.get("microphoneId")
        if microphone_id not in (None, "default"):
            raise AgentError(422, "MICROPHONE_NOT_ALLOWED", "ไม่พบไมโครโฟนที่เลือก")
        presenter_id = body.get("presenterId")
        if not isinstance(presenter_id, str):
            raise AgentError(422, "PRESENTER_REQUIRED", "กรุณาเลือกรูปผู้นำเสนอ")
        with self._lock:
            if self._current_update_status() in ("UPDATING", "RESTART_REQUIRED", "REQUIRED", "UPDATE_REQUIRED"):
                raise AgentError(426, "UPDATE_REQUIRED", "ต้องอัปเดต AI LIVE")
            if grant.grant_id in self._used_grants:
                raise AgentError(403, "GRANT_REPLAY", "ไม่สามารถตรวจสอบสิทธิ์ AI LIVE")
            self._used_grants.add(grant.grant_id)
            reference = self._references.get(presenter_id)
            if reference is None or not hmac.compare_digest(reference.token, token):
                raise AgentError(404, "PRESENTER_NOT_FOUND", "ไม่พบรูปผู้นำเสนอ")
            if any(session.state in ("BUSY", "PAUSED", "STOPPING") for session in self._sessions.values()):
                raise AgentError(409, "SESSION_BUSY", "AI LIVE กำลังทำงาน")
            hardware = self._assessment()
            if not hardware.compatible:
                raise AgentError(503, "GPU_REQUIRED", "เครื่องนี้ยังไม่รองรับ AI LIVE")
            if not self._validated:
                raise AgentError(503, "GPU_VALIDATION_REQUIRED", "AI LIVE ยังอยู่ระหว่างการเตรียมความพร้อม")
            if self._worker.health().get("ready") is not True:
                raise AgentError(503, "WORKER_NOT_VALIDATED", "ระบบ AI LIVE ยังไม่พร้อมใช้งาน")
            reference.owner_id = grant.owner_id
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
            self._sessions[session_id] = _Session(session_id, grant.owner_id, grant.expires_at)
        return self._view(token, origin)

    def pause(self, token: str, origin: str, session_id: str) -> dict[str, object]:
        session = self._owned_session(token, origin, session_id)
        with self._lock:
            if session.state != "BUSY":
                raise AgentError(409, "SESSION_NOT_RUNNING", "AI LIVE ไม่ได้กำลังทำงาน")
            self._worker.pause_session(session.owner_id, session_id)
            session.state = "PAUSED"
        return self._view(token, origin)

    def resume(self, token: str, origin: str, session_id: str) -> dict[str, object]:
        session = self._owned_session(token, origin, session_id)
        with self._lock:
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
        with self._lock:
            if session.state not in ("STOPPED", "STOPPING"):
                session.state = "STOPPING"
                try:
                    self._worker.stop_session(session.owner_id, session_id)
                except Exception as exc:
                    session.state = "ERROR"
                    raise AgentError(503, "WORKER_STOP_FAILED", "ไม่สามารถหยุด AI LIVE") from exc
                session.state = "STOPPED"
        return self._view(token, origin)

    def recover(self, token: str, origin: str, session_id: str) -> dict[str, object]:
        session = self._owned_session(token, origin, session_id)
        with self._lock:
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
