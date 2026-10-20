"""Slow camera push-in on a still (the hero shot with the real product), written at the output resolution.
No AI: the product pixels are the licensed photo's. Usage: python push_in.py still.png out.mp4 seconds zoom fx fy"""
import subprocess
import sys

import cv2
import numpy as np

still = cv2.imread(sys.argv[1])
seconds, zoom, fx, fy = map(float, sys.argv[3:7])
h, w = still.shape[:2]
W, H, frames = 1080, 1920, int(round(seconds * 25))
writer = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", "25", "-i", "-",
                           "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", sys.argv[2]], stdin=subprocess.PIPE)
for i in range(frames):
    t = i / max(1, frames - 1)
    ease = t * t * (3 - 2 * t)
    z = 1 + (zoom - 1) * ease
    cw, ch = w / z, h / z
    # Drift the crop centre from the frame centre toward the product.
    cx = w / 2 + (fx * w - w / 2) * ease
    cy = h / 2 + (fy * h - h / 2) * ease
    x0, y0 = np.clip(cx - cw / 2, 0, w - cw), np.clip(cy - ch / 2, 0, h - ch)
    m = np.float32([[W / cw, 0, -x0 * W / cw], [0, H / ch, -y0 * H / ch]])
    writer.stdin.write(cv2.warpAffine(still, m, (W, H), flags=cv2.INTER_CUBIC).tobytes())
writer.stdin.close()
writer.wait()
