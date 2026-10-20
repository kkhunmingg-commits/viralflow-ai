"""LIVE Lite presenter: prepared mouth library + audio-driven lip-sync on CPU.

This is a FrameEngine for the existing LiveStore → AVSessionStream → encoder →
StreamProvider path, so LIVE Pro's session, recovery and transport code is
reused unchanged. The slow neural/recorded work happens offline in the pack
builder; live work is selecting, blending and encoding prepared images.

Frames are paced to the audio clock. An idle loop keeps subtle motion when
the presenter is silent. Every frame carries a visible AI disclosure label.

Naturalness work done once at prepare time (no runtime cost): mouth patches are
colour-matched to the reference and get the reference's skin detail back where
the mouth did not change, so the 256 px neural patch is not a soft smear on a
sharp face. At runtime consecutive mouth shapes are cross-faded, the head moves
with smooth non-repeating motion plus small speech-driven nods, and the eyes
blink when they can be located in the reference.
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

    def __init__(self, pack_dir: Path, *, jpeg_quality: int = 90, allow_technical_test: bool = False,
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
        self._metrics = {"speech_frames": 0, "idle_frames": 0, "late_frames": 0, "skipped_frames": 0, "blinks": 0}
        self._paste_top = 0
        self._prev_region: np.ndarray | None = None
        self._prev_index = -1
        self._energy = 0.0
        self._blink_frames: list[np.ndarray] = []
        self._blink_plan: list[int] = []
        self._next_blink = 0
        self._rng = np.random.default_rng(int(os.getenv("AI_LIVE_LITE_MOTION_SEED", "7")))
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
        if _env_on("AI_LIVE_LITE_REFINE"):
            # The pack mask spans the whole patch width, so hair at the cheeks was pasted (and smeared)
            # too. Fade the outer 14 % on each side so only the mouth, chin and inner cheeks change.
            columns = np.linspace(0.0, 1.0, box_w, dtype=np.float32)
            taper = np.clip(np.minimum(columns, 1 - columns) / 0.14, 0.0, 1.0)
            alpha = alpha * (taper * taper * (3 - 2 * taper))[None, :, None]
        # Only rows the mask touches are pasted, so the eyes above stay the base's (and can blink).
        rows = np.nonzero(alpha[..., 0].max(axis=1) > 0.003)[0]
        top = int(rows[0]) if rows.size else 0
        under = base[y1:y2, x1:x2].astype(np.float32)
        regions = [refine_patch(cv2.imread(str(pack.root / frame.file), cv2.IMREAD_COLOR), under, alpha)[top:]
                   for frame in pack.frames]
        openness = np.array([frame.openness for frame in pack.frames], dtype=np.float32)
        if _env_on("AI_LIVE_LITE_REMEASURE"):
            measured = measured_openness(regions, y2 - y1, top)
            if measured.max() > 0:
                # Keep the pack's overall range so the audio tracker's scale still lines up.
                openness = openness.min() + measured * (openness.max() - openness.min())
        self._order = np.argsort(openness, kind="stable")
        self._open_sorted = openness[self._order]
        self._closed_index = int(self._order[0])
        self._pack, self._fps, self._base, self._regions, self._box = pack, fps, base, regions, (x1, y1, x2, y2)
        self._paste_top = top
        # Search the eyes down to 60 % of the face box: the pasted mouth region starts near 40 %, which cut
        # the lower half of the Haar eye boxes off and found no pair on any of the three Ally X presenters.
        eye_search = (x1, y1, x2, y1 + max(top, int((y2 - y1) * 0.6)))
        # Off by default: the eyelid remap left the iris visible through a smeared lid on the Ally X preview.
        self._blink_frames = blink_frames(base, eye_search) if _env_on("AI_LIVE_LITE_BLINK", "0") else []
        self._next_blink = int(self._fps * self._rng.uniform(1.5, 3.5))
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
            self._energy += (openness - self._energy) * 0.08  # slow envelope drives small nods
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
            self._energy *= 0.92
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
        self._regions, self._base, self._label, self._blink_frames, self._prev_region = [], None, None, [], None

    def metrics(self) -> dict[str, object]:
        samples = sorted(self._compose_ms)
        def pick(q: float):
            return round(samples[int((len(samples) - 1) * q)], 2) if samples else None
        return {"renderer": self.renderer, "fps": self._fps, **self._metrics,
                "compose_p50_ms": pick(0.5), "compose_p95_ms": pick(0.95),
                "library_frames": len(self._regions),
                "pack_source": self._pack.source if self._pack else None,
                "technical_test_only": self._pack.technical_test_only if self._pack else None,
                "face_box_output": list(self._box), "blink_ready": bool(self._blink_frames),
                "crossfade": _env_on("AI_LIVE_LITE_CROSSFADE")}

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
            value = abs(float(self._open_sorted[candidate]) - openness) + 0.004 * abs(candidate - self._last_rank)
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

    def _blink_base(self) -> np.ndarray:
        assert self._base is not None
        if self._blink_frames:
            if not self._blink_plan:
                self._next_blink -= 1
                if self._next_blink <= 0:
                    self._blink_plan = [0, 1, 1, 0]  # half, closed, closed, half: ~160 ms at 25 fps
                    self._metrics["blinks"] += 1
                    # Humans blink every 2-6 s, occasionally twice in a row.
                    double = self._rng.random() < 0.12
                    self._next_blink = int(self._fps * (0.35 if double else self._rng.uniform(2.2, 5.5)))
            if self._blink_plan:
                return self._blink_frames[self._blink_plan.pop(0)].copy()
        return self._base.copy()

    def _region(self, index: int) -> np.ndarray:
        import cv2
        region = self._regions[index]
        if _env_on("AI_LIVE_LITE_CROSSFADE") and self._prev_region is not None and index != self._prev_index:
            # One-frame cross-fade between mouth shapes hides the hard cut between library frames.
            region = cv2.addWeighted(region, 0.65, self._prev_region, 0.35, 0)
        self._prev_region, self._prev_index = self._regions[index], index
        return region

    def _compose(self, index: int) -> bytes:
        import cv2
        assert self._base is not None and self._label is not None and self._pack is not None
        started = time.perf_counter()
        frame = self._blink_base()
        x1, y1, x2, y2 = self._box
        frame[y1 + self._paste_top:y2, x1:x2] = self._region(index)
        motion = self._pack.motion
        t = self._t / self._fps
        period = motion.period_seconds
        # Sum of incommensurate sines: smooth, never visibly looping like a single sine.
        wave = lambda a, b, c: (math.sin(2 * math.pi * t / (period * a)) * 0.6
                                + math.sin(2 * math.pi * t / (period * b) + 1.3) * 0.3
                                + math.sin(2 * math.pi * t / (period * c) + 2.1) * 0.1)
        scale = 1.0 + motion.breath_scale * (0.5 + 0.5 * math.sin(2 * math.pi * t / period))
        dx = motion.sway_px * wave(2.0, 3.7, 1.3)
        dy = motion.sway_px * 0.4 * wave(1.0, 2.9, 0.7) + motion.sway_px * 1.2 * self._energy
        # The whole frame is warped, so tilt sways the wall and shirt more than the face (measured 10-14 px
        # vs 5 px at 0.35/0.4 deg on the Ally X preview) and reads as camera wobble; keep it small.
        angle = 0.15 * wave(2.6, 4.3, 1.7) + 0.2 * self._energy * math.sin(2 * math.pi * t / 1.9)
        if motion.breath_scale or motion.sway_px:
            h, w = frame.shape[:2]
            centre = (w / 2, h * 0.45)
            matrix = cv2.getRotationMatrix2D(centre, angle, scale)
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


def _env_on(name: str, default: str = "1") -> bool:
    return os.getenv(name, default).strip().lower() not in ("0", "false", "off")


def measured_openness(regions: list[np.ndarray], box_h: int, top: int) -> np.ndarray:
    """How open each library mouth really is: dark inner-mouth pixels in the lip area.

    The pack's stored score disagreed with the images on the Ally X (near-closed frames scored
    above clearly open ones), which made selection jump between shapes.
    """
    import cv2
    values = []
    for region in regions:
        h, w = region.shape[:2]
        # Lips sit around 62-88 % of the face box height, central 34-66 % of its width.
        a, b = max(0, int(box_h * 0.62) - top), max(1, min(h, int(box_h * 0.88) - top))
        crop = cv2.cvtColor(region[a:b, int(w * 0.34):int(w * 0.66)], cv2.COLOR_BGR2GRAY).astype(np.float32)
        skin = float(np.percentile(crop, 75)) if crop.size else 0.0
        values.append(float((crop < skin * 0.55).mean()) if crop.size else 0.0)
    values = np.array(values, dtype=np.float32)
    span = float(values.max() - values.min())
    return (values - values.min()) / span if span > 1e-6 else values


def refine_patch(patch: np.ndarray | None, under: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Upscale a neural mouth patch onto the face box without the usual soft, off-colour look.

    under/alpha are float32 (box_h, box_w, 3/1). Done once per library frame at prepare time.
    """
    import cv2
    if patch is None:
        raise PresenterPackError("LITE_PACK_IMAGE_INVALID")
    box_h, box_w = under.shape[:2]
    if not _env_on("AI_LIVE_LITE_REFINE"):  # previous behaviour, kept for A/B comparison
        up = cv2.resize(patch, (box_w, box_h), interpolation=cv2.INTER_CUBIC).astype(np.float32)
        return np.clip(up * alpha + under * (1 - alpha), 0, 255).astype(np.uint8)
    up = cv2.resize(patch, (box_w, box_h), interpolation=cv2.INTER_LANCZOS4).astype(np.float32)
    sigma = max(1.0, box_w / 256.0)
    blur_ref = cv2.GaussianBlur(under, (0, 0), sigma)
    blur_up = cv2.GaussianBlur(up, (0, 0), sigma)
    # Where the mouth did not change shape, the patch should look like the sharp reference.
    changed = np.abs(blur_up - blur_ref).mean(axis=2)
    changed = cv2.GaussianBlur(np.clip((changed - 10.0) / 20.0, 0.0, 1.0), (0, 0), sigma * 2)[..., None]
    weight = alpha[..., 0] > 0.5
    steady = weight & (changed[..., 0] < 0.2)
    if steady.sum() > 64:  # VAE colour drift: match the unchanged skin's mean colour
        up += (under[steady].mean(axis=0) - up[steady].mean(axis=0))
        blur_up = cv2.GaussianBlur(up, (0, 0), sigma)
    detail = under - blur_ref
    # Mild unsharp on the newly generated lips/teeth only; near the mask edge (jaw line) it drew a light halo.
    inner = cv2.GaussianBlur((alpha[..., 0] > 0.9).astype(np.float32), (0, 0), sigma * 3)[..., None]
    sharpened = up + 0.25 * inner * (up - blur_up)
    refined = changed * sharpened + (1 - changed) * (blur_up + detail)
    return np.clip(refined * alpha + under * (1 - alpha), 0, 255).astype(np.uint8)


