"""Windowed entry point in the self-contained Windows installer bundle.

The installer supplies config.json beside the packaged launcher. That file has
only public trust configuration; the pairing code is fresh in memory
for each launch. The release entry point cannot enable real-time streaming.
"""

from __future__ import annotations

import json
import os
import shutil
import secrets
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import messagebox

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_agent import AgentConfig, AgentHTTPServer, LocalAgent  # noqa: E402
from local_agent.device_identity import DeviceIdentity  # noqa: E402
from local_agent.security import SecurityError  # noqa: E402
from local_agent.hardware import inspect_hardware  # noqa: E402
from installer.delivery import DeliveryManager  # noqa: E402


def packaged_config() -> dict[str, object]:
    """Fixed trusted package location, never a path accepted from a web command."""
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
    path = base / "local_agent" / "config.json"
    if not path.exists():
        return {}
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 16 * 1024:
        raise SecurityError("INSTALL_CONFIG_INVALID")
    configured = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(configured, dict) or set(configured) - {"grantPublicKeyPem"}:
        raise SecurityError("INSTALL_CONFIG_INVALID")
    return configured


def main() -> None:
    root = tk.Tk()
    root.title("ViralFlow AI LIVE")
    root.geometry("390x190")
    root.resizable(False, False)
    try:
        configured = packaged_config()
        local_app_data = os.environ.get("LOCALAPPDATA")
        if not local_app_data:
            raise SecurityError("DEVICE_STORAGE_INVALID")
        managed_root = Path(local_app_data) / "ViralFlow" / "LiveAgent"
        identity = DeviceIdentity(managed_root / "identity")
        public_key = configured.get("grantPublicKeyPem", "")
        if not isinstance(public_key, str) or len(public_key) > 4096:
            raise SecurityError("INSTALL_CONFIG_INVALID")
        config = AgentConfig(
            device_id=identity.device_id,
            pairing_code=secrets.token_hex(12),
            grant_public_key_pem=public_key.encode("ascii"),
            data_dir=managed_root / "references",
        )
        # The bundled executable directory is trusted package content. This PATH
        # edit is process-local, does not install or modify the user's runtime.
        if getattr(sys, "frozen", False):
            os.environ["PATH"] = str(Path(sys.executable).resolve().parent) + os.pathsep + os.environ.get("PATH", "")
        bundled_ffmpeg = Path(sys.executable).resolve().parent / "ffmpeg.exe"

        def packaged_binary(name: str) -> str | None:
            if name == "ffmpeg" and getattr(sys, "frozen", False):
                return str(bundled_ffmpeg) if bundled_ffmpeg.is_file() and not bundled_ffmpeg.is_symlink() else None
            return shutil.which(name)

        def package_update_status() -> str:
            if not getattr(sys, "frozen", False):
                return "CURRENT"
            try:
                current = DeliveryManager(managed_root).executable()
                if current is None:
                    return "REQUIRED"
                return "CURRENT" if current.resolve() == Path(sys.executable).resolve() else "RESTART_REQUIRED"
            except (OSError, ValueError):
                return "REQUIRED"

        agent = LocalAgent(config, device_identity=identity,
                           hardware_probe=lambda: inspect_hardware(config.data_dir, which=packaged_binary),
                           update_status=package_update_status)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        messagebox.showerror("ViralFlow AI LIVE", "ต้องติดตั้งส่วนเสริม AI LIVE ให้ครบก่อนใช้งาน")
        root.destroy()
        return

    try:
        server = AgentHTTPServer(agent)
    except OSError:
        agent.close()
        messagebox.showinfo("ViralFlow AI LIVE", "ส่วนเสริม AI LIVE เปิดอยู่แล้ว กรุณาใช้หน้าต่างเดิม")
        root.destroy()
        return
    thread = threading.Thread(target=server.serve_forever,
                              kwargs={"poll_interval": 0.2}, daemon=True)
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
        server.shutdown()
        thread.join(timeout=3)
        server.server_close()
        agent.close()
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", close)
    root.mainloop()


if __name__ == "__main__":
    main()
