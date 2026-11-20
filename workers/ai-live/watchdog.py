"""Bounded, decision-only watchdog for AI LIVE session dependencies.

The watchdog never starts a presenter, reconnects a stream, or retries an
external call by itself. A controller may claim at most the configured number
of recovery attempts and must persist its own recovery decision.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LiveObservation:
    session_alive: bool
    presenter_alive: bool
    stream_connected: bool
    audio_queue_depth: int = 0
    audio_oldest_age_seconds: float = 0.0
    comment_queue_depth: int = 0
    comment_oldest_age_seconds: float = 0.0
    encoder_alive: bool = True
    encoder_output_age_seconds: float = 0.0


class LiveWatchdog:
    def __init__(
        self,
        *,
        max_recovery_attempts: int = 1,
        stuck_after_seconds: float = 10.0,
    ) -> None:
        if max_recovery_attempts < 0 or stuck_after_seconds <= 0:
            raise ValueError("INVALID_WATCHDOG_CONFIG")
        self._max_recovery_attempts = max_recovery_attempts
        self._stuck_after_seconds = stuck_after_seconds
        self._recovery_attempts = 0

    def inspect(self, observation: LiveObservation) -> tuple[str, ...]:
        if min(observation.audio_queue_depth, observation.comment_queue_depth,
               observation.audio_oldest_age_seconds,
               observation.comment_oldest_age_seconds, observation.encoder_output_age_seconds) < 0:
            raise ValueError("INVALID_WATCHDOG_OBSERVATION")
        issues = []
        if not observation.session_alive:
            issues.append("SESSION_NOT_ALIVE")
        if not observation.presenter_alive:
            issues.append("PRESENTER_NOT_ALIVE")
        if not observation.encoder_alive:
            issues.append("ENCODER_NOT_ALIVE")
        if observation.encoder_output_age_seconds >= self._stuck_after_seconds:
            issues.append("ENCODER_OUTPUT_STALLED")
        if observation.audio_queue_depth and observation.audio_oldest_age_seconds >= self._stuck_after_seconds:
            issues.append("AUDIO_QUEUE_STUCK")
        if observation.comment_queue_depth and observation.comment_oldest_age_seconds >= self._stuck_after_seconds:
            issues.append("COMMENT_QUEUE_STUCK")
        if not observation.stream_connected:
            issues.append("STREAM_DISCONNECTED")
        return tuple(issues)

    def claim_recovery(self, observation: LiveObservation) -> bool:
        """Reserve one bounded recovery attempt; never perform it implicitly."""
        if not self.inspect(observation) or self._recovery_attempts >= self._max_recovery_attempts:
            return False
        self._recovery_attempts += 1
        return True

    @property
    def recovery_attempts(self) -> int:
        return self._recovery_attempts
