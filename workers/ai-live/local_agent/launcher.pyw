"""Windowed entry point in the self-contained Windows installer bundle.

The installer supplies config.json beside the packaged launcher. That file has
only public trust configuration; the pairing code is fresh in memory
for each launch. The release entry point cannot enable real-time streaming.
"""

from __future__ import annotations

import json
import os
import queue
import shutil
import secrets
import sys
import threading
import tkinter as tk
import webbrowser
from pathlib import Path
from tkinter import messagebox
from tkinter import ttk

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_agent import AgentConfig, AgentHTTPServer, LocalAgent  # noqa: E402
from local_agent.agent import VERSIONS  # noqa: E402
from local_agent.device_identity import DeviceIdentity  # noqa: E402
from local_agent.security import SecurityError  # noqa: E402
from local_agent.hardware import HardwareTiers, NVIDIA_DRIVER_URL, driver_version_tuple, inspect_hardware  # noqa: E402
from installer.delivery import DeliveryManager  # noqa: E402
from installer.setup_app import integrate_update  # noqa: E402
from local_agent.updater import SafeUpdater  # noqa: E402
from local_agent.update_transport import trusted_origin  # noqa: E402
from local_agent.stream_credentials import StreamCredentialStore  # noqa: E402
from local_agent.components import BootstrapManager  # noqa: E402
from local_agent.managed_runtime import ManagedRuntimeWorker  # noqa: E402


def packaged_config() -> dict[str, object]:
    """Fixed trusted package location, never a path accepted from a web command."""
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
    path = base / "local_agent" / "config.json"
    if not path.exists():
        return {}
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 16 * 1024:
        raise SecurityError("INSTALL_CONFIG_INVALID")
    configured = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(configured, dict) or set(configured) - {"grantPublicKeyPem", "trustedKeys", "retiredKeyIds", "updateOrigin", "componentBootstrap"}:
        raise SecurityError("INSTALL_CONFIG_INVALID")
    return configured


