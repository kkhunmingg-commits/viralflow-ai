"""Commercial-license-gated Thai TTS measurements; no generated quality scores.

Only actual PCM produced by the verified official local adapter is a benchmark.
Subjective pronunciation, naturalness and voice consistency remain pending until
an identified owner reviews the saved audio. GPU numbers are null on CPU.
"""
from __future__ import annotations

import hashlib
import json
import threading
import time
import wave
from pathlib import Path
from typing import TYPE_CHECKING

from local_tts import ManagedLocalTTSProvider, VoxCPMBackend
from thai_speech import normalize_thai_speech

if TYPE_CHECKING:
    from local_agent.model_manager import VerifiedLocalModel

THAI_BENCHMARK_CASES = (
    ("greeting", "สวัสดีค่ะ ยินดีต้อนรับนะคะ"),
    ("price", "สินค้านี้ราคา 1,290 บาทค่ะ"),
    ("units", "ปริมาณ 250 ml น้ำหนัก 0.5 kg ลด 15% ค่ะ"),
    ("mixed", "เซรั่ม Vitamin C ใช้ตอนเช้าค่ะ"),
    ("sku", "รหัสสินค้า SKU AB-001 มี USB Type C ค่ะ"),
    ("question", "ต้องการสีไหนคะ สีฟ้าหรือสีขาวคะ"),
    ("long", "สวัสดีค่ะ วันนี้เรามีสินค้าให้เลือกหลายแบบนะคะ. สอบถามรายละเอียดสินค้าได้ค่ะ. "
             "ข้อมูลราคาและจำนวนคงเหลือจะยึดจากข้อมูลร้านค่ะ."),
)


class _MemorySampler:
    def __init__(self, device: str):
        self.device = device
        self.peak_ram_bytes: int | None = None
        self.peak_vram_bytes: int | None = None
        self.stop = threading.Event()
        self.thread: threading.Thread | None = None

    def __enter__(self):
        try:
            import psutil
            process = psutil.Process()
        except ImportError:
            return self
        def sample():
            while not self.stop.is_set():
                try:
                    ram = process.memory_info().rss
                    self.peak_ram_bytes = max(self.peak_ram_bytes or 0, ram)
                    if self.device.startswith("cuda"):
                        import torch
                        if torch.cuda.is_available():
                            self.peak_vram_bytes = max(self.peak_vram_bytes or 0, torch.cuda.max_memory_allocated())
                except (OSError, RuntimeError, psutil.Error):
                    return
                self.stop.wait(0.02)
        sample_thread = threading.Thread(target=sample, daemon=True)
        sample_thread.start()
        self.thread = sample_thread
        return self

    def __exit__(self, *_):
        self.stop.set()
        if self.thread:
            self.thread.join(timeout=1)


def _measure_sentence(provider, text: str, utterance_id: str, path: Path) -> dict:
    start = time.perf_counter()
    first_audio = None
    chunk_count = frames = 0
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        for chunk in provider.stream_text(text, utterance_id):
            if first_audio is None:
                first_audio = time.perf_counter() - start
            chunk_count += 1
            frames += len(chunk.pcm16) // 2
            audio.writeframes(chunk.pcm16)
    elapsed = time.perf_counter() - start
    if not frames or first_audio is None:
        raise RuntimeError("TTS_BENCHMARK_NO_AUDIO")
    duration = frames / 16000
    return {"text": text, "spoken_text": normalize_thai_speech(text), "audio_file": path.name,
            "audio_sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "first_audio_seconds": first_audio,
            "generation_seconds": elapsed, "audio_seconds": duration, "real_time_factor": elapsed / duration,
            "chunks": chunk_count, "multiple_pcm_chunks": chunk_count > 1,
            "pronunciation_owner_rating": None, "naturalness_owner_rating": None,
            "voice_consistency_owner_rating": None}


def _measure_interrupt(provider) -> dict:
    stream = provider.stream_text("กำลังทดสอบการหยุดเสียง. ประโยคนี้ต้องไม่พูดต่อหลังหยุด.", "benchmark-interrupt")
    try:
        next(stream)
        start = time.perf_counter()
        provider.interrupt()
        remaining = list(stream)
        return {"output_stop_seconds": time.perf_counter() - start, "chunks_after_interrupt": len(remaining),
                "compute_stop_scope": "between_native_chunks", "passed": not remaining}
    finally:
        stream.close()


