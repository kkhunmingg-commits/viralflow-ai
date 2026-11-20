"""Bounded local inference admission; hardware targets are not validation.

Presenter/audio reservations precede brain allocation. Brain defaults to CPU
when it cannot fit without touching those reservations. Loaded models are
accounted separately from in-flight priority leases; callers must release both.
"""
from __future__ import annotations

import heapq
import math
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Callable

from .security import SecurityError

PRIORITIES = {"PRESENTER": 1, "TTS": 2, "BRAIN": 3, "BACKGROUND": 4}


@dataclass(frozen=True)
class LocalAIProfile:
    name: str
    total_vram_mib: int
    presenter_reserved_mib: int
    audio_reserved_mib: int
    brain_profile: str = "qwen3-4b-q4_k_m"
    validated: bool = False


def select_profile(ram_gb: float | None, vram_gb: float | None) -> LocalAIProfile:
    # Combined resident model memory still needs actual GPU measurement.
    if (type(ram_gb) not in (int, float) or not math.isfinite(ram_gb) or ram_gb < 8
            or vram_gb is not None and (type(vram_gb) not in (int, float) or not math.isfinite(vram_gb) or vram_gb < 0)):
        raise SecurityError("LOCAL_AI_HARDWARE_UNSUPPORTED")
    vram = int((vram_gb or 0) * 1024)
    if vram >= 16 * 1024:
        return LocalAIProfile("GPU_HIGH", vram, 6144, 6144)
    if vram >= 12 * 1024:
        return LocalAIProfile("GPU_STANDARD", vram, 5120, 5120)
    if vram >= 8 * 1024:
        return LocalAIProfile("GPU_LITE", vram, 4096, 4096)
    return LocalAIProfile("CPU_DEV", 0, 0, 0)


class ResourceLease:
    def __init__(self, manager, identity: str, device: str):
        self.manager, self.identity, self.device = manager, identity, device
        self._released = False

    def release(self):
        if not self._released:
            self.manager._release(self.identity)
            self._released = True

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.release()


class LocalResourceManager:
    def __init__(self, profile: LocalAIProfile, *, maximum_pending: int = 32,
                 maximum_cpu: int = 1, clock: Callable = time.monotonic):
        if maximum_pending < 1 or maximum_cpu < 1:
            raise ValueError("Invalid local resource bounds")
        self.profile = profile
        self.maximum_pending, self.maximum_cpu, self.clock = maximum_pending, maximum_cpu, clock
        self._condition = threading.Condition()
        self._pending, self._active, self._models = [], {}, {}
        self._sequence = 0

    def _available(self, kind: str) -> int:
        used = sum(size for owner, size in self._models.values())
        used += sum(size for device, owner, size in self._active.values() if device == "GPU")
        reserve = 0
        # Presenter can consume its reservation first; lower priorities cannot.
        if kind != "PRESENTER":
            occupied = sum(size for owner, size in self._models.values() if owner == "PRESENTER")
            occupied += sum(size for device, owner, size in self._active.values() if device == "GPU" and owner == "PRESENTER")
            reserve += max(0, self.profile.presenter_reserved_mib - occupied)
        if kind in {"BRAIN", "BACKGROUND"}:
            occupied = sum(size for owner, size in self._models.values() if owner == "TTS")
            occupied += sum(size for device, owner, size in self._active.values() if device == "GPU" and owner == "TTS")
            reserve += max(0, self.profile.audio_reserved_mib - occupied)
        return max(0, self.profile.total_vram_mib - used - reserve)

    def register_model(self, model_id: str, kind: str, vram_mib: int) -> None:
        if kind not in PRIORITIES or type(vram_mib) is not int or vram_mib < 0:
            raise ValueError("Invalid model memory estimate")
        with self._condition:
            if model_id in self._models:
                raise SecurityError("LOCAL_RESOURCE_MODEL_ALREADY_LOADED")
            if vram_mib > self._available(kind):
                raise SecurityError("LOCAL_RESOURCE_GPU_FULL")
            self._models[model_id] = (kind, vram_mib)

    def unload_model(self, model_id: str, unload: Callable[[], None]) -> None:
        # Only release admission after the backend confirms it unloaded.
        unload()
        with self._condition:
            self._models.pop(model_id, None)
            self._condition.notify_all()

    def acquire(self, kind: str, *, vram_mib: int = 0, prefer_gpu: bool = False,
                allow_cpu: bool = True, timeout_seconds: float = 3,
                cancel_event=None) -> ResourceLease:
        if (kind not in PRIORITIES or type(vram_mib) is not int or vram_mib < 0
                or not math.isfinite(timeout_seconds) or not 0 < timeout_seconds <= 180):
            raise ValueError("Invalid resource request")
        deadline = self.clock() + timeout_seconds
        identity = uuid.uuid4().hex
        with self._condition:
            if len(self._pending) >= self.maximum_pending:
                raise SecurityError("LOCAL_RESOURCE_QUEUE_FULL")
            self._sequence += 1
            request = (PRIORITIES[kind], self._sequence, identity)
            heapq.heappush(self._pending, request)
            try:
                while True:
                    if cancel_event is not None and cancel_event.is_set():
                        raise SecurityError("LOCAL_RESOURCE_CANCELLED")
                    if self.clock() >= deadline:
                        raise SecurityError("LOCAL_RESOURCE_TIMEOUT")
                    if self._pending[0] == request:
                        if prefer_gpu and self.profile.total_vram_mib > 0 and vram_mib <= self._available(kind):
                            device = "GPU"
                        elif allow_cpu and sum(value[0] == "CPU" for value in self._active.values()) < self.maximum_cpu:
                            device = "CPU"
                        else:
                            device = None
                        if device:
                            heapq.heappop(self._pending)
                            self._active[identity] = (device, kind, vram_mib if device == "GPU" else 0)
                            self._condition.notify_all()
                            return ResourceLease(self, identity, device)
                    self._condition.wait(min(0.05, max(0.001, deadline - self.clock())))
            finally:
                if request in self._pending:
                    self._pending.remove(request)
                    heapq.heapify(self._pending)
                    self._condition.notify_all()

    def _release(self, identity: str) -> None:
        with self._condition:
            self._active.pop(identity, None)
            self._condition.notify_all()

    def metrics(self) -> dict:
        with self._condition:
            return {"profile": self.profile.name, "validated": False,
                    "queued": len(self._pending), "active": len(self._active),
                    "loaded_models": len(self._models),
                    "allocated_vram_mib": sum(size for _, size in self._models.values()) + sum(size for device, _, size in self._active.values() if device == "GPU")}


class LocalAIWarmup:
    """Readiness is earned by all actual stages, never by elapsed UI time."""
    def __init__(self, brain, voice, presenter_warmup: Callable, encoder_warmup: Callable):
        self.stages = {"brain": brain.warmup, "voice": voice.warmup,
                       "presenter": presenter_warmup, "encoder": encoder_warmup}
        self.state = {key: False for key in self.stages}
        self._lock = threading.Lock()

    def warmup(self) -> dict:
        with self._lock:
            self.invalidate()
            try:
                for name, action in self.stages.items():
                    result = action()
                    self.state[name] = result is not False and not (isinstance(result, dict) and result.get("ready") is not True)
                    if not self.state[name]:
                        break
            except Exception:
                self.invalidate()
                raise
            return self.health()

    def invalidate(self):
        self.state = {key: False for key in self.stages}

    def health(self) -> dict:
        return {"ready": all(self.state.values()), **self.state}
