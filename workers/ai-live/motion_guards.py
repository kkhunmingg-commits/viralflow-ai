"""Fail-closed frame/gesture guards with injectable measured detector output.

No landmark detector is invented here. Missing confidence cannot approve a hand
gesture. A rejected image may only be replaced by an earlier real, validated
inference frame; a static illustration is never a lip-sync fallback.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable

from gesture_engine import Gesture, HAND_GESTURES


@dataclass(frozen=True)
class Region:
    x: float
    y: float
    width: float
    height: float

    def __post_init__(self) -> None:
        values = (self.x, self.y, self.width, self.height)
        if (not all(math.isfinite(value) for value in values) or min(values) < 0
                or self.width == 0 or self.height == 0 or self.x + self.width > 1 or self.y + self.height > 1):
            raise ValueError("INVALID_NORMALIZED_REGION")

    def intersects(self, other: Region) -> bool:
        return (self.x < other.x + other.width and other.x < self.x + self.width
                and self.y < other.y + other.height and other.y < self.y + self.height)


@dataclass(frozen=True)
class OcclusionObservation:
    confidence: float | None
    hands: tuple[Region, ...] = ()
    face: Region | None = None
    mouth: Region | None = None
    eyes: tuple[Region, ...] = ()
    product: Region | None = None
    measured_at: float | None = None


@dataclass(frozen=True)
class GuardDecision:
    gesture: Gesture
    blocked: bool
    reason: str


def _confidence(value: float | None, threshold: float) -> bool:
    return value is not None and math.isfinite(value) and threshold <= value <= 1


class OcclusionGuard:
    def __init__(self, *, min_confidence: float = .85, max_observation_age: float = .2) -> None:
        if not 0 < min_confidence <= 1 or not math.isfinite(max_observation_age) or max_observation_age <= 0:
            raise ValueError("INVALID_OCCLUSION_POLICY")
        self.threshold = min_confidence
        self.max_age = max_observation_age
        self.blocked_count = 0
        self.fallback_count = 0
        self.last_confidence: float | None = None

    def evaluate(self, gesture: Gesture, supported: Iterable[Gesture], observation: OcclusionObservation | None,
                 *, now: float) -> GuardDecision:
        available = set(supported)
        reason: str | None = None
        if gesture not in available and gesture != Gesture.NEUTRAL:
            reason = "UNSUPPORTED_GESTURE"
        elif gesture in HAND_GESTURES:
            self.last_confidence = observation.confidence if observation else None
            if (observation is None or not _confidence(observation.confidence, self.threshold)
                    or observation.measured_at is None or not math.isfinite(observation.measured_at)
                    or not 0 <= now - observation.measured_at <= self.max_age
                    or observation.face is None or observation.mouth is None or not observation.eyes):
                reason = "OCCLUSION_UNVERIFIED"
            else:
                protected = (observation.face, observation.mouth, *observation.eyes,
                             *((observation.product,) if observation.product else ()))
                if gesture in (Gesture.POINT_PRODUCT, Gesture.HOLD_PRODUCT) and observation.product is None:
                    reason = "PRODUCT_REGION_REQUIRED"
                elif any(hand.intersects(region) for hand in observation.hands for region in protected):
                    reason = "PROTECTED_REGION_OCCLUDED"
                elif not observation.hands:
                    reason = "HAND_TRACKING_REQUIRED"
        if reason is None:
            return GuardDecision(gesture, False, "SAFE")
        self.blocked_count += 1
        fallback = Gesture.NOD if Gesture.NOD in available else Gesture.NEUTRAL
        self.fallback_count += int(fallback != gesture)
        return GuardDecision(fallback, True, reason)

    def metrics(self) -> dict[str, object]:
        return {"blocked_gesture_count": self.blocked_count, "fallback_gesture_count": self.fallback_count,
                "occlusion_confidence": self.last_confidence}


@dataclass(frozen=True)
class MotionObservation:
    face_integrity: float | None = None
    lip_integrity: float | None = None
    hand_integrity: float | None = None
    movement: float | None = None
    temporal_stability: float | None = None
    frozen_seconds: float = 0
    speaking: bool = False
    measured_at: float | None = None


@dataclass(frozen=True)
class MotionDecision:
    emit_candidate: bool
    gesture: Gesture
    reason: str
    hold_latest_real_frame: bool


class MotionQualityGuard:
    def __init__(self, *, min_integrity: float = .85, max_movement: float = .7,
                 frozen_limit_seconds: float = 3, recovery_frames: int = 3, max_observation_age: float = .2) -> None:
        if (not 0 < min_integrity <= 1 or not 0 < max_movement <= 1 or recovery_frames < 1
                or not math.isfinite(frozen_limit_seconds) or frozen_limit_seconds <= 0
                or not math.isfinite(max_observation_age) or max_observation_age <= 0):
            raise ValueError("INVALID_MOTION_POLICY")
        self.threshold = min_integrity
        self.max_movement = max_movement
        self.frozen_limit = frozen_limit_seconds
        self.recovery_frames = recovery_frames
        self.max_age = max_observation_age
        self.level = "ADVANCED"
        self._good_frames = 0
        self.blocked_frames = 0
        self.degradations = 0

    def evaluate(self, gesture: Gesture, observation: MotionObservation | None, *, now: float,
                 has_latest_real_frame: bool) -> MotionDecision:
        reason: str | None = None
        if (observation is None or observation.measured_at is None
                or not math.isfinite(observation.measured_at)
                or not 0 <= now - observation.measured_at <= self.max_age):
            reason = "MOTION_UNVERIFIED"
        elif not _confidence(observation.face_integrity, self.threshold):
            reason = "FACE_INTEGRITY"
        elif not _confidence(observation.lip_integrity, self.threshold):
            reason = "LIP_INTEGRITY"
        elif gesture in HAND_GESTURES and not _confidence(observation.hand_integrity, self.threshold):
            reason = "HAND_INTEGRITY"
        elif (observation.movement is None or not math.isfinite(observation.movement)
              or not 0 <= observation.movement <= self.max_movement):
            reason = "EXCESSIVE_OR_UNKNOWN_MOTION"
        elif not _confidence(observation.temporal_stability, self.threshold):
            reason = "TEMPORAL_INSTABILITY"
        elif (not math.isfinite(observation.frozen_seconds) or observation.frozen_seconds < 0
              or observation.speaking and observation.frozen_seconds >= self.frozen_limit):
            reason = "FROZEN_PRESENTER"
        if reason:
            self._good_frames = 0
            self.blocked_frames += 1
            self.degradations += 1
            self.level = "SAFE" if self.level == "ADVANCED" else "NEUTRAL"
            fallback = Gesture.NOD if self.level == "SAFE" else Gesture.NEUTRAL
            return MotionDecision(False, fallback, reason, has_latest_real_frame)
        self._good_frames += 1
        if self._good_frames >= self.recovery_frames:
            self.level = "SAFE" if self.level == "NEUTRAL" else "ADVANCED"
            self._good_frames = 0
        safe_gesture = gesture if self.level == "ADVANCED" else Gesture.NEUTRAL if self.level == "NEUTRAL" else Gesture.NOD
        return MotionDecision(True, safe_gesture, "SAFE", False)

    def metrics(self) -> dict[str, object]:
        return {"motion_level": self.level, "blocked_frame_count": self.blocked_frames,
                "degradations": self.degradations}
