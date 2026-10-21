"""Pastes the real watch head (case and face, cut from the licensed photo) over the AI-drawn watch in a still,
so the dial, lettering and buttons are the real product's pixels, not the model's guess.
Usage: python composite_head.py head.png bg.png out.png TLx,TLy TRx,TRy BRx,BRy BLx,BLy [tone 0..1]
The four points are where the case's bounding rectangle (SOURCE_QUAD) lands in the still."""
import sys

import cv2
import numpy as np

# Case body in the 1280x1280 front photo, buttons excluded: top-left, top-right, bottom-right, bottom-left.
SOURCE_QUAD = np.float32([[185, 172], [1142, 172], [1142, 1003], [185, 1003]])


def composite(head: np.ndarray, bg: np.ndarray, quad: np.ndarray, tone: float = 0.6, blend: bool = False,
              seed: int = 0) -> np.ndarray:
    h, w = bg.shape[:2]
    # Shrink the photo close to the target size first, so the warp does not alias the small lettering.
    shrink = float(min(1.0, 2 * np.sqrt(cv2.contourArea(quad.astype(np.float32)) / cv2.contourArea(SOURCE_QUAD))))
    small = cv2.resize(head, None, fx=shrink, fy=shrink, interpolation=cv2.INTER_AREA) if shrink < 1 else head
    matrix = cv2.getPerspectiveTransform(np.float32(SOURCE_QUAD * shrink), quad.astype(np.float32))
    warped = cv2.warpPerspective(small, matrix, (w, h), flags=cv2.INTER_LINEAR)
    alpha = warped[..., 3].astype(np.float32) / 255
    size = np.sqrt(cv2.contourArea(quad))
    scale = max(2, int(size / 120))
    alpha = cv2.GaussianBlur(alpha, (0, 0), scale * 0.4)
    rgb = warped[..., :3].astype(np.float32)
    base = bg.astype(np.float32)
    # Match the scene's light: shift the head's mean colour toward the region it replaces (tone=0 keeps the photo's colour).
    region = alpha > 0.5
    if region.any():
        gain = (base[region].mean(0) + 1) / (rgb[region].mean(0) + 1)
        rgb = np.clip(rgb * (1 + tone * (np.clip(gain, 0.6, 1.6) - 1)), 0, 255)
    if blend and region.any():
        # The scene's light falls across the case the same way it falls across the wrist under it.
        lum = cv2.GaussianBlur(cv2.cvtColor(bg, cv2.COLOR_BGR2GRAY).astype(np.float32), (0, 0), size * 0.35)
        shade = np.clip(lum / (lum[region].mean() + 1), 0.7, 1.3) ** 0.6
        rgb = np.clip(rgb * shade[..., None], 0, 255)
        # Contact shadow where the case sits on the skin, slightly below and around it.
        shadow = cv2.GaussianBlur(np.roll(alpha, int(size * 0.04), 0), (0, 0), size * 0.06)
        base = base * (1 - 0.45 * np.clip(shadow - alpha, 0, 1)[..., None])
        # Same softness and grain as the upscaled AI frame, so the paste does not read as a sharper sticker.
        rgb = cv2.GaussianBlur(rgb, (0, 0), 0.6 + size / 900)
        rgb = rgb + np.random.default_rng(seed).normal(0, 2.5, rgb.shape).astype(np.float32)
    else:
        # Soften to the still's sharpness so the paste does not look like a sticker.
        rgb = cv2.GaussianBlur(rgb, (0, 0), 0.3 + scale * 0.1)
    out = base * (1 - alpha[..., None]) + rgb * alpha[..., None]
    return np.clip(out, 0, 255).astype(np.uint8)


def main() -> None:
    head = cv2.imread(sys.argv[1], cv2.IMREAD_UNCHANGED)
    bg = cv2.imread(sys.argv[2])
    quad = np.float32([[float(v) for v in p.split(",")] for p in sys.argv[4:8]])
    tone = float(sys.argv[8]) if len(sys.argv) > 8 else 0.6
    cv2.imwrite(sys.argv[3], composite(head, bg, quad, tone))


if __name__ == "__main__":
    main()
