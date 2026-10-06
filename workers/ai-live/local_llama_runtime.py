"""Managed, authenticated loopback llama.cpp inference. No cloud AI client.

Paths and expected digests come from the signed local model manager, never from
comments or a browser request. This module does not download models.
"""
from __future__ import annotations

import hashlib
import ctypes
import http.client
import json
import math
import os
import re
import secrets
import socket
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from contextlib import contextmanager
from typing import Mapping, Sequence

MODEL_PROFILES = {
    "qwen3-4b-q4_k_m": {"minimum_ram_mib": 8192, "minimum_brain_budget_mib": 5120},
    "qwen3-8b-q4_k_m": {"minimum_ram_mib": 16384, "minimum_brain_budget_mib": 6144},
}
MAX_REQUEST_BYTES = 16_384
MAX_RESPONSE_BYTES = 65_536
MODEL_ALIAS = "viralflow-local-brain"
_MODEL_ADMISSION_LOCK = threading.Lock()
STATE_MARKER = b'{"format":"viralflow-local-brain-state-v1"}'


class BrainRuntimeError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class LlamaRuntimeConfig:
    managed_root: Path
    executable: Path
    model_path: Path
    executable_sha256: str
    model_sha256: str
    profile: str = "qwen3-4b-q4_k_m"
    threads: int = 4
    context_tokens: int = 2048
    gpu_layers: int = 0
    # 8B admission requires measured resources, after presenter/audio reservation.
    total_ram_mib: int = 0
    brain_budget_mib: int = 0
    startup_timeout_seconds: float = 60
    state_root: Path | None = None
    minimum_available_ram_mib: int = 0  # Factory sets the measured production admission.

    def __post_init__(self):
        if self.profile not in MODEL_PROFILES:
            raise BrainRuntimeError("LOCAL_BRAIN_PROFILE_INVALID")
        if (type(self.threads) is not int or not 1 <= self.threads <= 64
                or type(self.context_tokens) is not int or not 512 <= self.context_tokens <= 4096
                or type(self.gpu_layers) is not int or not 0 <= self.gpu_layers <= 99
                or not math.isfinite(self.startup_timeout_seconds)
                or not 1 <= self.startup_timeout_seconds <= 180):
            raise BrainRuntimeError("LOCAL_BRAIN_CONFIG_INVALID")
        if type(self.minimum_available_ram_mib) is not int or not 0 <= self.minimum_available_ram_mib <= 65536:
            raise BrainRuntimeError("LOCAL_BRAIN_CONFIG_INVALID")
        if self.profile == "qwen3-8b-q4_k_m":
            limits = MODEL_PROFILES[self.profile]
            if (self.total_ram_mib < limits["minimum_ram_mib"]
                    or self.brain_budget_mib < limits["minimum_brain_budget_mib"]):
                raise BrainRuntimeError("LOCAL_BRAIN_HARDWARE_UNSUPPORTED")


@dataclass(frozen=True)
class LlamaGeneration:
    text: str
    latency_ms: float
    first_token_ms: float | None
    completion_tokens: int
    tokens_per_second: float | None


class PendingLocalBrainRuntime:
    """Honest state for a legacy installation without a signed local brain."""
    def health(self) -> dict[str, object]:
        return {"ready": False, "loaded": False, "provider": "local", "code": "LOCAL_BRAIN_MODEL_PENDING"}

    def warmup(self, *, timeout_seconds: float = 30) -> dict[str, object]:
        return self.health()

    def generate(self, *args, **kwargs) -> LlamaGeneration:
        raise BrainRuntimeError("LOCAL_BRAIN_MODEL_PENDING")

    def close(self) -> None:
        pass


