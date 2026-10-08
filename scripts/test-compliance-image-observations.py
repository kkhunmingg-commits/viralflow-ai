import importlib.util
from pathlib import Path
import tempfile
import unittest

import cv2
import numpy as np

spec = importlib.util.spec_from_file_location("observations", Path(__file__).with_name("compliance-image-observations.py"))
observations = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observations)


class PixelObservationTest(unittest.TestCase):
    def test_blank_is_unverified(self):
        with tempfile.TemporaryDirectory(prefix="vf-pixel-test-") as directory:
            path = Path(directory) / "blank.png"
            cv2.imwrite(str(path), np.full((640, 360, 3), 255, dtype=np.uint8))
            row = observations.observe(path)
            self.assertFalse(row["visualSafetyVerified"])
            self.assertFalse(row["comparisonLayoutCandidate"])
            self.assertEqual(row["sharpness"], 0)

    def test_two_panels_are_only_a_review_candidate(self):
        with tempfile.TemporaryDirectory(prefix="vf-pixel-test-") as directory:
            path = Path(directory) / "panels.png"
            image = np.full((640, 360, 3), 255, dtype=np.uint8)
            image[300:600, 30:180] = (180, 130, 100)
            image[300:600, 180:330] = (240, 190, 160)
            cv2.line(image, (180, 300), (180, 600), (0, 0, 0), 2)
            cv2.imwrite(str(path), image)
            row = observations.observe(path)
            self.assertTrue(row["comparisonLayoutCandidate"])
            self.assertFalse(row["visualSafetyVerified"])

    def test_invalid_image_cannot_be_safe(self):
        with tempfile.TemporaryDirectory(prefix="vf-pixel-test-") as directory:
            path = Path(directory) / "bad.png"
            path.write_bytes(b"not an image")
            with self.assertRaisesRegex(RuntimeError, "IMAGE_DECODE_FAILED"):
                observations.observe(path)


if __name__ == "__main__":
    unittest.main()
