"""Private, inherited-pipe entry point in the signed managed worker runtime.

This is not a web service, installer command executor, or membership authority.
The existing LocalAgent authenticates device/user grants before invoking it.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import uuid
from pathlib import Path

WORKER = Path(__file__).resolve().parent
sys.path.insert(0, str(WORKER))
MAX_MESSAGE = 6 * 1024 * 1024
METHODS = {"health", "start_session", "pause_session", "resume_session", "stop_session",
           "recover_session", "push_audio", "preview_frame", "customer_stream", "close", "warmup",
           "sync_product_context", "submit_comment", "queue_speech", "session_ai_status", "prepare_room"}


class _TrustedChildComponents:
    """Fixed-root catalog attested by our parent over its inherited private pipe."""
    def __init__(self, root: Path, files: dict):
        from local_agent.components import _relative
        if not isinstance(files, dict) or len(files) > 10000:
            raise ValueError("INVALID_RUNTIME_CONFIG")
        for path, value in files.items():
            _relative(path)
            if (not isinstance(value, dict) or set(value) != {"sha256", "sizeBytes"}
                    or not isinstance(value["sha256"], str) or len(value["sha256"]) != 64
                    or any(char not in "0123456789abcdef" for char in value["sha256"])
                    or type(value["sizeBytes"]) is not int or not 0 < value["sizeBytes"] <= 64 * 1024 ** 3):
                raise ValueError("INVALID_RUNTIME_CONFIG")
        self.root, self.files = root, files

    def runtime_root(self):
        return self.root

    def _catalog(self):
        return self.root, self.files, {}


def serve(source, destination, *, worker_factory=None) -> None:
    worker = None
    try:
        first = source.readline(MAX_MESSAGE + 1)
        if len(first) > MAX_MESSAGE:
            raise ValueError("INVALID_RUNTIME_REQUEST")
        config = json.loads(first)
        if (not isinstance(config, dict) or not {"root", "profile", "componentRoot"}.issubset(config)
                or not set(config).issubset({"root", "profile", "componentRoot", "roomId", "localModelFiles"})):
            raise ValueError("INVALID_RUNTIME_CONFIG")
        room_id = config.get("roomId")
        if room_id is not None and (not isinstance(room_id, str) or str(uuid.UUID(room_id)) != room_id):
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
            from local_brain import make_managed_local_brain, LocalBrainProvider, PendingLocalBrainRuntime
            from local_tts import make_managed_local_tts
            from local_agent.security import SecurityError
            components = _TrustedChildComponents(component_root, config.get("localModelFiles", {}))
            def local_providers(scope, product_store):
                try:
                    brain = make_managed_local_brain(components, product_store)
                except SecurityError as exc:
                    if exc.code not in ("LOCAL_BRAIN_MODEL_PENDING", "LOCAL_RUNTIME_MODEL_PENDING"):
                        raise
                    brain = LocalBrainProvider(PendingLocalBrainRuntime(), product_store)
                return brain, make_managed_local_tts(components, context_id="/".join(vars(scope).values()))
            worker_root = root / "worker" / "isolated" / room_id if room_id else root / "worker"
            worker = LocalWorkerBoundary(worker_root, StreamCredentialStore(root / "live-credentials"), ai_provider_factory=local_providers)
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
                expected = 0 if method in ("health", "close", "warmup") else 5 if method in ("start_session", "prepare_room") else 3 if method in ("push_audio", "sync_product_context", "submit_comment", "queue_speech") else 2
                if len(args) != expected:
                    raise ValueError("INVALID_RUNTIME_REQUEST")
                if method in ("start_session", "prepare_room"):
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
                elif method in ("sync_product_context", "submit_comment", "queue_speech"):
                    if (not all(isinstance(value, str) and 0 < len(value) <= 128 for value in args[:2])
                            or not isinstance(args[2], list if method == "sync_product_context" else dict)):
                        raise ValueError("INVALID_RUNTIME_REQUEST")
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
