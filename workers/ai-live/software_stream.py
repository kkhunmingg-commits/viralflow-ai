"""Bounded JPEG → FFmpeg software H.264 → local file development sink."""
from __future__ import annotations

import os
import queue
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Protocol


class StreamProvider(Protocol):
    def push_frame(self, jpeg: bytes) -> None: ...
    def close(self) -> None: ...
    def metrics(self) -> dict[str, object]: ...


class SoftwareLocalStream:
    def __init__(self, output: Path, fps: int):
        configured = os.getenv("AI_LIVE_FFMPEG_PATH", "").strip()
        executable = configured if configured and Path(configured).is_file() else shutil.which("ffmpeg")
        if not executable:
            raise RuntimeError("SOFTWARE_ENCODER_UNAVAILABLE")
        output.parent.mkdir(parents=True, exist_ok=True)
        self.output = output
        self._queue: queue.Queue[bytes] = queue.Queue(maxsize=4)
        self._stop = threading.Event()
        self._frames = 0
        self._drops = 0
        self._error: str | None = None
        self._process = subprocess.Popen(
            [executable, "-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe",
             "-vcodec", "mjpeg", "-framerate", str(fps), "-i", "pipe:0", "-an",
             "-c:v", "libx264", "-preset", "ultrafast", "-threads", "2",
             "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-pix_fmt", "yuv420p",
             "-movflags", "+faststart", str(output)],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        self._thread = threading.Thread(target=self._run, name="dev-software-encoder", daemon=True)
        self._thread.start()

    def push_frame(self, jpeg: bytes) -> None:
        if self._stop.is_set() or self._error:
            return
        try:
            self._queue.put_nowait(jpeg)
        except queue.Full:
            self._drops += 1

    def _run(self) -> None:
        try:
            assert self._process.stdin is not None
            while not self._stop.is_set() or not self._queue.empty():
                try:
                    jpeg = self._queue.get(timeout=0.1)
                except queue.Empty:
                    continue
                self._process.stdin.write(jpeg)
                self._process.stdin.flush()
                self._frames += 1
            self._process.stdin.close()
            if self._process.wait(timeout=5) != 0:
                self._error = "SOFTWARE_ENCODER_FAILED"
        except (OSError, subprocess.TimeoutExpired):
            self._error = "SOFTWARE_ENCODER_FAILED"
        finally:
            if self._process.poll() is None:
                self._process.kill()
                self._process.wait(timeout=2)
            if self._process.stdin is not None and not self._process.stdin.closed:
                try:
                    self._process.stdin.close()
                except OSError:
                    pass
            while not self._queue.empty():
                try:
                    self._queue.get_nowait()
                except queue.Empty:
                    break

    def close(self) -> None:
        self._stop.set()
        self._thread.join(timeout=6)
        if self._thread.is_alive():
            self._process.kill()
            self._thread.join(timeout=2)

    def metrics(self) -> dict[str, object]:
        stopped = not self._thread.is_alive()
        return {
            "kind": "SOFTWARE_LOCAL_FILE", "codec": "libx264", "nvenc": False,
            "status": "FAILED" if self._error else "STOPPED" if stopped else "RUNNING",
            "frames_submitted": self._frames,
            "frames_encoded": self._frames if stopped and not self._error else None,
            "frame_drops": self._drops,
            "queue_depth": self._queue.qsize(), "error": self._error,
            "output_file": self.output.name,
            "output_bytes": self.output.stat().st_size if self.output.exists() else 0,
            "audio_encoded": False,
        }
