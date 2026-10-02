"""Inspect retained real proof artifacts; emits no owner, token or stream key."""
from __future__ import annotations
import argparse
import array
import bisect
import hashlib
import json
import math
import os
import subprocess
from pathlib import Path
from av_encoder import resolve_ffmpeg_path


MAX_MEDIA_BYTES = 512 * 1024 * 1024
MAX_TOTAL_MEDIA_BYTES = 1024 * 1024 * 1024
MAX_PROGRESS_GAP_SECONDS = 12


def require(condition: bool, code: str) -> None:
    if not condition:
        # Native diagnostics can contain paths and configuration. Emit codes only.
        raise RuntimeError(code)


def number(value, code: str) -> float:
    require(not isinstance(value, bool), code)
    try:
        result = float(value)
    except (ValueError, TypeError):
        raise RuntimeError(code) from None
    require(math.isfinite(result), code)
    return result


def read_report(path: Path) -> dict:
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= 8 * 1024 * 1024,
            "PROOF_REPORT_INVALID")
    try:
        result = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        raise RuntimeError("PROOF_REPORT_INVALID") from None
    require(isinstance(result, dict), "PROOF_REPORT_INVALID")
    return result


def media_command(command: list[str], *, timeout: int = 60, max_output: int = 32 * 1024 * 1024) -> bytes:
    try:
        result = subprocess.run(command, capture_output=True, timeout=timeout,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError("PROOF_MEDIA_CHECK_FAILED") from None
    require(result.returncode == 0 and not result.stderr.strip() and len(result.stdout) <= max_output,
            "PROOF_MEDIA_CHECK_FAILED")
    return result.stdout


def packet_measurements(metadata: dict) -> dict:
    streams = metadata.get("streams", [])
    require(isinstance(streams, list) and len(streams) <= 8, "RECEIVER_TRACKS_INVALID")
    tracks = {s.get("index"): s.get("codec_type") for s in streams
              if (s.get("codec_type"), s.get("codec_name")) in (("video", "h264"), ("audio", "aac"))}
    require(list(tracks.values()).count("video") == 1 and list(tracks.values()).count("audio") == 1,
            "RECEIVER_AV_MISSING")
    packets = metadata.get("packets", [])
    require(isinstance(packets, list) and 2 <= len(packets) <= 300000, "RECEIVER_PACKETS_INVALID")
    measured: dict[str, dict] = {}
    latest = {}
    presentation_times = {"video": [], "audio": []}
    for packet in packets:
        kind = tracks.get(packet.get("stream_index"))
        if kind is None:
            continue
        pts = number(packet.get("pts_time"), "RECEIVER_TIMESTAMP_INVALID")
        dts = number(packet.get("dts_time"), "RECEIVER_TIMESTAMP_INVALID")
        duration = number(packet.get("duration_time", 0), "RECEIVER_TIMESTAMP_INVALID")
        require(0 <= duration <= 1, "RECEIVER_TIMESTAMP_INVALID")
        if kind in measured:
            previous = measured[kind]
            # Negative initial AAC timestamps are valid. Regressing timestamps are not.
            require(dts > previous["last_dts"] and pts > previous["last_pts"], "RECEIVER_TIMESTAMP_REGRESSION")
            previous["max_gap_seconds"] = max(previous["max_gap_seconds"], pts - previous["last_pts"])
        else:
            measured[kind] = {"first_pts": pts, "last_pts": pts, "last_dts": dts,
                              "end_pts": pts, "packets": 0, "max_gap_seconds": 0.0}
        track = measured[kind]
        track.update(last_pts=pts, last_dts=dts, end_pts=pts + duration, packets=track["packets"] + 1)
        latest[kind] = pts
        presentation_times[kind].append(pts)
    require(set(measured) == {"video", "audio"} and all(t["packets"] >= 2 for t in measured.values()),
            "RECEIVER_AV_MISSING")
    require(all(t["max_gap_seconds"] <= 1 for t in measured.values()), "RECEIVER_PACKET_GAP")
    # Fragmented MP4 can serialize a group of video packets before its audio
    # group. Compare presentation clocks, not unrelated file traversal order.
    max_drift = max(abs(measured["video"]["first_pts"] - measured["audio"]["first_pts"]),
                    abs(measured["video"]["end_pts"] - measured["audio"]["end_pts"]))
    start = max(t["first_pts"] for t in measured.values())
    end = min(t["end_pts"] for t in measured.values())
    for kind, times in presentation_times.items():
        other = presentation_times["audio" if kind == "video" else "video"]
        for pts in times:
            if start <= pts <= end:
                index = bisect.bisect_left(other, pts)
                nearest = other[max(0, index - 1):min(len(other), index + 1)]
                max_drift = max(max_drift, min(abs(pts - candidate) for candidate in nearest))
    require(max_drift <= .250, "RECEIVER_AV_DRIFT")
    require(end > start, "RECEIVER_AV_MISSING")
    return {"video_packets": measured["video"]["packets"], "audio_packets": measured["audio"]["packets"],
            "av_span_seconds": round(end - start, 6), "first_av_pts_seconds": round(start, 6),
            "last_av_pts_seconds": round(end, 6), "timestamps_monotonic": True,
            "av_drift_method": "NEAREST_PRESENTATION_TIMESTAMP_WITH_TRACK_BOUNDARIES",
            "max_packet_gap_seconds": round(max(t["max_gap_seconds"] for t in measured.values()), 6),
            "av_packet_drift_max_ms": round(max_drift * 1000, 3),
            "av_packet_drift_final_ms": round(abs(latest["video"] - latest["audio"]) * 1000, 3)}


def receiver_progress(samples: list, duration: float) -> dict:
    require(isinstance(samples, list) and 3 <= len(samples) <= 4000, "RECEIVER_SAMPLES_INVALID")
    previous_time = previous_bytes = 0.0
    progress_times = [0.0]
    resets = 0
    segment_max_bytes = [0, 0]
    for sample in samples:
        elapsed = number(sample.get("elapsed_seconds"), "RECEIVER_SAMPLES_INVALID")
        size = number(sample.get("received_bytes"), "RECEIVER_SAMPLES_INVALID")
        require(previous_time <= elapsed <= duration + 120 and 0 <= size <= MAX_MEDIA_BYTES and size.is_integer(),
                "RECEIVER_SAMPLES_INVALID")
        require(elapsed - previous_time <= MAX_PROGRESS_GAP_SECONDS, "RECEIVER_SAMPLE_GAP")
        if size < previous_bytes:
            resets += 1
            require(resets == 1, "RECEIVER_UNEXPECTED_RESET")
            previous_bytes = 0
        if sample.get("receiving") is True and size > previous_bytes:
            progress_times.append(elapsed)
        segment_max_bytes[resets] = max(segment_max_bytes[resets], int(size))
        previous_time, previous_bytes = elapsed, size
    require(resets == 1 and all(segment_max_bytes), "RECEIVER_RECONNECT_NOT_OBSERVED")
    require(previous_time >= duration - 2, "RECEIVER_WINDOW_INCOMPLETE")
    progress_times.append(max(duration, progress_times[-1]))
    max_gap = max(b - a for a, b in zip(progress_times, progress_times[1:]))
    require(max_gap <= MAX_PROGRESS_GAP_SECONDS, "RECEIVER_OUTPUT_STALLED")
    return {"sample_count": len(samples), "observed_duration_seconds": round(previous_time, 3),
            "max_progress_gap_seconds": round(max_gap, 3), "observed_reconnects": resets,
            "segment_max_received_bytes": segment_max_bytes}


def recording_measurements(path: Path, ffprobe: Path, ffmpeg: str) -> dict:
    probe = media_command([str(ffprobe), "-v", "error", "-show_streams", "-show_format", "-show_packets",
        "-show_entries", "stream=index,codec_name,codec_type:format=duration:packet=stream_index,pts_time,dts_time,duration_time",
        "-of", "json", str(path)])
    try:
        metadata = json.loads(probe)
    except ValueError:
        raise RuntimeError("RECEIVER_PROBE_INVALID") from None
    packets = packet_measurements(metadata)
    duration = number(metadata.get("format", {}).get("duration"), "RECEIVER_DURATION_INVALID")
    require(1 <= duration <= 3720, "RECEIVER_DURATION_INVALID")
    # Decode every packet. A decodable introduction cannot hide corrupt late media.
    media_command([ffmpeg, "-v", "error", "-xerror", "-err_detect", "explode", "-i", str(path),
                   "-map", "0:v:0", "-map", "0:a:0", "-f", "null", os.devnull], timeout=120)
    windows = []
    import wave
    for label, offset in (("first", min(.25, duration / 4)), ("middle", max(0, duration / 2 - 1)),
                          ("last", max(0, duration - 2))):
        window_seconds = 10 if label == "first" else 2
        audio = media_command([ffmpeg, "-v", "error", "-xerror", "-ss", str(offset), "-i", str(path),
            "-t", str(window_seconds), "-map", "0:a:0", "-f", "s16le", "-ar", "16000", "-ac", "1", "pipe:1"],
            max_output=320000)
        require(len(audio) % 2 == 0, "RECEIVER_AUDIO_MISSING")
        pcm = array.array("h", audio)
        require(len(pcm) >= 8000, "RECEIVER_AUDIO_MISSING")
        rms = math.sqrt(sum(sample * sample for sample in pcm) / len(pcm))
        frame = media_command([ffmpeg, "-v", "error", "-xerror", "-ss", str(offset), "-i", str(path),
            "-map", "0:v:0", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"],
            max_output=4 * 1024 * 1024)
        require(frame.startswith(b"\xff\xd8") and frame.endswith(b"\xff\xd9"), "RECEIVER_VIDEO_MISSING")
        windows.append({"position": label, "offset_seconds": round(offset, 3), "requested_audio_seconds": window_seconds,
                        "audio_decoded_samples": len(pcm),
                        "audio_rms_pcm16": round(rms, 1), "jpeg_decoded_bytes": len(frame)})
        if label == "first":
            path.with_name(path.stem + "-verified.jpg").write_bytes(frame)
            with wave.open(str(path.with_name(path.stem + "-verified.wav")), "wb") as output:
                output.setnchannels(1); output.setsampwidth(2); output.setframerate(16000)
                output.writeframes(audio)
    # Silence between utterances is legitimate, but an entirely silent recording is not voice evidence.
    require(any(w["audio_rms_pcm16"] > 1 for w in windows), "RECEIVER_VOICE_MISSING")
    with path.open("rb") as media:
        digest = hashlib.file_digest(media, "sha256").hexdigest() if hasattr(hashlib, "file_digest") else None
        if digest is None:  # Packaged Python 3.10.
            media.seek(0)
            digest_state = hashlib.sha256()
            for block in iter(lambda: media.read(1024 * 1024), b""):
                digest_state.update(block)
            digest = digest_state.hexdigest()
    return {"filename": path.name, "sha256": digest, "bytes": path.stat().st_size,
            "duration_seconds": duration, "codecs": [s["codec_name"] for s in metadata["streams"]],
            **{key: windows[0][key] for key in ("audio_decoded_samples", "audio_rms_pcm16", "jpeg_decoded_bytes")},
            "full_av_decode_verified": True, "decode_windows": windows, "receiver_packets": packets}


def live_player_measurements(value, *, required: bool) -> dict:
    require(value is None or isinstance(value, dict), "PLAYER_EVIDENCE_INVALID")
    data = value or {}
    fragments = number(data.get("fragments_received", 0), "PLAYER_EVIDENCE_INVALID")
    cached = number(data.get("max_cache_bytes", 0), "PLAYER_EVIDENCE_INVALID")
    require(fragments.is_integer() and 0 <= fragments <= 100000
            and cached.is_integer() and 0 <= cached <= 4 * 1024 * 1024, "PLAYER_EVIDENCE_INVALID")
    observations = data.get("observations", [])
    require(isinstance(observations, list) and len(observations) <= 750, "PLAYER_EVIDENCE_INVALID")
    generations: dict[int, list] = {}
    for raw in observations:
        require(isinstance(raw, dict), "PLAYER_EVIDENCE_INVALID")
        sample = {key: number(raw.get(key), "PLAYER_EVIDENCE_INVALID") for key in
                  ("generation", "currentTime", "decodedVideoFrames", "audioDecodedBytes", "readyState", "audioRms", "errors")}
        require(all(0 <= n <= 10**12 for n in sample.values()) and sample["generation"].is_integer()
                and sample["readyState"] <= 4 and sample["audioRms"] <= 1, "PLAYER_EVIDENCE_INVALID")
        require(type(raw.get("playing")) is bool and type(raw.get("soundEnabled")) is bool, "PLAYER_EVIDENCE_INVALID")
        sample.update(playing=raw["playing"], soundEnabled=raw["soundEnabled"])
        generations.setdefault(int(sample["generation"]), []).append(sample)
    connections = []
    for generation, rows in sorted(generations.items()):
        if generation == 0:
            continue
        active = [r for r in rows if r["playing"] and r["readyState"] >= 2]
        first = active[0] if active else rows[0]
        last = active[-1] if active else rows[-1]
        started = False
        last_progress = 0
        max_freeze = 0
        previous = None
        for index, row in enumerate(rows):
            if previous and started:
                require(row["currentTime"] >= previous["currentTime"] and
                        row["decodedVideoFrames"] >= previous["decodedVideoFrames"] and
                        row["audioDecodedBytes"] >= previous["audioDecodedBytes"], "PLAYER_COUNTER_REGRESSION")
            if row["playing"] and row["readyState"] >= 2 and (previous is None or
                    row["currentTime"] > previous["currentTime"] and
                    row["decodedVideoFrames"] > previous["decodedVideoFrames"] and
                    row["audioDecodedBytes"] > previous["audioDecodedBytes"]):
                started = True
                last_progress = index
            if started:
                max_freeze = max(max_freeze, index - last_progress)
            previous = row
        connection = {"generation": generation, "observations": len(rows),
            "video_frames_decoded": int(max(r["decodedVideoFrames"] for r in rows)),
            "audio_bytes_decoded": int(max(r["audioDecodedBytes"] for r in rows)),
            "video_frames_progress": int(last["decodedVideoFrames"] - first["decodedVideoFrames"]),
            "audio_bytes_progress": int(last["audioDecodedBytes"] - first["audioDecodedBytes"]),
            "playback_time_progress_seconds": round(last["currentTime"] - first["currentTime"], 3),
            "sound_enabled": any(r["soundEnabled"] and r["playing"] for r in rows),
            "audio_rms_max": max(r["audioRms"] for r in rows), "player_errors": int(max(r["errors"] for r in rows)),
            "max_nonprogress_observations": max_freeze}
        if required:
            require(connection["player_errors"] == 0, "PLAYER_DECODE_FAILED")
            require(connection["video_frames_progress"] > 0 and connection["audio_bytes_progress"] > 0
                    and connection["playback_time_progress_seconds"] >= .5, "PLAYER_AV_PROGRESS_MISSING")
            audible = [r for r in active if r["soundEnabled"]]
            require(len(audible) >= 2 and audible[-1]["audioDecodedBytes"] > audible[0]["audioDecodedBytes"],
                    "PLAYER_SOUND_ENABLED_PROGRESS_MISSING")
            # Browser observations arrive once per second. Count observations,
            # rather than inventing wall-clock timestamps absent from the report.
            require(max_freeze <= MAX_PROGRESS_GAP_SECONDS, "PLAYER_PLAYBACK_FROZEN")
        connections.append(connection)
    if required:
        require(data.get("source") == "RECEIVER_LIVE_FRAGMENTED_MP4" and fragments > 0
                and {c["generation"] for c in connections} == {1, 2}, "PLAYER_RECONNECT_EVIDENCE_REQUIRED")
    return {"source": "RECEIVER_LIVE_FRAGMENTED_MP4" if value else "NOT_OBSERVED",
            "fragments_received": int(fragments), "max_cache_bytes": int(cached),
            "observation_count": len(observations), "connections": connections,
            "before_and_after_reconnect_verified": required}


def measure(directory: Path, ffprobe: Path, *, min_duration_seconds: int = 600) -> dict:
    require(isinstance(min_duration_seconds, int) and 12 <= min_duration_seconds <= 3600, "INVALID_PROOF_DURATION")
    source = read_report(directory / "pipeline.json")
    received = read_report(directory / "receiver.json")
    duration = number(source.get("measuredDurationMs"), "PROOF_DURATION_INVALID") / 1000
    require(min_duration_seconds <= duration <= 3720, "PROOF_DURATION_TOO_SHORT")
    require(source.get("completed") is True and source.get("measurementStartedAfterRealFrameAndLiveTransport") is True,
            "PROOF_NOT_COMPLETED")
    require(source.get("proofBoundary", "LocalWorkerBoundary") == "LocalWorkerBoundary", "PROOF_BOUNDARY_INVALID")
    current_boundary = source.get("proofBoundary") == "LocalWorkerBoundary"
    if current_boundary:
        require(type(source.get("producerSessionCount")) is int and source["producerSessionCount"] == 1,
                "PROOF_DUPLICATED_PRODUCER_SESSION")
    player = live_player_measurements(received.get("live_player"),
                                      required=current_boundary and min_duration_seconds >= 600)
    require(source.get("resourcesReleased") is True and received.get("worker_closed") is True
            and received.get("receiver_closed") is True, "PROOF_RESOURCES_NOT_RELEASED")
    require(received.get("reconnect_injected") is True, "RECEIVER_RECONNECT_NOT_OBSERVED")
    paths = [directory / "received.flv", directory / "received-reconnected.flv"]
    require(all(p.is_file() and not p.is_symlink() for p in paths), "RECEIVER_RECORDINGS_REQUIRED")
    local_files = sorted(directory.glob("*.mp4"))
    require(len(local_files) <= 4, "PROOF_MEDIA_LIMIT")
    paths += local_files
    require(all(not p.is_symlink() and 0 < p.stat().st_size <= MAX_MEDIA_BYTES for p in paths)
            and sum(p.stat().st_size for p in paths) <= MAX_TOTAL_MEDIA_BYTES, "PROOF_MEDIA_LIMIT")
    progress = receiver_progress(received.get("samples"), duration)
    before = source["beforeStop"]
    encoded = before["encoder"]
    samples = source["samples"]
    require(isinstance(samples, list) and 1 <= len(samples) <= 121, "PROOF_SAMPLES_INVALID")
    after = source["afterStop"]
    require(after.get("status") == "STOPPED" and after.get("resources_released") is True
            and after.get("encoder", {}).get("status") == "STOPPED"
            and after.get("encoder", {}).get("transport", {}).get("status") == "STOPPED", "PROOF_RESOURCES_NOT_RELEASED")
    ffmpeg = resolve_ffmpeg_path()
    recordings = [recording_measurements(path, ffprobe, ffmpeg) for path in paths]
    receivers = recordings[:2]
    require(all(0 <= recording["bytes"] - observed <= 256 * 1024
                for recording, observed in zip(receivers, progress["segment_max_received_bytes"])),
            "RECEIVER_RECORDING_SAMPLE_MISMATCH")
    received_span = sum(r["receiver_packets"]["av_span_seconds"] for r in receivers)
    require(received_span >= duration - MAX_PROGRESS_GAP_SECONDS, "RECEIVER_MEDIA_WINDOW_INCOMPLETE")
    memory = [number(s["metrics"]["ram_mb"], "PROOF_MEMORY_INVALID") for s in samples
              if s["elapsedMs"] >= (60000 if duration >= 60 else 0)]
    require(bool(memory), "PROOF_MEMORY_INVALID")
    return {"mode": "DEV_PROOF_ONLY", "completed": source["completed"],
        "duration_seconds": duration, "minimum_duration_seconds": min_duration_seconds,
        "ten_minute_acceptance": min_duration_seconds >= 600 and duration >= 600,
        "proof_boundary": source.get("proofBoundary", "LEGACY_DEV_STORE"),
        "producer_session_count": source.get("producerSessionCount") if current_boundary else None,
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
        "received_while_producer_active": True, "receiver_progress": progress,
        "receiver_decoded_av_span_seconds": round(received_span, 6),
        "receiver_av_packet_drift_max_ms": max(r["receiver_packets"]["av_packet_drift_max_ms"] for r in receivers),
        "live_player": player,
        "reconnect_injected": received["reconnect_injected"], "resources_released": source["resourcesReleased"],
        "worker_closed": received["worker_closed"], "receiver_closed": received["receiver_closed"],
        "recordings": recordings, "production_realtime_validated": False,
        "interpretation": "Packet timestamps are synchronized; slow held CPU frames do not prove realtime phoneme/lip synchronization."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--ffprobe", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--min-duration-seconds", type=int, default=600,
                        help="600 for acceptance; explicitly use 12 for a short smoke check")
    args = parser.parse_args()
    result = measure(args.directory, args.ffprobe, min_duration_seconds=args.min_duration_seconds)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result))
