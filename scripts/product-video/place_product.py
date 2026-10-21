"""Places a whole-product cutout (transparent PNG from the licensed photo) into an empty lifestyle still, standing on a
surface: the bottom edge sits at y, centred on x, at the given width. Prints the quad for track_recomposite.py.
Usage: python place_product.py cutout.png bg.png out.png x bottom_y width [tilt_degrees tone mask_out.png]"""
import os
import sys

import cv2
import numpy as np

from composite_head import alpha_box, composite, ground_shadow, reflection


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
    bg = reflection(cutout, bg, quad, float(os.environ.get("REFLECTION", "0")), alpha_box(cutout))
    bg = ground_shadow(bg, quad)
    cv2.imwrite(sys.argv[3], composite(cutout, bg, quad, tone, blend=True, source=alpha_box(cutout)))
    if len(sys.argv) > 9:
        # The product's mask in the still, for harmonize_merge.py.
        mask = np.zeros(bg.shape[:2], np.uint8)
        box = alpha_box(cutout)
        warp = cv2.getPerspectiveTransform(box, quad.astype(np.float32))
        mask = cv2.warpPerspective(cutout[..., 3], warp, (bg.shape[1], bg.shape[0]))
        cv2.imwrite(sys.argv[9], mask)
    print(" ".join(f"{px:.1f},{py:.1f}" for px, py in quad))


if __name__ == "__main__":
    main()
