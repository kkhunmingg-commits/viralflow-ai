"""Render a short offline preview of a LIVE Lite presenter speaking, for quality review.

No streaming and no network: bank sentences are played through the same
LitePresenterEngine the LIVE uses, and the frames plus audio are muxed to MP4.
`--baseline` turns off the naturalness improvements for an A/B comparison.

    python lite_presenter_preview.py --pack packs/nara --bank banks/nara --seconds 30 --out nara.mp4
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

TOGGLES = ("AI_LIVE_LITE_REFINE", "AI_LIVE_LITE_CROSSFADE", "AI_LIVE_LITE_REMEASURE")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pack", type=Path, required=True)
    parser.add_argument("--bank", type=Path, required=True)
    parser.add_argument("--seconds", type=float, default=30)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--baseline", action="store_true")
    parser.add_argument("--fps", type=int, default=25)
    parser.add_argument("--kbps", type=int, default=2500)
    args = parser.parse_args()
    for name in TOGGLES:
        if args.baseline:
            os.environ[name] = "0"
        else:
            os.environ.setdefault(name, "1")  # an explicit AI_LIVE_LITE_...=0 still wins
    if args.baseline:
        os.environ["AI_LIVE_LITE_BLINK"] = "0"

    from direct_stream import resolve_ffmpeg_path
    from lite_presenter_engine import LitePresenterEngine
    from lite_presenter_pack import load_pack

    pack = load_pack(args.pack)
    index = json.loads((args.bank / "index.json").read_text(encoding="utf-8"))
    sentences = [entry for entry in index["entries"].values()]
    class OfflineEngine(LitePresenterEngine):
        def _paced(self, index):  # offline render: no wall-clock pacing
            return self._compose(index)

    engine = OfflineEngine(args.pack, jpeg_quality=82 if args.baseline else 90,
                           allow_technical_test=os.getenv("AI_LIVE_LITE_TECHNICAL_TEST", "") == "true")
    engine.prepare(pack.reference_path, args.fps)
    work = Path(tempfile.mkdtemp(prefix="lite-preview-"))
    frames_dir = work / "frames"
    frames_dir.mkdir()
    pcm = bytearray()
    count = 0
    limit = int(args.seconds * args.fps)
    chunk = 16000 * 2 // args.fps * 5  # 200 ms of audio per engine call
    started = time.perf_counter()
    position = 0
    while count < limit:
        entry = sentences[position % len(sentences)]
        position += 1
        with wave.open(str(args.bank / entry["file"]), "rb") as handle:
            audio = handle.readframes(handle.getnframes())
        audio = audio[:len(audio) - len(audio) % (16000 * 2 // args.fps)]
        for offset in range(0, len(audio), chunk):
            piece = audio[offset:offset + chunk]
            for jpeg in engine.render_pcm16_chunk(piece):
                if count >= limit:
                    break
                (frames_dir / f"{count:06d}.jpg").write_bytes(jpeg)
                count += 1
            pcm += piece
            if count >= limit:
                break
        gap = int(args.fps * 0.4)  # the director's idle gap between lines
        for jpeg in engine.render_idle(gap / args.fps):
            if count >= limit:
                break
            (frames_dir / f"{count:06d}.jpg").write_bytes(jpeg)
            count += 1
            pcm += b"\0" * (16000 * 2 // args.fps)
    compose = engine.metrics()
    engine.close()
    wav = work / "audio.wav"
    with wave.open(str(wav), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(16000)
        handle.writeframes(bytes(pcm[:count * (16000 * 2 // args.fps)]))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([resolve_ffmpeg_path(None), "-hide_banner", "-loglevel", "error", "-y",
                    "-framerate", str(args.fps), "-i", str(frames_dir / "%06d.jpg"), "-i", str(wav),
                    "-c:v", "libx264", "-preset", "veryfast", "-b:v", f"{args.kbps}k", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "96k", "-shortest", str(args.out)], check=True)
    print(json.dumps({"ok": True, "out": str(args.out), "frames": count, "baseline": args.baseline,
                      "render_seconds": round(time.perf_counter() - started, 1),
                      "compose_p50_ms": compose["compose_p50_ms"], "compose_p95_ms": compose["compose_p95_ms"],
                      "blinks": compose["blinks"], "blink_ready": compose["blink_ready"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
