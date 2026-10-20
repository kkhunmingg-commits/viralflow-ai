"""Lays the real full-length product photo (cut out of the licensed photo) flat on the table in the hero still,
with table-plane foreshortening, a contact shadow and the scene's light, so the hero shot shows the real product.
Usage: python composite_flatlay.py full.png bg.png out.png cx cy case_width_px angle_deg squash"""
import sys

import cv2
import numpy as np


def main() -> None:
    fg = cv2.imread(sys.argv[1], cv2.IMREAD_UNCHANGED)
    bg = cv2.imread(sys.argv[2]).astype(np.float32)
    cx, cy, width, angle, squash = map(float, sys.argv[4:9])
    scale = width / fg.shape[1]
    fg = cv2.resize(fg, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    h, w = bg.shape[:2]
    # Rotate in the table plane, then squash vertically for the camera's tilt toward the table.
    rot = cv2.getRotationMatrix2D((fg.shape[1] / 2, fg.shape[0] / 2), angle, 1.0)
    rot = np.vstack([rot, [0, 0, 1]])
    move = np.array([[1, 0, cx - fg.shape[1] / 2], [0, 1, cy - fg.shape[0] / 2], [0, 0, 1]], np.float64)
    tilt = np.array([[1, 0, 0], [0, squash, cy * (1 - squash)], [0, 0, 1]], np.float64)
    matrix = tilt @ move @ rot
    warped = cv2.warpPerspective(fg, matrix, (w, h), flags=cv2.INTER_LINEAR)
    alpha = cv2.GaussianBlur(warped[..., 3].astype(np.float32) / 255, (0, 0), 0.8)[..., None]
    rgb = warped[..., :3].astype(np.float32)
    # Contact shadow: the product's silhouette, darkened, offset away from the window and blurred.
    shadow = cv2.GaussianBlur(np.roll(alpha[..., 0], (int(6 * squash), -3), (0, 1)), (0, 0), 5)[..., None]
    out = bg * (1 - 0.55 * shadow)
    # Warm the photo toward the scene's sunlight.
    region = alpha[..., 0] > 0.5
    gain = (bg[region].mean(0) + 1) / (rgb[region].mean(0) + 1)
    rgb = np.clip(rgb * (1 + 0.25 * (np.clip(gain, 0.7, 1.5) - 1)), 0, 255)
    out = out * (1 - alpha) + rgb * alpha
    cv2.imwrite(sys.argv[3], np.clip(out, 0, 255).astype(np.uint8))


if __name__ == "__main__":
    main()
