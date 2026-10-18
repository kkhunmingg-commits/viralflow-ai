"""Prepared LIVE Lite presenter pack: verified reference plus a mouth library.

A pack is built offline (the slow neural or recorded step) and replayed live
on CPU. Every file is hash-checked on load; nothing is downloaded or invented
at runtime. Synthetic packs exist for technical tests and are labelled so.
"""
from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

PACK_FORMAT = "viralflow-lite-presenter/1"
SOURCES = ("FRAME_ENGINE", "RECORDED_VIDEO", "SYNTHETIC_TEST")
MAX_PACK_FRAMES = 4000
MIN_PACK_FRAMES = 8
MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_SIDE = 4096


class PresenterPackError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


@dataclass(frozen=True)
class MouthFrame:
    file: str
    sha256: str
    openness: float
    centroid: float | None = None


@dataclass(frozen=True)
class MotionProfile:
    breath_scale: float = 0.006
    sway_px: float = 2.5
    period_seconds: float = 4.8

    def __post_init__(self):
        if (not 0 <= self.breath_scale <= 0.03 or not 0 <= self.sway_px <= 20
                or not 1 <= self.period_seconds <= 30):
            raise PresenterPackError("LITE_PACK_MOTION_INVALID")


@dataclass(frozen=True)
class PresenterPack:
    root: Path
    pack_id: str
    source: str
    technical_test_only: bool
    reference_file: str
    reference_sha256: str
    face_box: tuple[int, int, int, int]
    mask_file: str
    mask_sha256: str
    output_size: tuple[int, int]
    frames: tuple[MouthFrame, ...]
    motion: MotionProfile = field(default_factory=MotionProfile)
    disclosure_text: str = "AI presenter · ผู้นำเสนอ AI"
    consent: dict | None = None

    @property
    def reference_path(self) -> Path:
        return self.root / self.reference_file

    def to_manifest(self) -> dict:
        return {
            "format": PACK_FORMAT, "pack_id": self.pack_id, "source": self.source,
            "technical_test_only": self.technical_test_only,
            "reference": {"file": self.reference_file, "sha256": self.reference_sha256},
            "face_box": list(self.face_box),
            "mask": {"file": self.mask_file, "sha256": self.mask_sha256},
            "output": {"width": self.output_size[0], "height": self.output_size[1]},
            "frames": [{"file": frame.file, "sha256": frame.sha256, "openness": round(frame.openness, 4),
                        "centroid": None if frame.centroid is None else round(frame.centroid, 4)}
                       for frame in self.frames],
            "motion": {"breath_scale": self.motion.breath_scale, "sway_px": self.motion.sway_px,
                       "period_seconds": self.motion.period_seconds},
            "disclosure": {"text": self.disclosure_text},
            "consent": self.consent,
        }


def _safe_member(root: Path, name: object) -> Path:
    if not isinstance(name, str) or not name or len(name) > 200 or "\\" in name or name.startswith("/"):
        raise PresenterPackError("LITE_PACK_PATH_INVALID")
    path = (root / name)
    resolved = path.resolve()
    if root.resolve() not in resolved.parents or path.is_symlink() or not path.is_file():
        raise PresenterPackError("LITE_PACK_PATH_INVALID")
    if path.stat().st_size > MAX_FILE_BYTES:
        raise PresenterPackError("LITE_PACK_FILE_TOO_LARGE")
    return path


def _verified(root: Path, name: object, digest: object) -> str:
    path = _safe_member(root, name)
    if not isinstance(digest, str) or sha256_file(path) != digest:
        raise PresenterPackError("LITE_PACK_HASH_MISMATCH")
    return name  # type: ignore[return-value]


