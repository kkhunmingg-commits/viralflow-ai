"""Continuous JPEG/PCM -> H.264/AAC FLV transport and fragmented MP4.

Input timestamps are milliseconds relative to the first accepted real JPEG. Both
tracks use that one monotonic epoch. Repeating the last input JPEG preserves the
video timeline; it does not create or claim new lip-sync inference. Audio without
PCM is explicitly filled with silence. The sink must accept bytes promptly (the
stream providers do); sink failures never stop the local recording.
"""
from __future__ import annotations

import os
import math
import queue
import shutil
import socket
import subprocess
import threading
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol


class EncodedSink(Protocol):
    def push_encoded(self, data: bytes) -> object: ...


def resolve_ffmpeg_path(configured: str | None = None) -> str:
    candidate = configured or os.getenv("AI_LIVE_FFMPEG_PATH", "").strip()
    if candidate:
        if not Path(candidate).is_file():
            raise RuntimeError("INTERNAL_ENCODER_UNAVAILABLE")
        return candidate
    executable = shutil.which("ffmpeg")
    if executable:
        return executable
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except (ImportError, RuntimeError):
        raise RuntimeError("INTERNAL_ENCODER_UNAVAILABLE") from None


@dataclass(frozen=True)
class EncoderConfig:
    fps: int = 25
    sample_rate: int = 16000
    channels: int = 1
    video_codec: str = "libx264"
    video_bitrate_kbps: int = 1200
    audio_bitrate_kbps: int = 64
    max_audio_buffer_ms: int = 15000
    max_frame_bytes: int = 8 * 1024 * 1024
    input_queue_size: int = 64
    sink_queue_size: int = 128
    ffmpeg_path: str | None = None

    def __post_init__(self) -> None:
        if not 1 <= self.fps <= 60 or self.sample_rate != 16000 or self.channels != 1:
            raise ValueError("Encoder requires PCM16 mono 16kHz and fps in 1..60")
        if self.video_codec not in ("libx264", "h264_nvenc"):
            raise ValueError("Unsupported H.264 encoder")
        if min(self.video_bitrate_kbps, self.audio_bitrate_kbps, self.max_audio_buffer_ms,
               self.max_frame_bytes, self.input_queue_size, self.sink_queue_size) <= 0:
            raise ValueError("Encoder limits must be positive")


@dataclass
class _AudioChunk:
    sample: int
    pcm: bytes
    queued_at: float


