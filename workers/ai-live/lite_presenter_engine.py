"""LIVE Lite presenter: prepared mouth library + audio-driven lip-sync on CPU.

This is a FrameEngine for the existing LiveStore → AVSessionStream → encoder →
StreamProvider path, so LIVE Pro's session, recovery and transport code is
reused unchanged. The slow neural/recorded work happens offline in the pack
builder; live work is selecting, blending and encoding prepared images.

Frames are paced to the audio clock. An idle loop keeps subtle motion when
the presenter is silent. Every frame carries a visible AI disclosure label.
"""
from __future__ import annotations

import math
import os
import threading
import time
from collections import deque
from pathlib import Path
from typing import Iterator

import numpy as np

from lite_audio_features import FrameFeatureExtractor, OpennessTracker
from lite_presenter_pack import PresenterPack, PresenterPackError, load_pack, sha256_file

FONT_CANDIDATES = (
    r"C:\Windows\Fonts\LeelawUI.ttf", r"C:\Windows\Fonts\leelawad.ttf", r"C:\Windows\Fonts\tahoma.ttf",
    "/usr/share/fonts/truetype/tlwg/Garuda.ttf", "/usr/share/fonts/truetype/tlwg/Loma.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf",
)


def _disclosure_overlay(text: str, width: int) -> np.ndarray:
    """RGBA label rendered once. Falls back to ASCII only if no Thai font exists."""
    from PIL import Image, ImageDraw, ImageFont
    size = max(14, width // 34)
    font = None
    for candidate in FONT_CANDIDATES:
        if Path(candidate).is_file():
            try:
                font = ImageFont.truetype(candidate, size)
                break
            except OSError:
                continue
    if font is None:
        font, text = ImageFont.load_default(), "AI presenter"
    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    left, top, right, bottom = probe.textbbox((0, 0), text, font=font)
    pad = size // 2
    image = Image.new("RGBA", (right - left + pad * 2, bottom - top + pad * 2), (0, 0, 0, 150))
    ImageDraw.Draw(image).text((pad - left, pad - top), text, font=font, fill=(255, 255, 255, 255))
    return np.array(image)[..., [2, 1, 0, 3]]  # BGRA


class LitePresenterEngine:
    """One room's Lite presenter. Not thread-safe except ``interrupt``."""

    renderer = "lite_prepared_library"

    def __init__(self, pack_dir: Path, *, jpeg_quality: int = 82, allow_technical_test: bool = False,
                 clock=time.monotonic):
        self._pack_dir = Path(pack_dir)
        self._quality = int(jpeg_quality)
        self._allow_technical = allow_technical_test
        self._clock = clock
        self._interrupt = threading.Event()
        self._pack: PresenterPack | None = None
        self._fps = 0
        self._base = self._label = None
        self._regions: list[np.ndarray] = []
        self._order: np.ndarray | None = None
        self._open_sorted: np.ndarray | None = None
        self._closed_index = 0
        self._box = (0, 0, 0, 0)
        self._extractor: FrameFeatureExtractor | None = None
        self._tracker = OpennessTracker()
        self._next_due: float | None = None
        self._t = 0
        self._last_rank = 0
        self._repeat = 0
        self._metrics = {"speech_frames": 0, "idle_frames": 0, "late_frames": 0, "skipped_frames": 0}
        self._compose_ms: deque[float] = deque(maxlen=2048)
        self._prepared = False

    # FrameEngine contract -------------------------------------------------
    def prepare(self, reference: Path, fps: int) -> None:
        import cv2
        if self._prepared:
            raise RuntimeError("PRESENTER_ALREADY_LOADED")
        if not 1 <= fps <= 30:
            raise ValueError("INVALID_LITE_FPS")
        pack = load_pack(self._pack_dir)
        if pack.technical_test_only and not self._allow_technical:
            raise PresenterPackError("LITE_PACK_TECHNICAL_TEST_ONLY")
        # The selected presenter image must be this pack's verified reference.
        if not Path(reference).is_file() or sha256_file(Path(reference)) != pack.reference_sha256:
            raise PresenterPackError("LITE_PACK_REFERENCE_MISMATCH")
        source = cv2.imread(str(pack.reference_path), cv2.IMREAD_COLOR)
        mask = cv2.imread(str(pack.root / pack.mask_file), cv2.IMREAD_GRAYSCALE)
        if source is None or mask is None:
            raise PresenterPackError("LITE_PACK_IMAGE_INVALID")
        out_w, out_h = pack.output_size
        scale = max(out_w / source.shape[1], out_h / source.shape[0])
        resized = cv2.resize(source, (math.ceil(source.shape[1] * scale), math.ceil(source.shape[0] * scale)),
                             interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC)
        offset_x, offset_y = (resized.shape[1] - out_w) // 2, (resized.shape[0] - out_h) // 2
        base = np.ascontiguousarray(resized[offset_y:offset_y + out_h, offset_x:offset_x + out_w])
        x1, y1, x2, y2 = (round(value * scale) for value in pack.face_box)
        x1, x2 = x1 - offset_x, x2 - offset_x
        y1, y2 = y1 - offset_y, y2 - offset_y
        if x1 < 0 or y1 < 0 or x2 > out_w or y2 > out_h or x2 - x1 < 16 or y2 - y1 < 16:
            raise PresenterPackError("LITE_PACK_FACE_OUTSIDE_FRAME")
        box_w, box_h = x2 - x1, y2 - y1
        alpha = cv2.resize(mask, (box_w, box_h), interpolation=cv2.INTER_LINEAR).astype(np.float32)[..., None] / 255.0
        under = base[y1:y2, x1:x2].astype(np.float32)
        regions = []
        for frame in pack.frames:
            patch = cv2.imread(str(pack.root / frame.file), cv2.IMREAD_COLOR)
            if patch is None:
                raise PresenterPackError("LITE_PACK_IMAGE_INVALID")
            patch = cv2.resize(patch, (box_w, box_h), interpolation=cv2.INTER_CUBIC).astype(np.float32)
            regions.append(np.clip(patch * alpha + under * (1 - alpha), 0, 255).astype(np.uint8))
        openness = np.array([frame.openness for frame in pack.frames], dtype=np.float32)
        self._order = np.argsort(openness, kind="stable")
        self._open_sorted = openness[self._order]
        self._closed_index = int(self._order[0])
        self._pack, self._fps, self._base, self._regions, self._box = pack, fps, base, regions, (x1, y1, x2, y2)
        self._label = _disclosure_overlay(pack.disclosure_text, out_w)
        self._extractor = FrameFeatureExtractor(fps)
        self._interrupt.clear()
        self._prepared = True

    def render_pcm16_chunk(self, audio: bytes) -> Iterator[bytes]:
        if not self._prepared or self._extractor is None:
            raise RuntimeError("PRESENTER_NOT_LOADED")
        if not audio or len(audio) % 2 or len(audio) > 32_000:
            raise ValueError("INVALID_AUDIO_CHUNK")
        self._interrupt.clear()
        features = self._extractor.push(audio)
        # One frame of look-ahead inside the chunk offsets the tracker's smoothing
        # delay (measured ~40 ms behind the audio in the received stream).
        tracked = [self._tracker.update(feature) for feature in features]
        for position, feature in enumerate(features):
            if self._interrupt.is_set():
                self._extractor.reset()
                return
            openness = tracked[min(position + 1, len(tracked) - 1)]
            index = self._select(openness, feature.centroid if feature.voiced else None)
            jpeg = self._paced(index)
            if jpeg is not None:
                self._metrics["speech_frames"] += 1
                yield jpeg

    def render_idle(self, max_seconds: float) -> Iterator[bytes]:
        """Silent presenter motion between utterances; bounded so audio wins."""
        if not self._prepared:
            return
        if self._extractor is not None:
            self._extractor.reset()
        count = max(1, int(max_seconds * self._fps))
        for _ in range(count):
            if self._interrupt.is_set():
                self._interrupt.clear()
                return
            openness = self._decay()
            jpeg = self._paced(self._select(openness, None))
            if jpeg is not None:
                self._metrics["idle_frames"] += 1
                yield jpeg

    def audio_received(self, received_at: float) -> None:
        """Audio playout starts no earlier than the frame clock already reached."""
        if self._next_due is None or received_at > self._next_due + 2 / max(1, self._fps):
            self._next_due = received_at

    def interrupt(self) -> None:
        self._interrupt.set()

    def close(self) -> None:
        self._interrupt.set()
        self._prepared = False
        self._regions, self._base, self._label = [], None, None

    def metrics(self) -> dict[str, object]:
        samples = sorted(self._compose_ms)
        def pick(q: float):
            return round(samples[int((len(samples) - 1) * q)], 2) if samples else None
        return {"renderer": self.renderer, "fps": self._fps, **self._metrics,
                "compose_p50_ms": pick(0.5), "compose_p95_ms": pick(0.95),
                "library_frames": len(self._regions),
                "pack_source": self._pack.source if self._pack else None,
                "technical_test_only": self._pack.technical_test_only if self._pack else None,
                "face_box_output": list(self._box)}

    # internals -------------------------------------------------------------
    def _decay(self) -> float:
        from lite_audio_features import FrameFeature
        return self._tracker.update(FrameFeature(-120.0, 0.0, False))

    def _select(self, openness: float, centroid: float | None) -> int:
        assert self._order is not None and self._open_sorted is not None
        if openness < 0.04:
            self._last_rank, self._repeat = 0, 0
            return self._closed_index
        rank = int(np.searchsorted(self._open_sorted, openness))
        rank = min(max(rank, 0), len(self._order) - 1)
        # Small neighbourhood for variety, preferring continuity with the last pick.
        span = max(1, len(self._order) // 40)
        candidates = range(max(0, rank - span), min(len(self._order), rank + span + 1))
        pack = self._pack
        def cost(candidate: int) -> float:
            value = abs(float(self._open_sorted[candidate]) - openness) + 0.002 * abs(candidate - self._last_rank)
            frame = pack.frames[int(self._order[candidate])] if pack else None
            if centroid is not None and frame is not None and frame.centroid is not None:
                value += 0.15 * abs(frame.centroid - centroid)
            if candidate == self._last_rank and self._repeat >= 2:
                value += 1.0
            return value
        best = min(candidates, key=cost)
        self._repeat = self._repeat + 1 if best == self._last_rank else 0
        self._last_rank = best
        return int(self._order[best])

    def _compose(self, index: int) -> bytes:
        import cv2
        assert self._base is not None and self._label is not None and self._pack is not None
        started = time.perf_counter()
        frame = self._base.copy()
        x1, y1, x2, y2 = self._box
        frame[y1:y2, x1:x2] = self._regions[index]
        motion = self._pack.motion
        phase = 2 * math.pi * (self._t / self._fps) / motion.period_seconds
        scale = 1.0 + motion.breath_scale * (0.5 + 0.5 * math.sin(phase))
        dx = motion.sway_px * math.sin(phase * 0.5)
        dy = motion.sway_px * 0.4 * math.sin(phase + 1.1)
        if motion.breath_scale or motion.sway_px:
            h, w = frame.shape[:2]
            centre = (w / 2, h * 0.45)
            matrix = cv2.getRotationMatrix2D(centre, 0.15 * math.sin(phase * 0.7), scale)
            matrix[:, 2] += (dx, dy)
            frame = cv2.warpAffine(frame, matrix, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        label = self._label
        lh, lw = label.shape[:2]
        margin = max(8, frame.shape[1] // 60)
        roi = frame[margin:margin + lh, margin:margin + lw]
        alpha = label[:roi.shape[0], :roi.shape[1], 3:4].astype(np.float32) / 255.0
        roi[:] = (label[:roi.shape[0], :roi.shape[1], :3] * alpha + roi * (1 - alpha)).astype(np.uint8)
        ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, self._quality])
        if not ok:
            raise RuntimeError("PRESENTER_JPEG_ENCODE_FAILED")
        self._compose_ms.append((time.perf_counter() - started) * 1000)
        self._t += 1
        return encoded.tobytes()

    def _paced(self, index: int) -> bytes | None:
        period = 1 / self._fps
        now = self._clock()
        if self._next_due is None or self._next_due < now - 4 * period:
            if self._next_due is not None:
                # Far behind (CPU contention): skip stale slots instead of drifting.
                self._metrics["skipped_frames"] += int((now - self._next_due) / period)
            self._next_due = now
        due = self._next_due
        self._next_due = due + period
        jpeg = self._compose(index)
        wait = due - self._clock()
        if wait > 0:
            if self._interrupt.wait(wait):
                return None
        elif wait < -period:
            self._metrics["late_frames"] += 1
        return jpeg


def create_engine() -> LitePresenterEngine:
    """Module factory for ``AI_LIVE_MUSETALK_STREAM_MODULE``-style loading."""
    pack = os.getenv("AI_LIVE_LITE_PACK_DIR", "").strip()
    if not pack:
        raise RuntimeError("LITE_PRESENTER_PACK_REQUIRED")
    return LitePresenterEngine(Path(pack), allow_technical_test=os.getenv("AI_LIVE_LITE_TECHNICAL_TEST", "") == "true")
