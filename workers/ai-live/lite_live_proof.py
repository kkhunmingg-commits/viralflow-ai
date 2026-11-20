"""LIVE Lite Auto technical proof: no human host, RTMP test server only.

Runs the real Lite worker (LiteWorkerBoundary -> LocalAISession -> encoder ->
RTMP) for a fixed time against a loopback LocalRTMPReceiver, while a test
viewer bot keeps posting new questions (including ones about other SKUs).
Reports presenter fps, comment-to-voice latency, A/V sync measured from the
received video, CPU/RAM of the whole process tree (worker, encoder, receiver),
GPU engine load on Windows, speech usage and cost, and saves playable clips.

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
    {"productId": "lamp-led", "name": "โคมไฟตั้งโต๊ะ LED พับได้", "version": "proof-1", "facts": {
        "price": 459, "currency": "THB", "stock": 30, "colors": ["ขาว", "ดำ"],
        "attributes": {"แบตเตอรี่": "ชาร์จเต็มใช้ได้ประมาณหกชั่วโมงค่ะ", "ปรับแสง": "ปรับความสว่างได้สามระดับค่ะ"},
        "faq": {"ชาร์จด้วยอะไร": "ชาร์จผ่านสาย USB-C ค่ะ"}}},
]
# New wordings the product data does not contain verbatim, other-SKU questions, and ones with no data.
QUESTIONS = ["ราคาเท่าไหร่คะ", "ใส่น้ำร้อนได้มั้ยคะ", "เข้าเครื่องล้างจานได้ป่าว", "มีประกันไหมคะ",
             "มีสีอะไรบ้าง", "ส่งกี่วันถึง", "กันกระแทกไหม", "สวัสดีค่ะ", "วัสดุอะไรคะ", "ผ้าเป็นขุยมั้ย",
             "โคมไฟราคาเท่าไหร่", "โคมไฟชาร์จด้วยอะไรคะ", "แบตอยู่ได้นานไหม", "ผ้าขนหนูมีสีอะไรบ้าง",
             "ซื้อสองใบได้ส่วนลดไหม", "เก็บเย็นได้กี่ชั่วโมง", "ของแท้ไหมคะ", "สั่งยังไงคะ"]


class _ProcessKeyProtector:
    """Proof-only secret wrapping for non-Windows hosts (key never leaves memory)."""
    def __init__(self):
        self._key = secrets.token_bytes(32)

    def protect(self, data: bytes) -> bytes:
        return bytes(b ^ self._key[i % 32] for i, b in enumerate(data))

    unprotect = protect


class TreeMeter:
    """CPU/RSS of this process plus every child (encoder, receiver, ...)."""
    def __init__(self, extra_pids=()):
        import psutil
        self.psutil = psutil
        self.root = psutil.Process()
        self.extra = set(extra_pids)
        self.known: dict[int, object] = {}

    def sample(self) -> dict[str, float]:
        psutil = self.psutil
        processes = [self.root] + self.root.children(recursive=True)
        for pid in list(self.extra):
            try:
                processes.append(psutil.Process(pid))
            except psutil.Error:
                self.extra.discard(pid)
        cpu = rss = 0.0
        for process in processes:
            tracked = self.known.setdefault(process.pid, process)
            try:
                cpu += tracked.cpu_percent()
                rss += tracked.memory_info().rss
            except psutil.Error:
                self.known.pop(process.pid, None)
        cores = psutil.cpu_count() or 1
        return {"tree_cpu_percent_of_machine": round(cpu / cores, 1), "tree_rss_mib": round(rss / 2**20),
                "processes": len(processes)}


class GpuMeter(threading.Thread):
    """Windows GPU engine utilisation via performance counters (no admin rights needed)."""
    SCRIPT = ("$s=(Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction SilentlyContinue).CounterSamples;"
              "$r=@{};foreach($x in $s){$t=($x.InstanceName -split 'engtype_')[-1];$r[$t]=[double]$r[$t]+$x.CookedValue};"
              "$m=(Get-Counter '\\GPU Adapter Memory(*)\\Shared Usage' -ErrorAction SilentlyContinue).CounterSamples|Measure-Object CookedValue -Sum;"
              "$r['shared_memory_mib']=[math]::Round($m.Sum/1MB);$r|ConvertTo-Json -Compress")

    def __init__(self, every: float = 10):
        super().__init__(name="gpu-meter", daemon=True)
        self.every, self.samples, self._stop = every, [], threading.Event()

    def run(self):
        if os.name != "nt":
            return
        while not self._stop.wait(self.every):
            try:
                result = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", self.SCRIPT],
                                        capture_output=True, text=True, timeout=30,
                                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                self.samples.append({key: round(float(value), 1) for key, value in json.loads(result.stdout).items()})
            except Exception:
                continue

    def stop(self):
        self._stop.set()

    def summary(self) -> dict:
        if not self.samples:
            return {"available": os.name == "nt", "samples": 0}
        keys = {key for sample in self.samples for key in sample}
        return {"available": True, "samples": len(self.samples),
                **{key: {"p50": _percentile([s.get(key, 0) for s in self.samples], .5),
                         "p95": _percentile([s.get(key, 0) for s in self.samples], .95)} for key in sorted(keys)}}


def _percentile(values, q):
    values = sorted(values)
    return round(values[int((len(values) - 1) * q)], 1) if values else None


def _ffprobe() -> Path:
    return Path(resolve_ffmpeg_path()).with_name("ffprobe" + (".exe" if os.name == "nt" else ""))


def _probe(path: Path) -> dict:
    if not _ffprobe().is_file() or not path.is_file():
        return {}
    result = subprocess.run([str(_ffprobe()), "-v", "error", "-count_packets", "-show_entries",
                             "stream=codec_type,codec_name,width,height,nb_read_packets,avg_frame_rate:format=duration",
                             "-of", "json", str(path)], capture_output=True, timeout=120)
    return json.loads(result.stdout or b"{}")


def save_clips(received: Path, out: Path, seconds: float, length: float = 120) -> list[str]:
    """Playable MP4 (H.264 + AAC) excerpts from the start, middle and end of the stream."""
    ffmpeg = resolve_ffmpeg_path()
    clips = []
    for label, start in (("start", 5), ("middle", max(5, seconds / 2 - length / 2)),
                         ("end", max(5, seconds - length - 5))):
        target = out / f"clip-{label}.mp4"
        subprocess.run([ffmpeg, "-v", "error", "-y", "-ss", str(round(start, 1)), "-i", str(received),
                        "-t", str(length), "-c", "copy", "-movflags", "+faststart", str(target)],
                       capture_output=True, timeout=600)
        if target.is_file() and target.stat().st_size > 0:
            clips.append(target.name)
    return clips


def av_sync(clip: Path, box: list[int], size: tuple[int, int]) -> dict:
    """Mouth-region motion vs. speech energy in the received clip; best lag = presenter delay."""
    import numpy as np
    ffmpeg = resolve_ffmpeg_path()
    width, height = size
    raw = subprocess.run([ffmpeg, "-v", "error", "-i", str(clip), "-f", "rawvideo", "-pix_fmt", "gray", "-"],
                         capture_output=True, timeout=600).stdout
    frames = np.frombuffer(raw, np.uint8)
    if not len(frames) or len(frames) % (width * height):
        return {"measured": False}
    frames = frames.reshape(-1, height, width)
    x1, y1, x2, y2 = box
    h, w = y2 - y1, x2 - x1
    roi = frames[:, y1 + int(h * .62):y1 + int(h * .94), x1 + int(w * .26):x1 + int(w * .74)].astype(np.float32)
    # Open mouth = more dark cavity pixels than the clip's typical (mostly closed) mouth.
    mouth = (roi < np.median(roi) * 0.55).mean(axis=(1, 2))
    pcm = np.frombuffer(subprocess.run([ffmpeg, "-v", "error", "-i", str(clip), "-f", "s16le", "-ac", "1",
                                        "-ar", "16000", "-"], capture_output=True, timeout=600).stdout,
                        "<i2").astype(np.float32)
    per = 16000 // 25
    n = min(len(mouth), len(pcm) // per)
    if n < 50:
        return {"measured": False}
    energy = np.sqrt((pcm[:n * per].reshape(n, per) ** 2).mean(axis=1))
    mouth = mouth[:n]
    def corr(lag):
        a, b = (mouth[lag:], energy[:n - lag]) if lag >= 0 else (mouth[:n + lag], energy[-lag:])
        return float(np.corrcoef(a, b)[0, 1])
    best = max(((corr(lag), lag) for lag in range(-10, 11)), key=lambda item: item[0])
    return {"measured": True, "frames": int(n), "correlation_at_0": round(corr(0), 3),
            "best_correlation": round(best[0], 3), "video_lag_ms": best[1] * 40}


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
    if args.voice:
        os.environ["AZURE_SPEECH_VOICE"] = args.voice
    key = secrets.token_hex(12)
    receiver = LocalRTMPReceiver(out / "received.flv", port=args.rtmp_port, stream_key=key)
    receiver.start()
    time.sleep(0.5)
    protector = None if os.name == "nt" else _ProcessKeyProtector()
    credentials = StreamCredentialStore(out / "credentials", **({"protector": protector} if protector else {}))
    credentials.put(OWNER, ACCOUNT, receiver.server_url, key)
    worker = LiteWorkerBoundary(out / "worker", credentials, seconds_per_product=args.seconds_per_product)
    tree = TreeMeter(extra_pids=[receiver.process.pid] if receiver.process else [])
    tree.sample()
    psutil.cpu_percent()
    gpu = GpuMeter()
    gpu.start()
    report: dict = {"mode": "LITE_AUTO", "boundary": "TECHNICAL_TEST_RTMP_LOOPBACK",
                    "commercial_live_claim": False, "pack": {"id": pack.pack_id, "source": pack.source,
                    "name": pack.display_name, "technical_test_only": pack.technical_test_only,
                    "output": pack.output_size, "frames": len(pack.frames), "provenance": pack.provenance},
                    "voice": os.getenv("AZURE_SPEECH_VOICE") if os.getenv("AI_LIVE_LITE_TTS") == "azure" else
                    os.getenv("AI_LIVE_LITE_TTS"), "encoder": worker.encoder_config.video_codec,
                    "host": {"cpus": psutil.cpu_count(), "memory_gib": round(psutil.virtual_memory().total / 2**30, 1),
                             "platform": sys.platform}}
    comments: dict[str, dict] = {}
    samples = []
    try:
        worker.sync_product_context(OWNER, ACCOUNT, PRODUCTS)
        started = time.monotonic()
        ids = tuple(p["productId"] for p in PRODUCTS)
        worker.prepare_room(OWNER, ACCOUNT, ids, pack.reference_path, None)
        report["prepare_seconds"] = round(time.monotonic() - started, 2)
        session_id = worker.start_session(OWNER, ACCOUNT, ids, pack.reference_path, None)
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
                    item["product_on_screen"] = ai.current_product_id
            return emit(pcm)
        ai._emit_pcm = measured
        live_started = time.monotonic()
        next_question = live_started + args.first_question_after
        index = 0
        while time.monotonic() - live_started < args.seconds:
            now = time.monotonic()
            if now >= next_question:
                text = QUESTIONS[index % len(QUESTIONS)]
                comment_id = f"c{index}"
                comments[comment_id] = {"text": text, "at": time.monotonic(),
                                        "t": round(now - live_started, 1)}
                comments[comment_id]["result"] = worker.submit_comment(OWNER, session_id, {
                    "commentId": comment_id, "viewerId": f"viewer-{index}", "text": text,
                    "createdAtMs": time.time() * 1000})["accepted"]
                index += 1
                next_question = now + args.question_every
            session = record.store.get_session(OWNER, session_id)
            stream = record.stream.metrics() if record.stream else {}
            samples.append({"t": round(now - live_started, 1), **tree.sample(),
                            "sys_cpu": psutil.cpu_percent(), "frames": session.frames_generated,
                            "status": stream.get("status"), "transport": (stream.get("transport") or {}).get("status"),
                            "av_drift_ms": stream.get("av_drift_ms"),
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
        gpu.stop()
        worker.close()
        time.sleep(1)
        receiver.stop()
        credentials.delete(OWNER, ACCOUNT)
    seconds = samples[-1]["t"] if samples else 0
    frames = [s["frames"] for s in samples]
    fps = [b - a for a, b in zip(frames, frames[1:])]
    answered = [c for c in comments.values() if "first_audio_ms" in c]
    steady = samples[3:]
    usage = (report.get("ai") or {}).get("lite", {}).get("usage") or {}
    hours = seconds / 3600 if seconds else 0
    clips = save_clips(out / "received.flv", out, seconds, args.clip_seconds)
    box = (report.get("presenter") or {}).get("face_box_output")
    sync = av_sync(out / clips[1], box, pack.output_size) if box and len(clips) > 1 else {"measured": False}
    report.update({
        "seconds": seconds,
        "presenter_fps": {"mean": round(statistics.mean(fps), 2) if fps else None, "min": min(fps, default=None),
                          "seconds_below_20fps": sum(value < 20 for value in fps)},
        "cpu_percent_of_machine_all_processes": {"p50": _percentile([s["tree_cpu_percent_of_machine"] for s in steady], .5),
                                                  "p95": _percentile([s["tree_cpu_percent_of_machine"] for s in steady], .95)},
        "system_cpu_percent": {"p50": _percentile([s["sys_cpu"] for s in steady], .5),
                               "p95": _percentile([s["sys_cpu"] for s in steady], .95)},
        "ram_mib_all_processes": {"p50": _percentile([s["tree_rss_mib"] for s in steady], .5),
                                  "max": max((s["tree_rss_mib"] for s in samples), default=None)},
        "gpu": gpu.summary(),
        "av_sync_from_received_video": sync,
        "encoder_av_drift_ms_max": max((abs(s["av_drift_ms"] or 0) for s in samples), default=None),
        "comments": [{k: v for k, v in c.items() if k != "at"} for c in comments.values()],
        "comment_to_voice_ms": {"p50": _percentile([c["first_audio_ms"] for c in answered], .5),
                                "p95": _percentile([c["first_audio_ms"] for c in answered], .95),
                                "max": max((c["first_audio_ms"] for c in answered), default=None),
                                "answered": len(answered), "asked": len(comments)},
        "speech_characters_per_hour": round(usage.get("characters", 0) / hours) if hours else None,
        "speech_requests_per_minute": round(usage.get("requests", 0) / (seconds / 60), 1) if seconds else None,
        "speech_bank": usage.get("speech_bank"),
        "receiver": _probe(out / "received.flv"),
        "received_bytes": samples[-1]["received_bytes"] if samples else 0,
        "clips": clips,
        "samples": samples,
    })
    (out / "lite-proof.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--pack", type=Path, help="prepared presenter pack; default builds a synthetic test pack")
    parser.add_argument("--voice", help="Azure Thai voice, e.g. th-TH-PremwadeeNeural")
    parser.add_argument("--seconds", type=float, default=120)
    parser.add_argument("--rtmp-port", type=int, default=19350)
    parser.add_argument("--first-question-after", type=float, default=8)
    parser.add_argument("--question-every", type=float, default=20)
    parser.add_argument("--seconds-per-product", type=float, default=180)
    parser.add_argument("--clip-seconds", type=float, default=120)
    report = run(parser.parse_args())
    print(json.dumps({key: report.get(key) for key in (
        "seconds", "presenter_fps", "comment_to_voice_ms", "av_sync_from_received_video",
        "cpu_percent_of_machine_all_processes", "ram_mib_all_processes", "gpu", "speech_characters_per_hour", "speech_bank",
        "received_bytes", "clips", "failure")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
