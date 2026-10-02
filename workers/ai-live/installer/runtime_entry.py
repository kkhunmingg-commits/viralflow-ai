"""Windowed packaged launcher; no installed Python interpreter is needed."""

import runpy
import sys
from pathlib import Path


def _prepare_portaudio_paths() -> None:
    """CFFI's native DLL loader needs extended paths for deep Windows installs."""
    if sys.platform != "win32" or not getattr(sys, "frozen", False):
        return
    import _sounddevice_data
    prefix = "\\\\?\\"
    paths = []
    for value in _sounddevice_data.__path__:
        absolute = str(Path(value).resolve())
        if absolute.startswith(prefix):
            paths.append(absolute)
        elif absolute.startswith("\\\\"):
            paths.append(prefix + "UNC\\" + absolute[2:])
        else:
            paths.append(prefix + absolute)
    # Only the package's installed native-library location changes. No registry,
    # PATH, drivers or user files are modified, and no audio device is opened.
    _sounddevice_data.__path__ = paths


def _self_test() -> None:
    """Fail with an exit code, never a windowed exception dialog or LIVE start."""
    import json
    import os
    phase = "imports"
    report = os.environ.get("VIRALFLOW_SELF_TEST_REPORT")

    def record(status: str, error: str | None = None) -> None:
        if report:
            try:
                path = Path(report)
                if path.is_absolute() and path.parent.is_dir() and not path.is_symlink():
                    path.write_text(json.dumps({"status": status, "phase": phase,
                                                "errorType": error}), encoding="utf-8")
            except (OSError, ValueError):
                # Diagnostics must never turn a bounded self-test failure into
                # an unhandled GUI error when a developer report path is invalid.
                pass

    try:
        record("RUNNING")
        import tkinter  # noqa: F401
        from tkinter import messagebox  # noqa: F401
        from tkinter import ttk  # noqa: F401
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from local_agent.security import canonical_json
        from local_agent import AgentConfig, AgentHTTPServer, LocalAgent  # noqa: F401
        from local_agent.agent import REALTIME_VALIDATED
        from local_agent.live_worker import LocalWorkerBoundary  # noqa: F401
        from local_agent.stream_credentials import StreamCredentialStore  # noqa: F401
        from local_agent.components import BootstrapManager  # noqa: F401
        from local_agent.managed_runtime import ManagedRuntimeWorker  # noqa: F401
        from av_encoder import EncoderConfig, InternalAVEncoder  # noqa: F401
        from av_pipeline import AVSessionStream  # noqa: F401
        from direct_stream import GenericRTMPProvider, GenericRTMPSProvider, TikTokLiveProvider  # noqa: F401
        import subprocess
        phase = "portaudio"
        record("RUNNING")
        _prepare_portaudio_paths()
        import sounddevice
        # Importing and querying the bundled library never opens a microphone.
        assert sounddevice.get_portaudio_version()[0] > 0
        assert REALTIME_VALIDATED is False
        phase = "ffmpeg"
        record("RUNNING")
        if getattr(sys, "frozen", False):
            ffmpeg = Path(sys.executable).resolve().parent / "ffmpeg.exe"
            result = subprocess.run([str(ffmpeg), "-hide_banner", "-encoders"], capture_output=True,
                                    timeout=5, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            assert result.returncode == 0 and b"libx264" in result.stdout and b" aac " in result.stdout
        phase = "cryptography"
        record("RUNNING")
        key = Ed25519PrivateKey.generate()
        message = canonical_json({"delivery": True})
        key.public_key().verify(key.sign(message), message)
        phase = "tk"
        record("RUNNING")
        window = tkinter.Tk()
        window.withdraw()
        window.update_idletasks()
        window.destroy()
        record("PASSED")
    except Exception as exc:
        record("FAILED", type(exc).__name__)
        raise SystemExit(1) from None


def main() -> None:
    if "--self-test" in sys.argv:
        _self_test()
        return
    _prepare_portaudio_paths()
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    if "--startup-smoke" in sys.argv:
        # Display-only instrumentation: execute the real launcher/identity/server
        # path while keeping its window hidden in an isolated test user profile.
        import tkinter
        import os
        import re
        trace_path = Path(os.environ["LOCALAPPDATA"]) / "startup-smoke.trace"
        def trace(frame, event, arguments):
            name = Path(frame.f_code.co_filename).name
            if event == "exception" and name in {"launcher.pyw", "device_identity.py", "agent.py", "http_server.py"}:
                exception = arguments[1]
                code = getattr(exception, "code", "")
                if not isinstance(code, str) or not re.fullmatch(r"[A-Z_]{1,64}", code):
                    code = ""
                # Test diagnostics contain only source filename/line/type/code;
                # never exception text, keys, tokens, device identity, or frames.
                with trace_path.open("a", encoding="utf-8") as output:
                    output.write(f"{name}:{frame.f_lineno}:{type(exception).__name__}:{code}\n")
                    if isinstance(exception, ImportError):
                        match = re.search(r"cannot import name '([A-Za-z_][A-Za-z0-9_]*)' from '([A-Za-z0-9_.]+)'", str(exception))
                        if match:
                            output.write(f"missing-public-export:{match.group(1)}:module:{match.group(2)}\n")
            return trace
        sys.settrace(trace)
        class HiddenTk(tkinter.Tk):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, **kwargs)
                self.withdraw()
        tkinter.Tk = HiddenTk
    runpy.run_path(str(base / "local_agent" / "launcher.pyw"), run_name="__main__")


if __name__ == "__main__":
    main()
