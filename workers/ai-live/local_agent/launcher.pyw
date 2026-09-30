"""Windows GUI entry point packaged by a future signed ViralFlow installer.

The installer supplies config.json beside the packaged launcher. That file has
only the pinned public key and device UUID; the pairing code is fresh in memory
for each launch. The release entry point cannot enable real-time streaming.
"""

from __future__ import annotations

import json
import secrets
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import messagebox

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_agent import AgentConfig, LocalAgent, serve_agent  # noqa: E402


def main() -> None:
    root = tk.Tk()
    root.title("ViralFlow AI LIVE")
    root.geometry("390x190")
    root.resizable(False, False)
    config_path = Path(__file__).resolve().with_name("config.json")
    try:
        configured = json.loads(config_path.read_text(encoding="utf-8"))
        config = AgentConfig(
            device_id=configured["deviceId"],
            pairing_code=secrets.token_hex(12),
            grant_public_key_pem=configured["grantPublicKeyPem"].encode("ascii"),
            data_dir=Path.home() / "AppData" / "Local" / "ViralFlow" / "LiveAgent" / "references",
        )
        agent = LocalAgent(config)  # REALTIME_VALIDATED remains False.
    except (OSError, ValueError, KeyError, TypeError) as exc:
        messagebox.showerror("ViralFlow AI LIVE", "ต้องติดตั้งส่วนเสริม AI LIVE ให้ครบก่อนใช้งาน")
        root.destroy()
        return

    stop_event = threading.Event()
    thread = threading.Thread(target=serve_agent, args=(agent,),
                              kwargs={"stop_event": stop_event}, daemon=True)
    thread.start()
    tk.Label(root, text="รหัสเชื่อมต่อเครื่องนี้", font=("Segoe UI", 12)).pack(pady=(18, 6))
    code = tk.StringVar(value=config.pairing_code)
    tk.Entry(root, textvariable=code, justify="center", state="readonly",
             font=("Consolas", 14), width=28).pack()
    tk.Label(root, text="กรอกรหัสนี้ในหน้า AI LIVE ของ ViralFlow",
             font=("Segoe UI", 10)).pack(pady=(8, 10))

    def copy_code() -> None:
        root.clipboard_clear()
        root.clipboard_append(config.pairing_code)

    tk.Button(root, text="คัดลอกรหัส", command=copy_code).pack()

    def close() -> None:
        stop_event.set()
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", close)
    root.mainloop()


if __name__ == "__main__":
    main()
