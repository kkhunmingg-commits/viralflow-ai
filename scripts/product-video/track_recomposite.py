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

from composite_head import composite


def read_frames(path: str) -> list:
    capture, frames = cv2.VideoCapture(path), []
    while True:
        ok, frame = capture.read()
        if not ok:
            return frames
        frames.append(frame)


def track(frames: list, quad: np.ndarray) -> tuple:
    """Quad per frame from feature tracks on and around the watch, chained frame to frame with RANSAC homographies."""
    mask = np.zeros(frames[0].shape[:2], np.uint8)
    centre = quad.mean(0)
    cv2.fillPoly(mask, [np.int32(centre + (quad - centre) * 1.5)], 255)
    grey = cv2.cvtColor(frames[0], cv2.COLOR_BGR2GRAY)
    points = cv2.goodFeaturesToTrack(grey, 300, 0.01, 4, mask=mask)
    quads, inliers, current = [quad.copy()], [1.0], quad.copy()
    for frame in frames[1:]:
        nxt = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        moved, status, _ = cv2.calcOpticalFlowPyrLK(grey, nxt, points, None, winSize=(21, 21), maxLevel=3)
        good = status.ravel() == 1
        h, inl = (None, None)
        if good.sum() >= 8:
            h, inl = cv2.findHomography(points[good], moved[good], cv2.RANSAC, 2.0)
        if h is not None:
            current = cv2.perspectiveTransform(current[None], h)[0]
            inliers.append(float(inl.mean()))
        else:
            inliers.append(0.0)
        quads.append(current.copy())
        grey = nxt
        # Re-seed features inside the tracked region so long shots do not run out of points.
        mask = np.zeros_like(mask)
        c = current.mean(0)
        cv2.fillPoly(mask, [np.int32(c + (current - c) * 1.5)], 255)
        points = cv2.goodFeaturesToTrack(grey, 300, 0.01, 4, mask=mask)
    # Light temporal smoothing of the corners removes tracking jitter without lagging real motion.
    stack = np.array(quads)
    smooth = stack.copy()
    for i in range(len(stack)):
        lo, hi = max(0, i - 2), min(len(stack), i + 3)
        smooth[i] = stack[lo:hi].mean(0)
    return smooth, inliers


def main() -> None:
    shot, head_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
    quad = np.float32([[float(v) for v in p.split(",")] for p in sys.argv[4].split()])
    width, height = (int(sys.argv[5]), int(sys.argv[6])) if len(sys.argv) > 6 else (1080, 1920)
    tone = float(sys.argv[7]) if len(sys.argv) > 7 else 0.4
    head = cv2.imread(head_path, cv2.IMREAD_UNCHANGED)
    frames = read_frames(shot)
    quads, inliers = track(frames, quad)
    sx, sy = width / frames[0].shape[1], height / frames[0].shape[0]
    writer = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}",
                               "-r", "25", "-i", "-", "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", out],
                              stdin=subprocess.PIPE)
    for frame, q in zip(frames, quads):
        big = cv2.resize(frame, (width, height), interpolation=cv2.INTER_LANCZOS4)
        writer.stdin.write(composite(head, big, q * np.float32([sx, sy]), tone).tobytes())
    writer.stdin.close()
    writer.wait()
    drift = float(np.abs(quads[-1] - quads[0]).max())
    print(json.dumps({"shot": shot, "frames": len(frames), "minInlierRatio": round(min(inliers), 2),
                      "meanInlierRatio": round(float(np.mean(inliers)), 2), "maxCornerTravelPx": round(drift, 1), "output": out}))


if __name__ == "__main__":
    main()
