"""Explicit DEV CPU proof against verified official Qwen3-4B GGUF weights.

No downloads, paid API, GPU result, synthesis, or realtime readiness claim.
Run after the managed installer has obtained the official artifacts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import statistics
import threading
import time
from dataclasses import asdict
from pathlib import Path

from local_brain import BrainRequest, BrainScope, InMemoryProductStore, LocalBrainProvider, ProductSnapshot
from local_llama_runtime import BrainRuntimeError, LlamaRuntimeConfig, ManagedLlamaRuntime

MODEL_HASH = "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5"


def percentile(values: list[float], percent: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * percent / 100
    lower, upper = int(position), min(int(position) + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def run(root: Path, executable_hash: str, *, threads: int = 8) -> dict[str, object]:
    import psutil  # Optional DEV measurement dependency; production brain uses stdlib.
    model, executable = root / "Qwen3-4B-Q4_K_M.gguf", root / "runtime" / "llama-server.exe"
    config = LlamaRuntimeConfig(root, executable, model, executable_hash, MODEL_HASH, threads=threads)
    runtime = ManagedLlamaRuntime(config)
    scope = BrainScope("fixture-owner", "fixture-account", "fixture-room")
    store = InMemoryProductStore()
    store.put(ProductSnapshot(scope, "fixture-product", "เสื้อยืด VF", "fixture-v1", {
        "price": 1290, "stock": 7, "sizes": ["S", "M", "L"], "colors": ["ดำ", "ขาว"],
        "shipping": "จัดส่งภายใน 2 วันค่ะ", "attributes": {"วัสดุ": "ผ้าฝ้ายค่ะ"},
        "purchase": "เลือกสินค้าในตะกร้าของร้านได้เลยค่ะ"}))
    brain = LocalBrainProvider(runtime, store)
    metrics: dict[str, object] = {"status": "RUNNING", "production_realtime_validated": False,
        "profile": "CPU_DEV", "model": "Qwen3-4B-Q4_K_M", "model_bytes": model.stat().st_size,
        "model_sha256": MODEL_HASH, "runtime": "llama.cpp b11438 cbb7d52ec", "threads": threads,
        "hardware": {"processor": platform.processor(), "physical_cores": psutil.cpu_count(logical=False),
                     "logical_cores": psutil.cpu_count(), "ram_total_bytes": psutil.virtual_memory().total,
                     "ram_available_before_bytes": psutil.virtual_memory().available},
        "real_llm_samples": [], "production_router_samples": [], "failures": []}
    stop = threading.Event()
    peak_rss = [0]

    def measure_ram():
        while not stop.wait(0.05):
            try:
                process = runtime._process
                if process is not None:
                    peak_rss[0] = max(peak_rss[0], psutil.Process(process.pid).memory_info().rss)
            except psutil.Error:
                pass

    meter = threading.Thread(target=measure_ram, daemon=True)
    meter.start()
    try:
        started = time.monotonic()
        runtime.start()
        metrics["startup_ms_including_hash_verification"] = (time.monotonic() - started) * 1000
        metrics["loaded_not_warmed"] = runtime.health()
        started = time.monotonic()
        brain.warmup(timeout_seconds=60)
        metrics["warmup_ms"] = (time.monotonic() - started) * 1000
        metrics["health_after_warmup"] = brain.health()
        examples = [
            ("thai_greeting", "สวัสดีค่ะ"),
            ("product_price", "เสื้อตัวนี้ราคาเท่าไหร่"),
            ("stock", "มีของเหลือกี่ชิ้น"),
            ("unknown_product_fact", "สินค้ากันน้ำไหม"),
            ("mixed_thai_english", "มี size M สีอะไรบ้าง"),
            ("general_chat", "ขอบคุณที่คุยเป็นเพื่อนนะ"),
        ]
        # Explicit direct-model measurements demonstrate actual model Thai output;
        # production factual replies below still use deterministic source templates.
        system = ('ตอบภาษาไทยสั้นหนึ่งประโยค ไม่ใช้เหตุผลหรือคิดให้เห็น '
                  'ตอบข้อมูลสินค้าจาก JSON เท่านั้น ถ้าไม่มีให้บอกว่ายังไม่พบข้อมูล /no_think\n'
                  '{"price_baht":1290,"stock":7,"sizes":["S","M","L"],"colors":["ดำ","ขาว"]}')
        for label, comment in examples:
            try:
                generated = runtime.generate([{"role": "system", "content": system},
                    {"role": "user", "content": comment + " /no_think"}], timeout_seconds=60, max_tokens=64)
                row = {"case": label, "comment": comment, **asdict(generated)}
                metrics["real_llm_samples"].append(row)
                print(json.dumps(row, ensure_ascii=False), flush=True)
            except BrainRuntimeError as exc:
                metrics["failures"].append({"case": label, "code": exc.code})
            reply = brain.generate(BrainRequest(scope, comment, "fixture-product"), timeout_seconds=60)
            metrics["production_router_samples"].append({"case": label, "comment": comment, **asdict(reply)})
        cancelled = threading.Event()
        timer = threading.Timer(0.1, cancelled.set)
        timer.start()
        started = time.monotonic()
        try:
            runtime.generate([{"role": "user", "content": "กล่าวต้อนรับร้านเป็นภาษาไทย /no_think"}],
                             timeout_seconds=60, cancel_event=cancelled, max_tokens=96)
            metrics["failures"].append({"case": "interruption", "code": "DID_NOT_CANCEL"})
        except BrainRuntimeError as exc:
            metrics["interruption"] = {"code": exc.code, "latency_ms": (time.monotonic() - started) * 1000}
        finally:
            timer.cancel()
        started = time.monotonic()
        try:
            runtime.generate([{"role": "user", "content": "ทักทายและขอบคุณลูกค้าทุกคน /no_think"}],
                             timeout_seconds=0.05, max_tokens=96)
            metrics["failures"].append({"case": "timeout", "code": "DID_NOT_TIMEOUT"})
        except BrainRuntimeError as exc:
            metrics["timeout"] = {"code": exc.code, "latency_ms": (time.monotonic() - started) * 1000}
        latencies = [row["latency_ms"] for row in metrics["real_llm_samples"]]
        first = [row["first_token_ms"] for row in metrics["real_llm_samples"] if row["first_token_ms"] is not None]
        speeds = [row["tokens_per_second"] for row in metrics["real_llm_samples"] if row["tokens_per_second"] is not None]
        metrics["summary"] = {"samples": len(latencies), "latency_p50_ms": percentile(latencies, 50),
            "latency_p95_ms": percentile(latencies, 95), "first_token_p50_ms": percentile(first, 50),
            "first_token_p95_ms": percentile(first, 95),
            "tokens_per_second_median": statistics.median(speeds) if speeds else None}
        metrics["status"] = "PASS" if not metrics["failures"] else "PARTIAL"
        return metrics
    finally:
        stop.set()
        meter.join(1)
        metrics["runtime_peak_rss_bytes"] = peak_rss[0]
        brain.close()
        metrics["health_after_close"] = runtime.health()
        root.mkdir(parents=True, exist_ok=True)
        (root / "cpu-proof.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-root", type=Path, required=True)
    parser.add_argument("--executable-sha256", required=True)
    parser.add_argument("--threads", type=int, default=8)
    args = parser.parse_args()
    result = run(args.artifact_root.resolve(), args.executable_sha256, threads=args.threads)
    print(json.dumps(result.get("summary", {"status": result["status"]}), ensure_ascii=False))
