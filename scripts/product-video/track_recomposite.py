"""Keeps the real product on screen in an AI shot: tracks the watch through every frame and pastes the real watch head
(cut from the licensed photo) over the model's version, at the final output resolution, so the dial, lettering and
buttons never warp. Prints tracking quality per shot.
Usage: python track_recomposite.py shot.mp4 head.png out.mp4 "x,y x,y x,y x,y" [width height tone]
The quad is where the case rectangle sits in the shot's first frame (shot pixels, TL TR BR BL)."""
import json
import subprocess
import sys

import cv2
import numpy as np

import os

from composite_head import alpha_box, composite, ground_shadow, reflection


def read_frames(path: str) -> list:
    capture, frames = cv2.VideoCapture(path), []
    while True:
        ok, frame = capture.read()
        if not ok:
            return frames
        frames.append(frame)


def track(frames: list, quad: np.ndarray, surface: bool = False) -> tuple:
    """Quad per frame from feature tracks on and around the watch. The motion is limited to move, turn and scale
    (no shear or keystone), so the real case keeps its true shape instead of bending into a trapezoid.
    surface=True follows the surface under the product's base instead (the shot was rendered without the product,
    so the product stays put on the table or floor however the camera moves)."""
    def region(q):
        mask = np.zeros(frames[0].shape[:2], np.uint8)
        c = q.mean(0)
        if surface:
            # The floor or table around the base, widened across the frame: plain surfaces have few corners.
            h = np.linalg.norm(q[3] - q[0])
            base = (q[2] + q[3]) / 2
            y0, y1 = base[1] - h * 0.8, base[1] + h * 1.2
            cv2.rectangle(mask, (0, int(max(0, y0))), (mask.shape[1], int(min(mask.shape[0], y1))), 255, -1)
            return mask
        cv2.fillPoly(mask, [np.int32(c + (q - c) * 1.3)], 255)
        return mask

    grey = cv2.cvtColor(frames[0], cv2.COLOR_BGR2GRAY)
    def features(image, q):
        found = cv2.goodFeaturesToTrack(image, 300, 0.01, 4, mask=region(q))
        if found is None or len(found) < 20:
            found = cv2.goodFeaturesToTrack(image, 300, 0.005, 4)
        return found

    points = features(grey, quad)
    total, params, inliers, current = np.eye(3), [(0.0, 0.0, 0.0, 0.0)], [1.0], quad.copy()
    centre0 = quad.mean(0)
    for frame in frames[1:]:
        nxt = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        moved, status, _ = cv2.calcOpticalFlowPyrLK(grey, nxt, points, None, winSize=(21, 21), maxLevel=3)
        good = status.ravel() == 1
        m, inl = (None, None)
        if good.sum() >= 6:
            m, inl = cv2.estimateAffinePartial2D(points[good], moved[good], method=cv2.RANSAC, ransacReprojThreshold=2.0)
        if m is not None:
            total = np.vstack([m, [0, 0, 1]]) @ total
            inliers.append(float(inl.mean()))
        else:
            inliers.append(0.0)
        current = cv2.perspectiveTransform(quad[None], total)[0]
        # Keep motion as (dx, dy, angle, log scale) of the case centre so it can be smoothed without distortion.
        scale = float(np.hypot(total[0, 0], total[1, 0]))
        angle = float(np.arctan2(total[1, 0], total[0, 0]))
        c = current.mean(0)
        params.append((float(c[0] - centre0[0]), float(c[1] - centre0[1]), angle, float(np.log(scale))))
        grey = nxt
        points = features(grey, current)
    # Gaussian smoothing over about a third of a second removes the jitter the eye reads as the watch sliding on the skin.
    p = np.array(params)
    kernel = np.exp(-0.5 * (np.arange(-6, 7) / 2.5) ** 2)
    kernel /= kernel.sum()
    padded = np.pad(p, ((6, 6), (0, 0)), mode="edge")
    smooth = np.stack([np.convolve(padded[:, k], kernel, mode="valid") for k in range(4)], 1)
    quads = []
    for dx, dy, angle, log_scale in smooth:
        rot = np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]]) * np.exp(log_scale)
        quads.append(((quad - centre0) @ rot.T + centre0 + [dx, dy]).astype(np.float32))
    return np.array(quads), inliers


def main() -> None:
    shot, head_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
    quad = np.float32([[float(v) for v in p.split(",")] for p in sys.argv[4].split()])
    width, height = (int(sys.argv[5]), int(sys.argv[6])) if len(sys.argv) > 6 else (1080, 1920)
    tone = float(sys.argv[7]) if len(sys.argv) > 7 else 0.4
    head = cv2.imread(head_path, cv2.IMREAD_UNCHANGED)
    # WHOLE_PRODUCT=1: the quad is the bounding box of the whole cutout (moka pot, shoe) instead of the watch case.
    source = alpha_box(head) if os.environ.get("WHOLE_PRODUCT") == "1" else None
    frames = read_frames(shot)
    surface = os.environ.get("TRACK") == "surface"
    quads, inliers = track(frames, quad, surface)
    sx, sy = width / frames[0].shape[1], height / frames[0].shape[0]
    writer = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}",
                               "-r", "25", "-i", "-", "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", out],
                              stdin=subprocess.PIPE)
    for i, (frame, q) in enumerate(zip(frames, quads)):
        big = cv2.resize(frame, (width, height), interpolation=cv2.INTER_LANCZOS4)
        q = q * np.float32([sx, sy])
        if surface:
            big = reflection(head, big, q, float(os.environ.get("REFLECTION", "0")), source)
            big = ground_shadow(big, q)
        writer.stdin.write(composite(head, big, q, tone, blend=True, seed=i, source=source, prelit=os.environ.get("PRELIT") == "1").tobytes())
    writer.stdin.close()
    writer.wait()
    drift = float(np.abs(quads[-1] - quads[0]).max())
    print(json.dumps({"shot": shot, "frames": len(frames), "minInlierRatio": round(min(inliers), 2),
                      "meanInlierRatio": round(float(np.mean(inliers)), 2), "maxCornerTravelPx": round(drift, 1), "output": out}))


if __name__ == "__main__":
    main()
