"""Continuous FLV transports. No completed media file or external streaming app.

Input chunks are parsed into complete FLV tags. After a reconnect or overflow we
wait for a fresh keyframe, replay codec configuration, and rebase its epoch.
The encoder/audio timeline continues; this transport never repeats speech.
"""
from __future__ import annotations

import os
import queue
import select
import shutil
import socket
import ssl
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Protocol
from urllib.parse import urlsplit, urlunsplit


class StreamError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def validate_transport(server_url: str, stream_key: str, *, scheme: str | None = None) -> str:
    """Only explicit RTMP transports; subprocess receives an argument list."""
    if (not isinstance(server_url, str) or not isinstance(stream_key, str)
            or not stream_key or len(server_url) > 2048 or len(stream_key) > 2048
            or any(ord(c) <= 32 or ord(c) >= 127 or c in "\\#" for c in server_url + stream_key)
            or stream_key.startswith(("/", "?")) or "://" in stream_key):
        raise StreamError("STREAM_CREDENTIALS_INVALID")
    try:
        parsed = urlsplit(server_url)
        if (parsed.scheme not in ("rtmp", "rtmps") or (scheme and parsed.scheme != scheme)
                or not parsed.hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment or not parsed.path.strip("/")
                or (parsed.port is not None and not 1 <= parsed.port <= 65535)):
            raise ValueError
    except ValueError as exc:
        raise StreamError("STREAM_CREDENTIALS_INVALID") from exc
    return server_url.rstrip("/") + "/" + stream_key


def resolve_ffmpeg_path(configured: str | None = None) -> str:
    candidate = configured or os.getenv("AI_LIVE_FFMPEG_PATH", "").strip()
    if candidate and Path(candidate).is_file():
        return candidate
    candidate = shutil.which("ffmpeg")
    if candidate:
        return candidate
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError as exc:
        raise StreamError("INTERNAL_ENCODER_UNAVAILABLE") from exc


class StreamProvider(Protocol):
    def connect(self) -> None: ...
    def start(self) -> None: ...
    def push_encoded(self, data: bytes) -> None: ...
    def health(self) -> dict[str, object]: ...
    def metrics(self) -> dict[str, object]: ...
    def reconnect(self) -> None: ...
    def stop(self) -> None: ...
    def dispose(self) -> None: ...


