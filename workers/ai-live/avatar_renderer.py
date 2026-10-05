"""AvatarRenderer V2 boundary; preserves the proven incremental FrameEngine path.

Frame timestamps derive from the room's audio/frame timeline, never wall time.
Hardware adapters are candidates until their real backend has been validated.
This module does not download models, synthesize stand-in frames or select mock.
"""
from __future__ import annotations

import importlib
import importlib.util
import json
import math
import os
import threading
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Callable, Iterator, Mapping, Protocol, runtime_checkable

from engine import FrameEngine
from gesture_engine import Gesture


@dataclass(frozen=True)
class RendererCapabilities:
    renderer: str
    streaming_lip_sync: bool
    head_motion: bool
    expression: bool
    body_motion: bool
    gestures: frozenset[Gesture]
    requires_gpu: bool
    required_vram_mb: int | None
    target_fps: int
    fallback_support: str
    validation: str = "GPU_VALIDATION_REQUIRED"


@dataclass(frozen=True)
class RenderedFrame:
    jpeg: bytes
    pts_us: int
    duration_us: int
    sequence: int
    real_inference: bool
    held: bool = False

    def __post_init__(self) -> None:
        if (not self.jpeg.startswith(b"\xff\xd8") or not self.jpeg.endswith(b"\xff\xd9")
                or self.pts_us < 0 or self.duration_us <= 0 or self.sequence < 0):
            raise ValueError("INVALID_RENDERED_FRAME")


@runtime_checkable
class AvatarRenderer(Protocol):
    def capabilities(self) -> RendererCapabilities: ...
    def load_presenter(self, reference: Path, fps: int) -> None: ...
    def render_audio(self, pcm16: bytes) -> Iterator[RenderedFrame]: ...
    def set_gesture(self, gesture: Gesture) -> None: ...
    def health(self) -> dict[str, object]: ...
    def metrics(self) -> dict[str, object]: ...
    def interrupt(self) -> None: ...
    def stop(self) -> None: ...


class RendererUnavailable(RuntimeError):
    pass


