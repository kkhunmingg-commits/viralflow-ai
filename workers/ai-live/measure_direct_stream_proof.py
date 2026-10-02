"""Inspect retained real proof artifacts; emits no owner, token or stream key."""
from __future__ import annotations
import argparse
import array
import hashlib
import json
import math
import subprocess
from pathlib import Path
from av_encoder import resolve_ffmpeg_path


def measure(directory: Path, ffprobe: Path) -> dict:
    source = json.loads((directory / "pipeline.json").read_text(encoding="utf-8"))
    received = json.loads((directory / "receiver.json").read_text(encoding="utf-8"))
    before = source["beforeStop"]
    encoded = before["encoder"]
    samples = source["samples"]
    recordings = []
    ffmpeg = resolve_ffmpeg_path()
    for path in sorted(directory.glob("*.mp4")) + sorted(directory.glob("*.flv")):
        probe = subprocess.run([str(ffprobe), "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
                               capture_output=True, check=True, timeout=20)
        metadata = json.loads(probe.stdout)
        streams = metadata["streams"]
        assert any(s["codec_name"] == "h264" for s in streams)
        assert any(s["codec_name"] == "aac" for s in streams)
        # Decode actual received media, not just inspect stream headers.
        audio = subprocess.run([ffmpeg, "-v", "error", "-i", str(path), "-t", "10", "-map", "0:a:0",
            "-f", "s16le", "-ar", "16000", "-ac", "1", "pipe:1"], capture_output=True, check=True, timeout=20)
        pcm = array.array("h", audio.stdout)
        rms = math.sqrt(sum(sample * sample for sample in pcm) / len(pcm)) if pcm else 0
        assert len(pcm) > 16000 and rms > 1, "RECEIVER_AUDIO_MISSING"
        frame = subprocess.run([ffmpeg, "-v", "error", "-ss", "2", "-i", str(path), "-frames:v", "1",
            "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"], capture_output=True, check=True, timeout=20)
        assert frame.stdout.startswith(b"\xff\xd8") and frame.stdout.endswith(b"\xff\xd9")
        frame_path = directory / (path.stem + "-verified.jpg")
        frame_path.write_bytes(frame.stdout)
        # Audible evidence retained locally; it is never bundled into the app.
        wav_path = directory / (path.stem + "-verified.wav")
        import wave
        with wave.open(str(wav_path), "wb") as output:
            output.setnchannels(1); output.setsampwidth(2); output.setframerate(16000)
            output.writeframes(audio.stdout)
        recordings.append({"filename": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "bytes": path.stat().st_size, "duration_seconds": float(metadata["format"]["duration"]),
            "codecs": [s["codec_name"] for s in streams], "audio_decoded_samples": len(pcm),
            "audio_rms_pcm16": round(rms, 1), "jpeg_decoded_bytes": len(frame.stdout)})
    memory = [s["metrics"]["ram_mb"] for s in samples if s["elapsedMs"] >= 60000]
    raw_receivers = received["samples"]
    return {"mode": "DEV_PROOF_ONLY", "completed": source["completed"],
        "duration_seconds": source["measuredDurationMs"] / 1000,
        "comment_source": "SIMULATED_THAI_FIXTURE", "product_source": source["productSource"],
        "voice": "Windows offline Thai SAPI", "presenter": "MuseTalkCPUFloat32",
        "comments_accepted": source["commentsAccepted"], "duplicates_rejected": source["duplicatesRejected"],
        "speech_calls": source["speechCalls"], "audio_delivered_bytes": source["audioDeliveredBytes"],
        "presenter_real_frames": before["frames_generated"], "presenter_average_fps": before["average_fps"],
        "presenter_latency_p50_ms": before["p50_latency_ms"], "presenter_latency_p95_ms": before["p95_latency_ms"],
        "encoder_fps": round(encoded["encoder_fps"], 3), "encoder_frames": encoded["frames_encoded"],
        "held_real_frames": encoded["held_frames"], "inference_audio_drops": before["inference_audio_drops"],
        "encoded_audio_dropped_samples": encoded["audio_dropped_samples"],
        "transport_dropped_tags": encoded["transport"]["dropped_tags"],
        "transport_dropped_audio_tags": encoded["transport"]["dropped_audio"],
        "audio_buffer_max_ms": source["maxAudioBufferMs"], "av_mux_packet_drift_final_ms": encoded["av_drift_ms"],
        "av_mux_packet_drift_max_ms": encoded["max_av_drift_ms"], "av_input_clock_drift_ms": encoded["input_av_drift_ms"],
        "encoder_bitrate_kbps": round(encoded["bitrate_kbps"], 3),
        "transport_bitrate_kbps": round(encoded["transport"]["bitrate_bps"] / 1000, 3),
        "queues_max": {"comment": source["maxCommentQueue"], "action": source["maxActionQueue"],
            "presenter": source["maxPresenterQueue"],
            "encoder": max(s["metrics"]["encoder"]["queue_depth"] for s in samples),
            "transport": max(s["metrics"]["encoder"]["transport"]["queue_depth"] for s in samples)},
        "ram_after_warmup_min_mb": min(memory), "ram_after_warmup_max_mb": max(memory),
        "ram_first_warm_mb": memory[0], "ram_last_running_mb": memory[-1],
        "ram_after_stop_mb": source["afterStop"]["ram_mb"],
        "reconnect_count": encoded["transport"]["reconnect_count"],
        "received_while_producer_active": any(s["receiving"] and s["received_bytes"] > 0 for s in raw_receivers),
        "reconnect_injected": received["reconnect_injected"], "resources_released": source["resourcesReleased"],
        "worker_closed": received["worker_closed"], "receiver_closed": received["receiver_closed"],
        "recordings": recordings, "production_realtime_validated": False,
        "interpretation": "Packet timestamps are synchronized; slow held CPU frames do not prove realtime phoneme/lip synchronization."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--ffprobe", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = measure(args.directory, args.ffprobe)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result))
