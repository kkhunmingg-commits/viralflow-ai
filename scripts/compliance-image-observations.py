"""Local pixel measurements, not a semantic vision classifier or media attestation."""
import json
from pathlib import Path
import sys

import cv2
import numpy as np


def observe(path):
    image = cv2.imread(str(path))
    if image is None:
        raise RuntimeError("IMAGE_DECODE_FAILED")
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    height, width = gray.shape
    # A central vertical divider is only a layout candidate. It cannot prove
    # before/after, a person's identity, product efficacy or digital manipulation.
    edges = cv2.Canny(gray, 70, 180)
    center = edges[:, int(width * .4):int(width * .6)]
    vertical = float(np.max(np.mean(center > 0, axis=0)))
    return {"name": path.name, "width": width, "height": height,
            "contrast": round(float(np.std(gray)), 3),
            "sharpness": round(float(cv2.Laplacian(gray, cv2.CV_64F).var()), 3),
            "comparisonLayoutCandidate": vertical > .35,
            "visualSafetyVerified": False}


if __name__ == "__main__":
    directory = Path(sys.argv[1]).resolve(strict=True)
    paths = sorted(directory.glob("frame-*.png"))
    if not paths or len(paths) > 60:
        raise RuntimeError("IMAGE_COUNT_INVALID")
    print(json.dumps([observe(path) for path in paths]))
