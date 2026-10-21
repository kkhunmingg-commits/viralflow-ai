"""Puts the relit real product into a static-camera AI shot of its empty set, then adds a slow push-in over the whole
frame. The product, its contact shadow and its reflection come from the approved still (same set, same light), so
they cannot slide or warp; the AI only moves the curtains, leaves or steam around it. Any small drift of the AI camera
is measured (phase correlation on the set) and applied to the product too.
Usage: python static_composite.py shot.mp4 still_final.png still_bg.png product_mask.png out.mp4 seconds zoom fx fy [zoom_start]
shot.mp4 may be the still itself (a PNG): the push-in then runs over the still alone."""
import json
import subprocess
import sys

import cv2
import numpy as np

W, H, FPS = 1080, 1920, 25


def read_frames(path: str) -> list:
    capture, frames = cv2.VideoCapture(path), []
    while True:
        ok, frame = capture.read()
        if not ok:
            return frames
        frames.append(frame)


def main() -> None:
    shot, final_path, bg_path, mask_path, out = sys.argv[1:6]
    seconds, zoom, fx, fy = float(sys.argv[6]), float(sys.argv[7]), float(sys.argv[8]), float(sys.argv[9])
    zoom_start = float(sys.argv[10]) if len(sys.argv) > 10 else 1.0
    def big(im):
        # The AI clip was cover-cropped from the 768x1344 still (480x832 = 6.4 px off the top and bottom at still scale).
        if im.shape[0] == 1344:
            im = im[6:1338]
        return cv2.resize(im, (W, H), interpolation=cv2.INTER_LANCZOS4).astype(np.float32)

    final, bg = big(cv2.imread(final_path)), big(cv2.imread(bg_path))
    mask = np.clip(big(cv2.imread(mask_path, cv2.IMREAD_GRAYSCALE)) / 255, 0, 1)
    # What the product adds to the set outside its own pixels (shadow, contact line, reflection), as a gain on the set.
    gain = np.clip((cv2.GaussianBlur(final, (0, 0), 1.5) + 1) / (cv2.GaussianBlur(bg, (0, 0), 1.5) + 1), 0.25, 2.0)
    gain = 1 + (gain - 1) * (1 - mask[..., None])
    alpha = cv2.GaussianBlur(mask, (0, 0), 0.8)[..., None]
    if shot.endswith(".png"):
        still = cv2.imread(shot)[6:1338] if cv2.imread(shot).shape[0] == 1344 else cv2.imread(shot)
        frames = [cv2.resize(still, (480, 832), interpolation=cv2.INTER_AREA)]
    else:
        frames = read_frames(shot)
    count = int(round(seconds * FPS))
    # The AI clip is 24-25 fps; it is resampled to the edit length.
    pick = [frames[min(len(frames) - 1, int(i * len(frames) / count))] for i in range(count)]
    first = cv2.cvtColor(cv2.resize(pick[0], (W // 4, H // 4)), cv2.COLOR_BGR2GRAY).astype(np.float32)
    writer = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS),
                               "-i", "-", "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", out], stdin=subprocess.PIPE)
    drift_max = 0.0
    for i, frame in enumerate(pick):
        grey = cv2.cvtColor(cv2.resize(frame, (W // 4, H // 4)), cv2.COLOR_BGR2GRAY).astype(np.float32)
        (dx, dy), _ = cv2.phaseCorrelate(first, grey)
        dx, dy = dx * 4, dy * 4
        drift_max = max(drift_max, float(np.hypot(dx, dy)))
        shift = np.float32([[1, 0, dx], [0, 1, dy]])
        g = cv2.warpAffine(gain, shift, (W, H), borderValue=(1, 1, 1))
        p = cv2.warpAffine(final, shift, (W, H))
        a = cv2.warpAffine(alpha, shift, (W, H))[..., None]
        out_frame = big(frame) * g
        out_frame = out_frame * (1 - a) + p * a
        # Slow push-in over the whole frame (smoothstep), toward the product.
        t = i / max(1, count - 1)
        z = zoom_start + (zoom - zoom_start) * (t * t * (3 - 2 * t))
        cx, cy = fx * W, fy * H
        m = np.float32([[z, 0, cx - z * cx], [0, z, cy - z * cy]])
        out_frame = cv2.warpAffine(np.clip(out_frame, 0, 255).astype(np.uint8), m, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        writer.stdin.write(out_frame.tobytes())
    writer.stdin.close()
    writer.wait()
    print(json.dumps({"shot": shot, "frames": count, "maxSetDriftPx": round(drift_max, 1), "output": out}))


if __name__ == "__main__":
    main()