def physical_memory_mib() -> tuple[int, int]:
    """Actual total/available physical memory, without a production dependency."""
    if os.name == "nt":
        class MemoryStatus(ctypes.Structure):
            _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong),
                *[(name, ctypes.c_ulonglong) for name in ("total", "available", "page_total", "page_available",
                                                         "virtual_total", "virtual_available", "extended")]]
        value = MemoryStatus()
        value.length = ctypes.sizeof(value)
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(value)):
            raise BrainRuntimeError("LOCAL_BRAIN_HARDWARE_UNSUPPORTED")
        return value.total // 1048576, value.available // 1048576
    try:
        fields = {line.split(":")[0]: int(line.split()[1])
                  for line in Path("/proc/meminfo").read_text().splitlines()}
        return fields["MemTotal"] // 1024, fields["MemAvailable"] // 1024
    except (OSError, KeyError, ValueError):
        raise BrainRuntimeError("LOCAL_BRAIN_HARDWARE_UNSUPPORTED") from None


def _windows_user_sid() -> str:
    from ctypes import wintypes
    token = wintypes.HANDLE()
    kernel, advapi = ctypes.windll.kernel32, ctypes.windll.advapi32
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    advapi.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    advapi.GetTokenInformation.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.c_void_p,
                                         wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    advapi.ConvertSidToStringSidW.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.LPWSTR)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    if not advapi.OpenProcessToken(kernel.GetCurrentProcess(), 8, ctypes.byref(token)):
        raise BrainRuntimeError("LOCAL_BRAIN_PRIVATE_STATE_FAILED")
    try:
        size = wintypes.DWORD()
        advapi.GetTokenInformation(token, 1, None, 0, ctypes.byref(size))
        data = ctypes.create_string_buffer(size.value)
        if not advapi.GetTokenInformation(token, 1, data, size, ctypes.byref(size)):
            raise BrainRuntimeError("LOCAL_BRAIN_PRIVATE_STATE_FAILED")
        sid = ctypes.cast(data, ctypes.POINTER(ctypes.c_void_p))[0]
        converted = wintypes.LPWSTR()
        if not advapi.ConvertSidToStringSidW(ctypes.c_void_p(sid), ctypes.byref(converted)):
            raise BrainRuntimeError("LOCAL_BRAIN_PRIVATE_STATE_FAILED")
        try:
            return converted.value
        finally:
            kernel.LocalFree(converted)
    finally:
        kernel.CloseHandle(token)


def _private_state(root: Path) -> tuple[Path, str]:
    root = root.absolute()
    for path in (root, *root.parents):
        if path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction()):
            raise BrainRuntimeError("LOCAL_BRAIN_PATH_INVALID")
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    marker = root / ".managed-brain-state.json"
    if marker.is_symlink() or (marker.exists() and marker.read_bytes() != STATE_MARKER):
        raise BrainRuntimeError("LOCAL_BRAIN_PRIVATE_STATE_FAILED")
    if not marker.exists():
        descriptor = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            output.write(STATE_MARKER)
    if os.name != "nt":
        os.chmod(root, 0o700)
        return root, str(os.getuid())
    from ctypes import wintypes
    sid = _windows_user_sid()
    descriptor = ctypes.c_void_p()
    advapi, kernel = ctypes.windll.advapi32, ctypes.windll.kernel32
    advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD,
                                                                          ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p]
    advapi.GetSecurityDescriptorDacl.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.BOOL),
                                                ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(wintypes.BOOL)]
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    sddl = f"D:P(A;OICI;FA;;;{sid})(A;OICI;FA;;;SY)"
    if not advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, ctypes.byref(descriptor), None):
        raise BrainRuntimeError("LOCAL_BRAIN_PRIVATE_STATE_FAILED")
    try:
        present, defaulted, acl = wintypes.BOOL(), wintypes.BOOL(), ctypes.c_void_p()
        if not advapi.GetSecurityDescriptorDacl(descriptor, ctypes.byref(present), ctypes.byref(acl), ctypes.byref(defaulted)):
            raise BrainRuntimeError("LOCAL_BRAIN_PRIVATE_STATE_FAILED")
        advapi.SetNamedSecurityInfoW.argtypes = [wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD,
                                                ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
        if advapi.SetNamedSecurityInfoW(str(root), 1, 0x80000004, None, None, acl, None) != 0:
            raise BrainRuntimeError("LOCAL_BRAIN_PRIVATE_STATE_FAILED")
        return root, sid
    finally:
        kernel.LocalFree(descriptor)


def cleanup_local_brain_state(managed_application_root: Path) -> None:
    """Uninstaller-only exact owned state cleanup; preserve unrelated files."""
    root = Path(managed_application_root).absolute() / "local-ai-state"
    for path in (root, *root.parents):
        if path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction()):
            raise BrainRuntimeError("LOCAL_BRAIN_PATH_INVALID")
    marker = root / ".managed-brain-state.json"
    if not root.exists() or not marker.is_file() or marker.read_bytes() != STATE_MARKER:
        return
    with _model_admission(root, 3):
        for path in root.iterdir():
            if path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction()):
                raise BrainRuntimeError("LOCAL_BRAIN_PATH_INVALID")
            if path.is_file() and re.fullmatch(r"\.brain-auth-[a-f0-9]{24}", path.name):
                path.unlink()
    (root / ".brain-admission-lock").unlink(missing_ok=True)
    marker.unlink()
    if not any(root.iterdir()):
        root.rmdir()


