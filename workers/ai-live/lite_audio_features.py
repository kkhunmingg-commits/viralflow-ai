"""Cheap per-video-frame speech features for LIVE Lite lip-sync on CPU.

The features come from the exact PCM16 that the encoder plays. They drive the
selection of prepared mouth frames; they do not create presenter images.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

SAMPLE_RATE = 16_000


@dataclass(frozen=True)
class FrameFeature:
    """One video-frame window of played speech."""
    energy_db: float
    centroid: float  # 0..1 of the 0-4 kHz speech band
    voiced: bool


class FrameFeatureExtractor:
    """Split streamed PCM16 into fps-aligned windows without dropping samples.

    Residual samples are carried into the next chunk, so feature index ``n``
    always describes audio time ``n / fps`` of the current utterance.
    """
    def __init__(self, fps: int, *, silence_db: float = -45.0):
        if not 1 <= fps <= 60:
            raise ValueError("INVALID_LITE_FPS")
        self.fps = fps
        self.silence_db = silence_db
        self._exact = SAMPLE_RATE / fps
        self._pending = np.zeros(0, dtype=np.float32)
        self._consumed = 0
        self._emitted = 0
        window = int(round(self._exact))
        self._window = np.hanning(max(16, window)).astype(np.float32)
        freqs = np.fft.rfftfreq(len(self._window), 1 / SAMPLE_RATE)
        self._band = (freqs >= 80) & (freqs <= 4000)
        self._freqs = freqs[self._band]

    def reset(self) -> None:
        self._pending = np.zeros(0, dtype=np.float32)
        self._consumed = self._emitted = 0

    def push(self, pcm16: bytes) -> list[FrameFeature]:
        if len(pcm16) % 2:
            raise ValueError("INVALID_PCM16")
        samples = np.frombuffer(pcm16, dtype="<i2").astype(np.float32) / 32768.0
        self._pending = np.concatenate((self._pending, samples))
        features = []
        while True:
            end = int(round((self._emitted + 1) * self._exact)) - self._consumed
            if end > len(self._pending):
                break
            window = self._pending[:end]
            self._pending = self._pending[end:]
            self._consumed += end
            self._emitted += 1
            features.append(self._describe(window))
        return features

    def _describe(self, window: np.ndarray) -> FrameFeature:
        if not len(window):
            return FrameFeature(-120.0, 0.0, False)
        rms = float(np.sqrt(np.mean(window * window)))
        energy_db = 20 * math.log10(max(rms, 1e-6))
        padded = np.zeros(len(self._window), dtype=np.float32)
        padded[:min(len(window), len(padded))] = window[:len(padded)]
        spectrum = np.abs(np.fft.rfft(padded * self._window))[self._band]
        total = float(spectrum.sum())
        centroid = float((spectrum * self._freqs).sum() / total / 4000) if total > 1e-9 else 0.0
        return FrameFeature(energy_db, min(1.0, max(0.0, centroid)), energy_db > self.silence_db)


class OpennessTracker:
    """Map energy to 0..1 mouth openness with an adaptive voice-specific range.

    Cloud and local voices differ in loudness; the running speech-level range
    keeps quiet and loud voices articulating. Attack is fast and release slow,
    which reads as natural speech instead of frame-by-frame flicker.
    """
    def __init__(self, *, floor_db: float = -45.0, attack: float = 0.65, release: float = 0.35):
        self.floor_db = floor_db
        self.attack, self.release = attack, release
        self._peak = -20.0
        self._value = 0.0

    def reset(self) -> None:
        self._value = 0.0

    def update(self, feature: FrameFeature) -> float:
        if feature.voiced:
            # Slowly track the loudest recent speech so normalisation adapts.
            self._peak = max(feature.energy_db, self._peak - 0.05)
        span = max(6.0, self._peak - self.floor_db)
        target = 0.0 if not feature.voiced else min(1.0, max(0.0, (feature.energy_db - self.floor_db) / span))
        target = target ** 0.8
        rate = self.attack if target > self._value else self.release
        self._value += (target - self._value) * rate
        return self._value
