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
              seed: int = 0, source: np.ndarray = None, prelit: bool = False) -> np.ndarray:
    """source is the rectangle in the cutout that quad refers to (default: the watch case)."""
    SOURCE_QUAD = source if source is not None else globals()["SOURCE_QUAD"]
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
    if region.any() and not prelit:
        gain = (base[region].mean(0) + 1) / (rgb[region].mean(0) + 1)
        rgb = np.clip(rgb * (1 + tone * (np.clip(gain, 0.6, 1.6) - 1)), 0, 255)
    if blend and region.any():
        if not prelit:
            rgb = match_exposure(rgb, region, bg, quad)
        # The scene's light falls across the case the same way it falls across the wrist under it.
        # A prelit cutout (relit to this scene by IC-Light) already carries the scene's light.
        lum = cv2.GaussianBlur(cv2.cvtColor(bg, cv2.COLOR_BGR2GRAY).astype(np.float32), (0, 0), size * 0.35)
        shade = np.clip(lum / (lum[region].mean() + 1), 0.7, 1.3) ** (0.0 if prelit else 0.6)
        rgb = np.clip(rgb * shade[..., None], 0, 255)
        # Contact shadow where the case sits on the skin, slightly below and around it.
        shadow = cv2.GaussianBlur(np.roll(alpha, int(size * 0.04), 0), (0, 0), size * 0.06)
        base = base * (1 - 0.45 * np.clip(shadow - alpha, 0, 1)[..., None])
        # Same softness and grain as the scene right where the product stands, so it does not read as a sharper sticker.
        # A prelit cutout was already matched to the still's focus; only the resampling softness is added.
        focus = 0.4 if prelit else max(0.6 + size / 900, match_focus(bg, quad, rgb, region))
        rgb = cv2.GaussianBlur(rgb, (0, 0), focus)
        rgb = rgb + np.random.default_rng(seed).normal(0, 2.5, rgb.shape).astype(np.float32)
    else:
        # Soften to the still's sharpness so the paste does not look like a sticker.
        rgb = cv2.GaussianBlur(rgb, (0, 0), 0.3 + scale * 0.1)
    out = base * (1 - alpha[..., None]) + rgb * alpha[..., None]
    return np.clip(out, 0, 255).astype(np.uint8)


def box_quad(x0: float, y0: float, x1: float, y1: float) -> np.ndarray:
    return np.float32([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])


def alpha_box(cutout: np.ndarray) -> np.ndarray:
    """Bounding rectangle of a whole-product cutout, used as its source quad."""
    ys, xs = np.where(cutout[..., 3] > 128)
    return box_quad(xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)


def ground_shadow(bg: np.ndarray, quad: np.ndarray, strength: float = 0.55) -> np.ndarray:
    """Soft shadow under the base edge (quad BR-BL), so a standing product rests on the surface instead of floating."""
    left, right = np.float32(quad[3]), np.float32(quad[2])
    width = float(np.linalg.norm(right - left))
    centre = (left + right) / 2
    angle = float(np.degrees(np.arctan2(right[1] - left[1], right[0] - left[0])))
    shadow = np.zeros(bg.shape[:2], np.float32)
    cv2.ellipse(shadow, (int(centre[0]), int(centre[1] - width * 0.01)), (int(width * 0.47), max(2, int(width * 0.035))), angle, 0, 360, 1.0, -1)
    shadow = cv2.GaussianBlur(shadow, (0, 0), max(1.0, width * 0.025))
    # A thin dark contact line where the base touches the surface.
    contact = np.zeros(bg.shape[:2], np.float32)
    up = np.float32([0, width * 0.006])
    cv2.line(contact, tuple(int(v) for v in left + (right - left) * 0.06 - up), tuple(int(v) for v in right - (right - left) * 0.04 - up), 1.0, max(2, int(width * 0.012)))
    shadow = np.maximum(shadow, cv2.GaussianBlur(contact, (0, 0), max(1.0, width * 0.006)) * 0.9)
    return np.clip(bg.astype(np.float32) * (1 - strength * shadow[..., None]), 0, 255).astype(np.uint8)


