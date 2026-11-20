"""Compose registered inference layers before the existing JPEG/A-V boundary.

Movement sources must provide real measured registration and frame-quality
evidence. Unmeasured motion/hand frames are rejected; a previously accepted real
frame can be held on the next timeline slot without pretending new inference.
"""
from __future__ import annotations

import io
import math
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Iterator, Protocol

from avatar_renderer import RenderedFrame
from gesture_engine import Gesture
from motion_guards import MotionObservation, MotionQualityGuard, OcclusionGuard, OcclusionObservation, Region


@dataclass(frozen=True)
class InferenceLayer:
    frame: RenderedFrame
    region: Region
    registration_confidence: float
    registered_to_sequence: int
    quality: MotionObservation | None = None


@dataclass(frozen=True)
class HybridRenderInput:
    mouth: Region
    quality: MotionObservation | None
    occlusion: OcclusionObservation | None
    measured_now: float
    head: InferenceLayer | None = None
    expression: InferenceLayer | None = None
    body: InferenceLayer | None = None


class MotionLayerSource(Protocol):
    """Backend must return genuine measured layers, not procedural stand-ins."""
    def prepare(self, reference: Path, fps: int) -> None: ...
    def predict_occlusion(self, lip: RenderedFrame, requested: Gesture) -> tuple[OcclusionObservation | None, float]: ...
    def render_layers(self, lip: RenderedFrame, pcm16: bytes, gesture: Gesture) -> HybridRenderInput: ...
    def close(self) -> None: ...


class GuardedHybridFrameEngine:
    """Runtime hybrid boundary: lip inference → real layers → guards → JPEG.

    Body gestures are checked before asking the motion source to render them.
    The compositor checks frame quality again before releasing an image. This
    wrapper connects the concrete guards to the existing live encoder boundary.
    """
    def __init__(self, lip_renderer, motion_source: MotionLayerSource, supported: frozenset[Gesture]) -> None:
        self.lip_renderer = lip_renderer
        self.motion_source = motion_source
        self.compositor = HybridCompositor(supported)
        self._requested = Gesture.NEUTRAL
        self._prepared = False

    def prepare(self, reference: Path, fps: int) -> None:
        if self._prepared:
            raise RuntimeError("HYBRID_ALREADY_PREPARED")
        self.lip_renderer.load_presenter(reference, fps)
        try:
            self.motion_source.prepare(reference, fps)
        except Exception:
            self.lip_renderer.stop()
            raise
        self._prepared = True

    def set_gesture(self, gesture: str) -> None:
        self._requested = Gesture(gesture)

    def render_avatar_audio(self, pcm16: bytes) -> Iterator[RenderedFrame]:
        if not self._prepared:
            raise RuntimeError("HYBRID_NOT_PREPARED")
        for lip in self.lip_renderer.render_audio(pcm16):
            predicted, now = self.motion_source.predict_occlusion(lip, self._requested)
            decision = self.compositor.occlusion.evaluate(self._requested, self.compositor.supported,
                                                         predicted, now=now)
            measured = self.motion_source.render_layers(lip, pcm16, decision.gesture)
            frame = self.compositor.compose(lip, measured.mouth, gesture=decision.gesture,
                                            observation=measured.quality, occlusion=measured.occlusion,
                                            measured_now=measured.measured_now, head=measured.head,
                                            expression=measured.expression, body=measured.body)
            if frame is not None:
                yield frame

    def render_pcm16_chunk(self, pcm16: bytes) -> Iterator[bytes]:
        for frame in self.render_avatar_audio(pcm16):
            yield frame.jpeg

    def interrupt(self) -> None:
        self.lip_renderer.interrupt()

    def close(self) -> None:
        self._prepared = False
        try:
            self.lip_renderer.stop()
        finally:
            self.motion_source.close()

    def metrics(self) -> dict[str, object]:
        return self.compositor.metrics()