class InternalAVEncoder:
    def __init__(self, config: EncoderConfig, output_path: Path | str,
                 encoded_sink: EncodedSink | Callable[[bytes], object] | None = None):
        self.config = config
        self.output_path = Path(output_path)
        self._executable = resolve_ffmpeg_path(config.ffmpeg_path)
        self._sink = encoded_sink
        self._lock = threading.RLock()
        self._dispose_lock = threading.RLock()
        self._stop = threading.Event()
        self._first_frame = threading.Event()
        self._output_done = threading.Event()
        self._started = False
        self._stopped = False
        self._epoch: float | None = None
        self._latest_jpeg: bytes | None = None
        self._latest_frame_at: float | None = None
        self._last_frame_timestamp = -1.0
        self._frame_version = 0
        self._consumed_frame_version = 0
        self._audio: deque[_AudioChunk] = deque()
        self._audio_buffer_samples = 0
        self._audio_cursor = 0
        self._audio_tail = 0
        self._process: subprocess.Popen | None = None
        self._servers: list[socket.socket] = []
        self._connections: list[socket.socket] = []
        self._threads: list[threading.Thread] = []
        self._video_queue: queue.Queue[bytes] = queue.Queue(config.input_queue_size)
        self._audio_queue: queue.Queue[bytes] = queue.Queue(config.input_queue_size)
        self._sink_queue: queue.Queue[bytes] = queue.Queue(config.sink_queue_size)
        self._error: str | None = None
        self._stderr: deque[str] = deque(maxlen=12)
        self._frames_submitted = self._frame_drops = self._frames_written = 0
        self._ticks = self._held_frames = self._audio_written_samples = 0
        self._audio_dropped_samples = self._silence_samples = 0
        self._encoded_bytes = self._sink_drops = self._sink_errors = 0
        self._video_pts_ms: float | None = None
        self._audio_pts_ms: float | None = None
        self._max_pts_drift_ms = 0.0
        self._last_output_at: float | None = None
        self._last_audio_output_at: float | None = None
        self._max_scheduler_lag_ms = 0.0
        self._finished_at: float | None = None

    def _spawn(self, target, name, *args) -> None:
        thread = threading.Thread(target=target, args=args, name=name, daemon=True)
        self._threads.append(thread)
        thread.start()

    def start(self) -> None:
        with self._lock:
            if self._started:
                return
            if self._stopped:
                raise RuntimeError("ENCODER_DISPOSED")
            self.output_path.parent.mkdir(parents=True, exist_ok=True)
            ports = []
            for _ in range(2):
                server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                server.bind(("127.0.0.1", 0))
                server.listen(1)
                server.settimeout(0.2)
                self._servers.append(server)
                ports.append(server.getsockname()[1])
            # Using a path relative to cwd avoids tee-option parsing of Windows C:.
            local_name = self.output_path.resolve().name.replace("\\", "\\\\").replace("'", "\\'").replace("|", "\\|")
            command = [self._executable, "-hide_banner", "-loglevel", "warning", "-nostdin", "-y",
                       "-thread_queue_size", "64", "-probesize", "32", "-analyzeduration", "0",
                       "-f", "image2pipe", "-vcodec", "mjpeg", "-framerate", str(self.config.fps),
                       "-i", f"tcp://127.0.0.1:{ports[0]}",
                       "-thread_queue_size", "64", "-probesize", "32", "-analyzeduration", "0",
                       "-f", "s16le", "-ar", str(self.config.sample_rate), "-ac", "1",
                       "-i", f"tcp://127.0.0.1:{ports[1]}",
                       "-map", "0:v:0", "-map", "1:a:0", "-c:v", self.config.video_codec]
            if self.config.video_codec == "libx264":
                command += ["-preset", "ultrafast", "-tune", "zerolatency", "-threads", "2"]
            else:
                command += ["-preset", "p1", "-tune", "ull"]
            command += ["-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-pix_fmt", "yuv420p",
                        "-b:v", f"{self.config.video_bitrate_kbps}k", "-g", str(self.config.fps * 2),
                        "-keyint_min", str(self.config.fps * 2), "-sc_threshold", "0", "-bf", "0",
                        "-flags", "+global_header", "-c:a", "aac", "-b:a", f"{self.config.audio_bitrate_kbps}k",
                        "-ar", str(self.config.sample_rate), "-ac", "1", "-max_interleave_delta", "100000",
                        "-f", "tee", f"[f=flv:flvflags=no_duration_filesize:flush_packets=1]pipe:1|[f=mp4:movflags=+frag_keyframe+empty_moov+default_base_moof:flush_packets=1]'{local_name}'"]
            try:
                self._process = subprocess.Popen(command, cwd=self.output_path.resolve().parent,
                                                 stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                                 stderr=subprocess.PIPE, bufsize=0,
                                                 creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            except OSError:
                for server in self._servers:
                    server.close()
                self._servers.clear()
                raise RuntimeError("INTERNAL_ENCODER_UNAVAILABLE") from None
            self._started = True
            self._spawn(self._write_input, "av-video-input", self._servers[0], self._video_queue, True)
            self._spawn(self._write_input, "av-audio-input", self._servers[1], self._audio_queue, False)
            self._spawn(self._read_output, "av-encoded-output")
            self._spawn(self._dispatch_sink, "av-stream-sink")
            self._spawn(self._read_errors, "av-encoder-errors")
            self._spawn(self._schedule, "av-shared-clock")

    def push_frame(self, jpeg: bytes, timestamp_ms: float | None = None) -> bool:
        if not isinstance(jpeg, bytes) or not jpeg.startswith(b"\xff\xd8") or not jpeg.endswith(b"\xff\xd9"):
            raise ValueError("Expected complete generated JPEG bytes")
        if len(jpeg) > self.config.max_frame_bytes:
            with self._lock:
                self._frame_drops += 1
            return False
        with self._lock:
            if self._stop.is_set() or self._error:
                return False
            now = time.monotonic()
            epoch = self._epoch if self._epoch is not None else now
            timestamp = (now - epoch) * 1000 if timestamp_ms is None else float(timestamp_ms)
            if not math.isfinite(timestamp) or timestamp < 0:
                raise ValueError("Frame timestamp must be finite nonnegative milliseconds")
            if timestamp < self._last_frame_timestamp:
                self._frame_drops += 1
                return False
            if self._epoch is None:
                self._epoch = now
            # Latest-wins input slot is bounded, even if inference outpaces encoding.
            if self._frame_version > self._consumed_frame_version:
                self._frame_drops += 1
            self._latest_jpeg = jpeg
            self._latest_frame_at = now
            self._last_frame_timestamp = timestamp
            self._frame_version += 1
            self._frames_submitted += 1
            self._first_frame.set()
            return True

    def push_audio(self, pcm16: bytes, timestamp_ms: float | None = None, *, allow_partial: bool = True) -> bool:
        if not isinstance(pcm16, bytes) or len(pcm16) % 2:
            raise ValueError("Expected little-endian PCM16 mono bytes")
        if not pcm16:
            return True
        with self._lock:
            if self._stop.is_set() or self._error:
                return False
            if timestamp_ms is not None and (not math.isfinite(float(timestamp_ms)) or float(timestamp_ms) < 0):
                raise ValueError("Audio timestamp must be finite nonnegative milliseconds")
            start = max(self._audio_cursor, self._audio_tail) if timestamp_ms is None else round(float(timestamp_ms) * self.config.sample_rate / 1000)
            sample_count = len(pcm16) // 2
            late = min(sample_count, max(0, self._audio_cursor - start))
            if late:
                pcm16 = pcm16[late * 2:]
                start += late
                self._audio_dropped_samples += late
            capacity = self.config.max_audio_buffer_ms * self.config.sample_rate // 1000 - self._audio_buffer_samples
            if not allow_partial and len(pcm16) // 2 > max(0, capacity):
                return False
            accepted = min(len(pcm16) // 2, max(0, capacity))
            # Bound future placement too; arbitrary timestamps cannot reserve infinite time.
            if start > self._audio_cursor + self.config.max_audio_buffer_ms * self.config.sample_rate // 1000:
                accepted = 0
            self._audio_dropped_samples += len(pcm16) // 2 - accepted
            if accepted:
                if self._audio and start < self._audio_tail:
                    self._audio_dropped_samples += accepted
                    return False
                self._audio.append(_AudioChunk(start, pcm16[:accepted * 2], time.monotonic()))
                self._audio_buffer_samples += accepted
                self._audio_tail = start + accepted
            return accepted > 0 and accepted + late == sample_count

    def _audio_tick(self, end_sample: int) -> bytes:
        start_sample = self._audio_cursor
        block = bytearray((end_sample - start_sample) * 2)
        copied = 0
        while self._audio and self._audio[0].sample < end_sample:
            chunk = self._audio[0]
            offset = max(0, start_sample - chunk.sample)
            count = min(len(chunk.pcm) // 2 - offset, end_sample - max(start_sample, chunk.sample))
            if count > 0:
                destination = max(0, chunk.sample - start_sample) * 2
                block[destination:destination + count * 2] = chunk.pcm[offset * 2:(offset + count) * 2]
                copied += count
            consumed = offset + max(0, count)
            self._audio_buffer_samples -= min(consumed, len(chunk.pcm) // 2)
            if consumed >= len(chunk.pcm) // 2:
                self._audio.popleft()
            else:
                chunk.sample += consumed
                chunk.pcm = chunk.pcm[consumed * 2:]
                break
        self._silence_samples += end_sample - start_sample - copied
        self._audio_cursor = end_sample
        return bytes(block)

    def _schedule(self) -> None:
        version = -1
        while not self._stop.is_set() and not self._first_frame.wait(0.1):
            if self._process and self._process.poll() is not None:
                self._fail("INTERNAL_ENCODER_FAILED")
                return
        while not self._stop.is_set():
            with self._lock:
                assert self._epoch is not None
                target = self._epoch + self._ticks / self.config.fps
            if self._stop.wait(max(0, target - time.monotonic())):
                break
            with self._lock:
                lag = max(0, (time.monotonic() - target) * 1000)
                self._max_scheduler_lag_ms = max(self._max_scheduler_lag_ms, lag)
                jpeg = self._latest_jpeg
                if version == self._frame_version:
                    self._held_frames += 1
                version = self._frame_version
                self._consumed_frame_version = version
                audio = self._audio_tick(round((self._ticks + 1) * self.config.sample_rate / self.config.fps))
                self._ticks += 1
            try:
                assert jpeg is not None
                # Never skip encoded timeline positions; a blocked encoder fails
                # explicitly instead of allowing implicit input PTS to diverge.
                self._video_queue.put(jpeg, timeout=0.5)
                self._audio_queue.put(audio, timeout=0.5)
            except queue.Full:
                self._fail("ENCODER_INPUT_BACKPRESSURE")
            if self._process and self._process.poll() is not None:
                self._fail("INTERNAL_ENCODER_FAILED")

    def _write_input(self, server: socket.socket, pending: queue.Queue, video: bool) -> None:
        connection = None
        try:
            while not self._stop.is_set():
                try:
                    connection, _ = server.accept()
                    connection.settimeout(2)
                    self._connections.append(connection)
                    break
                except socket.timeout:
                    continue
            if connection is None:
                return
            while not self._stop.is_set() or not pending.empty():
                try:
                    data = pending.get(timeout=0.1)
                except queue.Empty:
                    continue
                connection.sendall(data)
                with self._lock:
                    if video:
                        self._frames_written += 1
                    else:
                        self._audio_written_samples += len(data) // 2
        except OSError:
            if not self._stop.is_set():
                self._fail("ENCODER_INPUT_FAILED")
        finally:
            if connection:
                try:
                    connection.shutdown(socket.SHUT_WR)
                except OSError:
                    pass
                connection.close()
            server.close()

    def _read_exact(self, size: int) -> bytes:
        assert self._process and self._process.stdout
        data = bytearray()
        while len(data) < size:
            chunk = self._process.stdout.read(size - len(data))
            if not chunk:
                break
            data.extend(chunk)
        return bytes(data)

    def _read_output(self) -> None:
        waiting_keyframe = False
        try:
            header = self._read_exact(9)
            if not header:
                return
            if len(header) != 9 or header[:3] != b"FLV":
                self._fail("ENCODER_INVALID_OUTPUT")
                return
            offset = int.from_bytes(header[5:9], "big")
            if not 9 <= offset <= 4096:
                self._fail("ENCODER_INVALID_OUTPUT")
                return
            header += self._read_exact(offset - 9 + 4)
            if self._sink:
                self._sink_queue.put_nowait(header)
            with self._lock:
                self._encoded_bytes += len(header)
            while True:
                tag_header = self._read_exact(11)
                if not tag_header:
                    break
                if len(tag_header) != 11:
                    self._fail("ENCODER_TRUNCATED_OUTPUT")
                    break
                size = int.from_bytes(tag_header[1:4], "big")
                if size > 16 * 1024 * 1024:
                    self._fail("ENCODER_INVALID_OUTPUT")
                    break
                payload = self._read_exact(size + 4)
                if len(payload) != size + 4:
                    self._fail("ENCODER_TRUNCATED_OUTPUT")
                    break
                timestamp = int.from_bytes(tag_header[4:7], "big") | (tag_header[7] << 24)
                kind = tag_header[0]
                # Sequence headers at timestamp 0 do not measure media drift.
                media = size > 1 and payload[1] == 1
                keyframe = kind == 9 and media and payload[0] >> 4 == 1
                with self._lock:
                    self._encoded_bytes += 11 + len(payload)
                    self._last_output_at = time.monotonic()
                    if kind == 9 and media:
                        self._video_pts_ms = timestamp
                        if self._audio_pts_ms is not None:
                            self._max_pts_drift_ms = max(self._max_pts_drift_ms, abs(timestamp - self._audio_pts_ms))
                    elif kind == 8 and media:
                        self._audio_pts_ms = timestamp
                        self._last_audio_output_at = self._last_output_at
                if self._sink:
                    if waiting_keyframe and not keyframe:
                        self._sink_drops += 1
                        continue
                    waiting_keyframe = False
                    try:
                        self._sink_queue.put_nowait(tag_header + payload)
                    except queue.Full:
                        self._sink_drops += 1
                        waiting_keyframe = True
                        # Complete tag drops preserve framing; provider resyncs at
                        # a GOP boundary using its own cached sequence headers.
                        reconnect = getattr(self._sink, "reconnect", None)
                        if reconnect:
                            try:
                                reconnect()
                            except Exception:
                                self._sink_errors += 1
        except (OSError, ValueError):
            if not self._stop.is_set():
                self._fail("ENCODER_OUTPUT_FAILED")
        finally:
            self._output_done.set()

    def _dispatch_sink(self) -> None:
        while not self._output_done.is_set() or not self._sink_queue.empty():
            try:
                data = self._sink_queue.get(timeout=0.1)
            except queue.Empty:
                continue
            try:
                callback = getattr(self._sink, "push_encoded", self._sink)
                if callback:
                    callback(data)
            except Exception:
                # Provider owns reconnection; no restart of the encoder epoch.
                with self._lock:
                    self._sink_errors += 1

    def _read_errors(self) -> None:
        assert self._process and self._process.stderr
        for line in iter(self._process.stderr.readline, b""):
            with self._lock:
                self._stderr.append(line.decode("utf-8", errors="replace").strip()[:500])

    def _fail(self, code: str) -> None:
        with self._lock:
            self._error = self._error or code
        self._stop.set()

    def metrics(self) -> dict[str, object]:
        with self._lock:
            now = self._finished_at or time.monotonic()
            duration = max(0, now - self._epoch) if self._epoch is not None else 0
            timeline = self._ticks / self.config.fps
            drift = None if self._video_pts_ms is None or self._audio_pts_ms is None else abs(self._video_pts_ms - self._audio_pts_ms)
            return {"kind": "INTERNAL_AV_ENCODER", "status": "FAILED" if self._error else "STOPPED" if self._stopped else "RUNNING" if self._first_frame.is_set() and self._started else "WAITING_FOR_FRAME" if self._started else "READY",
                    "codec": self.config.video_codec, "audio_codec": "aac", "nvenc": self.config.video_codec == "h264_nvenc",
                    "fps": self.config.fps, "encoder_fps": self._frames_written / duration if duration else 0,
                    "frames_submitted": self._frames_submitted, "frames_encoded": self._frames_written,
                    "held_frames": self._held_frames, "frame_drops": self._frame_drops,
                    "audio_encoded": self._audio_pts_ms is not None, "audio_samples_written": self._audio_written_samples,
                    "audio_dropped_samples": self._audio_dropped_samples, "dropped_audio": self._audio_dropped_samples,
                    "silence_samples": self._silence_samples, "audio_latency_ms": self._audio_buffer_samples / self.config.sample_rate * 1000,
                    "audio_input_age_ms": (now - self._audio[0].queued_at) * 1000 if self._audio else 0,
                    "av_drift_ms": drift, "max_av_drift_ms": self._max_pts_drift_ms,
                    "video_pts_ms": self._video_pts_ms, "audio_pts_ms": self._audio_pts_ms,
                    "input_av_drift_ms": abs(self._frames_written / self.config.fps - self._audio_written_samples / self.config.sample_rate) * 1000,
                    "presenter_frame_age_ms": (now - self._latest_frame_at) * 1000 if self._latest_frame_at is not None else None,
                    "max_scheduler_lag_ms": self._max_scheduler_lag_ms, "timeline_ms": timeline * 1000,
                    "queue_depth": self._video_queue.qsize() + self._audio_queue.qsize(), "video_queue_depth": self._video_queue.qsize(),
                    "audio_queue_depth": self._audio_queue.qsize(), "audio_buffer_samples": self._audio_buffer_samples,
                    "sink_queue_depth": self._sink_queue.qsize(), "sink_dropped_tags": self._sink_drops, "sink_errors": self._sink_errors,
                    "encoded_bytes": self._encoded_bytes, "bitrate_kbps": self._encoded_bytes * 8 / duration / 1000 if duration else 0,
                    "output_age_ms": (now - self._last_output_at) * 1000 if self._last_output_at else None,
                    "audio_output_age_ms": (now - self._last_audio_output_at) * 1000 if self._last_audio_output_at is not None else None,
                    "output_file": self.output_path.name, "output_bytes": self.output_path.stat().st_size if self.output_path.exists() else 0,
                    "error": self._error, "diagnostic_tail": list(self._stderr)}

    def health(self) -> dict[str, object]:
        metrics = self.metrics()
        age = metrics["output_age_ms"]
        audio_age = metrics["audio_output_age_ms"]
        elapsed_ms = max(0, (time.monotonic() - self._epoch) * 1000) if self._epoch is not None else 0
        metrics["encoder_stalled"] = bool(metrics["status"] == "RUNNING" and
                                           ((age is not None and age > 5000) or (age is None and elapsed_ms > 5000)))
        # Silence is encoded continuously too. Video/metadata output cannot
        # conceal a missing or stalled AAC media track.
        metrics["audio_stalled"] = bool(metrics["status"] == "RUNNING" and
                                         ((audio_age is not None and audio_age > 5000) or (audio_age is None and elapsed_ms > 5000)))
        return metrics

    def stop(self) -> None:
        with self._dispose_lock:
            self._stop_resources()

    def _stop_resources(self) -> None:
        if self._stopped:
            return
        self._finished_at = time.monotonic()
        self._stop.set()
        # Both writers drain equally numbered positions then close their TCP
        # write ends. FFmpeg can finalize the local file and flush AAC packets.
        for thread in self._threads:
            if thread.name in ("av-shared-clock", "av-video-input", "av-audio-input"):
                thread.join(timeout=3)
        if self._process:
            try:
                self._process.wait(timeout=6)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait(timeout=3)
                self._error = self._error or "ENCODER_STOP_TIMEOUT"
            if self._process.returncode and self._epoch is not None:
                self._error = self._error or "INTERNAL_ENCODER_FAILED"
        for server in self._servers:
            server.close()
        for thread in self._threads:
            thread.join(timeout=1)
        if self._process:
            for stream in (self._process.stdout, self._process.stderr):
                if stream:
                    stream.close()
        for pending in (self._video_queue, self._audio_queue, self._sink_queue):
            while not pending.empty():
                try:
                    pending.get_nowait()
                except queue.Empty:
                    break
        with self._lock:
            self._audio.clear()
            self._audio_buffer_samples = 0
            self._latest_jpeg = None
            self._stopped = True

    def dispose(self) -> None:
        self.stop()

    def close(self) -> None:
        self.stop()