def run_voxcpm_benchmark(model: VerifiedLocalModel, output_directory: Path, *, device: str = "cpu",
                         rounds: int = 3, timeout_seconds: float = 120.0) -> dict:
    """Explicit developer proof only. Never called from LIVE startup.

    Duration/RTF/first audio and memory are measured, not inferred from upstream
    claims. A full commercial LIVE soak must be a separately run long session.
    Output clips use a generated default voice, no private reference recordings.
    """
    from local_agent.model_manager import validate_model_record
    from dataclasses import asdict
    validate_model_record(asdict(model.record))
    model.verify_files()
    if type(rounds) is not int or not 1 <= rounds <= 500:
        raise ValueError("INVALID_TTS_BENCHMARK_ROUNDS")
    output_directory.mkdir(parents=True, exist_ok=True)
    report = {"model_id": model.record.model_id, "version": model.record.version, "device": device,
              "code_license": model.record.code_license, "weights_license": model.record.weights_license,
              "commercial_allowed": True, "redistribution_allowed": True, "measured_at_unix": int(time.time()),
              "human_review_status": "OWNER_REVIEW_PENDING", "live_production_approved": False,
              "rounds_requested": rounds, "samples": [], "failed_samples": []}
    provider = None
    started = time.perf_counter()
    with _MemorySampler(device) as memory:
        try:
            provider = ManagedLocalTTSProvider(VoxCPMBackend(model, device=device), context_id="benchmark",
                                               cache_bytes=0, timeout_seconds=timeout_seconds)
            load_done = time.perf_counter()
            report["load_seconds"] = load_done - started
            if not provider.warmup()["ready"]:
                raise RuntimeError("TTS_BENCHMARK_WARMUP_FAILED")
            report["warmup_seconds"] = time.perf_counter() - load_done
            inference_started = time.perf_counter()
            for repeat in range(rounds):
                for name, text in THAI_BENCHMARK_CASES:
                    sample_id = f"{repeat + 1:03d}-{name}"
                    try:
                        sample = _measure_sentence(provider, text, sample_id, output_directory / (sample_id + ".wav"))
                        sample["sample_id"] = sample_id
                        report["samples"].append(sample)
                    except (ValueError, RuntimeError) as exc:
                        report["failed_samples"].append({"sample_id": sample_id, "error": str(exc)[:200]})
            report["interruption"] = _measure_interrupt(provider)
            report["inference_session_seconds"] = time.perf_counter() - inference_started
            before_cancel = time.perf_counter()
            provider.cancel()
            report["cancel_seconds"] = time.perf_counter() - before_cancel
            report["cancelled_ready"] = provider.health()["ready"]
            report["status"] = "MEASURED_OWNER_REVIEW_PENDING" if not report["failed_samples"] else "BENCHMARK_FAILED"
        except (ImportError, ValueError, RuntimeError) as exc:
            report["status"] = "LOCAL_TTS_MODEL_PENDING"
            report["blocker"] = str(exc)[:200]
        finally:
            if provider:
                provider.cancel()
    report.update({"peak_process_ram_bytes": memory.peak_ram_bytes, "peak_allocated_vram_bytes": memory.peak_vram_bytes,
                   "session_seconds": time.perf_counter() - started,
                   "stability_scope": "only_observed_rounds_no_long_session_claim"})
    (output_directory / "benchmark.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def attach_owner_review(report: dict, ratings: list[dict], *, reviewer_identity: str, reviewed_at: int) -> dict:
    """Record explicit human ratings (1-5) and bind each to the actual clip hash.

    This does not approve the model automatically; license, hardware and LIVE
    stability remain independent release gates.
    """
    if (not isinstance(reviewer_identity, str) or not reviewer_identity.strip() or len(reviewer_identity) > 200
            or type(reviewed_at) is not int or not 0 < reviewed_at <= time.time()
            or not report.get("samples")):
        raise ValueError("TTS_OWNER_REVIEW_REQUIRED")
    samples = {sample["sample_id"]: sample for sample in report["samples"]}
    if len(ratings) != len(samples) or len({item.get("sample_id") for item in ratings}) != len(samples):
        raise ValueError("TTS_OWNER_REVIEW_INCOMPLETE")
    for rating in ratings:
        sample = samples.get(rating.get("sample_id"))
        if sample is None or rating.get("audio_sha256") != sample["audio_sha256"]:
            raise ValueError("TTS_OWNER_REVIEW_AUDIO_MISMATCH")
        for key in ("pronunciation", "naturalness", "voice_consistency"):
            if type(rating.get(key)) is not int or not 1 <= rating[key] <= 5:
                raise ValueError("TTS_OWNER_REVIEW_RATING_INVALID")
    result = json.loads(json.dumps(report))
    by_id = {rating["sample_id"]: rating for rating in ratings}
    for sample in result["samples"]:
        rating = by_id[sample["sample_id"]]
        for key in ("pronunciation", "naturalness", "voice_consistency"):
            sample[key + "_owner_rating"] = rating[key]
    result["human_review_status"] = "OWNER_RATED"
    result["owner_review"] = {"reviewer_identity": reviewer_identity.strip(), "reviewed_at": reviewed_at}
    return result
