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
from .security import Grant, PairingStore, SecurityError, verify_ed25519, verify_grant

MAX_REFERENCE_BYTES = 4 * 1024 * 1024
MAX_REFERENCES = 5
VERSIONS = {"web": "0.1.0", "agent": "0.1.0", "worker": "0.1.0",
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

    def __post_init__(self) -> None:
        try:
            if str(uuid.UUID(self.device_id)) != self.device_id.lower():
                raise ValueError
        except ValueError as exc:
            raise ValueError("Device ID must be a UUID created by the installer") from exc
        if not self.data_dir.is_absolute() or self.data_dir.is_symlink():
            raise ValueError("Agent data directory must be absolute and non-symlinked")
        if not self.grant_public_key_pem:
            raise ValueError("Pinned cloud grant public key is required")


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
            challenge, expires = self._pairings.challenge(token, origin)
        except SecurityError as exc:
            raise self._safe_error(exc) from exc
        return {"challenge": challenge, "expiresAt": int(expires)}

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
        return {"state": "READY", "versions": VERSIONS.copy(), "paired": False}

    def _assessment(self) -> HardwareAssessment:
        try:
            return assess_hardware(self._hardware_probe(), self.config.hardware_tiers)
        except Exception:
            # No OS/driver traceback or local path is ever returned to the UI.
            return HardwareAssessment(False, "UNSUPPORTED", True,
                                      ("ไม่สามารถตรวจสอบเครื่องนี้ได้",),
                                      {"marker": "GPU_VALIDATION_REQUIRED", "codes": ["HARDWARE_CHECK_FAILED"]})

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
        if active:
            state, message, reasons = active.state, "AI LIVE กำลังทำงาน" if active.state == "BUSY" else "AI LIVE หยุดชั่วคราว", []
        elif failed:
            state, message, reasons = "ERROR", "AI LIVE ขัดข้อง", ["ลองกู้คืนหรือหยุดรายการ"]
        elif not hardware.compatible:
            state, message, reasons = "GPU_REQUIRED", "เครื่องนี้ยังไม่รองรับ AI LIVE", list(hardware.customer_reasons)
        elif not self._validated or not worker_ready:
            state, message, reasons = "STARTING", "AI LIVE ยังอยู่ระหว่างการเตรียมความพร้อม", ["กำลังรอการทดสอบการแสดงสดบนเครื่องที่รองรับ"]
        else:
            state, message, reasons = "READY", "พร้อมสำหรับ AI LIVE", []
        result: dict[str, object] = {
            "state": state, "message": message, "reasons": reasons,
            "paired": True,
            "canStart": state == "READY",
            "sessionActive": active is not None or failed is not None,
            "versions": VERSIONS.copy(),
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
            grant = verify_grant(body.get("grant"), self.config.grant_public_key_pem,
                                 now=self._now(), verifier=self._grant_signature_verifier)
            self._pairings.consume_grant(token, origin, grant, self.config.device_id)
        except SecurityError as exc:
            raise self._safe_error(exc) from exc
        if grant.versions != VERSIONS:
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
