"""Offline LIVE Lite presenter pack builder (the slow step, done before LIVE).

Sources:
  frame-engine  Render a mouth library with an existing incremental FrameEngine
                (for example LIVE Pro's MuseTalk CPU backend) from calibration
                speech. Slow on CPU, but it runs once per presenter.
  video         Index mouth shapes from a consented, tripod-recorded video of
                the presenter speaking.
  synthetic     Drawn test face for technical pipeline tests only. Never a
                customer presenter.

Nothing is downloaded. The pack directory receives hashed files plus manifest.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import uuid
import wave
from pathlib import Path

import numpy as np

from lite_audio_features import FrameFeatureExtractor
from lite_presenter_pack import (MotionProfile, MouthFrame, PresenterPack, PresenterPackError, load_pack,
                                 mouth_measurements, sha256_file, write_manifest)

PATCH = 256


def _write_image(path: Path, image: np.ndarray, quality: int = 92) -> str:
    import cv2
    path.parent.mkdir(parents=True, exist_ok=True)
    params = [cv2.IMWRITE_JPEG_QUALITY, quality] if path.suffix == ".jpg" else []
    if not cv2.imwrite(str(path), image, params):
        raise PresenterPackError("LITE_PACK_WRITE_FAILED")
    return sha256_file(path)


def _lower_face_mask() -> np.ndarray:
    import cv2
    mask = np.zeros((PATCH, PATCH), dtype=np.float32)
    # Same lower-face region LIVE Pro's CPU MuseTalk backend blends.
    mask[115:246, 12:244] = 1.0
    return (cv2.GaussianBlur(mask, (31, 31), 0) * 255).astype(np.uint8)


def face_box_for(image: np.ndarray) -> tuple[int, int, int, int]:
    """Single-face box with the margins LIVE Pro's CPU engine uses."""
    import cv2
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    faces = cascade.detectMultiScale(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), scaleFactor=1.1,
                                     minNeighbors=5, minSize=(48, 48))
    if len(faces) != 1:
        raise PresenterPackError("LITE_PACK_SINGLE_FACE_REQUIRED")
    x, y, w, h = map(int, faces[0])
    return (max(0, x - w // 10), max(0, y - h // 10),
            min(image.shape[1], x + w + w // 10), min(image.shape[0], y + h + h // 4))


def _finish(out: Path, *, source: str, technical: bool, reference: np.ndarray, box, patches: list[np.ndarray],
            closed: np.ndarray, centroids: list[float | None], output_size: tuple[int, int],
            consent: dict | None, motion: MotionProfile, disclosure: str) -> PresenterPack:
    out.mkdir(parents=True, exist_ok=True)
    if any(out.iterdir()):
        raise PresenterPackError("LITE_PACK_OUTPUT_NOT_EMPTY")
    openness, _width = mouth_measurements(patches, closed)
    frames = []
    for index, (patch, value, centroid) in enumerate(zip(patches, openness, centroids)):
        name = f"mouth/{index:05d}.jpg"
        frames.append(MouthFrame(name, _write_image(out / name, patch), value, centroid))
    reference_sha = _write_image(out / "reference.jpg", reference, 95)
    mask_sha = _write_image(out / "mask.png", _lower_face_mask())
    pack = PresenterPack(out, "lite-" + uuid.uuid4().hex[:12], source, technical, "reference.jpg", reference_sha,
                         tuple(int(v) for v in box), "mask.png", mask_sha, output_size, tuple(frames), motion,
                         disclosure, consent)
    write_manifest(pack)
    return load_pack(out)


def build_synthetic(out: Path, *, frames: int = 32, output_size: tuple[int, int] = (540, 960)) -> PresenterPack:
    """Drawn face with a moving mouth. Exists only to test the live pipeline."""
    import cv2
    width, height = output_size
    reference = np.zeros((height, width, 3), dtype=np.uint8)
    for row in range(height):
        reference[row] = (40 + row * 60 // height, 30 + row * 40 // height, 70 + row * 80 // height)
    cx, cy, rx, ry = width // 2, int(height * 0.36), int(width * 0.2), int(width * 0.26)
    def face(mouth: float) -> np.ndarray:
        image = reference.copy()
        cv2.ellipse(image, (cx, cy), (rx, ry), 0, 0, 360, (150, 180, 225), -1)
        for side in (-1, 1):
            cv2.ellipse(image, (cx + side * rx // 2, cy - ry // 5), (rx // 7, ry // 12), 0, 0, 360, (40, 40, 40), -1)
        cv2.ellipse(image, (cx, cy + ry // 2), (rx // 3, max(2, int(ry * 0.22 * mouth))), 0, 0, 360, (40, 30, 90), -1)
        cv2.line(image, (cx - rx // 3, cy + ry // 2), (cx + rx // 3, cy + ry // 2), (60, 60, 140), 2)
        return image
    closed_full = face(0.0)
    box = (cx - rx - rx // 10, cy - ry - ry // 10, cx + rx + rx // 10, cy + ry + ry // 4)
    def crop(image):
        x1, y1, x2, y2 = box
        return cv2.resize(image[y1:y2, x1:x2], (PATCH, PATCH), interpolation=cv2.INTER_AREA)
    patches = [crop(face(i / (frames - 1))) for i in range(frames)]
    return _finish(out, source="SYNTHETIC_TEST", technical=True, reference=closed_full, box=box,
                   patches=patches, closed=crop(closed_full), centroids=[None] * frames, output_size=output_size,
                   consent=None, motion=MotionProfile(), disclosure="AI presenter · ผู้นำเสนอ AI (ทดสอบ)")


def read_wav_pcm16(path: Path) -> bytes:
    with wave.open(str(path), "rb") as handle:
        if handle.getnchannels() != 1 or handle.getsampwidth() != 2 or handle.getframerate() != 16000:
            raise PresenterPackError("LITE_PACK_CALIBRATION_AUDIO_FORMAT")
        return handle.readframes(handle.getnframes())


def build_from_frame_engine(out: Path, reference_path: Path, calibration_pcm: bytes, engine, *, fps: int = 5,
                            output_size: tuple[int, int] = (720, 1280), technical: bool = True,
                            consent: dict | None = None) -> PresenterPack:
    """Render the mouth library offline with an existing incremental engine.

    The engine must return PATCH×PATCH crops of the same face box this builder
    computes (LIVE Pro's MuseTalk CPU backend does exactly this).
    """
    import cv2
    reference = cv2.imdecode(np.frombuffer(reference_path.read_bytes(), np.uint8), cv2.IMREAD_COLOR)
    if reference is None:
        raise PresenterPackError("LITE_PACK_IMAGE_INVALID")
    box = face_box_for(reference)
    x1, y1, x2, y2 = box
    closed = cv2.resize(reference[y1:y2, x1:x2], (PATCH, PATCH), interpolation=cv2.INTER_LANCZOS4)
    engine.prepare(reference_path, fps)
    extractor = FrameFeatureExtractor(fps)
    patches, centroids = [], []
    try:
        # Lead-in silence gives genuinely closed neural frames.
        stream = bytes(16000 * 2) + calibration_pcm + bytes(8000 * 2)
        for offset in range(0, len(stream), 32000):
            chunk = stream[offset:offset + 32000]
            if len(chunk) % 2:
                chunk = chunk[:-1]
            features = extractor.push(chunk)
            for jpeg in engine.render_pcm16_chunk(chunk):
                patch = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
                if patch is None or patch.shape[:2] != (PATCH, PATCH):
                    raise PresenterPackError("LITE_PACK_ENGINE_FRAME_INVALID")
                patches.append(patch)
                feature = features.pop(0) if features else None
                centroids.append(feature.centroid if feature is not None and feature.voiced else None)
            print(f"rendered {len(patches)} library frames", file=sys.stderr, flush=True)
    finally:
        engine.close()
    if len(patches) < 8:
        raise PresenterPackError("LITE_PACK_FRAMES_INVALID")
    return _finish(out, source="FRAME_ENGINE", technical=technical, reference=reference, box=box,
                   patches=patches, closed=closed, centroids=centroids, output_size=output_size,
                   consent=consent, motion=MotionProfile(), disclosure="AI presenter · ผู้นำเสนอ AI")


def build_from_video(out: Path, video_path: Path, consent: dict, *, stride: int = 2,
                     output_size: tuple[int, int] = (720, 1280), max_frames: int = 1500) -> PresenterPack:
    """Index mouth shapes from a consented static-camera video of the presenter."""
    import cv2
    if (not isinstance(consent, dict) or consent.get("likeness_use") is not True
            or not isinstance(consent.get("person"), str) or not isinstance(consent.get("signed_at"), str)):
        raise PresenterPackError("LITE_PACK_CONSENT_REQUIRED")
    capture = cv2.VideoCapture(str(video_path))
    frames = []
    index = 0
    while len(frames) < max_frames:
        ok, frame = capture.read()
        if not ok:
            break
        if index % stride == 0:
            frames.append(frame)
        index += 1
    capture.release()
    if len(frames) < 8:
        raise PresenterPackError("LITE_PACK_VIDEO_TOO_SHORT")
    box = face_box_for(frames[0])
    x1, y1, x2, y2 = box
    patches, kept = [], []
    for frame in frames:
        try:
            other = face_box_for(frame)
        except PresenterPackError:
            continue
        overlap_w = max(0, min(x2, other[2]) - max(x1, other[0]))
        overlap_h = max(0, min(y2, other[3]) - max(y1, other[1]))
        union = (x2 - x1) * (y2 - y1) + (other[2] - other[0]) * (other[3] - other[1]) - overlap_w * overlap_h
        if union and overlap_w * overlap_h / union >= 0.85:  # head stayed put: patch fits the reference
            patches.append(cv2.resize(frame[y1:y2, x1:x2], (PATCH, PATCH), interpolation=cv2.INTER_AREA))
            kept.append(frame)
    if len(patches) < 8:
        raise PresenterPackError("LITE_PACK_VIDEO_UNSTABLE")
    openness, _ = mouth_measurements(patches, patches[0])
    closed_index = int(np.argmin(openness))
    return _finish(out, source="RECORDED_VIDEO", technical=False, reference=kept[closed_index], box=box,
                   patches=patches, closed=patches[closed_index], centroids=[None] * len(patches),
                   output_size=output_size, consent=consent, motion=MotionProfile(), disclosure="AI presenter · ผู้นำเสนอ AI")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="source", required=True)
    synthetic = sub.add_parser("synthetic")
    synthetic.add_argument("--out", type=Path, required=True)
    engine = sub.add_parser("frame-engine")
    engine.add_argument("--out", type=Path, required=True)
    engine.add_argument("--reference", type=Path, required=True)
    engine.add_argument("--calibration-wav", type=Path, required=True)
    engine.add_argument("--fps", type=int, default=5)
    engine.add_argument("--customer", action="store_true", help="Mark as customer pack (needs consent JSON).")
    engine.add_argument("--consent", type=Path)
    video = sub.add_parser("video")
    video.add_argument("--out", type=Path, required=True)
    video.add_argument("--video", type=Path, required=True)
    video.add_argument("--consent", type=Path, required=True)
    args = parser.parse_args(argv)
    if args.source == "synthetic":
        pack = build_synthetic(args.out)
    elif args.source == "frame-engine":
        from engine import make_engine
        consent = json.loads(args.consent.read_text(encoding="utf-8")) if args.consent else None
        if args.customer and not consent:
            raise PresenterPackError("LITE_PACK_CONSENT_REQUIRED")
        pack = build_from_frame_engine(args.out, args.reference, read_wav_pcm16(args.calibration_wav), make_engine(),
                                       fps=args.fps, technical=not args.customer, consent=consent)
    else:
        pack = build_from_video(args.out, args.video, json.loads(args.consent.read_text(encoding="utf-8")))
    print(json.dumps({"pack_id": pack.pack_id, "frames": len(pack.frames), "source": pack.source,
                      "technical_test_only": pack.technical_test_only}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
