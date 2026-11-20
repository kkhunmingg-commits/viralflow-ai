"""LIVE Lite presenter from the owner's photo: framing, checks, consented pack, agent build jobs."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lite_photo_presenter import build_from_photo, decode_photo, frame_photo, valid_consent  # noqa: E402
from lite_presenter_pack import PresenterPackError, list_packs, load_pack  # noqa: E402

CONSENT = {"likeness_use": True, "person": "ทดสอบ", "signed_at": "2026-11-20", "owner_ref": "a" * 64}


def face_photo(width=900, height=1400, face=220, top=330):
    """A drawn face that the frontal Haar cascade accepts is not guaranteed, so detection is patched in tests."""
    import cv2
    image = np.full((height, width, 3), 200, np.uint8)
    cx = width // 2
    cv2.ellipse(image, (cx, top + face // 2), (face // 2, int(face * 0.62)), 0, 0, 360, (150, 180, 225), -1)
    return image, (cx - face // 2, top, face, face)


def encode(image, ext=".jpg") -> bytes:
    import cv2
    ok, data = cv2.imencode(ext, image)
    assert ok
    return data.tobytes()


class FakeEngine:
    """Returns 256x256 crops whose mouth area darkens with the frame index."""

    def __init__(self):
        self.prepared = None

    def prepare(self, reference, fps):
        import cv2
        self.prepared = (Path(reference), fps)
        assert cv2.imread(str(reference)).shape[:2] == (1280, 720)

    def render_pcm16_chunk(self, chunk):
        import cv2
        for index in range(len(chunk) // 6400):
            patch = np.full((256, 256, 3), 170, np.uint8)
            cv2.ellipse(patch, (128, 200), (40, 4 + (index * 7) % 30), 0, 0, 360, (30, 20, 60), -1)
            yield cv2.imencode(".jpg", patch)[1].tobytes()

    def close(self):
        pass


class FramingTests(unittest.TestCase):
    def test_frames_to_720x1280_with_face_in_upper_third(self):
        image, box = face_photo()
        with unittest.mock.patch("face_detect.single_face", return_value=box):
            framed, report = frame_photo(image)
        self.assertEqual(framed.shape[:2], (1280, 720))
        x1, y1, x2, y2 = report["face_box"]
        self.assertTrue(150 <= x2 - x1 <= 470)
        self.assertLess((y1 + y2) / 2, 1280 * 0.45)

    def test_rejections_have_codes(self):
        image, (x, y, w, h) = face_photo()
        cases = {(x, y, 40, 40): "LITE_PHOTO_FACE_TOO_SMALL", (x, 2, w, h): "LITE_PHOTO_HEAD_CUT"}
        for box, code in cases.items():
            with self.subTest(code=code), unittest.mock.patch("face_detect.single_face", return_value=box):
                with self.assertRaises(PresenterPackError) as caught:
                    frame_photo(image)
                self.assertEqual(caught.exception.code, code)
        from face_detect import FaceDetectError
        for raised, code in (("NO_FACE", "LITE_PHOTO_NO_FACE"), ("MULTIPLE_FACES", "LITE_PHOTO_MULTIPLE_FACES")):
            with unittest.mock.patch("face_detect.single_face", side_effect=FaceDetectError(raised)):
                with self.assertRaises(PresenterPackError) as caught:
                    frame_photo(image)
                self.assertEqual(caught.exception.code, code)

    def test_close_up_is_rejected(self):
        image, _ = face_photo(width=700, height=900, face=600, top=150)
        with unittest.mock.patch("face_detect.single_face", return_value=(50, 150, 600, 600)):
            with self.assertRaises(PresenterPackError) as caught:
                frame_photo(image)
        self.assertEqual(caught.exception.code, "LITE_PHOTO_FACE_TOO_CLOSE")

    def test_decode_rejects_garbage_and_reads_png(self):
        with self.assertRaises(PresenterPackError):
            decode_photo(b"not an image")
        image, _ = face_photo()
        self.assertEqual(decode_photo(encode(image, ".png")).shape, image.shape)

    def test_consent_rules(self):
        self.assertTrue(valid_consent(CONSENT))
        for broken in ({}, {**CONSENT, "likeness_use": False}, {**CONSENT, "person": ""}, {**CONSENT, "signed_at": None}):
            self.assertFalse(valid_consent(broken))


class BuildTests(unittest.TestCase):
    def test_builds_a_consented_customer_pack_listed_with_owner(self):
        image, box = face_photo()
        engine = FakeEngine()
        with tempfile.TemporaryDirectory() as temp, \
                unittest.mock.patch("face_detect.single_face", side_effect=lambda img: box if img.shape[0] != 1280 else (240, 330, 240, 240)):
            out = Path(temp) / "packs" / "photo-test"
            pack = build_from_photo(out, encode(image), CONSENT, bytes(16000 * 2 * 3), engine,
                                    display_name="ลัคกี้", default_voice="th-TH-PremwadeeNeural")
            self.assertEqual(pack.source, "FRAME_ENGINE")
            self.assertFalse(pack.technical_test_only)
            loaded = load_pack(out)
            self.assertEqual(loaded.display_name, "ลัคกี้")
            self.assertEqual(loaded.consent["owner_ref"], "a" * 64)
            self.assertFalse((out.parent / ".photo-test.framed.png").exists())
            listed = list_packs(out.parent)
            self.assertEqual(listed[0]["ownerRef"], "a" * 64)
            self.assertEqual(engine.prepared[1], 5)

    def test_no_consent_no_pack(self):
        image, _ = face_photo()
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(PresenterPackError) as caught:
                build_from_photo(Path(temp) / "p", encode(image), {"likeness_use": False}, b"", FakeEngine(), display_name="x")
        self.assertEqual(caught.exception.code, "LITE_PHOTO_CONSENT_REQUIRED")


class FaceDetectTests(unittest.TestCase):
    def test_largest_face_wins_over_small_or_overlapping_false_positives(self):
        import face_detect
        detections = np.array([[100, 100, 60, 60], [300, 300, 200, 200], [330, 330, 120, 120]])
        cascade = unittest.mock.MagicMock()
        cascade.detectMultiScale.side_effect = [detections, np.empty((0, 4))]
        with unittest.mock.patch("cv2.CascadeClassifier", return_value=cascade):
            self.assertEqual(face_detect.single_face(np.zeros((800, 800, 3), np.uint8)), (300, 300, 200, 200))

    def test_second_real_face_is_rejected(self):
        import face_detect
        detections = np.array([[300, 300, 200, 200], [20, 20, 150, 150]])
        cascade = unittest.mock.MagicMock()
        cascade.detectMultiScale.side_effect = [detections, np.array([[10, 10, 20, 20]])]
        with unittest.mock.patch("cv2.CascadeClassifier", return_value=cascade):
            with self.assertRaises(face_detect.FaceDetectError) as caught:
                face_detect.single_face(np.zeros((800, 800, 3), np.uint8))
        self.assertEqual(caught.exception.code, "MULTIPLE_FACES")

    def test_no_face(self):
        import face_detect
        cascade = unittest.mock.MagicMock()
        cascade.detectMultiScale.return_value = ()
        with unittest.mock.patch("cv2.CascadeClassifier", return_value=cascade):
            with self.assertRaises(face_detect.FaceDetectError):
                face_detect.single_face(np.zeros((100, 100, 3), np.uint8))


class BackdropLayerTests(unittest.TestCase):
    """A cut-out person on a backdrop: pack layers round-trip and only the person moves live."""

    def _layered_pack(self, temp: Path):
        import cv2
        from dataclasses import replace
        from lite_pack_builder import build_synthetic
        from lite_presenter_pack import MotionProfile, sha256_file, write_manifest
        pack = build_synthetic(temp / "pack", frames=12, output_size=(256, 448))
        w, h = pack.output_size
        backdrop = np.zeros((h, w, 3), np.uint8)
        backdrop[:, ::8] = (0, 200, 255)       # vertical stripes: any shift is visible
        matte = np.zeros((h, w), np.uint8)
        cv2.ellipse(matte, (w // 2, int(h * 0.55)), (w // 4, int(h * 0.45)), 0, 0, 360, 255, -1)
        cv2.imwrite(str(pack.root / "backdrop.jpg"), backdrop, [cv2.IMWRITE_JPEG_QUALITY, 100])
        cv2.imwrite(str(pack.root / "matte.png"), matte)
        layered = replace(pack, motion=MotionProfile(0.02, 20.0, 2.0),
                          backdrop_file="backdrop.jpg", backdrop_sha256=sha256_file(pack.root / "backdrop.jpg"),
                          matte_file="matte.png", matte_sha256=sha256_file(pack.root / "matte.png"))
        write_manifest(layered)
        return layered

    def test_layers_round_trip_and_are_hash_checked(self):
        with tempfile.TemporaryDirectory() as temp:
            pack = self._layered_pack(Path(temp))
            loaded = load_pack(pack.root)
            self.assertEqual((loaded.backdrop_file, loaded.matte_file), ("backdrop.jpg", "matte.png"))
            (pack.root / "backdrop.jpg").write_bytes(b"changed")
            with self.assertRaises(PresenterPackError) as caught:
                load_pack(pack.root)
            self.assertEqual(caught.exception.code, "LITE_PACK_HASH_MISMATCH")

    def test_backdrop_stays_still_while_the_person_sways(self):
        import cv2
        from lite_presenter_engine import LitePresenterEngine
        with tempfile.TemporaryDirectory() as temp:
            pack = self._layered_pack(Path(temp))
            engine = LitePresenterEngine(pack.root, allow_technical_test=True)
            engine.prepare(pack.reference_path, 25)
            frames = [cv2.imdecode(np.frombuffer(engine._compose(engine._closed_index), np.uint8), cv2.IMREAD_GRAYSCALE)
                      for _ in range(40)]
            engine.close()
            corner = np.stack([frame[300:440, 0:40] for frame in frames]).astype(np.float32)
            self.assertLess(float(np.abs(corner - corner[0]).mean()), 2.0)
            person = np.stack([frame[180:260, 110:150] for frame in frames]).astype(np.float32)
            self.assertGreater(float(np.abs(person - person[0]).max()), 20.0)


class PhotoOnBackdropTests(unittest.TestCase):
    def test_build_with_backdrop_keeps_only_the_person_and_records_layers(self):
        image, box = face_photo()
        engine = FakeEngine()
        backdrop = np.full((1600, 900, 3), (40, 90, 160), np.uint8)

        def fake_place(person, backdrop_image, model):
            alpha = np.zeros(person.shape[:2], np.uint8)
            alpha[200:, 160:560] = 255
            fitted = np.full_like(person, (40, 90, 160))
            out = person.copy()
            out[alpha == 0] = fitted[alpha == 0]
            return out, fitted, alpha

        with tempfile.TemporaryDirectory() as temp, \
                unittest.mock.patch("face_detect.single_face", side_effect=lambda img: box if img.shape[0] != 1280 else (240, 330, 240, 240)), \
                unittest.mock.patch("person_matte.place_on_backdrop", side_effect=fake_place):
            model = Path(temp) / "u2net_human_seg.onnx"
            model.write_bytes(b"x")
            out = Path(temp) / "packs" / "photo-bd"
            build_from_photo(out, encode(image), CONSENT, bytes(16000 * 2 * 3), engine, display_name="ลัคกี้",
                             backdrop=encode(backdrop), matte_model=model)
            loaded = load_pack(out)
            self.assertEqual((loaded.backdrop_file, loaded.matte_file), ("backdrop.jpg", "matte.png"))
            import cv2
            reference = cv2.imread(str(loaded.reference_path))
            self.assertLess(np.abs(reference[20, 20].astype(int) - (40, 90, 160)).max(), 12)

    def test_backdrop_needs_the_matte_model_and_a_readable_image(self):
        image, box = face_photo()
        with tempfile.TemporaryDirectory() as temp, \
                unittest.mock.patch("face_detect.single_face", return_value=box):
            for backdrop, model, code in ((encode(image), None, "LITE_MATTE_MODEL_MISSING"),
                                          (b"nope", __file__, "LITE_PHOTO_BACKDROP_INVALID")):
                with self.subTest(code=code), self.assertRaises(PresenterPackError) as caught:
                    build_from_photo(Path(temp) / code, encode(image), CONSENT, b"", FakeEngine(), display_name="x",
                                     backdrop=backdrop, matte_model=model)
                self.assertEqual(caught.exception.code, code)


class BackdropCatalogTests(unittest.TestCase):
    def test_lists_named_backdrops_in_order_and_rejects_unsafe_ids(self):
        import cv2
        from local_agent.lite_photo_builds import backdrop_path, backdrop_thumbnail, list_backdrops
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            folder = root / "backdrops"
            folder.mkdir()
            for name in ("shelf", "warehouse", "shop", "my-store", "Bad_Name"):
                cv2.imwrite(str(folder / f"{name}.jpg"), np.full((1280, 720, 3), 120, np.uint8))
            (folder / "names.json").write_text(json.dumps({"my-store": "ร้านของฉัน"}, ensure_ascii=False), encoding="utf-8")
            self.assertEqual(list_backdrops(root), [{"id": "warehouse", "name": "โกดัง"}, {"id": "shop", "name": "ร้านค้า"},
                                                    {"id": "shelf", "name": "ชั้นวางของ"}, {"id": "my-store", "name": "ร้านของฉัน"}])
            self.assertIsNone(backdrop_path(root, "../shop"))
            self.assertIsNone(backdrop_path(root, "Bad_Name"))
            thumb = backdrop_thumbnail(root, "shop")
            self.assertEqual(cv2.imdecode(np.frombuffer(thumb, np.uint8), cv2.IMREAD_COLOR).shape[1], 240)
            self.assertEqual(list_backdrops(None), [])


if __name__ == "__main__":
    unittest.main()
