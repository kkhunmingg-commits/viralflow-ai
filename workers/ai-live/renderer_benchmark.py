"""Explicit future NVIDIA benchmark harness; never fabricates missing metrics.

Runs genuine incremental frames through AVSessionStream's existing encoder and
StreamProvider. Retained local FLV is a streaming sink, not a prerecorded input.
Receiver/lip-sync/gesture evaluation remains UNMEASURED until supplied by the
real receiver/detectors/human review. This harness alone never approves capacity.
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
import subprocess
import threading
import time
import wave
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable

from avatar_renderer import AvatarRenderer, GPUCandidateRenderer

METRICS = ("fps", "p50_latency_ms", "p95_latency_ms", "vram_used_mb", "gpu_utilization_percent",
           "ram_mb", "encoder_latency_ms", "av_drift_ms", "lip_sync", "occlusion_failures",
           "gesture_failures", "dropped_frames", "reconnects", "stability")


def _nvidia_sample() -> dict[str, float | None]:
    result: dict[str, float | None] = {"vram_used_mb": None, "gpu_utilization_percent": None}
    try:
        measured = subprocess.run(["nvidia-smi", "--query-gpu=memory.used,utilization.gpu", "--format=csv,noheader,nounits"],
                                  capture_output=True, text=True, check=False, timeout=3, shell=False,
                                  creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        values = measured.stdout.strip().splitlines()[0].split(",") if measured.returncode == 0 else []
        if len(values) == 2:
            numbers = tuple(float(value.strip()) for value in values)
            if all(math.isfinite(value) and value >= 0 for value in numbers):
                result.update(vram_used_mb=numbers[0], gpu_utilization_percent=numbers[1])
    except (OSError, subprocess.TimeoutExpired, IndexError, ValueError):
        pass
    return result


def _process_ram_mb() -> float | None:
    try:
        import psutil
        return psutil.Process().memory_info().rss / (1024 * 1024)
    except (ImportError, OSError):
        return None


class BenchmarkRecorder:
    def __init__(self) -> None:
        self.latencies: deque[float] = deque(maxlen=10_000)
        self.frames = 0
        self.rejected_frames = 0
        self.rejected_audio = 0
        self._start = time.monotonic()
        self._start_ram = _process_ram_mb()

    def frame(self, latency_ms: float, accepted: bool) -> None:
        if not math.isfinite(latency_ms) or latency_ms < 0:
            raise ValueError("INVALID_BENCHMARK_MEASUREMENT")
        self.frames += 1
        self.rejected_frames += int(not accepted)
        self.latencies.append(latency_ms)

    def finish(self, pipeline: dict[str, object], *, elapsed: float | None = None) -> dict[str, object]:
        seconds = time.monotonic() - self._start if elapsed is None else elapsed
        if not math.isfinite(seconds) or seconds <= 0:
            raise ValueError("INVALID_BENCHMARK_DURATION")
        latencies = sorted(self.latencies)
        resources = _nvidia_sample()
        ram = _process_ram_mb()
        return {"fps": self.frames / seconds, "generated_frames": self.frames,
                "p50_latency_ms": statistics.median(latencies) if latencies else None,
                "p95_latency_ms": latencies[math.ceil(len(latencies) * .95) - 1] if latencies else None,
                "latency_window": "last_10000_generated_frames", **resources, "ram_mb": ram,
                "memory_growth_mb": max(0, ram - self._start_ram) if ram is not None and self._start_ram is not None else None,
                "encoder_latency_ms": pipeline.get("encoder_processing_latency_ms"),
                "encoder_latency_note": "UNMEASURED unless encoder supplies a measured processing latency",
                "av_drift_ms": pipeline.get("max_av_drift_ms"), "lip_sync": None, "occlusion_failures": None,
                "gesture_failures": None, "dropped_frames": self.rejected_frames,
                "rejected_audio_chunks": self.rejected_audio,
                "reconnects": pipeline.get("transport", {}).get("reconnects") if isinstance(pipeline.get("transport"), dict) else None,
                "stability": "OBSERVED" if seconds >= 600 and pipeline.get("status") != "FAILED" else "INCOMPLETE",
                "duration_seconds": seconds}


def run_benchmark(candidate: str, rooms: int, *, reference: Path, audio: Path, output: Path,
                  seconds: int = 600, renderer_factory: Callable[[], AvatarRenderer] | None = None) -> dict[str, object]:
    if rooms not in (1, 2, 3) or not 600 <= seconds <= 3600:
        raise ValueError("INVALID_BENCHMARK_PLAN")
    factory = renderer_factory or (lambda: GPUCandidateRenderer(candidate, benchmark_only=True))
    probe = factory()
    try:
        readiness = probe.health()
    finally:
        probe.stop()
    if readiness.get("ready") is not True:
        return {"candidate": candidate, "rooms": rooms, "status": "NOT_RUN",
                "reason": readiness.get("status"), "metrics": {name: None for name in METRICS},
                "capacity": "UNVERIFIED_CAPACITY"}
    if not reference.is_file() or not audio.is_file():
        raise ValueError("BENCHMARK_REAL_INPUTS_REQUIRED")
    with wave.open(str(audio), "rb") as wav:
        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, 16_000):
            raise ValueError("BENCHMARK_PCM16_MONO_16000_REQUIRED")
        pcm = wav.readframes(16_000 * 60)
    if not pcm or not any(pcm):
        raise ValueError("BENCHMARK_REAL_SPEECH_REQUIRED")
    output.mkdir(parents=True, exist_ok=True)
    barrier = threading.Barrier(rooms, timeout=120)
    abort = threading.Event()

    def run_room(room: int) -> dict[str, object]:
        from av_pipeline import AVSessionStream
        renderer = factory()
        pipeline = AVSessionStream(output / f"{candidate}-{rooms}-room-{room}.mp4")
        recorder = BenchmarkRecorder()
        elapsed = 0.0
        report: dict[str, object] = {"room": room, "status": "FAILED"}
        try:
            renderer.load_presenter(reference, 25)
            pipeline.start()
            barrier.wait()
            start = time.monotonic()
            offset = 0
            while not abort.is_set() and time.monotonic() - start < seconds:
                chunk = pcm[offset:offset + 6400]
                offset = offset + len(chunk) if offset + len(chunk) < len(pcm) else 0
                if not chunk:
                    raise RuntimeError("BENCHMARK_AUDIO_EMPTY")
                accepted_audio = pipeline.push_audio(chunk)
                if not accepted_audio:
                    recorder.rejected_audio += 1
                    time.sleep(.02)
                    continue
                began = time.monotonic()
                pipeline.presenter_activity(True)
                try:
                    for frame in renderer.render_audio(chunk):
                        if not frame.real_inference:
                            raise RuntimeError("BENCHMARK_FAKE_FRAME_FORBIDDEN")
                        recorder.frame((time.monotonic() - began) * 1000, pipeline.push_frame(frame.jpeg))
                finally:
                    pipeline.presenter_activity(False)
                if pipeline.metrics().get("status") == "FAILED":
                    raise RuntimeError("BENCHMARK_PIPELINE_FAILED")
                elapsed = time.monotonic() - start
                pacing = len(chunk) / 32000 - (time.monotonic() - began)
                if pacing > 0:
                    time.sleep(pacing)
            report.update(status="MEASURED", metrics=recorder.finish(pipeline.metrics(), elapsed=max(elapsed, .001)))
            return report
        except Exception:
            abort.set()
            barrier.abort()
            report.update(status="FAILED", reason="REAL_BENCHMARK_FAILED",
                          metrics=recorder.finish(pipeline.metrics(), elapsed=max(elapsed, .001)))
            return report
        finally:
            for close in (renderer.stop, pipeline.close):
                try:
                    close()
                except Exception:
                    report.update(status="FAILED", reason="BENCHMARK_RELEASE_FAILED_OR_PENDING")
                    abort.set()

    with ThreadPoolExecutor(max_workers=rooms, thread_name_prefix="renderer-room-benchmark") as executor:
        results = list(executor.map(run_room, range(1, rooms + 1)))
    return {"candidate": candidate, "rooms": rooms,
            "status": "MEASURED" if all(room["status"] == "MEASURED" for room in results) else "FAILED",
            "room_results": results, "capacity": "UNVERIFIED_CAPACITY",
            "remaining_evaluation": ["Receiver A/V", "Reconnect injection", "Stop/release", "Lip-sync", "Occlusion", "Gesture quality"]}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", choices=("musetalk_gpu", "musetalk_portrait", "ditto", "musetalk_hybrid"), required=True)
    parser.add_argument("--rooms", type=int, choices=(1, 2, 3), required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seconds", type=int, default=600)
    args = parser.parse_args()
    result = run_benchmark(args.candidate, args.rooms, reference=args.reference, audio=args.audio,
                           output=args.output, seconds=args.seconds)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