@contextmanager
def _model_admission(state_root: Path, timeout: float):
    """Serialize model residency across room child processes on this user host."""
    if not _MODEL_ADMISSION_LOCK.acquire(timeout=timeout):
        raise BrainRuntimeError("LOCAL_BRAIN_START_TIMEOUT")
    handle, lock_file = None, None
    try:
        root, identity = _private_state(state_root)
        if os.name == "nt":
            from ctypes import wintypes
            kernel = ctypes.windll.kernel32
            kernel.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
            kernel.CreateMutexW.restype = wintypes.HANDLE
            handle = kernel.CreateMutexW(None, False, "Local\\ViralFlowLocalBrain-" + identity)
            if not handle:
                raise BrainRuntimeError("LOCAL_BRAIN_PRIVATE_STATE_FAILED")
            kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
            status = kernel.WaitForSingleObject(handle, int(timeout * 1000))
            if status not in (0, 0x80):
                kernel.CloseHandle(handle)
                handle = None
                raise BrainRuntimeError("LOCAL_BRAIN_START_TIMEOUT")
        else:
            import fcntl
            path = root / ".brain-admission-lock"
            if path.is_symlink():
                raise BrainRuntimeError("LOCAL_BRAIN_PATH_INVALID")
            lock_file = path.open("a+b")
            os.chmod(path, 0o600)
            deadline = time.monotonic() + timeout
            while True:
                try:
                    fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise BrainRuntimeError("LOCAL_BRAIN_START_TIMEOUT")
                    time.sleep(0.025)
        yield
    finally:
        if handle is not None:
            kernel.ReleaseMutex.argtypes = [wintypes.HANDLE]
            kernel.ReleaseMutex(handle)
            kernel.CloseHandle.argtypes = [wintypes.HANDLE]
            kernel.CloseHandle(handle)
        if lock_file is not None:
            lock_file.close()
        _MODEL_ADMISSION_LOCK.release()


def _verified_file(root: Path, path: Path, expected_hash: str, suffix: str) -> Path:
    if len(expected_hash) != 64 or any(c not in "0123456789abcdef" for c in expected_hash):
        raise BrainRuntimeError("LOCAL_BRAIN_HASH_REQUIRED")
    root = Path(root).absolute()
    path = Path(path).absolute()
    if not root.is_dir() or root.is_symlink() or not path.is_relative_to(root):
        raise BrainRuntimeError("LOCAL_BRAIN_PATH_INVALID")
    # Reject symlinks and Windows junctions anywhere beneath the managed root.
    for current in (root, *path.relative_to(root).parents):
        current = current if current == root else root / current
        if current.is_symlink() or (hasattr(current, "is_junction") and current.is_junction()):
            raise BrainRuntimeError("LOCAL_BRAIN_PATH_INVALID")
    if (path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction())
            or not path.is_file() or path.suffix.lower() != suffix
            or not path.resolve().is_relative_to(root.resolve())):
        raise BrainRuntimeError("LOCAL_BRAIN_PATH_INVALID")
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(4 * 1024 * 1024), b""):
            digest.update(block)
    if not secrets.compare_digest(digest.hexdigest(), expected_hash):
        raise BrainRuntimeError("LOCAL_BRAIN_HASH_MISMATCH")
    return path.resolve()


