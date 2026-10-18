"""Draws an original, fictional product (a blue insulated bottle) for pipeline tests.
Everything is generated here with Pillow and FFmpeg: no photo, logo or clip from anyone else.
Outputs: mock-bottle.png (still), mock-bottle-detail.png and mock-bottle.mp4 (10 s, 1080x1920).
Each frame carries a small "TEST MEDIA" mark so it cannot be mistaken for a real product shot."""
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = sys.argv[1]
FONT = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "fonts", "NotoSansThai-Bold.ttf")
FFMPEG = os.environ.get("FFMPEG_BINARY", "ffmpeg")
W, H = 1440, 2560  # Oversized so the video can pan and zoom without upscaling.


def vertical_gradient(size, top, bottom):
    img = Image.new("RGB", size, top)
    draw = ImageDraw.Draw(img)
    for y in range(size[1]):
        t = y / (size[1] - 1)
        draw.line([(0, y), (size[0], y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(top, bottom)))
    return img


def bottle(scene):
    draw = ImageDraw.Draw(scene, "RGBA")
    cx, top, body_w, body_h = W // 2, 700, 520, 1300
    shadow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(shadow).ellipse([cx - 380, top + body_h + 120, cx + 380, top + body_h + 260], fill=150)
    scene.paste((40, 50, 70), (0, 0), shadow.filter(ImageFilter.GaussianBlur(40)))
    # Body with a vertical highlight band to read as a metal cylinder.
    draw.rounded_rectangle([cx - body_w // 2, top + 220, cx + body_w // 2, top + 220 + body_h], radius=120, fill=(38, 120, 196))
    for i in range(60):
        alpha = int(90 * (1 - abs(i - 30) / 30))
        draw.line([(cx - 150 + i, top + 300), (cx - 150 + i, top + 140 + body_h)], fill=(255, 255, 255, alpha), width=1)
    draw.rounded_rectangle([cx - body_w // 2 + 40, top + 700, cx + body_w // 2 - 40, top + 980], radius=40, fill=(245, 248, 252))
    font = ImageFont.truetype(FONT, 96)
    draw.text((cx, top + 840), "ฟ้าเย็น", font=font, fill=(30, 70, 120), anchor="mm")
    draw.text((cx, top + 940), "500 ml", font=ImageFont.truetype(FONT, 56), fill=(90, 110, 140), anchor="mm")
    # Shoulder, neck and a flip lid with a handle loop.
    draw.rounded_rectangle([cx - 200, top + 120, cx + 200, top + 300], radius=70, fill=(32, 104, 172))
    draw.rounded_rectangle([cx - 210, top - 20, cx + 210, top + 140], radius=50, fill=(36, 40, 52))
    draw.arc([cx + 120, top - 110, cx + 330, top + 110], start=270, end=90, fill=(36, 40, 52), width=36)
    draw.ellipse([cx - 40, top + 20, cx + 40, top + 60], fill=(90, 96, 110))


def mark(img):
    draw = ImageDraw.Draw(img, "RGBA")
    font = ImageFont.truetype(FONT, 44)
    draw.rounded_rectangle([60, 60, 520, 150], radius=24, fill=(0, 0, 0, 120))
    draw.text((290, 105), "TEST MEDIA", font=font, fill=(255, 255, 255, 230), anchor="mm")


def main():
    os.makedirs(OUT, exist_ok=True)
    scene = vertical_gradient((W, H), (232, 240, 248), (176, 196, 220))
    bottle(scene)
    still = os.path.join(OUT, "mock-bottle-hires.png")
    scene.save(still)
    full = scene.resize((1080, 1920), Image.LANCZOS)
    mark(full)
    full.save(os.path.join(OUT, "mock-bottle.png"))
    detail = scene.crop((W // 2 - 540, 300, W // 2 + 540, 300 + 1920))
    mark(detail)
    detail.save(os.path.join(OUT, "mock-bottle-detail.png"))
    overlay = Image.new("RGBA", (1080, 1920), (0, 0, 0, 0))
    mark(overlay)
    badge = os.path.join(OUT, "mark.png")
    overlay.save(badge)
    # Slow push-in with a gentle drift: a camera move over the drawn scene, not a claimed demonstration.
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-framerate", "30", "-t", "10", "-i", still, "-i", badge,
                    "-filter_complex", "[0:v]scale=1440:2560,zoompan=z='1+0.0006*on':x='(iw-iw/zoom)/2+20*sin(on/60)':y='(ih-ih/zoom)/2':d=1:s=1080x1920:fps=30[v];[v][1:v]overlay=0:0,format=yuv420p",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", os.path.join(OUT, "mock-bottle.mp4")], check=True)
    os.remove(still)
    os.remove(badge)


if __name__ == "__main__":
    main()