class _VerifiedTLSTunnel:
    """The actual RTMPS connection is verified by Python, before any RTMP bytes.

    FFmpeg talks RTMP to a one-use loopback socket. Only bounded encrypted relays
    leave this machine, and this class has no unverified TLS mode.
    """
    def __init__(self, endpoint: str):
        parsed = urlsplit(endpoint)
        self._host, self._port = parsed.hostname, parsed.port or 443
        self._stop = threading.Event()
        self._listener = socket.socket()
        self._listener.bind(("127.0.0.1", 0))
        self._listener.listen(1)
        self._listener.settimeout(0.1)
        port = self._listener.getsockname()[1]
        self.url = urlunsplit(("rtmp", f"127.0.0.1:{port}", parsed.path, parsed.query, ""))
        self.error: str | None = None
        self._sockets: list[socket.socket] = []
        self._thread = threading.Thread(target=self._run, name="verified-live-tls", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        try:
            while not self._stop.is_set():
                try:
                    client, _ = self._listener.accept()
                    break
                except socket.timeout:
                    continue
            else:
                return
            self._sockets.append(client)
            self._listener.close()
            raw = socket.create_connection((self._host, self._port), timeout=3)
            self._sockets.append(raw)
            # This socket carries the actual publishing bytes, not a preflight.
            verified = ssl.create_default_context().wrap_socket(raw, server_hostname=self._host)
            self._sockets.append(verified)
            client.setblocking(False)
            verified.setblocking(False)
            upstream, downstream = bytearray(), bytearray()
            draining = False
            while not self._stop.is_set():
                if draining and not upstream and not downstream:
                    return
                readers = [] if draining else (([client] if len(upstream) < 256 * 1024 else []) + ([verified] if len(downstream) < 256 * 1024 else []))
                writers = ([verified] if upstream else []) + ([client] if downstream else [])
                readable, writable, _ = select.select(readers, writers, [], 0.05)
                if not draining and verified.pending() and len(downstream) < 256 * 1024 and verified not in readable:
                    readable.append(verified)
                for source in readable:
                    try:
                        pending_buffer = upstream if source is client else downstream
                        block = source.recv(min(65536, 256 * 1024 - len(pending_buffer)))
                        if not block:
                            # EOF may be reported in the same select cycle in
                            # which the other socket is ready to receive our
                            # buffered final bytes. Flush those bytes first.
                            draining = True
                            if source is verified:
                                upstream.clear()
                            break
                        (upstream if source is client else downstream).extend(block)
                    except (BlockingIOError, ssl.SSLWantReadError, ssl.SSLWantWriteError):
                        pass
                for destination in writable:
                    pending = upstream if destination is verified else downstream
                    if not pending:
                        continue
                    try:
                        sent = destination.send(pending)
                        del pending[:sent]
                    except (BlockingIOError, ssl.SSLWantReadError, ssl.SSLWantWriteError):
                        pass
        except ssl.SSLCertVerificationError:
            self.error = "STREAM_TLS_VERIFICATION_FAILED"
        except (OSError, ssl.SSLError):
            if not self._stop.is_set():
                self.error = "STREAM_TRANSPORT_FAILED"
        finally:
            self._listener.close()
            for connection in self._sockets:
                try:
                    connection.close()
                except OSError:
                    pass

    def stop(self) -> None:
        self._stop.set()
        self._listener.close()
        for connection in self._sockets:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            connection.close()
        self._thread.join(timeout=4)


def _timestamp(tag: bytes) -> int:
    return int.from_bytes(tag[4:7], "big") | (tag[7] << 24)


def _rebase(tag: bytes, epoch: int) -> bytes:
    timestamp = max(0, _timestamp(tag) - epoch) & 0xFFFFFFFF
    result = bytearray(tag)
    result[4:7] = (timestamp & 0xFFFFFF).to_bytes(3, "big")
    result[7] = timestamp >> 24
    return bytes(result)


class _FLVTransport:
    MAX_TAG_BYTES = 4 * 1024 * 1024
    MAX_QUEUE_BYTES = 4 * 1024 * 1024
    MAX_QUEUE_TAGS = 128
    OUTPUT_TIMEOUT_SECONDS = 5.0

    def __init__(self, *, session_id: str | None = None, backoff_seconds: float = 0.25):
        self.session_id = session_id or str(uuid.uuid4())
        self._backoff = backoff_seconds
        self._queue: queue.Queue[bytes] = queue.Queue(self.MAX_QUEUE_TAGS)
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._restart = threading.Event()
        self._buffer = bytearray()
        self._header: bytes | None = None
        self._sequences: dict[int, bytes] = {}
        self._metadata: bytes | None = None
        self._epoch: int | None = None
        self._queue_bytes = 0
        self._bytes = self._drops = self._audio_drops = self._reconnects = 0
        self._started_at = self._last_output = 0.0
        self._attempt_input_at = 0.0
        self._output_timeouts = 0
        self._status = "IDLE"
        self._error: str | None = None
        self._thread: threading.Thread | None = None
        self._watchdog_thread: threading.Thread | None = None
        self._disposed = False

    def connect(self) -> None:
        if self._disposed or self._stop.is_set():
            raise StreamError("STREAM_DISPOSED")
        if self._status == "IDLE":
            self._status = "CONNECTED"

    def start(self) -> None:
        self.connect()
        if self._thread is not None:
            return
        self._started_at = time.monotonic()
        self._open()
        self._status = "CONNECTING"
        self._thread = threading.Thread(target=self._run, name="direct-stream", daemon=True)
        self._thread.start()
        self._watchdog_thread = threading.Thread(target=self._watch_output, name="stream-output-watchdog", daemon=True)
        self._watchdog_thread.start()

    def _clear_queue(self) -> None:
        while True:
            try:
                tag = self._queue.get_nowait()
                self._drops += 1
                if tag and tag[0] == 8:
                    self._audio_drops += 1
            except queue.Empty:
                break
        self._queue_bytes = 0
        self._epoch = None

    def _enqueue(self, data: bytes) -> None:
        self._queue.put_nowait(data)
        self._queue_bytes += len(data)

    def push_encoded(self, data: bytes) -> None:
        if not isinstance(data, bytes):
            raise StreamError("STREAM_INPUT_INVALID")
        if self._stop.is_set() or self._error:
            return
        with self._lock:
            if len(data) > self.MAX_TAG_BYTES * 2 or len(self._buffer) + len(data) > self.MAX_TAG_BYTES * 2:
                self._error = "STREAM_INPUT_INVALID"
                self._stop.set()
                return
            self._buffer.extend(data)
            if self._header is None:
                if len(self._buffer) < 9:
                    return
                header_size = int.from_bytes(self._buffer[5:9], "big")
                if self._buffer[:3] != b"FLV" or not 9 <= header_size <= 256:
                    self._error = "STREAM_INPUT_INVALID"
                    self._stop.set()
                    return
                if len(self._buffer) < header_size + 4:
                    return
                self._header = bytes(self._buffer[:header_size + 4])
                del self._buffer[:header_size + 4]
            while len(self._buffer) >= 11:
                payload_size = int.from_bytes(self._buffer[1:4], "big")
                size = 11 + payload_size + 4
                if size > self.MAX_TAG_BYTES or self._buffer[0] not in (8, 9, 18):
                    self._error = "STREAM_INPUT_INVALID"
                    self._stop.set()
                    return
                if len(self._buffer) < size:
                    break
                tag = bytes(self._buffer[:size])
                del self._buffer[:size]
                if int.from_bytes(tag[-4:], "big") != size - 4:
                    self._error = "STREAM_INPUT_INVALID"
                    self._stop.set()
                    return
                kind = tag[0]
                sequence = (payload_size >= 2 and ((kind == 8 and tag[11] >> 4 == 10)
                            or (kind == 9 and tag[11] & 15 == 7)) and tag[12] == 0)
                if sequence:
                    if size > 64 * 1024:
                        self._error = "STREAM_INPUT_INVALID"
                        self._stop.set()
                        return
                    self._sequences[kind] = _rebase(tag, _timestamp(tag))
                if kind == 18:
                    if size > 64 * 1024:
                        self._error = "STREAM_INPUT_INVALID"
                        self._stop.set()
                        return
                    self._metadata = _rebase(tag, _timestamp(tag))
                keyframe = kind == 9 and payload_size >= 2 and tag[11] == 0x17 and tag[12] == 1
                if self._queue.full() or self._queue_bytes + size > self.MAX_QUEUE_BYTES:
                    self._clear_queue()
                    self._restart.set()
                if self._epoch is None:
                    if not keyframe or not {8, 9}.issubset(self._sequences):
                        self._drops += 1
                        self._audio_drops += int(kind == 8 and not sequence)
                        continue
                    bootstrap_size = len(self._header) + sum(map(len, self._sequences.values())) + len(self._metadata or b"")
                    if size + bootstrap_size > self.MAX_QUEUE_BYTES:
                        self._error = "STREAM_INPUT_INVALID"
                        self._stop.set()
                        return
                    self._epoch = _timestamp(tag)
                    self._enqueue(self._header)
                    if self._metadata:
                        self._enqueue(self._metadata)
                    for sequence_tag in self._sequences.values():
                        self._enqueue(sequence_tag)
                # Audio from before the reconnect epoch cannot precede its keyframe.
                if not sequence and _timestamp(tag) < self._epoch:
                    self._drops += 1
                    self._audio_drops += int(kind == 8)
                    continue
                self._enqueue(_rebase(tag, self._epoch))

    def reconnect(self) -> None:
        if self._thread is None or self._stop.is_set():
            raise StreamError("STREAM_NOT_RUNNING")
        self._restart.set()
        # Unblock a network write immediately; retry happens in the sole writer.
        self._interrupt()

    def _recover(self) -> bool:
        self._close(False)
        with self._lock:
            self._clear_queue()
            self._attempt_input_at = self._last_output = 0.0
        if self._reconnects >= 3:
            self._error = "STREAM_RECONNECT_EXHAUSTED"
            self._status = "FAILED"
            return False
        self._reconnects += 1
        self._status = "RECONNECTING"
        self._restart.clear()
        if self._stop.wait(self._backoff * 2 ** (self._reconnects - 1)):
            return False
        self._open()
        return True

    def _output_stalled(self) -> bool:
        # Preparation can legitimately wait for a real presenter frame for tens
        # of seconds. The deadline starts with this connection's encoded input.
        return bool(self._attempt_input_at and not self._stop.is_set()
                    and time.monotonic() - (self._last_output or self._attempt_input_at)
                    > self.OUTPUT_TIMEOUT_SECONDS)

    def _watch_output(self) -> None:
        while not self._stop.wait(0.1):
            if self._thread is None or not self._thread.is_alive():
                return
            if self._output_stalled() and not self._restart.is_set():
                self._output_timeouts += 1
                # A full stdin pipe can block the writer, so a separate watchdog
                # must interrupt it. The sole writer owns the bounded retry.
                self._restart.set()
                self._interrupt()

    def _run(self) -> None:
        try:
            while not self._stop.is_set() or not self._queue.empty():
                if self._restart.is_set() or not self._alive():
                    if self._stop.is_set() or not self._recover():
                        break
                try:
                    data = self._queue.get(timeout=0.05)
                except queue.Empty:
                    continue
                with self._lock:
                    self._queue_bytes = max(0, self._queue_bytes - len(data))
                try:
                    if not self._attempt_input_at:
                        self._attempt_input_at = time.monotonic()
                    self._write(data)
                    self._bytes += len(data)
                except (OSError, ValueError):
                    if self._stop.is_set() or not self._recover():
                        break
        except (OSError, StreamError):
            self._error = "STREAM_TRANSPORT_FAILED"
        finally:
            self._close(True)
            with self._lock:
                self._clear_queue()
            self._status = "FAILED" if self._error else "STOPPED"

    def health(self) -> dict[str, object]:
        output_stalled = self._output_stalled()
        return {"status": self._status, "error": self._error,
                "healthy": self._status == "LIVE" and not output_stalled and self._alive(),
                "output_stalled": output_stalled}

    def metrics(self) -> dict[str, object]:
        elapsed = max(0.001, time.monotonic() - self._started_at) if self._started_at else 1
        return {"kind": type(self).__name__, "session_id": self.session_id,
                **self.health(), "encoded_bytes_submitted": self._bytes,
                "bitrate_bps": round(self._bytes * 8 / elapsed),
                "queue_depth": self._queue.qsize(), "queue_bytes": self._queue_bytes,
                "dropped_tags": self._drops, "dropped_audio": self._audio_drops,
                "reconnect_count": self._reconnects, "output_timeouts": self._output_timeouts}

    def stop(self) -> None:
        self._stop.set()
        if self._watchdog_thread:
            self._watchdog_thread.join(timeout=1)
        if self._thread:
            self._thread.join(timeout=3)
            if self._thread.is_alive():
                self._interrupt()
                self._thread.join(timeout=3)
        else:
            self._close(False)
            self._status = "STOPPED"
        with self._lock:
            self._clear_queue()

    def dispose(self) -> None:
        self.stop()
        self._disposed = True
        with self._lock:
            self._buffer.clear()
            self._header = self._metadata = None
            self._sequences.clear()

    def _open(self) -> None: ...
    def _alive(self) -> bool: ...
    def _write(self, data: bytes) -> None: ...
    def _close(self, graceful: bool) -> None: ...
    def _interrupt(self) -> None: ...


class LocalTestStream(_FLVTransport):
    """Incremental local FLV recording, useful for continuous encoder inspection."""
    def __init__(self, output: Path, **kwargs):
        super().__init__(**kwargs)
        self.output = output
        self._file = None

    def _open(self) -> None:
        self.output.parent.mkdir(parents=True, exist_ok=True)
        self._file = self.output.open("wb")

    def _alive(self) -> bool:
        return self._file is not None and not self._file.closed

    def _write(self, data: bytes) -> None:
        self._file.write(data)
        self._file.flush()
        self._status = "LIVE"
        self._last_output = time.monotonic()

    def _close(self, graceful: bool) -> None:
        if self._file:
            self._file.close()

    def _interrupt(self) -> None:
        self._close(False)


class GenericRTMPProvider(_FLVTransport):
    SCHEME = "rtmp"

    def __init__(self, server_url: str, stream_key: str, *, ffmpeg_path: str | None = None, **kwargs):
        super().__init__(**kwargs)
        self._url = validate_transport(server_url, stream_key, scheme=self.SCHEME)
        self._server_url = server_url.rstrip("/")
        self._stream_key = stream_key
        self._hostname = urlsplit(server_url).hostname
        self._ffmpeg = resolve_ffmpeg_path(ffmpeg_path)
        self._process: subprocess.Popen | None = None
        self._progress_thread: threading.Thread | None = None
        self._tunnel: _VerifiedTLSTunnel | None = None

    def _command(self) -> list[str]:
        command = [self._ffmpeg, "-hide_banner", "-loglevel", "error", "-nostats",
                   "-f", "flv", "-analyzeduration", "0", "-probesize", "32768",
                   "-i", "pipe:0", "-map", "0:v:0", "-map", "0:a:0", "-c", "copy",
                   "-flush_packets", "1", "-rw_timeout", "3000000"]
        if self.SCHEME == "rtmps" and self._tunnel is None:
            raise StreamError("STREAM_TLS_VERIFICATION_REQUIRED")
        endpoint = self._tunnel.url if self._tunnel else self._url
        # Preserve the real destination's app/playpath/tcUrl when TLS is relayed.
        # Some publishing servers authorize tcUrl as well as the stream key.
        command += ["-rtmp_app", urlsplit(self._server_url).path.strip("/"),
                    "-rtmp_tcurl", self._server_url, "-rtmp_playpath", self._stream_key]
        return command + ["-progress", "pipe:1", "-stats_period", "0.25", "-f", "flv", endpoint]

    def _open(self) -> None:
        if self.SCHEME == "rtmps":
            self._tunnel = _VerifiedTLSTunnel(self._url)
        try:
            self._process = subprocess.Popen(self._command(), stdin=subprocess.PIPE,
                                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        except OSError:
            if self._tunnel:
                self._tunnel.stop()
                self._tunnel = None
            raise
        process = self._process
        def progress() -> None:
            assert process.stdout is not None
            last_output_us = 0
            for line in iter(process.stdout.readline, b""):
                if line.startswith(b"out_time_us=") and process is self._process:
                    try:
                        output_us = int(line.partition(b"=")[2])
                        if output_us > last_output_us:
                            last_output_us = output_us
                            self._status = "LIVE"
                            self._last_output = time.monotonic()
                    except ValueError:
                        pass
        self._progress_thread = threading.Thread(target=progress, name="stream-progress", daemon=True)
        self._progress_thread.start()

    def _alive(self) -> bool:
        if self._tunnel and self._tunnel.error == "STREAM_TLS_VERIFICATION_FAILED":
            self._error = self._tunnel.error
            self._stop.set()
            return False
        return self._process is not None and self._process.poll() is None

    def _write(self, data: bytes) -> None:
        assert self._process is not None and self._process.stdin is not None
        self._process.stdin.write(data)
        self._process.stdin.flush()

    def _interrupt(self) -> None:
        if self._alive():
            self._process.kill()

    def _close(self, graceful: bool) -> None:
        process = self._process
        if process is None:
            return
        if not graceful and process.poll() is None:
            process.kill()
        try:
            if process.stdin and not process.stdin.closed:
                process.stdin.close()
            process.wait(timeout=2)
        except (OSError, subprocess.TimeoutExpired):
            process.kill()
            process.wait(timeout=2)
        if self._progress_thread:
            self._progress_thread.join(timeout=1)
        if process.stdout:
            process.stdout.close()
        if self._tunnel:
            self._tunnel.stop()
            self._tunnel = None

    def dispose(self) -> None:
        super().dispose()
        self._url = ""
        self._server_url = self._stream_key = ""
        self._hostname = None


class GenericRTMPSProvider(GenericRTMPProvider):
    SCHEME = "rtmps"


class TikTokLiveProvider:
    """Only user-obtained publish credentials. No TikTok endpoints or discovery."""
    def __init__(self, server_url: str | None = None, stream_key: str | None = None, **kwargs):
        self._transport = None
        if server_url and stream_key:
            provider = GenericRTMPSProvider if urlsplit(server_url).scheme == "rtmps" else GenericRTMPProvider
            self._transport = provider(server_url, stream_key, **kwargs)

    def connect(self) -> None:
        if not self._transport:
            raise StreamError("TIKTOK_LIVE_TRANSPORT_REQUIRED")
        self._transport.connect()

    def start(self) -> None:
        self.connect()
        self._transport.start()

    def push_encoded(self, data: bytes) -> None:
        if self._transport:
            self._transport.push_encoded(data)

    def health(self) -> dict[str, object]:
        return self._transport.health() if self._transport else {"status": "TIKTOK_LIVE_TRANSPORT_REQUIRED", "healthy": False, "error": "TIKTOK_LIVE_TRANSPORT_REQUIRED"}

    def metrics(self) -> dict[str, object]:
        return self._transport.metrics() if self._transport else self.health()

    def reconnect(self) -> None:
        self.connect()
        self._transport.reconnect()

    def stop(self) -> None:
        if self._transport:
            self._transport.stop()

    def dispose(self) -> None:
        if self._transport:
            self._transport.dispose()
            self._transport = None


class LocalRTMPReceiver:
    """Development-only, real FFmpeg listen-mode RTMP sink on loopback."""
    def __init__(self, output: Path, *, port: int, stream_key: str = "fixture", ffmpeg_path: str | None = None):
        if not 1024 <= port <= 65535:
            raise StreamError("LOCAL_RECEIVER_INVALID")
        self.server_url = f"rtmp://127.0.0.1:{port}/live"
        self.stream_key = stream_key
        self._url = validate_transport(self.server_url, stream_key)
        self.output = output
        self._ffmpeg = resolve_ffmpeg_path(ffmpeg_path)
        self.process = None

    def start(self) -> None:
        self.output.parent.mkdir(parents=True, exist_ok=True)
        self.process = subprocess.Popen([self._ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-listen", "1", "-analyzeduration", "0", "-probesize", "32768", "-i", self._url, "-map", "0", "-c", "copy",
            "-flush_packets", "1", "-f", "flv", str(self.output)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)

    def stop(self) -> None:
        if self.process and self.process.poll() is None:
            self.process.kill()
            self.process.wait(timeout=3)

    def metrics(self) -> dict[str, object]:
        return {"receiving": bool(self.process and self.process.poll() is None),
                "received_bytes": self.output.stat().st_size if self.output.exists() else 0}
