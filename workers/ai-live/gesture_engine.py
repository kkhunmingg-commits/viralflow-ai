"""Per-room gesture intent selection. Selection never fabricates motion frames."""
from __future__ import annotations

import math
import random
from collections import deque
from dataclasses import dataclass
from enum import Enum
from typing import Callable, Iterable


class Gesture(str, Enum):
    NEUTRAL = "neutral"
    SMILE = "smile"
    NOD = "nod"
    SMALL_WAVE = "small_wave"
    OPEN_PALM = "open_palm"
    POINT_PRODUCT = "point_product"
    HOLD_PRODUCT = "hold_product"
    LIGHT_HAIR_TOUCH = "light_hair_touch"
    LAUGH_REACTION = "laugh_reaction"
    LISTENING_POSE = "listening_pose"


HAND_GESTURES = frozenset({Gesture.SMALL_WAVE, Gesture.OPEN_PALM, Gesture.POINT_PRODUCT,
                          Gesture.HOLD_PRODUCT, Gesture.LIGHT_HAIR_TOUCH})
SAFE_GESTURES = frozenset({Gesture.NEUTRAL, Gesture.SMILE, Gesture.NOD, Gesture.LISTENING_POSE})
INTENT_GESTURES = {
    "greeting": (Gesture.SMALL_WAVE, Gesture.SMILE),
    "product_question": (Gesture.OPEN_PALM, Gesture.NOD),
    "purchase_intent": (Gesture.POINT_PRODUCT, Gesture.SMILE),
    "product_cta": (Gesture.POINT_PRODUCT, Gesture.OPEN_PALM),
    "emphasis": (Gesture.NOD,),
    "reaction": (Gesture.LAUGH_REACTION, Gesture.SMILE),
    "listening": (Gesture.LISTENING_POSE,),
    "safety": (Gesture.NEUTRAL,),
}


@dataclass(frozen=True)
class GestureDecision:
    gesture: Gesture
    reason: str
    expires_at: float


class GestureEngine:
    def __init__(self, *, cooldown_seconds: float = 6, same_gesture_cooldown: float = 20,
                 duration_seconds: float = 1.5, neutral_recovery_seconds: float = 2,
                 probability: float = .45, rng: Callable[[], float] = random.random) -> None:
        values = (cooldown_seconds, same_gesture_cooldown, duration_seconds, neutral_recovery_seconds, probability)
        if not all(math.isfinite(value) and value >= 0 for value in values) or not 0 <= probability <= 1 or duration_seconds == 0:
            raise ValueError("INVALID_GESTURE_POLICY")
        self.cooldown = cooldown_seconds
        self.same_cooldown = same_gesture_cooldown
        self.duration = duration_seconds
        self.recovery = neutral_recovery_seconds
        self.probability = probability
        self.rng = rng
        self._last_selected = -math.inf
        self._last_by_gesture: dict[Gesture, float] = {}
        self._recent: deque[Gesture] = deque(maxlen=3)
        self._active = GestureDecision(Gesture.NEUTRAL, "INITIAL", 0)
        self._neutral_until = 0.0
        self._latest_time = -math.inf
        self.selected_count = 0

    def _time(self, now: float) -> None:
        if not math.isfinite(now) or now < self._latest_time:
            raise ValueError("GESTURE_TIME_NOT_MONOTONIC")
        self._latest_time = now

    def current(self, now: float) -> GestureDecision:
        self._time(now)
        if self._active.gesture != Gesture.NEUTRAL and now >= self._active.expires_at:
            self._neutral_until = max(self._neutral_until, self._active.expires_at + self.recovery)
            self._active = GestureDecision(Gesture.NEUTRAL, "NEUTRAL_RECOVERY", self._neutral_until)
        return self._active

    def neutral(self, now: float, reason: str = "SAFETY_RECOVERY") -> GestureDecision:
        self._time(now)
        self._neutral_until = now + self.recovery
        self._active = GestureDecision(Gesture.NEUTRAL, reason, self._neutral_until)
        return self._active

    def choose(self, intent: str, now: float, supported: Iterable[Gesture], *, emphasis: bool = False) -> GestureDecision:
        current = self.current(now)
        if intent == "safety":
            return self.neutral(now, "SAFETY_INTENT")
        if current.gesture != Gesture.NEUTRAL:
            return current
        if now < self._neutral_until or now - self._last_selected < self.cooldown:
            return GestureDecision(Gesture.NEUTRAL, "COOLDOWN", self._neutral_until)
        supported_set = set(supported)
        choices = INTENT_GESTURES.get("emphasis" if emphasis else intent, ())
        choices = tuple(gesture for gesture in choices if gesture in supported_set and gesture not in self._recent
                        and now - self._last_by_gesture.get(gesture, -math.inf) >= self.same_cooldown)
        # Prefer natural stillness; unknown intent, unsupported motion or repetition
        # does not trigger a random hand gesture.
        roll = self.rng()
        if not math.isfinite(roll) or not 0 <= roll <= 1:
            raise ValueError("INVALID_GESTURE_RANDOM")
        if not choices or roll >= self.probability:
            return GestureDecision(Gesture.NEUTRAL, "STILLNESS", now)
        gesture = choices[0]
        self._active = GestureDecision(gesture, "INTENT", now + self.duration)
        self._last_selected = now
        self._last_by_gesture[gesture] = now
        self._recent.append(gesture)
        self.selected_count += 1
        return self._active

    def metrics(self) -> dict[str, object]:
        return {"selected_count": self.selected_count, "active_gesture": self._active.gesture.value,
                "history_depth": len(self._recent)}