def match_exposure(rgb: np.ndarray, region: np.ndarray, bg: np.ndarray, quad: np.ndarray) -> np.ndarray:
    """Studio product photos are brighter and harder-white than a soft-lit scene: scale the product so its highlights sit
    at the scene's highlight level around it, and lift its blacks to the scene's black level."""
    c = quad.mean(0)
    around = np.zeros(bg.shape[:2], np.uint8)
    cv2.fillPoly(around, [np.int32(c + (quad - c) * 2.2)], 255)
    scene = cv2.cvtColor(bg, cv2.COLOR_BGR2GRAY)[around > 0].astype(np.float32)
    product = rgb[region].mean(1)
    hi_s, lo_s = np.percentile(scene, 98), np.percentile(scene, 2)
    hi_p, lo_p = np.percentile(product, 98), np.percentile(product, 2)
    hi = min(hi_p, hi_s * 1.02)
    lo = max(lo_p, min(lo_s * 0.5, lo_p + 12))
    return np.clip((rgb - lo_p) / max(1.0, hi_p - lo_p) * (hi - lo) + lo, 0, 255)


def match_focus(bg: np.ndarray, quad: np.ndarray, rgb: np.ndarray, region: np.ndarray) -> float:
    """Blur that brings the product's fine-detail energy down to the scene's at the product's base (depth of field)."""
    grey = cv2.cvtColor(bg, cv2.COLOR_BGR2GRAY).astype(np.float32)
    base = (np.float32(quad[2]) + np.float32(quad[3])) / 2
    width = float(np.linalg.norm(np.float32(quad[2]) - np.float32(quad[3])))
    x0, x1 = int(max(0, base[0] - width * 0.6)), int(min(bg.shape[1], base[0] + width * 0.6))
    y0, y1 = int(max(0, base[1] + width * 0.02)), int(min(bg.shape[0], base[1] + width * 0.12))
    if x1 - x0 < 8 or y1 - y0 < 4:
        return 0.0
    scene = np.abs(cv2.Laplacian(grey, cv2.CV_32F))[y0:y1, x0:x1].mean()
    product_grey = cv2.cvtColor(np.clip(rgb, 0, 255).astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)
    inner = cv2.erode(region.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
    best = 0.0
    for sigma in (0.0, 0.5, 0.8, 1.1, 1.4, 1.8, 2.2):
        blurred = cv2.GaussianBlur(product_grey, (0, 0), sigma) if sigma else product_grey
        # Product detail (lettering, stitching) is busier than a floor, so it may stay up to twice the scene's energy.
        if np.abs(cv2.Laplacian(blurred, cv2.CV_32F))[inner].mean() <= scene * 2.0:
            return sigma
        best = sigma
    return best


def mirror_quad(quad: np.ndarray, squash: float = 1.0) -> np.ndarray:
    """The quad reflected about its base edge (BR-BL), for a reflection on a glossy surface."""
    tl, tr, br, bl = [np.float32(p) for p in quad]
    return np.float32([bl + (bl - tl) * squash, br + (br - tr) * squash, br, bl])


def reflection(head: np.ndarray, bg: np.ndarray, quad: np.ndarray, strength: float, source: np.ndarray = None) -> np.ndarray:
    """A faint mirror image of the product on a glossy floor or counter, fading out below the base."""
    if strength <= 0:
        return bg
    src = source if source is not None else SOURCE_QUAD
    mq = mirror_quad(quad)
    matrix = cv2.getPerspectiveTransform(np.float32(src), mq)
    warped = cv2.warpPerspective(head, matrix, (bg.shape[1], bg.shape[0]), flags=cv2.INTER_LINEAR)
    alpha = warped[..., 3].astype(np.float32) / 255
    base = float((quad[2][1] + quad[3][1]) / 2)
    height = float(np.linalg.norm(quad[3] - quad[0]))
    ys = np.arange(bg.shape[0], dtype=np.float32)[:, None]
    fade = np.clip(1 - (ys - base) / (0.45 * height), 0, 1) ** 1.5
    alpha = cv2.GaussianBlur(alpha * fade * strength, (0, 0), 2.0)[..., None]
    rgb = cv2.GaussianBlur(warped[..., :3].astype(np.float32), (0, 0), 2.5)
    return np.clip(bg.astype(np.float32) * (1 - alpha) + rgb * alpha, 0, 255).astype(np.uint8)


def main() -> None:
    head = cv2.imread(sys.argv[1], cv2.IMREAD_UNCHANGED)
    bg = cv2.imread(sys.argv[2])
    quad = np.float32([[float(v) for v in p.split(",")] for p in sys.argv[4:8]])
    tone = float(sys.argv[8]) if len(sys.argv) > 8 else 0.6
    cv2.imwrite(sys.argv[3], composite(head, bg, quad, tone))


if __name__ == "__main__":
    main()
