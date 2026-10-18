"""LIVE Lite Auto technical proof: no human host, RTMP test server only.

Runs the real Lite worker (LiteWorkerBoundary -> LocalAISession -> encoder ->
RTMP) for a fixed time against a loopback LocalRTMPReceiver, while a test
viewer bot posts new questions. Reports presenter fps, comment-to-voice
latency, CPU/RAM, encoder/transport health and speech usage/cost.

This proves the technical pipeline only. It never sends to TikTok or any
public platform, and it is not evidence of commercial LIVE permission.
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import statistics
import subprocess
import sys
import threading
import time
from pathlib import Path

WORKER = Path(__file__).resolve().parent
sys.path.insert(0, str(WORKER))

from direct_stream import LocalRTMPReceiver, resolve_ffmpeg_path  # noqa: E402

OWNER, ACCOUNT = "lite-proof-owner", "lite-proof-account"
PRODUCTS = [
    {"productId": "bottle-600", "name": "กระบอกน้ำเก็บความเย็น 600 มล.", "version": "proof-1", "facts": {
        "price": 299, "currency": "THB", "promotion": "วันนี้ซื้อสองใบ ลดเพิ่มห้าสิบบาทค่ะ", "stock": 120,
        "colors": ["ดำ", "ขาว", "ชมพู"], "sizes": ["600 มล."],
        "shipping": "ส่งฟรีทั่วประเทศ ได้รับภายในสองถึงสามวันค่ะ",
        "attributes": {"วัสดุ": "ตัวกระบอกเป็นสแตนเลสสามศูนย์สี่ค่ะ",
                       "เก็บความเย็น": "เก็บความเย็นได้ประมาณสิบสองชั่วโมงค่ะ"},
        "faq": {"ล้างเครื่องล้างจานได้ไหม": "แนะนำให้ล้างด้วยมือนะคะ ไม่ควรเข้าเครื่องล้างจานค่ะ",
                "ใส่น้ำร้อนได้ไหม": "ใส่น้ำร้อนได้ค่ะ เก็บความร้อนได้ประมาณหกชั่วโมงค่ะ",
                "รับประกัน": "รับประกันสินค้าหนึ่งปีค่ะ"},
        "purchase": "สนใจกดตะกร้าสีส้มด้านล่างได้เลยค่ะ"}},
    {"productId": "towel-set", "name": "ผ้าขนหนูคอตตอนเซ็ตสามผืน", "version": "proof-1", "facts": {
        "price": 390, "currency": "THB", "stock": 45, "colors": ["ครีม", "เทา"],
        "shipping": "ส่งภายในวันถัดไปค่ะ",
        "attributes": {"เนื้อผ้า": "เป็นคอตตอนร้อยเปอร์เซ็นต์ ซับน้ำดีค่ะ"},
        "faq": {"ผ้าเป็นขุยไหม": "ซักครั้งแรกอาจมีขุยเล็กน้อย หลังจากนั้นจะหายไปค่ะ"}}},
]
# New wordings the product data does not contain verbatim, plus one with no data at all.
QUESTIONS = ["ราคาเท่าไหร่คะ", "ใส่น้ำร้อนได้มั้ยคะ", "เข้าเครื่องล้างจานได้ป่าว", "มีประกันไหมคะ",
             "มีสีอะไรบ้าง", "ส่งกี่วันถึง", "กันกระแทกไหม", "สวัสดีค่ะ", "วัสดุอะไรคะ", "ผ้าเป็นขุยมั้ย"]


class _ProcessKeyProtector:
    """Proof-only secret wrapping for non-Windows hosts (key never leaves memory)."""
    def __init__(self):
        self._key = secrets.token_bytes(32)

    def protect(self, data: bytes) -> bytes:
        return bytes(b ^ self._key[i % 32] for i, b in enumerate(data))

    unprotect = protect


def _percentile(values, q):
    values = sorted(values)
    return round(values[int((len(values) - 1) * q)], 1) if values else None


def _probe(path: Path) -> dict:
    ffprobe = Path(resolve_ffmpeg_path()).with_name("ffprobe" + (".exe" if os.name == "nt" else ""))
    if not ffprobe.is_file() or not path.is_file():
        return {}
    result = subprocess.run([str(ffprobe), "-v", "error", "-count_packets", "-show_entries",
                             "stream=codec_type,codec_name,width,height,nb_read_packets,avg_frame_rate:format=duration",
                             "-of", "json", str(path)], capture_output=True, timeout=60)
    return json.loads(result.stdout or b"{}")


def run(args) -> dict:
    import psutil
    from local_agent.stream_credentials import StreamCredentialStore
    from lite_mode import LiteWorkerBoundary
    from lite_pack_builder import build_synthetic
    from lite_presenter_pack import load_pack

    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    if args.pack:
        pack = load_pack(args.pack)
    else:
        pack = build_synthetic(out / "synthetic-pack")
        os.environ["AI_LIVE_LITE_TECHNICAL_TEST"] = "true"
    os.environ["AI_LIVE_LITE_PACK_DIR"] = str(pack.root)
    key = secrets.token_hex(12)
    receiver = LocalRTMPReceiver(out / "received.flv", port=args.rtmp_port, stream_key=key)
    receiver.start()
    time.sleep(0.5)
    protector = None if os.name == "nt" else _ProcessKeyProtector()
    credentials = StreamCredentialStore(out / "credentials", **({"protector": protector} if protector else {}))
    credentials.put(OWNER, ACCOUNT, receiver.server_url, key)
    worker = LiteWorkerBoundary(out / "worker", credentials, seconds_per_product=args.seconds_per_product)
    process = psutil.Process()
    process.cpu_percent()
    psutil.cpu_percent()
    report: dict = {"mode": "LITE_AUTO", "boundary": "TECHNICAL_TEST_RTMP_LOOPBACK",
                    "commercial_live_claim": False, "pack": {"id": pack.pack_id, "source": pack.source,
                    "technical_test_only": pack.technical_test_only, "output": pack.output_size,
                    "frames": len(pack.frames)}, "encoder": worker.encoder_config.video_codec,
                    "host": {"cpus": psutil.cpu_count(), "memory_gib": round(psutil.virtual_memory().total / 2**30, 1),
                             "platform": sys.platform}}
    comments: dict[str, dict] = {}
    samples = []
    try:
        worker.sync_product_context(OWNER, ACCOUNT, PRODUCTS)
        started = time.monotonic()
        worker.prepare_room(OWNER, ACCOUNT, tuple(p["productId"] for p in PRODUCTS), pack.reference_path, None)
        report["prepare_seconds"] = round(time.monotonic() - started, 2)
        session_id = worker.start_session(OWNER, ACCOUNT, tuple(p["productId"] for p in PRODUCTS),
                                          pack.reference_path, None)
        record = worker._owned(OWNER, session_id)
        ai = record.ai
        emit = ai._emit_pcm

        def measured(pcm):
            # Instrumentation only: first audio after each viewer comment.
            active = ai._active
            if active is not None and active.source == "COMMENT" and active.key in comments:
                item = comments[active.key]
                if "first_audio_ms" not in item:
                    item["first_audio_ms"] = round((time.monotonic() - item["at"]) * 1000, 1)
                    item["answer"] = active.text
            return emit(pcm)
        ai._emit_pcm = measured
        live_started = time.monotonic()
        next_question = live_started + args.first_question_after
        index = 0
        while time.monotonic() - live_started < args.seconds:
            now = time.monotonic()
            if now >= next_question and index < len(QUESTIONS):
                comment_id = f"c{index}"
                comments[comment_id] = {"text": QUESTIONS[index], "at": time.monotonic()}
                comments[comment_id]["result"] = worker.submit_comment(OWNER, session_id, {
                    "commentId": comment_id, "viewerId": f"viewer-{index}", "text": QUESTIONS[index],
                    "createdAtMs": time.time() * 1000})
                index += 1
                next_question = now + args.question_every
            session = record.store.get_session(OWNER, session_id)
            stream = record.stream.metrics() if record.stream else {}
            samples.append({"t": round(now - live_started, 1), "proc_cpu": process.cpu_percent(),
                            "sys_cpu": psutil.cpu_percent(), "rss_mib": round(process.memory_info().rss / 2**20),
                            "frames": session.frames_generated, "status": stream.get("status"),
                            "transport": (stream.get("transport") or {}).get("status"),
                            "received_bytes": receiver.metrics()["received_bytes"]})
            if stream.get("status") == "FAILED":
                report["failure"] = stream.get("error")
                break
            time.sleep(1)
        status = worker.session_ai_status(OWNER, session_id)
        engine = getattr(record.store.get_session(OWNER, session_id).engine, "metrics", None)
        report["presenter"] = engine() if callable(engine) else None
        report["encoder_metrics"] = record.stream.metrics() if record.stream else None
        report["ai"] = {key: status.get(key) for key in ("replies", "audio_chunks", "safety", "lite")}
        worker.stop_session(OWNER, session_id)
    finally:
        worker.close()
        time.sleep(1)
        receiver.stop()
        credentials.delete(OWNER, ACCOUNT)
    seconds = samples[-1]["t"] if samples else 0
    frames = [s["frames"] for s in samples]
    fps = [b - a for a, b in zip(frames, frames[1:])]
    answered = [c for c in comments.values() if "first_audio_ms" in c]
    report.update({
        "seconds": seconds,
        "presenter_fps": {"mean": round(statistics.mean(fps), 1) if fps else None, "min": min(fps, default=None)},
        "cpu_percent_process": {"p50": _percentile([s["proc_cpu"] for s in samples[2:]], .5),
                                "p95": _percentile([s["proc_cpu"] for s in samples[2:]], .95)},
        "cpu_percent_system": {"p50": _percentile([s["sys_cpu"] for s in samples[2:]], .5)},
        "rss_mib_max": max((s["rss_mib"] for s in samples), default=None),
        "comments": [{k: v for k, v in c.items() if k != "at"} for c in comments.values()],
        "comment_to_voice_ms": {"p50": _percentile([c["first_audio_ms"] for c in answered], .5),
                                "p95": _percentile([c["first_audio_ms"] for c in answered], .95),
                                "answered": len(answered), "asked": len(comments)},
        "receiver": _probe(out / "received.flv"),
        "received_bytes": samples[-1]["received_bytes"] if samples else 0,
        "samples": samples,
    })
    (out / "lite-proof.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--pack", type=Path, help="prepared presenter pack; default builds a synthetic test pack")
    parser.add_argument("--seconds", type=float, default=120)
    parser.add_argument("--rtmp-port", type=int, default=19350)
    parser.add_argument("--first-question-after", type=float, default=8)
    parser.add_argument("--question-every", type=float, default=9)
    parser.add_argument("--seconds-per-product", type=float, default=60)
    report = run(parser.parse_args())
    print(json.dumps({key: report.get(key) for key in ("seconds", "presenter_fps", "comment_to_voice_ms",
                      "cpu_percent_process", "rss_mib_max", "received_bytes", "failure")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
