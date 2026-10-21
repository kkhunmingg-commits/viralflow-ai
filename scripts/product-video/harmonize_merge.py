"""Merges a relit frame (sdxl_harmonize.py) with the original composite: inside the product, the photo's fine detail
(lettering, logo, stitching) is kept and only the soft light and colour come from the relit frame; outside, the relit
frame is used as is, with its new shadows and reflections.
Usage: python harmonize_merge.py composite.png relit.png product_mask.png out.png [detail_sigma]"""
import sys

import cv2
import numpy as np


def merge(original: np.ndarray, relit: np.ndarray, mask: np.ndarray, sigma: float = 4.0) -> np.ndarray:
    o, r = original.astype(np.float32), relit.astype(np.float32)
    low = lambda im: cv2.GaussianBlur(im, (0, 0), sigma)
    product = np.clip(low(r) + (o - low(o)), 0, 255)
    alpha = cv2.GaussianBlur(mask.astype(np.float32) / 255, (0, 0), 1.0)[..., None]
    return np.clip(product * alpha + r * (1 - alpha), 0, 255).astype(np.uint8)


def main() -> None:
    original, relit = cv2.imread(sys.argv[1]), cv2.imread(sys.argv[2])
    mask = cv2.imread(sys.argv[3], cv2.IMREAD_GRAYSCALE)
    sigma = float(sys.argv[5]) if len(sys.argv) > 5 else 4.0
    cv2.imwrite(sys.argv[4], merge(original, cv2.resize(relit, original.shape[1::-1]), mask, sigma))


if __name__ == "__main__":
    main()
