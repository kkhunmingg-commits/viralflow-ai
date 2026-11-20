"""LIVE Lite presenter from the owner's own photo ("ใช้รูปของฉัน").

One photo the owner uploaded with likeness consent is framed to the presenter
layout (720x1280, face in the upper third), checked, and turned into a normal
LIVE Lite pack with the existing offline mouth-library step
(``build_from_frame_engine`` with LIVE Pro's MuseTalk CPU engine). The pack
then plays exactly like the generated presenters: breathing/sway motion from
the pack's MotionProfile, mouth frames chosen from real speech, AI disclosure
burned into the video. Nothing is downloaded and no paid service is called.

    python lite_photo_presenter.py --out packs/photo-ab12cd34 --photo me.jpg --consent consent.json \\
        --calibration-wav calibration.wav --name "ลัคกี้" --voice th-TH-PremwadeeNeural
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lite_presenter_pack import PresenterPack, PresenterPackError

OUTPUT_W, OUTPUT_H = 720, 1280
FACE_FRACTION = 0.30   # face width / frame width, like the generated presenters
FACE_TOP = 0.30        # face centre at 30 % of the frame height
MIN_SOURCE_FACE_PX = 80   # smaller faces would be upscaled into mush
MAX_FACE_PX = 470         # framed face wider than this = photo too tight (no shoulders)
# Customer-facing reasons for each rejection (shown in the Dashboard).
PHOTO_ERRORS = {
    "LITE_PHOTO_INVALID": "อ่านไฟล์รูปไม่ได้ ใช้รูป JPG หรือ PNG",
    "LITE_PHOTO_NO_FACE": "ไม่เจอใบหน้าในรูป ใช้รูปหน้าตรง เห็นหน้าชัด ไม่ใส่แว่นดำหรือหน้ากาก",
    "LITE_PHOTO_MULTIPLE_FACES": "รูปมีหลายคน ใช้รูปที่มีคนเดียว",
    "LITE_PHOTO_FACE_TOO_SMALL": "หน้าในรูปเล็กหรือความละเอียดต่ำเกินไป ใช้รูปที่ถ่ายใกล้ขึ้นหรือชัดกว่านี้",
    "LITE_PHOTO_FACE_TOO_CLOSE": "หน้าใหญ่เกินไป ใช้รูปที่เห็นไหล่และลำตัวด้วย",
    "LITE_PHOTO_HEAD_CUT": "ศีรษะชิดขอบบนเกินไป ใช้รูปที่มีพื้นที่เหนือศีรษะ",
    "LITE_PHOTO_CONSENT_REQUIRED": "ต้องยืนยันว่าเป็นรูปของคุณเอง หรือเจ้าของรูปยินยอมแล้ว",
    "LITE_PHOTO_NO_PERSON": "แยกตัวคนออกจากฉากหลังไม่ได้ ใช้รูปที่เห็นตัวคนชัด ไม่มีของบังหน้าหรือลำตัว",
    "LITE_PHOTO_BACKDROP_INVALID": "อ่านรูปฉากหลังไม่ได้ เลือกฉากอื่น",
    "LITE_MATTE_MODEL_MISSING": "เครื่องนี้ยังไม่มีตัวแยกคนออกจากฉาก ดูวิธีติดตั้งในคู่มือ docs/AI_LIVE_LITE_AUTO.md",
}


def decode_photo(data: bytes) -> np.ndarray:
    """Decode JPEG/PNG bytes and apply the EXIF orientation (phone photos)."""
    import cv2
    image = None
    try:
        from io import BytesIO
        from PIL import Image, ImageOps
        with Image.open(BytesIO(data)) as opened:
            image = cv2.cvtColor(np.asarray(ImageOps.exif_transpose(opened).convert("RGB")), cv2.COLOR_RGB2BGR)
    except Exception:
        image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if image is None or image.ndim != 3 or min(image.shape[:2]) < 64:
        raise PresenterPackError("LITE_PHOTO_INVALID")
    return image


def frame_photo(image: np.ndarray) -> tuple[np.ndarray, dict]:
    """Crop to 9:16 around the face and scale to 720x1280. Returns (framed, report)."""
    import cv2
    from face_detect import FaceDetectError, single_face
    try:
        fx, fy, fw, fh = single_face(image)
    except FaceDetectError as exc:
        raise PresenterPackError("LITE_PHOTO_NO_FACE" if exc.code == "NO_FACE" else "LITE_PHOTO_MULTIPLE_FACES") from None
    ih, iw = image.shape[:2]
    if fw < MIN_SOURCE_FACE_PX:
        raise PresenterPackError("LITE_PHOTO_FACE_TOO_SMALL")
    cw = fw / FACE_FRACTION
    ch = cw * OUTPUT_H / OUTPUT_W
    if ch > ih:
        ch, cw = ih, ih * OUTPUT_W / OUTPUT_H
    if cw > iw:
        cw, ch = iw, iw * OUTPUT_H / OUTPUT_W
    x0 = min(max(fx + fw / 2 - cw / 2, 0), iw - cw)
    y0 = min(max(fy + fh / 2 - FACE_TOP * ch, 0), ih - ch)
    crop = image[int(round(y0)):int(round(y0 + ch)), int(round(x0)):int(round(x0 + cw))]
    interpolation = cv2.INTER_LANCZOS4 if cw < OUTPUT_W else cv2.INTER_AREA
    framed = cv2.resize(crop, (OUTPUT_W, OUTPUT_H), interpolation=interpolation)
    scale = OUTPUT_W / cw
    box = [int((fx - x0) * scale), int((fy - y0) * scale), int((fx + fw - x0) * scale), int((fy + fh - y0) * scale)]
    if box[2] - box[0] > MAX_FACE_PX:
        raise PresenterPackError("LITE_PHOTO_FACE_TOO_CLOSE")
    if box[1] < 40:
        raise PresenterPackError("LITE_PHOTO_HEAD_CUT")
    warnings = []
    if cw < 0.75 * OUTPUT_W:
        warnings.append("LOW_RESOLUTION")
    face = cv2.cvtColor(framed[box[1]:box[3], box[0]:box[2]], cv2.COLOR_BGR2GRAY)
    if face.mean() < 55:
        warnings.append("DARK_FACE")
    if cv2.Laplacian(face, cv2.CV_64F).var() < 25:
        warnings.append("BLURRY_FACE")
    return framed, {"face_box": box, "source_size": [iw, ih], "warnings": warnings}


def valid_consent(consent: object) -> bool:
    return (isinstance(consent, dict) and consent.get("likeness_use") is True
            and isinstance(consent.get("person"), str) and 1 <= len(consent["person"].strip()) <= 80
            and isinstance(consent.get("signed_at"), str))


def cut_onto_backdrop(framed: np.ndarray, backdrop: bytes, matte_model: Path | None):
    """(reference, (fitted backdrop, matte)) with the person cut out of their photo onto the backdrop."""
    import cv2
    from person_matte import MatteError, place_on_backdrop
    if matte_model is None or not Path(matte_model).is_file():
        raise PresenterPackError("LITE_MATTE_MODEL_MISSING")
    image = cv2.imdecode(np.frombuffer(backdrop, np.uint8), cv2.IMREAD_COLOR) if backdrop else None
    if image is None or min(image.shape[:2]) < 200:
        raise PresenterPackError("LITE_PHOTO_BACKDROP_INVALID")
    try:
        reference, fitted, alpha = place_on_backdrop(framed, image, Path(matte_model))
    except MatteError:
        raise PresenterPackError("LITE_PHOTO_NO_PERSON") from None
    return reference, (fitted, alpha)


def build_from_photo(out: Path, photo: bytes, consent: dict, calibration_pcm: bytes, engine, *,
                     display_name: str, default_voice: str | None = None, fps: int = 5,
                     backdrop: bytes | None = None, matte_model: Path | None = None) -> PresenterPack:
    """Customer pack (source FRAME_ENGINE, consent recorded) from one consented photo.

    With a backdrop, only the person is kept and placed on it; the pack keeps the
    backdrop and the person's matte as layers so the backdrop stays still live.
    """
    import cv2
    from lite_pack_builder import build_from_frame_engine
    if not valid_consent(consent):
        raise PresenterPackError("LITE_PHOTO_CONSENT_REQUIRED")
    framed, _report = frame_photo(decode_photo(photo))
    layers = None
    if backdrop is not None:
        framed, layers = cut_onto_backdrop(framed, backdrop, matte_model)
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    reference = out.parent / f".{out.name}.framed.png"
    if not cv2.imwrite(str(reference), framed):
        raise PresenterPackError("LITE_PACK_WRITE_FAILED")
    try:
        return build_from_frame_engine(out, reference, calibration_pcm, engine, fps=fps, technical=False,
                                       consent=consent, display_name=display_name[:40], default_voice=default_voice,
                                       layers=layers)
    finally:
        reference.unlink(missing_ok=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--photo", type=Path, required=True)
    parser.add_argument("--consent", type=Path, required=True)
    parser.add_argument("--calibration-wav", type=Path, required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--voice")
    parser.add_argument("--fps", type=int, default=5)
    parser.add_argument("--backdrop", type=Path, help="place the cut-out person on this backdrop image")
    parser.add_argument("--matte-model", type=Path, help="u2net_human_seg.onnx (see person_matte.py fetch)")
    parser.add_argument("--check-only", action="store_true", help="only frame and check the photo (writes <out>.png)")
    args = parser.parse_args(argv)
    try:
        if args.check_only:
            import cv2
            framed, report = frame_photo(decode_photo(args.photo.read_bytes()))
            if args.backdrop:
                framed, _ = cut_onto_backdrop(framed, args.backdrop.read_bytes(), args.matte_model)
            cv2.imwrite(str(args.out.with_suffix(".png")), framed)
            print(json.dumps({"ok": True, **report}))
            return 0
        from engine import make_engine
        from lite_pack_builder import read_wav_pcm16
        pack = build_from_photo(args.out, args.photo.read_bytes(), json.loads(args.consent.read_text(encoding="utf-8")),
                                read_wav_pcm16(args.calibration_wav), make_engine(), display_name=args.name,
                                default_voice=args.voice, fps=args.fps,
                                backdrop=args.backdrop.read_bytes() if args.backdrop else None, matte_model=args.matte_model)
    except PresenterPackError as exc:
        print(json.dumps({"ok": False, "code": exc.code, "message": PHOTO_ERRORS.get(exc.code, "")}, ensure_ascii=False))
        return 2
    print(json.dumps({"ok": True, "pack_id": pack.pack_id, "frames": len(pack.frames), "source": pack.source},
                     ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