def blink_frames(base: np.ndarray, upper_face: tuple[int, int, int, int]) -> list[np.ndarray]:
    """Half- and fully-closed eye versions of the base frame, or [] if two eyes are not found.

    The upper eyelid band is stretched down over the eye and the lower lid moves up a little,
    feathered into the face. No extra model or asset is used.
    """
    import cv2
    x1, y1, x2, y2 = upper_face
    if x2 - x1 < 40 or y2 - y1 < 30 or not hasattr(cv2, "CascadeClassifier"):
        return []
    face = base[y1:y2, x1:x2]
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_eye.xml")
    eyes = cascade.detectMultiScale(cv2.cvtColor(face, cv2.COLOR_BGR2GRAY), scaleFactor=1.05, minNeighbors=6,
                                    minSize=((x2 - x1) // 10, (x2 - x1) // 10), maxSize=((x2 - x1) // 3, (x2 - x1) // 3))
    eyes = sorted((tuple(map(int, e)) for e in eyes), key=lambda e: -e[2] * e[3])[:2]
    if len(eyes) != 2 or abs(eyes[0][1] - eyes[1][1]) > (y2 - y1) * 0.12:
        return []
    result = []
    for amount in (0.55, 1.0):
        frame = base.copy()
        for ex, ey, ew, eh in eyes:
            # Haar eye boxes include brow-to-cheek; the eye itself sits around the box's middle.
            top, bottom = y1 + ey + int(eh * 0.25), y1 + ey + int(eh * 0.85)
            left, right = x1 + ex, x1 + ex + ew
            h = bottom - top
            if h < 6:
                return []
            lid = top + int(h * (0.15 + 0.5 * amount))  # where the upper lid edge ends up
            map_y = np.empty((h, ew), np.float32)
            rows = np.arange(h, dtype=np.float32)[:, None]
            src_band = h * 0.22  # upper-lid skin above the lash line
            upper = rows <= (lid - top)
            split = max(1, lid - top)
            start = src_band + amount * (0.78 * h - src_band)  # lower-lid rows that stay visible
            frac = (rows - split) / max(1, h - split)
            map_y[:] = np.where(upper, rows * (src_band / split), start + frac * (h - start))
            map_y += top
            map_x = np.tile(np.arange(left, right, dtype=np.float32), (h, 1))
            warped = cv2.remap(base, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            feather = np.zeros((h, ew), np.float32)
            feather[h // 6:h - h // 6, ew // 8:ew - ew // 8] = 1.0
            feather = cv2.GaussianBlur(feather, (0, 0), max(1.0, h / 6))[..., None]
            region = frame[top:bottom, left:right].astype(np.float32)
            frame[top:bottom, left:right] = np.clip(warped * feather + region * (1 - feather), 0, 255).astype(np.uint8)
        result.append(frame)
    return result


def create_engine() -> LitePresenterEngine:
    """Module factory for ``AI_LIVE_MUSETALK_STREAM_MODULE``-style loading."""
    pack = os.getenv("AI_LIVE_LITE_PACK_DIR", "").strip()
    if not pack:
        raise RuntimeError("LITE_PRESENTER_PACK_REQUIRED")
    return LitePresenterEngine(Path(pack), allow_technical_test=os.getenv("AI_LIVE_LITE_TECHNICAL_TEST", "") == "true")
