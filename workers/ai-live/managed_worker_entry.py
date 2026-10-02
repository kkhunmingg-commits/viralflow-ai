"""Private, inherited-pipe entry point in the signed managed worker runtime.

This is not a web service, installer command executor, or membership authority.
The existing LocalAgent authenticates device/user grants before invoking it.
"""
from __future__ import annotations

import base64
import json
import os
import sys
from pathlib import Path

WORKER = Path(__file__).resolve().parent
sys.path.insert(0, str(WORKER))
MAX_MESSAGE = 6 * 1024 * 1024
METHODS = {"health", "start_session", "pause_session", "resume_session", "stop_session",
           "recover_session", "push_audio", "preview_frame", "customer_stream", "close"}


def serve(source, destination, *, worker_factory=None) -> None:
    worker = None
    try:
        first = source.readline(MAX_MESSAGE + 1)
        if len(first) > MAX_MESSAGE:
            raise ValueError("INVALID_RUNTIME_REQUEST")
        config = json.loads(first)
        if not isinstance(config, dict) or set(config) != {"root", "profile", "componentRoot"}:
            raise ValueError("INVALID_RUNTIME_CONFIG")
        root, component_root = Path(config["root"]), Path(config["componentRoot"])
        if not root.is_absolute() or not component_root.is_absolute() or root.is_symlink() or component_root.is_symlink():
            raise ValueError("INVALID_RUNTIME_CONFIG")
        profile = config["profile"]
        if profile not in ("cpu-dev", "nvidia"):
            raise ValueError("INVALID_RUNTIME_CONFIG")
        # All local paths are from verified package content and the agent's fixed
        # managed root. Neither browser requests nor model files supply commands.
        os.environ["AI_LIVE_FFMPEG_PATH"] = str(component_root / "runtime" / "ffmpeg.exe")
        models = component_root / "models" / "musetalk"
        os.environ["AI_LIVE_DEV_MODELS_DIR"] = str(models)
        os.environ["AI_LIVE_MODELS_DIR"] = str(models)
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        if profile == "cpu-dev":
            os.environ.update({"PRESENTER_PROVIDER": "dev_fallback", "AI_LIVE_DEV_FALLBACK": "true",
                               "APP_ENV": "development", "AI_LIVE_ENV": "development"})
        else:
            os.environ.update({"PRESENTER_PROVIDER": "musetalk", "AI_LIVE_DEV_FALLBACK": "false",
                               "AI_LIVE_ENCODER": "h264_nvenc"})
        if worker_factory is None:
            # Portable Python native microphone DLLs must also work in deep
            # per-user Windows paths; no system PATH or registry changes.
            if sys.platform == "win32":
                import _sounddevice_data
                _sounddevice_data.__path__ = [
                    value if value.startswith("\\\\?\\") else "\\\\?\\" + str(Path(value).resolve())
                    for value in _sounddevice_data.__path__]
            from local_agent.live_worker import LocalWorkerBoundary
            from local_agent.stream_credentials import StreamCredentialStore
            worker = LocalWorkerBoundary(root / "worker", StreamCredentialStore(root / "live-credentials"))
        else:
            worker = worker_factory(root, profile, component_root)
        destination.write(b'{"ready":true}\n')
        destination.flush()
        while True:
            raw = source.readline(MAX_MESSAGE + 1)
            if not raw:
                break
            if len(raw) > MAX_MESSAGE or not raw.endswith(b"\n"):
                raise ValueError("INVALID_RUNTIME_REQUEST")
            request = json.loads(raw)
            request_id = request.get("id") if isinstance(request, dict) else None
            try:
                if (not isinstance(request, dict) or set(request) != {"id", "method", "args"}
                        or type(request_id) is not int or not 0 < request_id < 2**53
                        or request["method"] not in METHODS or not isinstance(request["args"], list)):
                    raise ValueError("INVALID_RUNTIME_REQUEST")
                method, args = request["method"], request["args"]
                expected = 0 if method in ("health", "close") else 5 if method == "start_session" else 3 if method == "push_audio" else 2
                if len(args) != expected:
                    raise ValueError("INVALID_RUNTIME_REQUEST")
                if method == "start_session":
                    if (not all(isinstance(value, str) for value in (args[0], args[1], args[3]))
                            or not isinstance(args[2], list) or not 0 < len(args[2]) <= 100
                            or any(not isinstance(value, str) for value in args[2])
                            or args[4] not in (None, "default")):
                        raise ValueError("INVALID_RUNTIME_REQUEST")
                    args[2], args[3] = tuple(args[2]), Path(args[3])
                elif method == "push_audio":
                    if not all(isinstance(value, str) for value in args):
                        raise ValueError("INVALID_RUNTIME_REQUEST")
                    args[2] = base64.b64decode(args[2], validate=True)
                elif expected == 2 and not all(isinstance(value, str) for value in args):
                    raise ValueError("INVALID_RUNTIME_REQUEST")
                value = getattr(worker, method)(*args)
                if isinstance(value, bytes):
                    value = {"bytes": base64.b64encode(value).decode("ascii")}
                response = {"id": request_id, "value": value}
            except Exception as exc:
                # Error text can contain secrets, native paths, or driver state.
                # The parent receives only a bounded code and customer-safe text.
                code = getattr(exc, "code", "WORKER_UNAVAILABLE")
                if not isinstance(code, str) or not code.isascii() or not code.replace("_", "").isalnum() or len(code) > 64:
                    code = "WORKER_UNAVAILABLE"
                response = {"id": request_id, "error": code}
            encoded = json.dumps(response, ensure_ascii=True, separators=(",", ":")).encode() + b"\n"
            if len(encoded) > MAX_MESSAGE:
                encoded = json.dumps({"id": request_id, "error": "WORKER_RESPONSE_TOO_LARGE"}).encode() + b"\n"
            destination.write(encoded)
            destination.flush()
            if isinstance(request, dict) and request.get("method") == "close":
                break
    finally:
        if worker is not None:
            worker.close()


if __name__ == "__main__":
    # Model libraries may print progress; it must not enter the command protocol.
    output = sys.stdout.buffer
    sys.stdout = sys.stderr
    try:
        serve(sys.stdin.buffer, output)
    except Exception:
        raise SystemExit(1) from None
