"""Render a product shot on a studio sweep, drawn fresh for every frame so the product is never resampled twice.

The licensed product photo is a studio shot, so it is placed on a studio set lit the same way (soft front light,
light backdrop) instead of an AI room with different light. The set is drawn here, not generated: a seamless sweep,
a soft light pool behind the product, a contact shadow, and a faint reflection on a satin floor. Nothing about the
product is drawn or altered; it is the photo's own pixels, scaled.

Usage: python studio_render.py job.json
job: {"cutout": png, "out": mp4, "seconds": s, "fps": 25, "wall": [r,g,b], "floor": [r,g,b], "horizon": 0.6,
      "width_frac": product width / frame width, "base_y": floor contact as frame fraction, "x": product centre fraction,
      "reflection": 0.18, "start": {"zoom": 1, "cx": 0.5, "cy": 0.5}, "end": {...}}
zoom/cx/cy describe the camera: zoom into the point (cx, cy) of the full set.
"""
import json
import subprocess
import sys

import cv2
import numpy as np

W, H = 1080, 1920


def smooth(t):
    return t * t * (3 - 2 * t)


def set_canvas(job, s, ox, oy):
    """Backdrop in camera space: scale s about origin offset (ox, oy) of set coordinates."""
    ys = (np.arange(H, dtype=np.float32) / s + oy) / H
    xs = (np.arange(W, dtype=np.float32) / s + ox) / W
    X, Y = np.meshgrid(xs, ys)
    wall = np.array(job["wall"], np.float32)[::-1]
    floor = np.array(job["floor"], np.float32)[::-1]
    hz = job["horizon"]
    # Seamless sweep: wall fades into floor through a soft curve, no hard horizon line.
    m = np.clip((Y - (hz - 0.08)) / 0.16, 0, 1)
    m = smooth(m)[..., None]
    img = wall * (1 - m) + floor * m
    # Soft light pool behind the product and gentle falloff to the edges.
    px, py = job["x"], job["base_y"] - 0.12
    d = np.sqrt(((X - px) * 1.0) ** 2 + ((Y - py) * 0.75) ** 2)
    img *= (1.0 + 0.10 * np.exp(-(d / 0.32) ** 2))[..., None]
    img *= (1.0 - 0.22 * np.clip(d - 0.25, 0, 1) ** 1.5)[..., None]
    # Floor darkens slightly toward the camera.
    img *= (1.0 - 0.10 * np.clip((Y - hz) / (1 - hz), 0, 1))[..., None]
    return img


