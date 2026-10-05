"""Measured-only per-device room capacity. GPU model names are not evidence."""
from __future__ import annotations

import hashlib
import json
import math
from dataclasses import asdict, dataclass
from typing import Iterable


@dataclass(frozen=True)
class RendererDevice:
    gpu_name: str | None
    vram_mb: int | None
    ram_mb: int | None
    driver_version: str | None
    renderer: str
    renderer_revision: str
    runtime_revision: str

    def fingerprint(self) -> str:
        return hashlib.sha256(json.dumps(asdict(self), sort_keys=True, separators=(",", ":")).encode()).hexdigest()


@dataclass(frozen=True)
class CapacityEvidence:
    fingerprint: str
    rooms: int
    measured_at: float
    duration_seconds: float
    minimum_room_fps: float | None
    p95_latency_ms: float | None
    max_av_drift_ms: float | None
    queue_overflow_count: int | None
    crash_count: int | None
    lip_sync_passed: bool | None
    occlusion_passed: bool | None
    gesture_passed: bool | None
    receiver_av_passed: bool | None
    reconnect_passed: bool | None
    stop_release_passed: bool | None
    memory_growth_mb: float | None


def _number(value: float | None, minimum: float, maximum: float) -> bool:
    return (not isinstance(value, bool) and value is not None and math.isfinite(value)
            and minimum <= value <= maximum)


class HardwareCapacityPlanner:
    def __init__(self, *, target_fps: float = 20, max_p95_latency_ms: float = 1000,
                 max_av_drift_ms: float = 100, max_memory_growth_mb: float = 128,
                 max_age_seconds: float = 7 * 86400) -> None:
        if not all(math.isfinite(value) and value > 0 for value in
                   (target_fps, max_p95_latency_ms, max_av_drift_ms, max_memory_growth_mb, max_age_seconds)):
            raise ValueError("INVALID_CAPACITY_POLICY")
        self.fps = target_fps
        self.latency = max_p95_latency_ms
        self.drift = max_av_drift_ms
        self.memory = max_memory_growth_mb
        self.max_age = max_age_seconds

    def evaluate(self, device: RendererDevice, evidence: Iterable[CapacityEvidence], *, now: float) -> dict[str, object]:
        if not math.isfinite(now):
            raise ValueError("INVALID_CAPACITY_TIME")
        fingerprint = device.fingerprint()
        valid = set()
        for item in evidence:
            if (item.fingerprint != fingerprint or isinstance(item.rooms, bool) or item.rooms not in (1, 2, 3)
                    or not _number(item.measured_at, now - self.max_age, now)
                    or not _number(item.duration_seconds, 600, 24 * 3600)
                    or not _number(item.minimum_room_fps, self.fps, 240)
                    or not _number(item.p95_latency_ms, 0, self.latency)
                    or not _number(item.max_av_drift_ms, 0, self.drift)
                    or not _number(item.memory_growth_mb, 0, self.memory)
                    or item.queue_overflow_count != 0 or item.crash_count != 0
                    or not all(value is True for value in (item.lip_sync_passed, item.occlusion_passed,
                                item.gesture_passed, item.receiver_av_passed, item.reconnect_passed, item.stop_release_passed))):
                continue
            valid.add(item.rooms)
        # Larger-room evidence cannot silently substitute for a missing one-room
        # baseline. Each concurrency increase must have its own measured proof.
        count = 0
        while count + 1 in valid:
            count += 1
        return {"status": "VERIFIED_CAPACITY" if count else "UNVERIFIED_CAPACITY",
                "max_rooms": count or None, "fingerprint": fingerprint,
                "renderer": device.renderer, "gpu_name": device.gpu_name,
                "vram_mb": device.vram_mb, "ram_mb": device.ram_mb,
                "customer_message": f"เครื่องนี้พร้อม LIVE สูงสุด {count} ห้อง" if count else "กำลังตรวจความพร้อมของเครื่อง"}
