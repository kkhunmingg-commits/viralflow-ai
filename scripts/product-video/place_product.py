"""Places a whole-product cutout (transparent PNG from the licensed photo) into an empty lifestyle still, standing on a
surface: the bottom edge sits at y, centred on x, at the given width. Prints the quad for track_recomposite.py.
Usage: python place_product.py cutout.png bg.png out.png x bottom_y width [tilt_degrees tone]"""
import sys

import cv2
import numpy as np

from composite_head import alpha_box, composite


def quad_for(cutout: np.ndarray, x: float, bottom: float, width: float, tilt: float = 0.0) -> np.ndarray:
    box = alpha_box(cutout)
    height = width * (box[2, 1] - box[0, 1]) / (box[1, 0] - box[0, 0])
    quad = np.float32([[x - width / 2, bottom - height], [x + width / 2, bottom - height], [x + width / 2, bottom], [x - width / 2, bottom]])
    angle = np.radians(tilt)
    rot = np.float32([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
    pivot = np.float32([x, bottom])
    return (quad - pivot) @ rot.T + pivot


def main() -> None:
    cutout = cv2.imread(sys.argv[1], cv2.IMREAD_UNCHANGED)
    bg = cv2.imread(sys.argv[2])
    x, bottom, width = (float(v) for v in sys.argv[4:7])
    tilt = float(sys.argv[7]) if len(sys.argv) > 7 else 0.0
    tone = float(sys.argv[8]) if len(sys.argv) > 8 else 0.35
    quad = quad_for(cutout, x, bottom, width, tilt)
    # Soft ground shadow under the base, so the product stands on the surface instead of floating over it.
    shadow = np.zeros(bg.shape[:2], np.float32)
    cv2.ellipse(shadow, (int(x), int(bottom - width * 0.01)), (int(width * 0.47), max(2, int(width * 0.035))), tilt, 0, 360, 1.0, -1)
    shadow = cv2.GaussianBlur(shadow, (0, 0), width * 0.025)
    bg = np.clip(bg.astype(np.float32) * (1 - 0.55 * shadow[..., None]), 0, 255).astype(np.uint8)
    cv2.imwrite(sys.argv[3], composite(cutout, bg, quad, tone, blend=True, source=alpha_box(cutout)))
    print(" ".join(f"{px:.1f},{py:.1f}" for px, py in quad))


if __name__ == "__main__":
    main()
