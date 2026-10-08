"""Create new encoded fixture pixels/audio, never customer evidence or usable ads."""
import json
import os
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / ".video-cache" / "compliance-real-world" / "videos"
FFMPEG = ROOT / "node_modules" / "ffmpeg-static" / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")


def run(args, env=None):
    subprocess.run(args, env=env, check=True, timeout=30, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)


def main():
    data = json.loads((ROOT / "docs/compliance-brain/real-world-holdout.json").read_text(encoding="utf8"))
    font = ImageFont.truetype("C:/Windows/Fonts/tahoma.ttf", 38)
    DEST.mkdir(parents=True, exist_ok=True)
    rows = [row for row in data["cases"] if row.get("video")] + data["mediaOnly"]
    for row in rows:
        image = Image.new("RGB", (720, 1280), "white")
        draw = ImageDraw.Draw(image)
        if row.get("comparison"):
            draw.rectangle((50, 650, 360, 1150), fill=(180, 130, 100))
            draw.rectangle((360, 650, 670, 1150), fill=(240, 190, 160))
            draw.line((360, 620, 360, 1200), fill="black", width=3)
        words, lines, line = row["text"].split(), [], ""
        for word in words:
            if draw.textlength((line + " " + word).strip(), font=font) > 640 and line:
                lines.append(line)
                line = word
            else:
                line = (line + " " + word).strip()
        if line:
            lines.append(line)
        for index, line in enumerate(lines):
            draw.text((40, 160 + index * 65), line, font=font, fill="black", stroke_width=0)
        frame = DEST / f"{row['id']}.png"
        image.save(frame)
        video = DEST / f"{row['id']}.mp4"
        if row.get("speech"):
            audio = DEST / f"{row['id']}.wav"
            # Speech content is passed through environment data, never interpolated in shell code.
            command = ("Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; "
                       "$s.SetOutputToWaveFile($env:COMPLIANCE_FIXTURE_AUDIO); $s.Speak($env:COMPLIANCE_FIXTURE_TEXT); $s.Dispose()")
            run(["powershell", "-NoProfile", "-Command", command], dict(os.environ,
                COMPLIANCE_FIXTURE_AUDIO=str(audio), COMPLIANCE_FIXTURE_TEXT=row["speech"]))
            audio_args = ["-i", str(audio)]
        else:
            audio_args = ["-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono"]
        run([str(FFMPEG), "-nostdin", "-y", "-v", "error", "-loop", "1", "-i", str(frame), *audio_args,
             "-t", "6", "-r", "15", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-af", "apad", "-movflags", "+faststart", str(video)])
    print(json.dumps({"videosCreated": len(rows), "fixtureOnly": True, "paidCalls": 0}))


if __name__ == "__main__":
    main()