class HybridCompositor:
    def __init__(self, supported_gestures: frozenset[Gesture], *, max_skew_us: int = 40_000,
                 motion_guard: MotionQualityGuard | None = None, occlusion_guard: OcclusionGuard | None = None) -> None:
        if max_skew_us < 0 or max_skew_us > 200_000:
            raise ValueError("INVALID_COMPOSITOR_TIMING")
        self.supported = supported_gestures
        self.max_skew_us = max_skew_us
        self.motion = motion_guard or MotionQualityGuard()
        self.occlusion = occlusion_guard or OcclusionGuard()
        self._latest_real: RenderedFrame | None = None
        self._latest_sequence = -1
        self._latest_pts = -1
        self.held_frames = 0
        self.composed_frames = 0
        self.rejected_layers = 0

    def _hold(self, requested: RenderedFrame) -> RenderedFrame | None:
        if self._latest_real is None:
            return None
        self.held_frames += 1
        return replace(self._latest_real, pts_us=requested.pts_us, duration_us=requested.duration_us,
                       sequence=requested.sequence, held=True)

    def compose(self, lip: RenderedFrame, mouth: Region, *, gesture: Gesture,
                observation: MotionObservation | None, occlusion: OcclusionObservation | None,
                measured_now: float, head: InferenceLayer | None = None,
                expression: InferenceLayer | None = None, body: InferenceLayer | None = None) -> RenderedFrame | None:
        if not lip.real_inference:
            raise ValueError("REAL_INFERENCE_REQUIRED")
        if lip.sequence <= self._latest_sequence or lip.pts_us <= self._latest_pts:
            raise ValueError("COMPOSITOR_TIMELINE_NOT_MONOTONIC")
        self._latest_sequence, self._latest_pts = lip.sequence, lip.pts_us
        motion = self.motion.evaluate(gesture, observation, now=measured_now,
                                      has_latest_real_frame=self._latest_real is not None)
        if not motion.emit_candidate:
            return self._hold(lip)
        occlusion_decision = self.occlusion.evaluate(gesture, self.supported, occlusion, now=measured_now)
        try:
            from PIL import Image
            with Image.open(io.BytesIO(lip.jpeg)) as decoded:
                decoded.load()
                base = decoded.convert("RGB")
            original = base.copy()
            for layer in (body, head, expression):
                if layer is None:
                    continue
                if (not layer.frame.real_inference or not math.isfinite(layer.registration_confidence)
                        or not .9 <= layer.registration_confidence <= 1
                        or layer.registered_to_sequence != lip.sequence
                        or abs(layer.frame.pts_us - lip.pts_us) > self.max_skew_us
                        or body is layer and (occlusion_decision.blocked or motion.gesture != gesture)):
                    self.rejected_layers += 1
                    continue
                # Registration confidence cannot replace face/hand integrity.
                # Every additional rendered layer requires its own fresh quality
                # observation; failure simply omits it and preserves real lips.
                layer_quality = MotionQualityGuard().evaluate(gesture if body is layer else Gesture.NEUTRAL,
                                                              layer.quality, now=measured_now,
                                                              has_latest_real_frame=False)
                if not layer_quality.emit_candidate:
                    self.rejected_layers += 1
                    continue
                with Image.open(io.BytesIO(layer.frame.jpeg)) as decoded:
                    decoded.load()
                    image = decoded.convert("RGB")
                if image.size != base.size:
                    self.rejected_layers += 1
                    continue
                box = self._pixels(layer.region, base.size)
                base.paste(image.crop(box), box)
            # Registered head/expression layers cannot overwrite the inferred
            # lip region. There is no reuse of an unrelated prerecorded mouth.
            mouth_box = self._pixels(mouth, base.size)
            base.paste(original.crop(mouth_box), mouth_box)
            output = io.BytesIO()
            base.save(output, format="JPEG", quality=90)
        except (ImportError, OSError, ValueError):
            self.rejected_layers += 1
            return self._hold(lip)
        result = replace(lip, jpeg=output.getvalue())
        self._latest_real = result
        self.composed_frames += 1
        return result

    @staticmethod
    def _pixels(region: Region, dimensions: tuple[int, int]) -> tuple[int, int, int, int]:
        width, height = dimensions
        box = (int(region.x * width), int(region.y * height), int((region.x + region.width) * width),
               int((region.y + region.height) * height))
        if box[2] <= box[0] or box[3] <= box[1]:
            raise ValueError("EMPTY_COMPOSITOR_REGION")
        return box

    def metrics(self) -> dict[str, object]:
        return {"composed_frames": self.composed_frames, "held_real_frames": self.held_frames,
                "rejected_layers": self.rejected_layers, **self.motion.metrics(), **self.occlusion.metrics()}
