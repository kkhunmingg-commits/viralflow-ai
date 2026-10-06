"""Run verified presenter dependencies in our portable runtime, never system Python."""
from __future__ import annotations

import base64
import ctypes
import json
import os
import queue
import subprocess
import threading
import sys
import uuid
from pathlib import Path

from .agent import AgentError
from .security import SecurityError

MAX_MESSAGE = 6 * 1024 * 1024


class WindowsChildJob:
    """Close only our worker and its descendants after an agent crash/timeout."""
    def __init__(self, process):
        from ctypes import wintypes
        class Basic(ctypes.Structure):
            _fields_ = [("processTime", ctypes.c_int64), ("jobTime", ctypes.c_int64),
                        ("flags", wintypes.DWORD), ("minimum", ctypes.c_size_t), ("maximum", ctypes.c_size_t),
                        ("active", wintypes.DWORD), ("affinity", ctypes.c_size_t),
                        ("priority", wintypes.DWORD), ("scheduling", wintypes.DWORD)]
        class IO(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in ("readOps", "writeOps", "otherOps", "readBytes", "writeBytes", "otherBytes")]
        class Extended(ctypes.Structure):
            _fields_ = [("basic", Basic), ("io", IO), ("processMemory", ctypes.c_size_t),
                        ("jobMemory", ctypes.c_size_t), ("peakProcessMemory", ctypes.c_size_t), ("peakJobMemory", ctypes.c_size_t)]
        api = ctypes.WinDLL("kernel32", use_last_error=True)
        api.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        api.CreateJobObjectW.restype = wintypes.HANDLE
        api.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        api.SetInformationJobObject.restype = wintypes.BOOL
        api.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        api.AssignProcessToJobObject.restype = wintypes.BOOL
        api.CloseHandle.argtypes = [wintypes.HANDLE]
        api.CloseHandle.restype = wintypes.BOOL
        self.api, self.handle = api, api.CreateJobObjectW(None, None)
        information = Extended()
        information.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE.
        if (not self.handle or not api.SetInformationJobObject(self.handle, 9, ctypes.byref(information), ctypes.sizeof(information))
                or not api.AssignProcessToJobObject(self.handle, wintypes.HANDLE(int(process._handle)))):
            self.close()
            raise OSError("worker isolation unavailable")

    def close(self):
        if self.handle:
            self.api.CloseHandle(self.handle)
            self.handle = None