def load_pack(root: Path) -> PresenterPack:
    root = Path(root)
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file() or manifest_path.is_symlink() or manifest_path.stat().st_size > 2 * 1024 * 1024:
        raise PresenterPackError("LITE_PACK_MANIFEST_REQUIRED")
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise PresenterPackError("LITE_PACK_MANIFEST_INVALID") from None
    if not isinstance(data, dict) or data.get("format") != PACK_FORMAT or data.get("source") not in SOURCES:
        raise PresenterPackError("LITE_PACK_MANIFEST_INVALID")
    source = data["source"]
    technical = data.get("technical_test_only")
    if type(technical) is not bool or (source == "SYNTHETIC_TEST" and not technical):
        raise PresenterPackError("LITE_PACK_MANIFEST_INVALID")
    consent = data.get("consent")
    if source != "SYNTHETIC_TEST" and not technical:
        # A real person's likeness needs recorded consent before customer use.
        if (not isinstance(consent, dict) or consent.get("likeness_use") is not True
                or not isinstance(consent.get("person"), str) or not isinstance(consent.get("signed_at"), str)):
            raise PresenterPackError("LITE_PACK_CONSENT_REQUIRED")
    reference = data.get("reference") or {}
    mask = data.get("mask") or {}
    output = data.get("output") or {}
    box = data.get("face_box")
    width, height = output.get("width"), output.get("height")
    if (type(width) is not int or type(height) is not int or not 64 <= width <= 1920 or not 64 <= height <= 1920
            or width % 2 or height % 2):
        raise PresenterPackError("LITE_PACK_OUTPUT_INVALID")
    if (not isinstance(box, list) or len(box) != 4 or any(type(value) is not int for value in box)
            or not 0 <= box[0] < box[2] <= MAX_SIDE or not 0 <= box[1] < box[3] <= MAX_SIDE):
        raise PresenterPackError("LITE_PACK_FACE_BOX_INVALID")
    frames_data = data.get("frames")
    if not isinstance(frames_data, list) or not MIN_PACK_FRAMES <= len(frames_data) <= MAX_PACK_FRAMES:
        raise PresenterPackError("LITE_PACK_FRAMES_INVALID")
    frames = []
    for item in frames_data:
        if not isinstance(item, dict):
            raise PresenterPackError("LITE_PACK_FRAMES_INVALID")
        openness, centroid = item.get("openness"), item.get("centroid")
        if (type(openness) not in (int, float) or not math.isfinite(openness) or not 0 <= openness <= 1
                or (centroid is not None and (type(centroid) not in (int, float) or not 0 <= centroid <= 1))):
            raise PresenterPackError("LITE_PACK_FRAMES_INVALID")
        frames.append(MouthFrame(_verified(root, item.get("file"), item.get("sha256")), item["sha256"],
                                 float(openness), None if centroid is None else float(centroid)))
    motion = data.get("motion") or {}
    try:
        profile = MotionProfile(float(motion.get("breath_scale", 0.006)), float(motion.get("sway_px", 2.5)),
                                float(motion.get("period_seconds", 4.8)))
    except (TypeError, ValueError):
        raise PresenterPackError("LITE_PACK_MOTION_INVALID") from None
    disclosure = (data.get("disclosure") or {}).get("text", "AI presenter · ผู้นำเสนอ AI")
    if not isinstance(disclosure, str) or not 2 <= len(disclosure) <= 80:
        raise PresenterPackError("LITE_PACK_DISCLOSURE_REQUIRED")
    pack_id = data.get("pack_id")
    if not isinstance(pack_id, str) or not 1 <= len(pack_id) <= 80:
        raise PresenterPackError("LITE_PACK_MANIFEST_INVALID")
    return PresenterPack(root, pack_id, source, technical,
                         _verified(root, reference.get("file"), reference.get("sha256")), reference["sha256"],
                         tuple(box), _verified(root, mask.get("file"), mask.get("sha256")), mask["sha256"],
                         (width, height), tuple(frames), profile, disclosure,
                         consent if isinstance(consent, dict) else None)


def write_manifest(pack: PresenterPack) -> Path:
    path = pack.root / "manifest.json"
    path.write_text(json.dumps(pack.to_manifest(), ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def mouth_measurements(patches: list[np.ndarray], closed: np.ndarray) -> tuple[list[float], list[float]]:
    """Image-measured openness (dark mouth cavity + change from closed) and width.

    Patches are BGR uint8 of one size. Measured from the pixels themselves so
    any frame source (neural, recorded video) is indexed the same way.
    """
    import cv2
    h, w = closed.shape[:2]
    rows, cols = slice(int(h * 0.62), int(h * 0.94)), slice(int(w * 0.26), int(w * 0.74))
    closed_luma = cv2.cvtColor(closed, cv2.COLOR_BGR2GRAY)[rows, cols].astype(np.float32)
    threshold = float(np.median(closed_luma)) * 0.55
    dark, change, width = [], [], []
    for patch in patches:
        luma = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)[rows, cols].astype(np.float32)
        mask = luma < threshold
        dark.append(float(mask.mean()))
        change.append(float(np.abs(luma - closed_luma).mean()))
        columns = np.flatnonzero(mask.any(axis=0))
        width.append(float((columns[-1] - columns[0] + 1) / mask.shape[1]) if len(columns) else 0.0)
    def normalise(values: list[float]) -> list[float]:
        low, high = min(values), max(values)
        return [0.0 if high - low < 1e-9 else (value - low) / (high - low) for value in values]
    dark_n, change_n = normalise(dark), normalise(change)
    openness = [min(1.0, 0.7 * d + 0.3 * c) for d, c in zip(dark_n, change_n)]
    return openness, width
