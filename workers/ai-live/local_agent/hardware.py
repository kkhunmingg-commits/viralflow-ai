"""Read-only Windows hardware inspection with provisional, configurable tiers."""

from __future__ import annotations

import ctypes
import json
import os
import platform
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence


def _command(args: Sequence[str]) -> str | None:
    # All callers below pass fixed commands and arguments. Never use a shell.
    try:
        result = subprocess.run(list(args), capture_output=True, text=True,
                                timeout=4, check=False, shell=False)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return result.stdout if result.returncode == 0 else None


def _nvidia_smi_path() -> str | None:
    for candidate in (
        Path("C:/Windows/System32/nvidia-smi.exe"),
        Path("C:/Program Files/NVIDIA Corporation/NVSMI/nvidia-smi.exe"),
    ):
        if candidate.is_file() and not candidate.is_symlink():
            return str(candidate)
    return None


def _bundled_ffmpeg_path(install_dir: Path) -> str | None:
    candidate = install_dir.parent / "ffmpeg.exe"
    return str(candidate) if candidate.is_file() and not candidate.is_symlink() else None


@dataclass(frozen=True)
class HardwareTiers:
    minimum_vram_gb: float = 6
    recommended_vram_gb: float = 12
    high_performance_vram_gb: float = 16
    minimum_ram_gb: float = 16
    minimum_free_disk_gb: float = 20
    minimum_compute_capability: float = 6.0

    def __post_init__(self) -> None:
        if not (0 < self.minimum_vram_gb <= self.recommended_vram_gb
                <= self.high_performance_vram_gb):
            raise ValueError("VRAM tiers must be positive and ordered")
        if min(self.minimum_ram_gb, self.minimum_free_disk_gb,
               self.minimum_compute_capability) <= 0:
            raise ValueError("Hardware thresholds must be positive")


@dataclass(frozen=True)
class HardwareSnapshot:
    os_name: str
    os_version: str
    cpu_name: str | None
    ram_gb: float | None
    gpu_name: str | None
    vram_gb: float | None
    driver_version: str | None
    compute_capability: float | None
    ffmpeg_available: bool
    encoder_listed: bool
    free_disk_gb: float | None
    microphone_count: int | None


@dataclass(frozen=True)
class HardwareAssessment:
    compatible: bool
    tier: str
    validation_required: bool
    customer_reasons: tuple[str, ...]
    diagnostics: dict[str, object]

    def customer(self) -> dict[str, object]:
        return {
            "state": "กำลังเตรียม" if self.compatible else "เครื่องไม่รองรับ",
            "message": "รอการทดสอบ AI LIVE บนเครื่องจริง" if self.compatible else "เครื่องนี้ยังไม่รองรับ AI LIVE",
            "reasons": list(self.customer_reasons),
        }


def _windows_ram_gb() -> float | None:
    class MemoryStatus(ctypes.Structure):
        _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
    try:
        status = MemoryStatus()
        status.dwLength = ctypes.sizeof(MemoryStatus)
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return None
        return status.ullTotalPhys / 1024 ** 3
    except (AttributeError, OSError):
        return None


def _windows_microphone_count() -> int | None:
    try:
        return int(ctypes.windll.winmm.waveInGetNumDevs())
    except (AttributeError, OSError):
        return None


