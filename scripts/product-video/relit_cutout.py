"""Cuts the relit product out of a merged still (harmonize_merge.py output) as a transparent PNG, and prints the quad
it occupies in the still, for track_recomposite.py with WHOLE_PRODUCT=1 PRELIT=1.
Usage: python relit_cutout.py merged.png mask.png out.png"""
import sys

import cv2
import numpy as np

merged = cv2.imread(sys.argv[1])
mask = cv2.imread(sys.argv[2], cv2.IMREAD_GRAYSCALE)
ys, xs = np.where(mask > 128)
x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
cv2.imwrite(sys.argv[3], np.dstack([merged, mask])[y0:y1, x0:x1])
print(f"{x0},{y0} {x1},{y0} {x1},{y1} {x0},{y1}")
