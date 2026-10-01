"""Self-contained offline GUI install/repair/uninstall for Windows customers."""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import tkinter as tk
import winreg
from pathlib import Path
from tkinter import messagebox

from installer.delivery import DeliveryError, DeliveryManager, _regular_path

UNINSTALL_REGISTRY = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\ViralFlowLiveAgent"
SHORTCUT_NAME = "ViralFlow AI LIVE.lnk"
CREATE_NO_WINDOW = 0x08000000


def install_root() -> Path:
    local = Path(os.environ.get("LOCALAPPDATA", ""))
    if not local.is_absolute() or local.is_symlink():
        raise DeliveryError("LOCAL_APP_DATA_UNAVAILABLE")
    return local / "ViralFlow" / "LiveAgent"


def shortcut_path() -> Path:
    # Windows shell known folder; handles localized/moved Desktop locations.
    import ctypes
    buffer = ctypes.create_unicode_buffer(32768)
    if ctypes.windll.shell32.SHGetFolderPathW(None, 0x10, None, 0, buffer) != 0:
        raise DeliveryError("DESKTOP_UNAVAILABLE")
    return Path(buffer.value) / SHORTCUT_NAME


def integrate(executable: Path | None, root: Path, version: str) -> None:
    if executable is None:
        try:
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, UNINSTALL_REGISTRY)
        except FileNotFoundError:
            pass
        shortcut_path().unlink(missing_ok=True)
        return
    _regular_path(executable, root)
    # A rollback points to the retained previous release and must show its version.
    version = executable.parent.name.split("-", 1)[0]
    if not executable.is_file():
        raise DeliveryError("RUNTIME_MISSING")
    result = subprocess.run([str(executable), "--self-test"], shell=False,
                            creationflags=CREATE_NO_WINDOW, timeout=30, check=False)
    if result.returncode:
        raise DeliveryError("RUNTIME_SELF_TEST_FAILED")
    maintenance = _regular_path(root / "maintenance.exe", root)
    if Path(sys.executable).resolve() != maintenance.resolve():
        temporary = _regular_path(root / "maintenance.new", root)
        shutil.copyfile(sys.executable, temporary)
        os.replace(temporary, maintenance)
    # Fixed script; paths are data passed in child-only environment, never code.
    powershell = Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    if not powershell.is_file():
        raise DeliveryError("WINDOWS_COMPONENT_UNAVAILABLE")
    environment = os.environ.copy()
    environment["VIRALFLOW_LINK_PATH"] = str(shortcut_path())
    environment["VIRALFLOW_TARGET_PATH"] = str(executable)
    script = "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:VIRALFLOW_LINK_PATH);$s.TargetPath=$env:VIRALFLOW_TARGET_PATH;$s.WorkingDirectory=[System.IO.Path]::GetDirectoryName($env:VIRALFLOW_TARGET_PATH);$s.Save()"
    subprocess.run([str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
                   env=environment, shell=False, creationflags=CREATE_NO_WINDOW, timeout=20, check=True)
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, UNINSTALL_REGISTRY) as key:
        for name, value in {
            "DisplayName": "ViralFlow AI LIVE",
            "DisplayVersion": version,
            "Publisher": "ViralFlow AI",
            "InstallLocation": str(root),
            "UninstallString": f'"{maintenance}" --uninstall',
            "ModifyPath": f'"{maintenance}"',
            "DisplayIcon": str(executable),
        }.items():
            winreg.SetValueEx(key, name, 0, winreg.REG_SZ, value)
        winreg.SetValueEx(key, "NoRepair", 0, winreg.REG_DWORD, 0)


def _relay_uninstall_if_needed(root: Path) -> bool:
    executable = Path(sys.executable).resolve()
    if getattr(sys, "frozen", False) and executable == (root / "maintenance.exe").resolve():
        # Windows cannot remove a running EXE. Run its verified copy from temp,
        # let this process exit, then remove only the application's managed files.
        relay = Path(tempfile.mkdtemp(prefix="viralflow-uninstall-")) / "remove.exe"
        shutil.copyfile(executable, relay)
        subprocess.Popen([str(relay), "--uninstall-relay"], shell=False,
                         creationflags=CREATE_NO_WINDOW)
        return True
    return False


def agent_is_open() -> bool:
    # Fixed local endpoint, only used to require a stopped companion before
    # modifying/removing its install. Do not send commands or inspect secrets.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as connection:
        connection.settimeout(0.4)
        return connection.connect_ex(("127.0.0.1", 8766)) == 0