def inspect_hardware(
    install_dir: Path,
    *,
    command: Callable[[Sequence[str]], str | None] = _command,
    which: Callable[[str], str | None] | None = None,
) -> HardwareSnapshot:
    os_name = platform.system()
    gpu_name = driver = None
    vram = compute = None
    if os_name == "Windows":
        smi_path = _nvidia_smi_path()
        smi = command((smi_path, "--query-gpu=name,memory.total,driver_version,compute_cap",
                       "--format=csv,noheader,nounits")) if smi_path else None
        if smi:
            # One GPU is sufficient. If multiple are present, use the largest
            # compatible device rather than claiming that the first is adequate.
            devices = []
            for line in smi.splitlines():
                fields = [field.strip() for field in line.split(",")]
                if len(fields) != 4:
                    continue
                try:
                    devices.append((float(fields[1]) / 1024, float(fields[3]), fields[0], fields[2]))
                except ValueError:
                    continue
            if devices:
                vram, compute, gpu_name, driver = max(devices)
    ffmpeg = which("ffmpeg") if which is not None else _bundled_ffmpeg_path(install_dir)
    encoders = command((ffmpeg, "-hide_banner", "-encoders")) if ffmpeg else None
    try:
        free_disk = shutil.disk_usage(install_dir).free / 1024 ** 3
    except OSError:
        free_disk = None
    return HardwareSnapshot(
        os_name=os_name,
        os_version=platform.version(),
        cpu_name=platform.processor() or None,
        ram_gb=_windows_ram_gb() if os_name == "Windows" else None,
        gpu_name=gpu_name,
        vram_gb=vram,
        driver_version=driver,
        compute_capability=compute,
        ffmpeg_available=ffmpeg is not None,
        encoder_listed=bool(encoders and re.search(r"\bh264_nvenc\b", encoders)),
        free_disk_gb=free_disk,
        microphone_count=_windows_microphone_count() if os_name == "Windows" else None,
    )


def assess_hardware(snapshot: HardwareSnapshot,
                    tiers: HardwareTiers = HardwareTiers()) -> HardwareAssessment:
    reasons: list[str] = []
    diagnostic_codes: list[str] = []
    if snapshot.os_name != "Windows":
        reasons.append("ระบบปฏิบัติการยังไม่รองรับ")
        diagnostic_codes.append("WINDOWS_REQUIRED")
    if snapshot.cpu_name is None or snapshot.ram_gb is None or snapshot.ram_gb < tiers.minimum_ram_gb:
        reasons.append("หน่วยความจำเครื่องไม่เพียงพอ")
        diagnostic_codes.append("SYSTEM_RAM_REQUIRED")
    if snapshot.gpu_name is None or snapshot.vram_gb is None:
        reasons.append("ไม่พบการ์ดจอที่รองรับ")
        diagnostic_codes.append("NVIDIA_GPU_REQUIRED")
    elif snapshot.vram_gb < tiers.minimum_vram_gb:
        reasons.append("หน่วยความจำการ์ดจอไม่เพียงพอ")
        diagnostic_codes.append("GPU_VRAM_REQUIRED")
    if snapshot.gpu_name and (not snapshot.driver_version or snapshot.compute_capability is None
                              or snapshot.compute_capability < tiers.minimum_compute_capability):
        reasons.append("ต้องอัปเดตไดรเวอร์")
        diagnostic_codes.append("CUDA_COMPATIBILITY_REQUIRED")
    if not snapshot.ffmpeg_available or not snapshot.encoder_listed:
        reasons.append("ต้องตรวจสอบความพร้อมของเครื่องเพิ่มเติม")
        diagnostic_codes.append("ENCODER_REQUIRED")
    if snapshot.free_disk_gb is None or snapshot.free_disk_gb < tiers.minimum_free_disk_gb:
        reasons.append("พื้นที่จัดเก็บไม่เพียงพอ")
        diagnostic_codes.append("FREE_DISK_REQUIRED")
    if snapshot.microphone_count is None or snapshot.microphone_count < 1:
        reasons.append("ไม่พบอุปกรณ์เสียง")
        diagnostic_codes.append("MICROPHONE_REQUIRED")
    tier = "UNSUPPORTED"
    if not reasons:
        assert snapshot.vram_gb is not None
        tier = ("HIGH_PERFORMANCE" if snapshot.vram_gb >= tiers.high_performance_vram_gb
                else "RECOMMENDED" if snapshot.vram_gb >= tiers.recommended_vram_gb
                else "MINIMUM")
    return HardwareAssessment(
        compatible=not reasons,
        tier=tier,
        validation_required=True,
        customer_reasons=tuple(reasons),
        diagnostics={
            "marker": "GPU_VALIDATION_REQUIRED",
            "tier": tier,
            "codes": diagnostic_codes,
            "probe": json.loads(json.dumps(snapshot.__dict__)),
            "thresholds_provisional": tiers.__dict__.copy(),
            "encoder_listed_only": snapshot.encoder_listed,
        },
    )