class IncrementalAvatarRenderer:
    """Lossless bridge for an existing genuine FrameEngine, scoped to one room."""
    def __init__(self, engine_factory: Callable[[], FrameEngine], capabilities: RendererCapabilities,
                 readiness: Callable[[], dict[str, object]]) -> None:
        self._factory = engine_factory
        self._capabilities = capabilities
        self._readiness = readiness
        self._engine: FrameEngine | None = None
        self._fps = 0
        self._sequence = 0
        self._latest_pts = -1
        self._latest_end = 0
        self._guarded_metrics: dict[str, object] = {}
        self._audio_samples = 0
        self._status = "NEW"
        self._gesture = Gesture.NEUTRAL
        self._release_thread: threading.Thread | None = None
        self._release_error: str | None = None
        self._release_lock = threading.Lock()

    def capabilities(self) -> RendererCapabilities:
        return self._capabilities

    def health(self) -> dict[str, object]:
        if self._status in ("FAILED", "STOPPED", "STOPPING"):
            return {"ready": False, "status": self._status}
        return self._readiness()

    def load_presenter(self, reference: Path, fps: int) -> None:
        if self._status != "NEW":
            raise RendererUnavailable("RENDERER_ALREADY_LOADED")
        if not reference.is_file() or not 1 <= fps <= self._capabilities.target_fps:
            raise ValueError("INVALID_AVATAR_CONFIG")
        health = self.health()
        if health.get("ready") is not True:
            raise RendererUnavailable(str(health.get("status", "RENDERER_NOT_READY")))
        engine = self._factory()
        try:
            for method in ("prepare", "render_pcm16_chunk", "close"):
                if not callable(getattr(engine, method, None)):
                    raise RendererUnavailable("INCREMENTAL_BACKEND_CONTRACT_REQUIRED")
            engine.prepare(reference, fps)
        except Exception:
            closer = getattr(engine, "close", None)
            if callable(closer):
                closer()
            self._status = "FAILED"
            raise
        self._engine = engine
        self._fps = fps
        self._status = "RUNNING"

    def render_audio(self, pcm16: bytes) -> Iterator[RenderedFrame]:
        if self._status != "RUNNING" or self._engine is None:
            raise RendererUnavailable("RENDERER_NOT_RUNNING")
        if not pcm16 or len(pcm16) % 2 or len(pcm16) > 32_000:
            raise ValueError("INVALID_AUDIO_CHUNK")
        self._audio_samples += len(pcm16) // 2
        max_frames = math.ceil(self._audio_samples * self._fps / 16_000)
        try:
            # Guarded hybrid backends preserve their source timestamps and held
            # provenance. Do not compress gaps when a corrupted frame is rejected.
            render_avatar_audio = getattr(self._engine, "render_avatar_audio", None)
            if callable(render_avatar_audio):
                for frame in render_avatar_audio(pcm16):
                    if (not isinstance(frame, RenderedFrame) or not frame.real_inference
                            or frame.pts_us <= self._latest_pts
                            or frame.pts_us >= max_frames * 1_000_000 // self._fps):
                        raise RendererUnavailable("INVALID_GUARDED_FRAME_TIMELINE")
                    self._latest_pts = frame.pts_us
                    self._latest_end = frame.pts_us + frame.duration_us
                    self._sequence += 1
                    yield frame
                return
            for jpeg in self._engine.render_pcm16_chunk(pcm16):
                if self._sequence >= max_frames:
                    raise RendererUnavailable("FRAME_TIMELINE_EXCEEDS_AUDIO")
                pts = self._sequence * 1_000_000 // self._fps
                end = (self._sequence + 1) * 1_000_000 // self._fps
                frame = RenderedFrame(jpeg, pts, end - pts, self._sequence, True)
                self._sequence += 1
                self._latest_pts = pts
                self._latest_end = end
                yield frame
        except Exception:
            self._status = "FAILED"
            raise

    def set_gesture(self, gesture: Gesture) -> None:
        if gesture != Gesture.NEUTRAL and gesture not in self.capabilities().gestures:
            raise RendererUnavailable("GESTURE_NOT_SUPPORTED")
        if self._engine is None:
            raise RendererUnavailable("RENDERER_NOT_RUNNING")
        apply_gesture = getattr(self._engine, "set_gesture", None)
        if gesture != Gesture.NEUTRAL and not callable(apply_gesture):
            raise RendererUnavailable("GESTURE_BACKEND_REQUIRED")
        if callable(apply_gesture):
            apply_gesture(gesture.value)
        self._gesture = gesture

    def metrics(self) -> dict[str, object]:
        guarded = self._guarded_metrics
        backend_metrics = getattr(self._engine, "metrics", None)
        if callable(backend_metrics):
            measured = backend_metrics()
            allowed = ("composed_frames", "held_real_frames", "rejected_layers", "blocked_gesture_count",
                       "fallback_gesture_count", "occlusion_confidence", "blocked_frame_count", "motion_level", "degradations")
            if isinstance(measured, dict):
                guarded = {name: measured[name] for name in allowed if name in measured}
                self._guarded_metrics = guarded
        held = guarded.get("held_real_frames", 0)
        return {"status": self._status, "frames_generated": self._sequence - held, "frames_emitted": self._sequence,
                "audio_samples": self._audio_samples, "timeline_us": self._latest_end,
                "gesture": self._gesture.value, "performance_verified": False, **guarded}

    def interrupt(self) -> None:
        interrupt = getattr(self._engine, "interrupt", None)
        if callable(interrupt):
            interrupt()

    def stop(self) -> None:
        self.metrics()  # Retain measured guard counts after resources are released.
        with self._release_lock:
            engine, self._engine = self._engine, None
            if engine is not None:
                self._status = "STOPPING"
                def release() -> None:
                    try:
                        engine.close()
                    except Exception:
                        self._release_error = "RENDERER_RELEASE_FAILED"
                        self._status = "FAILED"
                    else:
                        self._status = "STOPPED"
                self._release_thread = threading.Thread(target=release, name="avatar-release", daemon=True)
                self._release_thread.start()
            elif self._release_thread is None:
                self._status = "STOPPED"
            thread = self._release_thread
        if thread is not None:
            thread.join(timeout=2)
            if thread.is_alive():
                # A native GPU call cannot be killed safely in-process. Never
                # claim release or retry/recreate a renderer while it remains.
                raise RendererUnavailable("RENDERER_RELEASE_PENDING")
            if self._release_error:
                raise RendererUnavailable(self._release_error)


class AvatarFrameEngine:
    """Same JPEG boundary consumed by LiveStore/AVTimeline/encoder/StreamProvider."""
    def __init__(self, renderer: AvatarRenderer) -> None:
        self.renderer = renderer

    def prepare(self, reference: Path, fps: int) -> None:
        self.renderer.load_presenter(reference, fps)

    def render_pcm16_chunk(self, pcm16: bytes) -> Iterator[bytes]:
        for frame in self.renderer.render_audio(pcm16):
            if not frame.real_inference:
                raise RendererUnavailable("NON_INFERENCE_FRAME_FORBIDDEN")
            yield frame.jpeg

    def interrupt(self) -> None:
        self.renderer.interrupt()

    def close(self) -> None:
        self.renderer.stop()


def cpu_avatar_renderer() -> IncrementalAvatarRenderer:
    # The old explicit dev-only gates remain authoritative in create_engine().
    from dev_fallback_engine import create_engine, probe_readiness
    from provider_config import dev_fallback_enabled
    caps = RendererCapabilities("MuseTalkCPUFloat32", True, False, False, False,
                                frozenset({Gesture.NEUTRAL}), False, None, 5,
                                "HOLD_LATEST_REAL_FRAME", "CPU_PROOF_ONLY")
    return IncrementalAvatarRenderer(create_engine, caps, lambda: probe_readiness() if dev_fallback_enabled()
                                     else {"ready": False, "status": "DEV_FALLBACK_DISABLED"})


GPU_CANDIDATES: dict[str, RendererCapabilities] = {
    "musetalk_gpu": RendererCapabilities("MuseTalkGPU", True, False, False, False,
                                         frozenset({Gesture.NEUTRAL}), True, None, 25, "HOLD_LATEST_REAL_FRAME"),
    "musetalk_hybrid": RendererCapabilities("MuseTalkHybrid", True, True, True, True,
                                            frozenset(Gesture), True, None, 25, "SAFE_MOTION_THEN_NEUTRAL"),
    "musetalk_portrait": RendererCapabilities("MuseTalkFasterLivePortrait", True, True, True, False,
                                             frozenset({Gesture.NEUTRAL, Gesture.SMILE, Gesture.NOD, Gesture.LISTENING_POSE}),
                                             True, None, 25, "SAFE_MOTION_THEN_NEUTRAL"),
    "faster_live_portrait": RendererCapabilities("FasterLivePortrait", False, True, True, False,
                                                frozenset({Gesture.NEUTRAL, Gesture.SMILE, Gesture.NOD, Gesture.LISTENING_POSE}),
                                                True, None, 25, "NEUTRAL"),
    "ditto": RendererCapabilities("DittoRenderer", True, True, True, True,
                                   frozenset(Gesture), True, None, 25, "HOLD_LATEST_REAL_FRAME"),
}


def _dependency_exists(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ModuleNotFoundError, ValueError):
        return False


def inspect_renderer_dependencies(candidate: str, environment: Mapping[str, str] | None = None) -> dict[str, object]:
    """Use the shipped planning manifest for read-only installed-asset detection.

    Presence is not model integrity, redistribution permission or runtime proof;
    the existing signed component delivery and GPU benchmark remain necessary.
    """
    env = os.environ if environment is None else environment
    path = Path(__file__).with_name("renderer-dependencies.json")
    try:
        if path.is_symlink() or path.stat().st_size > 64 * 1024:
            raise ValueError("INVALID_RENDERER_MANIFEST")
        plan = json.loads(path.read_text(encoding="utf-8"))
        if plan.get("format") != "viralflow-avatar-renderer-candidates-v2" or plan.get("automatic_download") is not False:
            raise ValueError("INVALID_RENDERER_MANIFEST")
        spec = next(item for item in plan["candidates"] if item["id"] == candidate)
    except (OSError, ValueError, StopIteration, KeyError, TypeError):
        return {"status": "DEPENDENCY_MANIFEST_REQUIRED", "dependencies_available": False, "models_available": False}
    if spec.get("components"):
        dependencies = [inspect_renderer_dependencies(name, env) for name in spec["components"] if name in GPU_CANDIDATES]
        return {"status": "HYBRID_SOURCE_VALIDATION_REQUIRED", "dependencies_available": all(item.get("dependencies_available") is True for item in dependencies),
                "models_available": all(item.get("models_available") is True for item in dependencies),
                "source_available": all(item.get("source_available") is True for item in dependencies)}
    root_value = env.get("AI_LIVE_" + candidate.upper() + "_ROOT", "").strip()
    root = Path(root_value) if root_value else None

    def present(relative: str) -> bool:
        if root is None:
            return False
        location = root / relative
        try:
            return not location.is_symlink() and (location.is_file() and location.stat().st_size > 0 or location.is_dir() and any(location.iterdir()))
        except OSError:
            return False

    missing_dependencies = [name for name in spec.get("modules", ()) if not _dependency_exists(name)]
    missing_source = [name for name in spec.get("source_markers", ()) if not present(name)]
    missing_models = [name for name in spec.get("model_markers", ()) if not present(name)]
    status = "DEPENDENCIES_REQUIRED" if missing_dependencies else "SOURCE_REQUIRED" if missing_source else "MODELS_REQUIRED" if missing_models else "PRESENT_NOT_VALIDATED"
    return {"status": status, "dependencies_available": not missing_dependencies, "source_available": not missing_source,
            "models_available": not missing_models, "missing_dependencies": missing_dependencies,
            "missing_source": missing_source, "missing_models": missing_models}


class GPUCandidateRenderer(IncrementalAvatarRenderer):
    """Explicit extension boundary for hardware adapters, not an upstream API claim.

    CUDA/dependencies/source files alone cannot prove real streaming. The vetted
    local backend must export create_engine(), probe_readiness() and report
    streaming_validated=True after measured NVIDIA validation. Without that
    backend the adapter remains unavailable; there is no silent mock fallback.
    """
    def __init__(self, candidate: str, *, capability_probe: Callable[[], Mapping[str, object]] | None = None,
                 backend_factory: Callable[[], FrameEngine] | None = None,
                 environment: Mapping[str, str] | None = None, benchmark_only: bool = False) -> None:
        if candidate not in GPU_CANDIDATES:
            raise ValueError("UNKNOWN_RENDERER")
        self.candidate = candidate
        self._benchmark_only = benchmark_only
        self._environment = os.environ if environment is None else environment
        self._probe = capability_probe or self._default_probe
        super().__init__(backend_factory or self._configured_factory, GPU_CANDIDATES[candidate], self._candidate_readiness)

    def _prefix(self) -> str:
        return "AI_LIVE_" + self.candidate.upper()

    def load_presenter(self, reference: Path, fps: int) -> None:
        if self.candidate in ("musetalk_hybrid", "musetalk_portrait"):
            factory = self._factory
            def guarded_factory() -> FrameEngine:
                from hybrid_compositor import GuardedHybridFrameEngine
                engine = factory()
                if not isinstance(engine, GuardedHybridFrameEngine):
                    engine.close()
                    raise RendererUnavailable("GUARDED_HYBRID_BACKEND_REQUIRED")
                return engine
            self._factory = guarded_factory
        super().load_presenter(reference, fps)

    def capabilities(self) -> RendererCapabilities:
        # Candidate feature targets are not installed/validated capabilities.
        # A lip-sync validation alone cannot activate hands or head motion.
        try:
            measured = self._probe()
        except Exception:
            measured = {}
        verified = measured.get("streaming_validated") is True
        supported = measured.get("validated_gestures", ()) if verified else ()
        if not isinstance(supported, (tuple, list, set, frozenset)):
            supported = ()
        gestures = frozenset(Gesture(value) for value in supported if value in {item.value for item in Gesture})
        return replace(self._capabilities, streaming_lip_sync=self._capabilities.streaming_lip_sync and verified,
                       head_motion=verified and measured.get("head_motion_validated") is True,
                       expression=verified and measured.get("expression_validated") is True,
                       body_motion=verified and measured.get("body_motion_validated") is True,
                       gestures=gestures | {Gesture.NEUTRAL},
                       validation="STREAMING_VALIDATED" if verified else "GPU_VALIDATION_REQUIRED")

    def _configured_factory(self) -> FrameEngine:
        module_name = self._environment.get(self._prefix() + "_MODULE", "").strip()
        if not module_name or not all(part.isidentifier() for part in module_name.split(".")):
            raise RendererUnavailable("INCREMENTAL_BACKEND_REQUIRED")
        module = importlib.import_module(module_name)
        factory = getattr(module, "create_engine", None)
        if not callable(factory):
            raise RendererUnavailable("INCREMENTAL_BACKEND_REQUIRED")
        return factory()

    def _default_probe(self) -> Mapping[str, object]:
        cuda = False
        if _dependency_exists("torch"):
            try:
                import torch
                cuda = bool(torch.cuda.is_available())
            except (ImportError, OSError, RuntimeError):
                pass
        if not cuda:
            return {"cuda_available": False}
        installed = inspect_renderer_dependencies(self.candidate, self._environment)
        if installed.get("dependencies_available") is not True:
            return {"cuda_available": True, "dependencies_available": False}
        if installed.get("models_available") is not True or installed.get("source_available") is not True:
            return {"cuda_available": True, "dependencies_available": True, "backend_available": True, "models_available": False}
        module_name = self._environment.get(self._prefix() + "_MODULE", "").strip()
        if not module_name or not all(part.isidentifier() for part in module_name.split(".")):
            return {"cuda_available": True, "dependencies_available": True, "backend_available": False}
        try:
            module = importlib.import_module(module_name)
            probe = getattr(module, "probe_readiness", None)
            result = probe() if callable(probe) else None
            if not isinstance(result, dict):
                return {"cuda_available": True, "dependencies_available": True, "backend_available": False}
            return {**result, "cuda_available": True, "dependencies_available": True,
                    "backend_available": callable(getattr(module, "create_engine", None))}
        except Exception:
            return {"cuda_available": True, "dependencies_available": True, "backend_available": False}

    def _candidate_readiness(self) -> dict[str, object]:
        try:
            probe = self._probe()
        except Exception:
            return {"ready": False, "status": "CAPABILITY_PROBE_FAILED", "candidate": self.candidate}
        status = ("GPU_REQUIRED" if probe.get("cuda_available") is not True
                  else "DEPENDENCIES_REQUIRED" if probe.get("dependencies_available") is not True
                  else "INCREMENTAL_BACKEND_REQUIRED" if probe.get("backend_available") is not True
                  else "MODELS_REQUIRED" if probe.get("models_available") is not True
                  else "BENCHMARK_READY" if self._benchmark_only and probe.get("streaming_validated") is not True
                  else "GPU_VALIDATION_REQUIRED" if probe.get("streaming_validated") is not True
                  else "READY")
        return {"ready": status in ("READY", "BENCHMARK_READY"), "status": status, "candidate": self.candidate,
                "performance_verified": probe.get("performance_verified") is True and status == "READY"}


class MuseTalkHybrid(GPUCandidateRenderer):
    def __init__(self, **kwargs: object) -> None:
        super().__init__("musetalk_hybrid", **kwargs)


class FasterLivePortraitAdapter(GPUCandidateRenderer):
    def __init__(self, **kwargs: object) -> None:
        super().__init__("faster_live_portrait", **kwargs)


class DittoRenderer(GPUCandidateRenderer):
    def __init__(self, **kwargs: object) -> None:
        super().__init__("ditto", **kwargs)


def make_avatar_renderer(candidate: str | None = None) -> AvatarRenderer:
    """Explicit renderer selection; never substitutes a mock or another engine."""
    selected = candidate or os.getenv("AI_LIVE_AVATAR_RENDERER", "").strip()
    if selected == "cpu_dev":
        return cpu_avatar_renderer()
    if selected in GPU_CANDIDATES:
        return GPUCandidateRenderer(selected)
    raise RendererUnavailable("AVATAR_RENDERER_SELECTION_REQUIRED")
