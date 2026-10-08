"""Managed private-pipe adapter for the shared TypeScript ComplianceEngine.

Only executables and public trust material attested by the signed component
catalog can be launched. No system Node/PATH, policy rules, keys or client PASS
flags are accepted. Missing artifacts leave LIVE speech unavailable.
"""
from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
import time
from pathlib import Path

from compliance_speech import ComplianceSpeechError

COMPLIANCE_ARTIFACTS = ("runtime/node.exe", "worker/compliance-local-bridge.cjs", "worker/compliance-trust.json")
MAX_MESSAGE = 1024 * 1024


def _verified_path(root: Path, files: dict, relative: str) -> Path:
    from local_agent.components import _relative, _safe, _hash_file
    # Reuse the installed SHA-256/size/link safety boundary for executable bytes.
    record = files.get(_relative(relative))
    path = _safe(root / relative, root)
    if (not isinstance(record, dict) or set(record) != {"sha256", "sizeBytes"}
            or not path.is_file() or path.stat().st_size != record["sizeBytes"]
            or _hash_file(path) != record["sha256"]):
        raise ComplianceSpeechError()
    return path


class ManagedNodeComplianceTransport:
    def __init__(self, app_root: Path, component_root: Path, files: dict, *, process_factory=subprocess.Popen):
        self.node, self.entry, trust_path = (_verified_path(component_root, files, name) for name in COMPLIANCE_ARTIFACTS)
        if trust_path.stat().st_size > 64 * 1024:
            raise ComplianceSpeechError()
        trust = json.loads(trust_path.read_bytes())
        if (not isinstance(trust, dict) or trust.get("format") != "viralflow-compliance-trust-v1"
                or not {"format", "contextPublicKeys", "policyPublicKeys"}.issubset(trust)
                or not set(trust).issubset({"format", "contextPublicKeys", "policyPublicKeys", "legacyContextPublicKey"})):
            raise ComplianceSpeechError()
        for name in ("contextPublicKeys", "policyPublicKeys"):
            if (not isinstance(trust[name], dict) or not 1 <= len(trust[name]) <= 8
                    or any(not isinstance(key, str) or not 0 < len(key) <= 128
                           or not isinstance(pem, str) or "BEGIN PUBLIC KEY" not in pem or len(pem) > 4096
                           for key, pem in trust[name].items())):
                raise ComplianceSpeechError()
        self.config = {name: value for name, value in trust.items() if name != "format"}
        self.config["policyDirectory"] = str((Path(app_root) / "compliance-policy").resolve())
        self._factory = process_factory
        self._process = None
        self._responses = queue.Queue(maxsize=2)
        self._lock = threading.RLock()
        self._counter = 0
        self._closed = False
        self._context_ready = False

    def health(self):
        return {"ready": self._context_ready and not self._closed}

    def _read(self, process):
        try:
            while True:
                line = process.stdout.readline(MAX_MESSAGE + 1)
                if not line or len(line) > MAX_MESSAGE or not line.endswith(b"\n"):
                    break
                self._responses.put(json.loads(line), timeout=0.1)
        except (ValueError, OSError, queue.Full):
            pass
        finally:
            try:
                self._responses.put(None, timeout=0.1)
            except queue.Full:
                pass

    def _send(self, body: dict, deadline: float, cancel: threading.Event):
        raw = json.dumps(body, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode() + b"\n"
        if len(raw) > MAX_MESSAGE:
            raise ComplianceSpeechError()
        done = threading.Event()
        error = []
        process = self._process
        def write():
            try:
                view = memoryview(raw)
                while view:
                    count = process.stdin.write(view)
                    if not count:
                        raise OSError()
                    view = view[count:]
                process.stdin.flush()
            except (OSError, ValueError, AttributeError):
                error.append(True)
            finally:
                done.set()
        thread = threading.Thread(target=write, daemon=True, name="live-compliance-pipe-write")
        thread.start()
        while not done.wait(0.005):
            if cancel.is_set() or time.monotonic() >= deadline:
                self.close()
                raise ComplianceSpeechError()
        if error or cancel.is_set() or time.monotonic() >= deadline:
            self.close()
            raise ComplianceSpeechError()

    def _receive(self, deadline, cancel):
        while not cancel.is_set() and time.monotonic() < deadline:
            try:
                value = self._responses.get(timeout=min(0.01, max(0.001, deadline - time.monotonic())))
                if value is None:
                    break
                return value
            except queue.Empty:
                pass
        self.close()
        raise ComplianceSpeechError()

    def _launch(self, deadline, cancel):
        if self._closed:
            raise ComplianceSpeechError()
        if self._process is not None:
            if self._process.poll() is not None:
                self.close()
                raise ComplianceSpeechError()
            return
        environment = {name: value for name, value in os.environ.items()
                       if name.upper() in {"SYSTEMROOT", "WINDIR", "TEMP", "TMP"}}
        self._process = self._factory([str(self.node), str(self.entry)], cwd=self.entry.parent,
            env=environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            bufsize=0, shell=False, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        threading.Thread(target=self._read, args=(self._process,), daemon=True, name="live-compliance-pipe-read").start()
        self._send(self.config, deadline, cancel)
        if self._receive(deadline, cancel) != {"ready": True}:
            self.close()
            raise ComplianceSpeechError()

    def _rpc(self, method, body, timeout_seconds, cancel):
        deadline = time.monotonic() + timeout_seconds
        if not self._lock.acquire(timeout=max(0, deadline - time.monotonic())):
            self.close()
            raise ComplianceSpeechError()
        try:
            if cancel.is_set() or time.monotonic() >= deadline:
                raise ComplianceSpeechError()
            self._launch(deadline, cancel)
            self._counter += 1
            self._send({"id": self._counter, "method": method, "body": body}, deadline, cancel)
            response = self._receive(deadline, cancel)
            if (not isinstance(response, dict) or response.get("id") != self._counter
                    or set(response) != {"id", "value"}):
                self.close()
                raise ComplianceSpeechError()
            return response["value"]
        except Exception:
            # Every failed startup/write/read relinquishes this authority process.
            self.close()
            raise ComplianceSpeechError() from None
        finally:
            self._lock.release()

    def sync_context(self, signed):
        with self._lock:
            self._context_ready = False
            value = self._rpc("syncContext", signed, 2, threading.Event())
            if value != {"synced": True}:
                raise ComplianceSpeechError()
            self._context_ready = True

    def authorize(self, request, *, timeout_seconds, cancel_event):
        if not self._context_ready:
            raise ComplianceSpeechError()
        return self._rpc("authorize", request, timeout_seconds, cancel_event)

    def close(self):
        self._closed = True
        self._context_ready = False
        process, self._process = self._process, None
        if process is not None:
            if process.poll() is None:
                process.kill()
            try:
                process.wait(timeout=0.2)
            except subprocess.TimeoutExpired:
                pass
            for stream in (process.stdin, process.stdout):
                if stream is not None:
                    try:
                        stream.close()
                    except (OSError, ValueError):
                        pass


def managed_compliance_factory(app_root, components):
    def create(_scope, _store):
        try:
            root, files, _ = components._catalog()
            return ManagedNodeComplianceTransport(app_root, root, files)
        except Exception:
            return None  # No authority; LocalSpeechGate fails closed, never mock PASS.
    return create