class _ManagedRoomProcess:
    def __init__(self, app_root: Path, components, *, process_factory=subprocess.Popen,
                 timeout_seconds: float = 30, room_id: str | None = None):
        self.app_root = app_root
        self.components = components
        self._process_factory = process_factory
        self._timeout = timeout_seconds
        self._room_id = room_id
        self._process = None
        self._reader = None
        self._writer = None
        self._responses = queue.Queue(maxsize=2)
        self._lock = threading.RLock()
        self._counter = 0
        self._active_root = None
        self._closed = False
        self._job = None
        self._has_started_session = False

    def _read(self, process, responses) -> None:
        try:
            while True:
                raw = process.stdout.readline(MAX_MESSAGE + 1)
                if not raw:
                    break
                if len(raw) > MAX_MESSAGE or not raw.endswith(b"\n"):
                    break
                try:
                    responses.put(json.loads(raw), timeout=1)
                except (ValueError, queue.Full):
                    break
        except (OSError, ValueError):
            pass
        finally:
            try:
                responses.put({"error": "WORKER_DISCONNECTED"}, timeout=1)
            except queue.Full:
                pass

    def _send(self, process, body: bytes, timeout_seconds: float | None = None) -> None:
        """A stopped child cannot indefinitely block the local HTTP boundary."""
        result = queue.Queue(maxsize=1)
        def write() -> None:
            try:
                view = memoryview(body)
                while view:
                    size = process.stdin.write(view)
                    if not size:
                        raise OSError("closed worker pipe")
                    view = view[size:]
                process.stdin.flush()
                result.put(True)
            except (OSError, ValueError):
                result.put(False)
        self._writer = threading.Thread(target=write, daemon=True, name="managed-presenter-request")
        self._writer.start()
        if result.get(timeout=self._timeout if timeout_seconds is None else timeout_seconds) is not True:
            raise OSError("worker pipe unavailable")
        self._writer.join(timeout=1)
        self._writer = None

    def _launch(self) -> None:
        if self._closed:
            raise AgentError(503, "WORKER_UNAVAILABLE", "กรุณาเปิด ViralFlow ใหม่")
        if self._has_started_session and (self._process is None or self._process.poll() is not None):
            raise AgentError(503, "WORKER_UNAVAILABLE", "ต้องตรวจสอบ LIVE ของบัญชีนี้")
        root = self.components.runtime_root()
        if root is None:
            raise AgentError(503, "COMPONENTS_REQUIRED", "กำลังเตรียมส่วนประกอบ")
        if self._process is not None and self._process.poll() is None:
            if root != self._active_root:
                raise AgentError(503, "WORKER_RESTART_REQUIRED", "กรุณาเปิด ViralFlow ใหม่")
            return
        self._terminate()
        if not self.components.verify_current():
            raise AgentError(503, "COMPONENTS_REPAIR_REQUIRED", "กรุณาซ่อมแซมส่วนประกอบ")
        interpreter = root / "runtime" / "python.exe"
        entry = root / "worker" / "managed_worker_entry.py"
        if not interpreter.is_file() or not entry.is_file():
            raise AgentError(503, "COMPONENTS_REQUIRED", "กำลังเตรียมส่วนประกอบ")
        environment = {name: value for name, value in os.environ.items()
                       if name.upper() in {"SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA", "USERPROFILE"}}
        environment.update({"PYTHONDONTWRITEBYTECODE": "1", "PYTHONNOUSERSITE": "1",
                            "PATH": str(root / "runtime"), "HF_HUB_OFFLINE": "1"})
        if self.components.profile == "cpu-dev":
            from provider_config import dev_fallback_enabled
            if not dev_fallback_enabled():
                raise AgentError(503, "DEV_FALLBACK_DISABLED", "AI LIVE กำลังเตรียมพร้อม")
        self._responses = queue.Queue(maxsize=2)
        try:
            process = self._process_factory([str(interpreter), "-I", "-B", str(entry)], cwd=root,
                env=environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                bufsize=0, shell=False, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            self._process, self._active_root = process, root
            if sys.platform == "win32" and self._process_factory is subprocess.Popen:
                self._job = WindowsChildJob(process)
            self._reader = threading.Thread(target=self._read, args=(process, self._responses), daemon=True, name="managed-presenter-response")
            self._reader.start()
            config = {"root": str(self.app_root), "componentRoot": str(root), "profile": self.components.profile}
            if self._room_id is not None:
                config["roomId"] = self._room_id
            self._send(process, json.dumps(config).encode() + b"\n")
            ready = self._responses.get(timeout=self._timeout)
            if ready != {"ready": True}:
                raise ValueError
        except Exception:
            self._terminate()
            raise AgentError(503, "WORKER_UNAVAILABLE", "ยังเตรียมเครื่องไม่สำเร็จ กรุณาลองอีกครั้ง") from None

    def _terminate(self) -> None:
        process, self._process = self._process, None
        if self._job is not None:
            self._job.close()
            self._job = None
        if process is not None:
            if process.poll() is None:
                process.kill()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
            if self._writer is not None:
                self._writer.join(timeout=2)
            for stream in (process.stdin, process.stdout):
                if stream is not None:
                    stream.close()
        if self._reader is not None and self._reader is not threading.current_thread():
            self._reader.join(timeout=2)
        self._reader = None
        self._writer = None

    def _call(self, method: str, *args, timeout_seconds: float | None = None):
        with self._lock:
            self._launch()
            self._counter += 1
            body = json.dumps({"id": self._counter, "method": method, "args": args}).encode() + b"\n"
            if len(body) > MAX_MESSAGE:
                raise AgentError(413, "WORKER_INPUT_TOO_LARGE", "ข้อมูลมีขนาดใหญ่เกินไป")
            try:
                budget = self._timeout if timeout_seconds is None else timeout_seconds
                self._send(self._process, body, budget)
                response = self._responses.get(timeout=budget)
                if (not isinstance(response, dict) or type(response.get("id")) is not int
                        or response["id"] != self._counter or set(response) not in ({"id", "value"}, {"id", "error"})):
                    raise ValueError
            except Exception:
                self._terminate()
                raise AgentError(503, "WORKER_UNAVAILABLE", "ไม่สามารถเตรียม AI LIVE ได้") from None
            if "error" in response:
                code = response["error"]
                if not isinstance(code, str) or len(code) > 64 or not code.isascii() or not code.replace("_", "").isalnum():
                    code = "WORKER_UNAVAILABLE"
                raise AgentError(503, code, "AI LIVE ยังไม่พร้อม กรุณาตรวจสอบเครื่อง")
            return response.get("value")

    def health(self):
        if self.components.status().get("state") != "READY":
            return {"ready": False, "status": "COMPONENTS_REQUIRED"}
        try:
            result = self._call("health")
            return result if isinstance(result, dict) else {"ready": False}
        except (AgentError, SecurityError):
            return {"ready": False, "status": "WORKER_UNAVAILABLE"}

    def start_session(self, owner_id, account_id, product_ids, presenter_path, microphone_id):
        result = self._call("start_session", owner_id, account_id, list(product_ids), str(presenter_path), microphone_id)
        self._has_started_session = True
        return result

    def pause_session(self, owner, session):
        return self._call("pause_session", owner, session)

    def resume_session(self, owner, session):
        return self._call("resume_session", owner, session)

    def stop_session(self, owner, session):
        return self._call("stop_session", owner, session)

    def recover_session(self, owner, session):
        return self._call("recover_session", owner, session)

    def push_audio(self, owner, session, pcm):
        return self._call("push_audio", owner, session, base64.b64encode(pcm).decode("ascii"))

    def preview_frame(self, owner, session):
        value = self._call("preview_frame", owner, session)
        if value is None:
            return None
        try:
            if (not isinstance(value, dict) or set(value) != {"bytes"}
                    or not isinstance(value["bytes"], str) or len(value["bytes"]) > 5_592_408):
                raise ValueError
            frame = base64.b64decode(value["bytes"], validate=True)
            if len(frame) > 4 * 1024 * 1024 or not frame.startswith(b"\xff\xd8") or not frame.endswith(b"\xff\xd9"):
                raise ValueError
            return frame
        except (ValueError, TypeError):
            with self._lock:
                self._terminate()
            raise AgentError(503, "PREVIEW_UNAVAILABLE", "ยังไม่มีภาพจากระบบ") from None

    def customer_stream(self, owner, session):
        if not self._lock.acquire(timeout=0.01):
            # Another command in this room is in flight. No other room waits for
            # its native deadline; unavailable observation is not an error claim.
            return {"phase": "PREPARING", "connectionQuality": "UNAVAILABLE"}
        try:
            result = self._call("customer_stream", owner, session, timeout_seconds=min(0.2, self._timeout))
            return result if isinstance(result, dict) else {"phase": "ERROR", "connectionQuality": "PROBLEM"}
        except AgentError:
            return {"phase": "ERROR", "connectionQuality": "PROBLEM"}
        finally:
            self._lock.release()

    def close(self):
        with self._lock:
            try:
                if self._process is not None and self._process.poll() is None:
                    self._call("close")
            except AgentError:
                pass
            finally:
                self._terminate()
                self._closed = True


class ManagedRuntimeWorker:
    """One inherited-pipe process/job per physical room; no shared audio/model state.

    The authenticated LocalAgent owns measured-capacity admission. This boundary
    additionally caps resource creation and refuses duplicate account lifecycles.
    A timed-out child cannot terminate another room or accept a new session ID.
    """
    def __init__(self, app_root: Path, components, *, process_factory=subprocess.Popen,
                 timeout_seconds: float = 30):
        self.app_root, self.components = app_root, components
        self._factory, self._timeout = process_factory, timeout_seconds
        self._probe = self._new_process()
        self._probe_claimed = False
        self._rooms: dict[tuple[str, str], _ManagedRoomProcess] = {}
        self._accounts: dict[tuple[str, str], tuple[str, str]] = {}
        self._pending: set[tuple[str, str]] = set()
        self._stopped: set[tuple[str, str]] = set()
        self._lock = threading.RLock()
        self._closed = False
        self._health_cached = {"ready": False}

    def _new_process(self):
        return _ManagedRoomProcess(self.app_root, self.components,
            process_factory=self._factory, timeout_seconds=self._timeout, room_id=str(uuid.uuid4()))

    @staticmethod
    def _missing():
        return AgentError(404, "SESSION_NOT_FOUND", "ไม่พบ LIVE ของบัญชีนี้")

    def _owned(self, owner, session):
        with self._lock:
            process = self._rooms.get((owner, session))
            if process is None:
                raise self._missing()
            return process

    def health(self):
        with self._lock:
            if self._closed:
                return {"ready": False, "status": "WORKER_UNAVAILABLE"}
            # Reuse an existing healthy process for inspection. A failed room is
            # inspected separately through its session and never silently restarted.
            probe = self._probe
            if self._probe_claimed:
                return dict(self._health_cached)
        result = probe.health()
        with self._lock:
            self._health_cached = dict(result)
        return result

    def start_session(self, owner_id, account_id, product_ids, presenter_path, microphone_id):
        key = (owner_id, account_id)
        with self._lock:
            if self._closed:
                raise AgentError(503, "WORKER_UNAVAILABLE", "กรุณาเปิด ViralFlow ใหม่")
            if key in self._accounts or key in self._pending:
                raise AgentError(409, "SESSION_BUSY", "บัญชีนี้กำลัง LIVE อยู่")
            if len(self._accounts) + len(self._pending) >= 10:
                raise AgentError(409, "ROOM_CAPACITY_REACHED", "ใช้จำนวนห้องครบแล้ว")
            self._pending.add(key)
            process = self._new_process() if self._probe_claimed else self._probe
            self._probe_claimed = True
        try:
            session_id = process.start_session(owner_id, account_id, product_ids, presenter_path, microphone_id)
            try:
                if not isinstance(session_id, str) or str(uuid.UUID(session_id)) != session_id.lower():
                    raise ValueError
            except (ValueError, TypeError, AttributeError):
                raise AgentError(503, "WORKER_INVALID_SESSION", "ไม่สามารถเริ่ม LIVE ได้") from None
            route = (owner_id, session_id)
            with self._lock:
                if self._closed or route in self._rooms:
                    raise AgentError(503, "WORKER_INVALID_SESSION", "ไม่สามารถเริ่ม LIVE ได้")
                self._rooms[route], self._accounts[key] = process, route
                # Keep a small terminal history without retaining old processes.
                for old in list(self._stopped)[:-20]:
                    self._stopped.discard(old)
                    self._rooms.pop(old, None)
            return session_id
        except Exception:
            process.close()
            if process is self._probe:
                with self._lock:
                    self._probe = self._new_process()
                    self._probe_claimed = False
            raise
        finally:
            with self._lock:
                self._pending.discard(key)

    def pause_session(self, owner, session):
        return self._owned(owner, session).pause_session(owner, session)

    def resume_session(self, owner, session):
        return self._owned(owner, session).resume_session(owner, session)

    def stop_session(self, owner, session):
        process = self._owned(owner, session)
        route = (owner, session)
        with self._lock:
            if route in self._stopped:
                return
        # A proven dead process has already released its native resources. Never
        # launch another child just to Stop a session that the new child cannot own.
        if process._process is not None and process._process.poll() is None:
            process.stop_session(owner, session)
        process.close()
        with self._lock:
            self._stopped.add(route)
            for account, target in list(self._accounts.items()):
                if target == route:
                    self._accounts.pop(account)
            if process is self._probe:
                self._probe, self._probe_claimed = self._new_process(), False

    def recover_session(self, owner, session):
        return self._owned(owner, session).recover_session(owner, session)

    def push_audio(self, owner, session, pcm):
        return self._owned(owner, session).push_audio(owner, session, pcm)

    def preview_frame(self, owner, session):
        return self._owned(owner, session).preview_frame(owner, session)

    def customer_stream(self, owner, session):
        process = self._owned(owner, session)
        with self._lock:
            if (owner, session) in self._stopped:
                return {"phase": "STOPPED", "connectionQuality": "UNAVAILABLE"}
        # Only this room reports the child's failure; all other routes stay alive.
        if process._process is None or process._process.poll() is not None:
            return {"phase": "ERROR", "connectionQuality": "PROBLEM"}
        return process.customer_stream(owner, session)

    def close(self):
        with self._lock:
            self._closed = True
            children = set(self._rooms.values()) | {self._probe}
        for process in children:
            process.close()