def main() -> None:
    root_path = install_root()
    resources = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    package = resources / "payload.zip"
    metadata = json.loads((resources / "payload-info.json").read_text(encoding="utf-8"))
    version, digest = metadata["version"], metadata["sha256"]
    app = tk.Tk()
    app.title("ติดตั้ง ViralFlow AI LIVE")
    app.geometry("490x320")
    app.resizable(False, False)
    status = tk.StringVar(value="ส่วนเสริมสำหรับใช้ AI LIVE บนเครื่องนี้")
    tk.Label(app, text="ViralFlow AI LIVE", font=("Segoe UI", 20, "bold")).pack(pady=(24, 8))
    tk.Label(app, textvariable=status, wraplength=440, font=("Segoe UI", 11)).pack(pady=8)
    manager = DeliveryManager(root_path, integration=lambda exe: integrate(exe, root_path, version))
    current = manager.current()
    if current:
        status.set("ติดตั้งส่วนเสริมแล้ว • พร้อมตรวจสอบและซ่อมแซม")
    tk.Label(app, text="ติดตั้งส่วนเสริมและส่วนประกอบที่จำเป็นโดยอัตโนมัติ\nโมดูลแสดงสดยังรอการทดสอบบนเครื่องที่รองรับ",
             wraplength=445, font=("Segoe UI", 10)).pack(pady=10)
    buttons = tk.Frame(app)
    buttons.pack(pady=8)

    def run_operation(operation: str) -> None:
        if agent_is_open():
            messagebox.showinfo("ViralFlow AI LIVE", "กรุณาหยุดการใช้งานและปิดส่วนเสริม AI LIVE ก่อนทำรายการนี้")
            return
        if operation == "uninstall":
            if not messagebox.askyesno("ViralFlow AI LIVE", "ถอนการติดตั้งและลบข้อมูลส่วนเสริมบนเครื่องนี้หรือไม่?"):
                return
            if _relay_uninstall_if_needed(root_path):
                app.destroy()
                return
        elif current and not messagebox.askyesno("ViralFlow AI LIVE", "ติดตั้งหรือซ่อมแซมส่วนเสริมบนเครื่องนี้หรือไม่?"):
            return
        for widget in buttons.winfo_children():
            widget.configure(state="disabled")
        status.set("กำลังถอนการติดตั้ง" if operation == "uninstall" else "กำลังเตรียมส่วนเสริม…")

        def execute() -> None:
            try:
                if operation == "uninstall":
                    if "--uninstall-relay" in sys.argv:
                        time.sleep(2)  # allow original maintenance EXE to release lock
                    manager.uninstall()
                    text = "ถอนการติดตั้งเรียบร้อยแล้ว"
                else:
                    manager.install(package, digest, repair=operation == "repair", expected_version=version)
                    text = "ติดตั้งเรียบร้อยแล้ว • เปิด ViralFlow AI LIVE จากไอคอนบนหน้าจอได้เลย"
                app.after(0, lambda: status.set(text))
                app.after(0, lambda: messagebox.showinfo("ViralFlow AI LIVE", text))
            except Exception:
                app.after(0, lambda: status.set("ทำรายการไม่สำเร็จ • ระบบคงรุ่นเดิมไว้ กรุณาลองซ่อมแซมอีกครั้ง"))
            finally:
                app.after(0, lambda: [widget.configure(state="normal") for widget in buttons.winfo_children()])

        threading.Thread(target=execute, daemon=False).start()

    tk.Button(buttons, text="ติดตั้ง / อัปเดต", width=15, height=2,
              command=lambda: run_operation("install")).grid(row=0, column=0, padx=4)
    tk.Button(buttons, text="ซ่อมแซม", width=11, height=2,
              command=lambda: run_operation("repair")).grid(row=0, column=1, padx=4)
    tk.Button(buttons, text="ถอนการติดตั้ง", width=13, height=2,
              command=lambda: run_operation("uninstall")).grid(row=0, column=2, padx=4)
    tk.Button(app, text="ปิด", width=12, command=app.destroy).pack(pady=10)
    if "--uninstall" in sys.argv or "--uninstall-relay" in sys.argv:
        app.after(100, lambda: run_operation("uninstall"))
    app.mainloop()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Packaged setup must not expose Python traceback, filesystem layout, or
        # raw Windows errors to customers when setup cannot initialize safely.
        try:
            dialog = tk.Tk()
            dialog.withdraw()
            messagebox.showerror("ViralFlow AI LIVE", "ไม่สามารถเตรียมส่วนเสริมได้ กรุณาปิดส่วนเสริมแล้วลองติดตั้งใหม่")
            dialog.destroy()
        except Exception:
            pass
        raise SystemExit(1)