def render_frame(job, cut, zoom, cx, cy, grain):
    s = zoom
    ox = cx * W - W / (2 * s)
    oy = cy * H - H / (2 * s)
    img = set_canvas(job, s, ox, oy)

    ph, pw = cut.shape[:2]
    alpha_src = cut[:, :, 3].astype(np.float32) / 255
    rows = np.where(alpha_src.max(axis=1) > 0.5)[0]
    cols = np.where(alpha_src.max(axis=0) > 0.5)[0]
    top, bot = rows.min(), job.get("contact_row", rows.max())
    left, right = cols.min(), cols.max()
    k = job["width_frac"] * W / (right - left)  # set pixels per photo pixel
    # Photo pixel (u, v) -> set (X, Y) -> camera (x, y)
    X0 = job["x"] * W - (left + right) / 2 * k
    Y0 = job["base_y"] * H - bot * k
    A = np.array([[k * s, 0, (X0 - ox) * s], [0, k * s, (Y0 - oy) * s]], np.float32)

    prod = cv2.warpAffine(cut, A, (W, H), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    a = prod[:, :, 3:].astype(np.float32) / 255
    rgb = prod[:, :, :3].astype(np.float32)

    base_y = (job["base_y"] * H - oy) * s
    pw_cam = job["width_frac"] * W * s
    xc = (job["x"] * W - ox) * s

    # The product's own bottom edge in camera space, per column (the base is seen slightly from above, so it curves).
    acol = a[..., 0]
    has = acol > 0.5
    lowest = np.where(has.any(axis=0), H - 1 - np.argmax(has[::-1], axis=0), -1).astype(np.float32)
    near = lowest > base_y - pw_cam * 0.06
    bottom = np.where(near, lowest, -1)
    cols = np.where(bottom > 0)[0]

    # Reflection: each column mirrored about its own contact point, fading out quickly.
    if job.get("reflection", 0) > 0 and len(cols):
        b = bottom.copy()
        b[b < 0] = np.interp(np.where(b < 0)[0], cols, b[cols])
        b = cv2.GaussianBlur(b[None, :], (0, 0), 3)[0]
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        map_y = 2 * b[None, :] - yy
        ref = cv2.remap(prod, xx, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
        ra = ref[:, :, 3].astype(np.float32) / 255
        depth = yy - b[None, :]
        ra *= (depth > 0) * np.clip(1 - depth / (0.14 * pw_cam), 0, 1) ** 1.8 * job["reflection"]
        ra = cv2.GaussianBlur(ra, (0, 0), 1.2 * s)
        rr = cv2.GaussianBlur(ref[:, :, :3].astype(np.float32), (0, 0), 1.2 * s)
        img = img * (1 - ra[..., None]) + rr * ra[..., None]

    # Shadows: a wide soft one, a short occlusion gradient, and a thin soft contact under the product's own bottom edge.
    sh = np.zeros((H, W), np.float32)
    cv2.ellipse(sh, (int(xc), int(base_y)), (int(pw_cam * 0.52), int(pw_cam * 0.06)), 0, 0, 360, 1.0, -1, cv2.LINE_AA)
    sh = cv2.GaussianBlur(sh, (0, 0), pw_cam * 0.05) * job.get("ambient", 0.30)
    contact = np.zeros((H, W), np.float32)
    drop = max(1.5, pw_cam * 0.003)  # the shadow core sits just below the edge, where the product does not cover it
    for x in cols:
        y = bottom[x] + drop
        y0, fy = int(y), y - int(y)
        if 0 <= y0 < H - 2:
            contact[y0, x] += 1 - fy
            contact[y0 + 1, x] += 1
            contact[y0 + 2, x] += fy
    contact = cv2.GaussianBlur(contact, (0, 0), max(1.0, pw_cam * 0.004)) * job.get("contact", 0.55) * 2.0
    occl = cv2.GaussianBlur(contact, (0, 0), pw_cam * 0.015) * 1.4
    shadow = np.clip(sh + np.clip(contact, 0, job.get("contact", 0.55)) + occl, 0, 0.8)
    img *= (1 - shadow)[..., None]

    img = img * (1 - a) + rgb * a
    img += grain
    return np.clip(img, 0, 255).astype(np.uint8)


def main():
    job = json.load(open(sys.argv[1]))
    cut = cv2.imread(job["cutout"], cv2.IMREAD_UNCHANGED)
    fps = job.get("fps", 25)
    n = max(1, round(job["seconds"] * fps))
    rng = np.random.default_rng(7)
    proc = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}",
                             "-r", str(fps), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", job["out"]],
                            stdin=subprocess.PIPE)
    a, b = job["start"], job["end"]
    for i in range(n):
        t = smooth(i / max(1, n - 1))
        z = a["zoom"] + (b["zoom"] - a["zoom"]) * t
        cx = a["cx"] + (b["cx"] - a["cx"]) * t
        cy = a["cy"] + (b["cy"] - a["cy"]) * t
        grain = rng.normal(0, 1.6, (H, W, 1)).astype(np.float32)
        proc.stdin.write(render_frame(job, cut, z, cx, cy, grain).tobytes())
        if i == 0 and job.get("still"):
            cv2.imwrite(job["still"], render_frame(job, cut, z, cx, cy, grain))
    proc.stdin.close()
    proc.wait()
    print(json.dumps({"out": job["out"], "frames": n}))


if __name__ == "__main__":
    main()
