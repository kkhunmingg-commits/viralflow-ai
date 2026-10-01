"""Windowed packaged launcher; no installed Python interpreter is needed."""

import runpy
import sys
from pathlib import Path


def main() -> None:
    if "--self-test" in sys.argv:
        # Verify packaged non-GPU dependencies without starting a server/session.
        import tkinter  # noqa: F401
        from tkinter import messagebox  # noqa: F401
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from local_agent.security import canonical_json
        from local_agent import AgentConfig, AgentHTTPServer, LocalAgent  # noqa: F401
        key = Ed25519PrivateKey.generate()
        message = canonical_json({"delivery": True})
        key.public_key().verify(key.sign(message), message)
        window = tkinter.Tk()
        window.withdraw()
        window.update_idletasks()
        window.destroy()
        return
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