class ManagedLlamaRuntime:
    def __init__(self, config: LlamaRuntimeConfig):
        self.config = config
        self._process: subprocess.Popen | None = None
        self._port: int | None = None
        self._token: str | None = None
        self._token_path: Path | None = None
        self._warmed = False
        self._state_lock = threading.RLock()
        self._generation_lock = threading.Lock()
        self._active: http.client.HTTPConnection | None = None

    def _connection(self, timeout: float) -> http.client.HTTPConnection:
        if self._port is None or self._token is None:
            raise BrainRuntimeError("LOCAL_BRAIN_NOT_READY")
        # Literal IP and direct HTTPConnection bypass DNS, proxies and redirects.
        return http.client.HTTPConnection("127.0.0.1", self._port, timeout=timeout)

    def _headers(self) -> dict[str, str]:
        return {"Authorization": "Bearer " + (self._token or ""), "Content-Type": "application/json"}

    def start(self) -> None:
        with self._state_lock:
            if self._process is not None and self._process.poll() is None:
                return
            state_root = self.config.state_root or Path(self.config.managed_root).absolute().parent / ".viralflow-local-brain-state"
            if state_root.absolute().is_relative_to(Path(self.config.managed_root).absolute()):
                raise BrainRuntimeError("LOCAL_BRAIN_PATH_INVALID")
            with _model_admission(state_root, self.config.startup_timeout_seconds):
                if self.config.minimum_available_ram_mib:
                    total, available = physical_memory_mib()
                    if (total < MODEL_PROFILES[self.config.profile]["minimum_ram_mib"]
                            or available < self.config.minimum_available_ram_mib):
                        raise BrainRuntimeError("LOCAL_BRAIN_HARDWARE_UNSUPPORTED")
                self._start_managed(state_root)

    def _start_managed(self, state_root: Path) -> None:
        with self._state_lock:
            if self._process is not None and self._process.poll() is None:
                return
            self.close()
            executable = _verified_file(self.config.managed_root, self.config.executable,
                                        self.config.executable_sha256, ".exe" if os.name == "nt" else "")
            model = _verified_file(self.config.managed_root, self.config.model_path,
                                  self.config.model_sha256, ".gguf")
            if executable.name.lower() not in ("llama-server", "llama-server.exe"):
                raise BrainRuntimeError("LOCAL_BRAIN_EXECUTABLE_INVALID")
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as reservation:
                reservation.bind(("127.0.0.1", 0))
                self._port = reservation.getsockname()[1]
            self._token = secrets.token_urlsafe(32)
            self._token_path = state_root.resolve() / (".brain-auth-" + secrets.token_hex(12))
            descriptor = os.open(self._token_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "w", encoding="ascii") as output:
                output.write(self._token + "\n")
            args = [str(executable), "--model", str(model), "--host", "127.0.0.1", "--port", str(self._port),
                    "--api-key-file", str(self._token_path), "--alias", MODEL_ALIAS,
                    "--ctx-size", str(self.config.context_tokens), "--parallel", "1",
                    "--threads", str(self.config.threads), "--n-gpu-layers", str(self.config.gpu_layers),
                    "--jinja", "--reasoning", "off",
                    "--reasoning-budget", "0", "--n-predict", "96", "--no-context-shift",
                    "--no-ui", "--no-slots", "--timeout", "15"]
            # Do not inherit LLAMA_* flags, proxy settings or customer/provider keys.
            environment = {name: value for name, value in os.environ.items()
                           if name.upper() in {"SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LANG", "LC_ALL"}}
            try:
                self._process = subprocess.Popen(args, cwd=executable.parent, env=environment,
                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    shell=False, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                deadline = time.monotonic() + self.config.startup_timeout_seconds
                while time.monotonic() < deadline:
                    if self._process.poll() is not None:
                        raise BrainRuntimeError("LOCAL_BRAIN_START_FAILED")
                    try:
                        connection = self._connection(0.5)
                        try:
                            connection.request("GET", "/v1/models", headers=self._headers())
                            response = connection.getresponse()
                            data = response.read(8193)
                            if response.status == 200 and len(data) <= 8192:
                                models = json.loads(data).get("data", [])
                                if any(item.get("id") == MODEL_ALIAS for item in models):
                                    return
                        finally:
                            connection.close()
                    except (OSError, ValueError, http.client.HTTPException):
                        pass
                    time.sleep(0.05)
                raise BrainRuntimeError("LOCAL_BRAIN_START_TIMEOUT")
            except Exception:
                self.close()
                raise

    def health(self) -> dict[str, object]:
        alive = self._process is not None and self._process.poll() is None
        return {"ready": bool(alive and self._warmed), "loaded": alive, "provider": "local",
                "code": "READY" if alive and self._warmed else "LOCAL_BRAIN_NOT_READY",
                "profile": self.config.profile, "gpu_layers": self.config.gpu_layers}

    def warmup(self, *, timeout_seconds: float = 30) -> dict[str, object]:
        self.start()
        self.generate([{"role": "system", "content": "ตอบภาษาไทยสั้น ๆ /no_think"},
                       {"role": "user", "content": "ทักทายหนึ่งคำ /no_think"}],
                      timeout_seconds=timeout_seconds, max_tokens=8)
        self._warmed = True
        return self.health()

    @staticmethod
    def _abort(connection: http.client.HTTPConnection | None) -> None:
        if connection is not None:
            if connection.sock is not None:
                try:
                    connection.sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
            connection.close()

    def generate(self, messages: Sequence[Mapping[str, str]], *, timeout_seconds: float = 3,
                 cancel_event: threading.Event | None = None, max_tokens: int = 96) -> LlamaGeneration:
        if (not math.isfinite(timeout_seconds) or not 0 < timeout_seconds <= 120
                or type(max_tokens) is not int or not 1 <= max_tokens <= 128
                or not 1 <= len(messages) <= 4
                or any(set(item) != {"role", "content"} or item["role"] not in ("system", "user", "assistant")
                       or not isinstance(item["content"], str) for item in messages)):
            raise BrainRuntimeError("LOCAL_BRAIN_REQUEST_INVALID")
        body = json.dumps({"model": MODEL_ALIAS, "messages": list(messages), "stream": True,
            "stream_options": {"include_usage": True}, "max_tokens": max_tokens,
            "temperature": 0.7, "top_p": 0.8, "top_k": 20, "min_p": 0,
            "presence_penalty": 1.5, "chat_template_kwargs": {"enable_thinking": False},
            "reasoning_effort": "none", "cache_prompt": False}, ensure_ascii=False).encode("utf-8")
        if len(body) > MAX_REQUEST_BYTES:
            raise BrainRuntimeError("LOCAL_BRAIN_REQUEST_TOO_LARGE")
        started = time.monotonic()
        deadline = started + timeout_seconds
        while not self._generation_lock.acquire(timeout=min(0.025, max(0.001, deadline - time.monotonic()))):
            if cancel_event is not None and cancel_event.is_set():
                raise BrainRuntimeError("LOCAL_BRAIN_CANCELLED")
            if time.monotonic() >= deadline:
                raise BrainRuntimeError("LOCAL_BRAIN_TIMEOUT")
        try:
            if cancel_event is not None and cancel_event.is_set():
                raise BrainRuntimeError("LOCAL_BRAIN_CANCELLED")
            if time.monotonic() >= deadline:
                raise BrainRuntimeError("LOCAL_BRAIN_TIMEOUT")
            if self._process is None or self._process.poll() is not None:
                raise BrainRuntimeError("LOCAL_BRAIN_NOT_READY")
            connection = self._connection(timeout_seconds)
            self._active = connection
            done = threading.Event()
            result: list[LlamaGeneration | Exception] = []

            def read_stream():
                try:
                    connection.request("POST", "/v1/chat/completions", body=body, headers=self._headers())
                    response = connection.getresponse()
                    if response.status != 200:
                        raise BrainRuntimeError("LOCAL_BRAIN_INFERENCE_FAILED")
                    pieces: list[str] = []
                    byte_count = 0
                    first: float | None = None
                    completion_tokens = 0
                    speed: float | None = None
                    finished = False
                    while True:
                        line = response.readline(8193)
                        byte_count += len(line)
                        if len(line) > 8192 or byte_count > MAX_RESPONSE_BYTES:
                            raise BrainRuntimeError("LOCAL_BRAIN_RESPONSE_TOO_LARGE")
                        if not line:
                            break
                        if not line.startswith(b"data: "):
                            continue
                        payload = line[6:].strip()
                        if payload == b"[DONE]":
                            finished = True
                            break
                        event = json.loads(payload)
                        if not isinstance(event, dict):
                            raise BrainRuntimeError("LOCAL_BRAIN_RESPONSE_INVALID")
                        if event.get("error"):
                            raise BrainRuntimeError("LOCAL_BRAIN_INFERENCE_FAILED")
                        for choice in event.get("choices", []):
                            delta = choice.get("delta", {})
                            if delta.get("reasoning_content"):
                                raise BrainRuntimeError("LOCAL_BRAIN_REASONING_REJECTED")
                            content = delta.get("content") or ""
                            if content:
                                if first is None:
                                    first = (time.monotonic() - started) * 1000
                                pieces.append(content)
                        completion_tokens = event.get("usage", {}).get("completion_tokens", completion_tokens)
                        if type(completion_tokens) is not int or not 0 <= completion_tokens <= 132:
                            raise BrainRuntimeError("LOCAL_BRAIN_RESPONSE_INVALID")
                        timings = event.get("timings", {})
                        speed = timings.get("predicted_per_second", speed)
                        if speed is not None and (type(speed) not in (int, float) or not math.isfinite(speed) or speed < 0):
                            raise BrainRuntimeError("LOCAL_BRAIN_RESPONSE_INVALID")
                    text = "".join(pieces).strip()
                    if not finished or not text or "<think" in text or "</think" in text:
                        raise BrainRuntimeError("LOCAL_BRAIN_RESPONSE_INVALID")
                    elapsed = (time.monotonic() - started) * 1000
                    if speed is None and completion_tokens and first is not None and elapsed > first:
                        speed = max(0, completion_tokens - 1) / ((elapsed - first) / 1000)
                    result.append(LlamaGeneration(text, elapsed, first, int(completion_tokens), speed))
                except (OSError, ValueError, TypeError, KeyError, AttributeError, http.client.HTTPException, BrainRuntimeError) as exc:
                    result.append(exc)
                finally:
                    connection.close()
                    done.set()

            reader = threading.Thread(target=read_stream, name="local-brain-response", daemon=True)
            reader.start()
            while not done.wait(0.025):
                code = ("LOCAL_BRAIN_CANCELLED" if cancel_event is not None and cancel_event.is_set()
                        else "LOCAL_BRAIN_TIMEOUT" if time.monotonic() >= deadline else None)
                if code:
                    self._abort(connection)
                    reader.join(0.25)
                    if reader.is_alive():
                        self.close()
                    raise BrainRuntimeError(code)
            if time.monotonic() >= deadline:
                raise BrainRuntimeError("LOCAL_BRAIN_TIMEOUT")
            if isinstance(result[0], BrainRuntimeError):
                raise result[0]
            if isinstance(result[0], Exception):
                raise BrainRuntimeError("LOCAL_BRAIN_INFERENCE_FAILED") from None
            return result[0]
        finally:
            self._active = None
            self._generation_lock.release()

    def close(self) -> None:
        with self._state_lock:
            self._abort(self._active)
            process, self._process = self._process, None
            if process is not None and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=2)
            if self._token_path is not None:
                self._token_path.unlink(missing_ok=True)
            self._token_path = None
            self._token = None
            self._port = None
            self._warmed = False
