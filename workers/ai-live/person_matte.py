"""Cut the presenter out of their photo and place them on a selling backdrop.

A photo's own background (a bedroom, a flower shop) rarely suits a LIVE sale, so
the person is separated with U^2-Net human segmentation (Apache-2.0 weights,
MIT ``rembg`` release, run locally through onnxruntime on the CPU, about 1-2 s)
and composited onto a backdrop the owner picks: warehouse, shop or shelf.

The model file is downloaded once, on purpose, with ``python person_matte.py
fetch --out <packs root>/models``; nothing is downloaded while building or live.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
from pathlib import Path

import numpy as np

MODEL_ENV = "AI_LIVE_LITE_MATTE_MODEL"
MODEL_NAME = "u2net_human_seg.onnx"
MODEL_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_human_seg.onnx"
MODEL_SHA256 = "01eb6a29a5c4d8edb30b56adad9bb3a2a0535338e480724a213e0acfd2d1c73c"
INPUT = 320


class MatteError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def model_path(packs_root: Path | None) -> Path | None:
    """The model from the environment, else ``<packs root>/models/u2net_human_seg.onnx``."""
    value = os.getenv(MODEL_ENV, "").strip()
    candidates = [Path(value)] if value else []
    if packs_root is not None:
        candidates.append(Path(packs_root) / "models" / MODEL_NAME)
    for path in candidates:
        if path.is_absolute() and path.is_file() and not path.is_symlink():
            return path
    return None


_SESSIONS: dict[str, object] = {}


def _session(model: Path):
    import onnxruntime
    key = str(model)
    if key not in _SESSIONS:
        options = onnxruntime.SessionOptions()
        options.intra_op_num_threads = max(1, min(4, (os.cpu_count() or 2) // 2))
        _SESSIONS[key] = onnxruntime.InferenceSession(key, options, providers=["CPUExecutionProvider"])
    return _SESSIONS[key]


def person_alpha(image: np.ndarray, model: Path) -> np.ndarray:
    """uint8 alpha (255 = person) with the image's height and width."""
    import cv2
    h, w = image.shape[:2]
    rgb = cv2.cvtColor(cv2.resize(image, (INPUT, INPUT), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
    x = rgb.astype(np.float32) / max(1.0, float(rgb.max()))
    x = (x - (0.485, 0.456, 0.406)) / (0.229, 0.224, 0.225)
    session = _session(model)
    raw = session.run(None, {session.get_inputs()[0].name: x.transpose(2, 0, 1)[None].astype(np.float32)})[0][0, 0]
    low, high = float(raw.min()), float(raw.max())
    if high - low < 1e-6:
        raise MatteError("NO_PERSON")
    soft = (raw - low) / (high - low)
    soft = cv2.resize(soft, (w, h), interpolation=cv2.INTER_CUBIC)
    # Hard core, soft hair edge; drop faint blobs (flowers, furniture) not joined to the person.
    alpha = np.clip((soft - 0.15) / 0.7, 0.0, 1.0)
    count, labels, stats, _ = cv2.connectedComponentsWithStats((alpha > 0.5).astype(np.uint8), 8)
    if count <= 1:
        raise MatteError("NO_PERSON")
    keep = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    body = cv2.dilate((labels == keep).astype(np.uint8), np.ones((15, 15), np.uint8))
    alpha *= body.astype(np.float32)
    # Pull the edge in by a pixel so the old background does not halo, then feather it.
    alpha = cv2.erode(alpha, np.ones((3, 3), np.uint8))
    alpha = cv2.GaussianBlur(alpha, (0, 0), max(0.8, w / 900))
    return (alpha * 255).astype(np.uint8)


def cover(image: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """Scale and centre-crop to fill (width, height)."""
    import cv2
    width, height = size
    scale = max(width / image.shape[1], height / image.shape[0])
    resized = cv2.resize(image, (max(width, round(image.shape[1] * scale)), max(height, round(image.shape[0] * scale))),
                         interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC)
    x0, y0 = (resized.shape[1] - width) // 2, (resized.shape[0] - height) // 2
    return np.ascontiguousarray(resized[y0:y0 + height, x0:x0 + width])


def harmonise(person: np.ndarray, alpha: np.ndarray, backdrop: np.ndarray, strength: float = 0.35) -> np.ndarray:
    """Nudge the person's overall brightness and colour cast toward the backdrop's."""
    import cv2
    mask = alpha > 128
    if mask.sum() < 100:
        return person
    p_lab = cv2.cvtColor(person, cv2.COLOR_BGR2LAB).astype(np.float32)
    b_lab = cv2.cvtColor(backdrop, cv2.COLOR_BGR2LAB).astype(np.float32)
    shift = (b_lab.reshape(-1, 3).mean(axis=0) - p_lab[mask].mean(axis=0)) * strength
    shift[0] = np.clip(shift[0], -18, 18)
    shift[1:] = np.clip(shift[1:], -6, 6)
    return cv2.cvtColor(np.clip(p_lab + shift, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)


def composite(person: np.ndarray, alpha: np.ndarray, backdrop: np.ndarray) -> np.ndarray:
    a = alpha.astype(np.float32)[..., None] / 255.0
    return (person.astype(np.float32) * a + backdrop.astype(np.float32) * (1 - a)).astype(np.uint8)


def place_on_backdrop(person: np.ndarray, backdrop: np.ndarray, model: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(composited reference, backdrop fitted to the person's frame, alpha)."""
    alpha = person_alpha(person, model)
    coverage = float((alpha > 128).mean())
    if not 0.04 <= coverage <= 0.92:
        raise MatteError("NO_PERSON")
    fitted = cover(backdrop, (person.shape[1], person.shape[0]))
    return composite(harmonise(person, alpha, fitted), alpha, fitted), fitted, alpha


def fetch(out_dir: Path) -> Path:
    """One deliberate download of the free segmentation model, checked against its hash."""
    import urllib.request
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / MODEL_NAME
    if target.is_file() and _sha256(target) == MODEL_SHA256:
        return target
    partial = target.with_suffix(".part")
    with urllib.request.urlopen(MODEL_URL, timeout=60) as response, partial.open("wb") as handle:
        while block := response.read(1 << 20):
            handle.write(block)
    if _sha256(partial) != MODEL_SHA256:
        partial.unlink(missing_ok=True)
        raise MatteError("MODEL_HASH_MISMATCH")
    partial.replace(target)
    return target


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    get = sub.add_parser("fetch", help="download the segmentation model once")
    get.add_argument("--out", type=Path, required=True)
    try_ = sub.add_parser("try", help="cut a person out and place them on a backdrop")
    try_.add_argument("--photo", type=Path, required=True)
    try_.add_argument("--backdrop", type=Path, required=True)
    try_.add_argument("--model", type=Path, required=True)
    try_.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    if args.command == "fetch":
        print(fetch(args.out))
        return 0
    import cv2
    result, _, _ = place_on_backdrop(cv2.imread(str(args.photo)), cv2.imread(str(args.backdrop)), args.model)
    cv2.imwrite(str(args.out), result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