def component_configuration(configured: dict[str, object]) -> tuple[str | None, str | None, str, str | None]:
    """Package-owned release coordinates only; never a browser URL or command."""
    import re
    bootstrap = configured.get("componentBootstrap")
    if bootstrap is None:
        return None, None, "nvidia", None
    if (not configured.get("trustedKeys") or not isinstance(bootstrap, dict)
            or set(bootstrap) - {"origin", "releaseVersion", "profile", "minimumNvidiaDriver"}
            or not {"origin", "releaseVersion", "profile"} <= set(bootstrap)
            or bootstrap["profile"] not in ("cpu-dev", "nvidia")
            or not isinstance(bootstrap["releaseVersion"], str)
            or len(bootstrap["releaseVersion"]) > 32
            or not re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", bootstrap["releaseVersion"])):
        raise SecurityError("INSTALL_CONFIG_INVALID")
    origin = trusted_origin(bootstrap["origin"])[0]
    minimum = bootstrap.get("minimumNvidiaDriver")
    if minimum is not None:
        driver_version_tuple(minimum)
    return origin, origin + "/viralflow/ai-live/components/" + bootstrap["releaseVersion"] + "/manifest.json", bootstrap["profile"], minimum


def main() -> None:
    root = tk.Tk()
    root.title("ViralFlow AI")
    root.geometry("440x340")
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
        keyring = configured.get("trustedKeys", {})
        retired = configured.get("retiredKeyIds", [])
        if (not isinstance(keyring, dict) or len(keyring) > 8
                or any(not isinstance(key, str) or not isinstance(value, str) or len(value) > 4096
                       for key, value in keyring.items())
                or not isinstance(retired, list) or len(retired) > 8
                or any(not isinstance(value, str) for value in retired)):
            raise SecurityError("INSTALL_CONFIG_INVALID")
        update_origin = configured.get("updateOrigin")
        if update_origin is not None:
            trusted_origin(update_origin)
        component_origin, component_url, profile, minimum_driver = component_configuration(configured)
        config = AgentConfig(
            device_id=identity.device_id,
            pairing_code=secrets.token_hex(12),
            grant_public_key_pem=public_key.encode("ascii"),
            data_dir=managed_root / "references",
            trusted_keys={key: value.encode("ascii") for key, value in keyring.items()},
            retired_key_ids=frozenset(retired),
            hardware_tiers=HardwareTiers(minimum_driver_version=minimum_driver),
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

        updater = SafeUpdater(managed_root, config.grant_public_key_pem,
                              trusted_keys=config.trusted_keys, retired_key_ids=config.retired_key_ids,
                              installed_versions={name: VERSIONS[name] for name in ("web", "agent", "worker")},
                              update_origin=update_origin,
                              delivery=DeliveryManager(managed_root, integration=lambda exe: integrate_update(exe, managed_root)))
        credentials = StreamCredentialStore(managed_root / "live-credentials")
        components = BootstrapManager(managed_root / "components", config.grant_public_key_pem,
            trusted_keys=config.trusted_keys, retired_key_ids=config.retired_key_ids,
            release_origin=component_origin, profile=profile)
        worker = ManagedRuntimeWorker(managed_root, components)

        def open_stream_setup(owner_id: str, account_id: str) -> None:
            # HTTP handles grants only. Entered secrets stay in this native
            # window and are protected with current-user Windows DPAPI.
            def show() -> None:
                dialog = tk.Toplevel(root)
                dialog.title("ตั้งค่าการ LIVE")
                dialog.geometry("440x320")
                dialog.transient(root)
                dialog.grab_set()
                tk.Label(dialog, text="ใช้ข้อมูล LIVE ที่คุณได้รับอย่างถูกต้อง", font=("Segoe UI", 11)).pack(pady=(18, 8))
                tk.Label(dialog, text="ที่อยู่สำหรับส่ง LIVE", font=("Segoe UI", 10)).pack(anchor="w", padx=22)
                url_input = tk.Entry(dialog, width=48)
                url_input.pack(padx=22, pady=(4, 12))
                tk.Label(dialog, text="รหัสสำหรับส่ง LIVE", font=("Segoe UI", 10)).pack(anchor="w", padx=22)
                key_input = tk.Entry(dialog, width=48, show="●")
                key_input.pack(padx=22, pady=(4, 12))
                acknowledged = tk.BooleanVar(value=False)
                tk.Checkbutton(dialog, text="ฉันมีสิทธิ์ใช้ข้อมูล LIVE ของบัญชีที่เลือก", variable=acknowledged).pack()
                feedback = tk.StringVar(value="")
                tk.Label(dialog, textvariable=feedback, wraplength=390).pack(pady=8)

                def clear_and_close() -> None:
                    url_input.delete(0, tk.END)
                    key_input.delete(0, tk.END)
                    dialog.destroy()

                def save() -> None:
                    if not acknowledged.get():
                        feedback.set("กรุณายืนยันว่าคุณมีสิทธิ์ใช้ข้อมูลนี้")
                        return
                    try:
                        agent.save_stream_setup(owner_id, account_id, url_input.get().strip(), key_input.get().strip())
                    except Exception:
                        feedback.set("บันทึกไม่ได้ กรุณาตรวจข้อมูลหรือเปิดตั้งค่าใหม่จาก ViralFlow")
                        return
                    clear_and_close()
                    messagebox.showinfo("ViralFlow AI LIVE", "บันทึกข้อมูลการ LIVE บนเครื่องแล้ว")

                tk.Button(dialog, text="บันทึก", command=save, width=20).pack()
                dialog.protocol("WM_DELETE_WINDOW", clear_and_close)
            root.after(0, show)

        agent = LocalAgent(config, device_identity=identity, worker=worker,
                           stream_credentials=credentials, stream_setup_callback=open_stream_setup,
                           hardware_probe=lambda: inspect_hardware(config.data_dir, which=packaged_binary),
                           update_status=package_update_status, updater=updater,
                           components=components, component_manifest_url=component_url)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        messagebox.showerror("ViralFlow AI", "ยังเปิดใช้งานไม่ได้ กรุณาซ่อมแซมการติดตั้ง ViralFlow")
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
    tk.Label(root, text="ยินดีต้อนรับสู่ ViralFlow AI", font=("Segoe UI", 15, "bold")).pack(pady=(16, 8))
    tk.Button(root, text="เข้าสู่ระบบ", command=lambda: webbrowser.open("https://viralflow-ai-blond.vercel.app/ai-live"), width=28).pack()
    tk.Label(root, text="เชื่อมเครื่องกับบัญชีของคุณ", font=("Segoe UI", 11)).pack(pady=(12, 6))
    code = tk.StringVar(value=config.pairing_code)
    tk.Entry(root, textvariable=code, justify="center", state="readonly",
             font=("Consolas", 14), width=28).pack()
    tk.Label(root, text="กรอกรหัสนี้ในหน้า AI LIVE ของ ViralFlow",
             font=("Segoe UI", 10)).pack(pady=(8, 10))

    def copy_code() -> None:
        root.clipboard_clear()
        root.clipboard_append(config.pairing_code)

    tk.Button(root, text="คัดลอกรหัส", command=copy_code).pack()
    feedback = tk.StringVar(value="เข้าสู่ระบบเพื่อเริ่มตรวจและเตรียมเครื่องอัตโนมัติ")
    tk.Label(root, textvariable=feedback, wraplength=405, font=("Segoe UI", 10)).pack(pady=(14, 6))
    progress = ttk.Progressbar(root, mode="determinate", maximum=100, length=350)
    progress.pack()
    driver_button = tk.Button(root, text="กรุณาอัปเดตไดรเวอร์การ์ดจอ", command=lambda: webbrowser.open(NVIDIA_DRIVER_URL))
    # OS/driver checks must not block first-run progress or the window buttons.
    driver_results = queue.Queue(maxsize=1)
    driver_required = False
    threading.Thread(target=lambda: driver_results.put(agent._assessment().driver_action is not None),
                     daemon=True, name="viralflow-machine-check").start()
    labels = {"CHECKING": "กำลังตรวจเครื่อง", "DOWNLOADING": "กำลังดาวน์โหลดส่วนประกอบ",
              "VERIFYING": "กำลังตรวจความสมบูรณ์", "INSTALLING": "กำลังเตรียมเครื่อง",
              "READY": "เตรียมส่วนประกอบครบแล้ว · AI LIVE กำลังเตรียมพร้อม",
              "REPAIR_REQUIRED": "กรุณากดซ่อมแซมในหน้า AI LIVE", "ERROR": "กรุณาลองเตรียมเครื่องอีกครั้งในหน้า AI LIVE"}
    def refresh() -> None:
        nonlocal driver_required
        view = agent._components_view()
        state, received, total = view["state"], view["bytesReceived"], view["totalBytes"]
        feedback.set(labels.get(state, "เข้าสู่ระบบเพื่อเริ่มตรวจและเตรียมเครื่องอัตโนมัติ"))
        progress["value"] = 100 * received / total if total else 0
        try:
            driver_required = driver_results.get_nowait()
        except queue.Empty:
            pass
        if driver_required:
            driver_button.pack(pady=(6, 0))
        else:
            driver_button.pack_forget()
        root.after(1500, refresh)
    root.after(500, refresh)

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
