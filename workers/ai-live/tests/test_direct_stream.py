"""Continuous real RTMP tests use explicitly synthetic A/V, never TikTok."""
from __future__ import annotations

import os
import select
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from direct_stream import (GenericRTMPProvider, GenericRTMPSProvider, LocalRTMPReceiver,
                           LocalTestStream, StreamError, TikTokLiveProvider,
                           _VerifiedTLSTunnel, _timestamp, resolve_ffmpeg_path, validate_transport)


def tag(kind, payload, timestamp=0):
    return (bytes([kind]) + len(payload).to_bytes(3, "big") +
            (timestamp & 0xFFFFFF).to_bytes(3, "big") + bytes([timestamp >> 24]) +
            b"\0\0\0" + payload + (len(payload) + 11).to_bytes(4, "big"))


HEADER = b"FLV\x01\x05\0\0\0\x09\0\0\0\0"
AVC = tag(9, b"\x17\0\0\0\0sequence")
AAC = tag(8, b"\xaf\0sequence")


def wait_until(predicate, timeout=8):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if predicate():
            return True
        time.sleep(0.05)
    return False


class DirectStreamTests(unittest.TestCase):
    def test_url_validation_rejects_alternate_protocols_and_redacts(self):
        for url, key in [("file:///tmp/live", "key"), ("https://host/live", "key"),
                         ("rtmp://user:pass@host/live", "key"), ("rtmp://host/live", "\nsecret"),
                         ("rtmp://host/live", "file://secret"), ("rtmp://host/live", "/secret"),
                         ("rtmp://host:99999/live", "key")]:
            with self.subTest(url=url), self.assertRaisesRegex(StreamError, "STREAM_CREDENTIALS_INVALID"):
                validate_transport(url, key)
        self.assertEqual(validate_transport("rtmps://publish.example/live", "secret?token=abc"),
                         "rtmps://publish.example/live/secret?token=abc")
        stream = GenericRTMPProvider("rtmp://127.0.0.1:1234/live", "never-display-this", ffmpeg_path=sys.executable)
        self.assertNotIn("never-display-this", str(stream.metrics()))
        stream.dispose()
        self.assertEqual(stream._url, "")

    def test_tls_requires_certificate_and_host_verification(self):
        stream = GenericRTMPSProvider("rtmps://publish.example/live", "secret", ffmpeg_path=sys.executable)
        with self.assertRaisesRegex(StreamError, "STREAM_TLS_VERIFICATION_REQUIRED"):
            stream._command()
        stream.dispose()

    def test_actual_tls_relay_validates_ca_and_hostname_before_publishing(self):
        from datetime import datetime, timedelta, timezone
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
        certificate = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
            .public_key(private_key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(datetime.now(timezone.utc) - timedelta(minutes=1))
            .not_valid_after(datetime.now(timezone.utc) + timedelta(days=1))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost")]), critical=False)
            .sign(private_key, hashes.SHA256()))
        with tempfile.TemporaryDirectory() as directory:
            cert = Path(directory) / "test-ca.pem"
            key = Path(directory) / "test-key.pem"
            cert.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
            key.write_bytes(private_key.private_bytes(serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
            server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            server_context.load_cert_chain(cert, key)
            trusted_context = ssl.create_default_context(cafile=str(cert))
            untrusted_context = ssl.create_default_context()
            for hostname, context, allowed in [("localhost", trusted_context, True),
                                               ("127.0.0.1", trusted_context, False),
                                               ("localhost", untrusted_context, False)]:
                with self.subTest(host=hostname, trusted=allowed), socket.socket() as listener:
                    listener.bind(("127.0.0.1", 0))
                    listener.listen(1)
                    received = []
                    def serve():
                        raw, _ = listener.accept()
                        try:
                            with server_context.wrap_socket(raw, server_side=True) as secure:
                                received.append(secure.recv(1024))
                                secure.sendall(b"receiver-ack")
                        except ssl.SSLError:
                            raw.close()
                    server_thread = threading.Thread(target=serve, daemon=True)
                    server_thread.start()
                    real_select = select.select
                    eof_before_write = []
                    def prioritize_tls_read(readers, writers, errors, timeout):
                        readable, writable, exceptional = real_select(readers, writers, errors, timeout)
                        # Reproduce coalesced ACK + TLS close under CPU load:
                        # read TLS EOF before forwarding the pending ACK.
                        if (not eof_before_write
                                and any(not isinstance(item, ssl.SSLSocket) for item in writers)):
                            if any(isinstance(item, ssl.SSLSocket) for item in readable):
                                eof_before_write.append(True)
                            writable = []
                        return readable, writable, exceptional
                    with patch("direct_stream.ssl.create_default_context", return_value=context), patch("direct_stream.select.select", side_effect=prioritize_tls_read):
                        tunnel = _VerifiedTLSTunnel(f"rtmps://{hostname}:{listener.getsockname()[1]}/live/fixture")
                        try:
                            from urllib.parse import urlsplit
                            local = urlsplit(tunnel.url)
                            with socket.create_connection((local.hostname, local.port), timeout=3) as client:
                                client.sendall(b"actual-publishing-bytes")
                                if allowed:
                                    self.assertEqual(client.recv(1024), b"receiver-ack")
                                    self.assertTrue(eof_before_write, "Fixture must exercise TLS EOF before the queued ACK write")
                                else:
                                    self.assertTrue(wait_until(lambda: tunnel.error is not None))
                                    self.assertEqual(tunnel.error, "STREAM_TLS_VERIFICATION_FAILED")
                            server_thread.join(timeout=3)
                            self.assertEqual(received, [b"actual-publishing-bytes"] if allowed else [])
                        finally:
                            tunnel.stop()

    def test_tiktok_requires_legitimate_transport_and_performs_no_discovery(self):
        stream = TikTokLiveProvider()
        self.assertEqual(stream.health()["status"], "TIKTOK_LIVE_TRANSPORT_REQUIRED")
        with self.assertRaisesRegex(StreamError, "TIKTOK_LIVE_TRANSPORT_REQUIRED"):
            stream.start()
        stream.dispose()

    def test_fragmented_flv_restarts_at_keyframe_and_rebases_epoch(self):
        with tempfile.TemporaryDirectory() as directory:
            stream = LocalTestStream(Path(directory) / "continuous.flv")
            # Queue without starting the writer gives deterministic parser checks.
            payload = HEADER + AVC + AAC + tag(9, b"\x27\x01old", 900) + tag(9, b"\x17\x01new", 1000) + tag(8, b"\xaf\x01audio", 1040)
            for index in range(0, len(payload), 3):
                stream.push_encoded(payload[index:index + 3])
            parts = list(stream._queue.queue)
            self.assertEqual(parts[0], HEADER)
            self.assertEqual(_timestamp(parts[-2]), 0)
            self.assertEqual(_timestamp(parts[-1]), 40)
            self.assertNotIn(b"old", b"".join(parts))
            with stream._lock:
                stream._clear_queue()
            stream.push_encoded(tag(8, b"\xaf\x01stale", 2000) + tag(9, b"\x17\x01fresh", 3000) + tag(8, b"\xaf\x01next", 3020))
            parts = list(stream._queue.queue)
            self.assertEqual(parts[0], HEADER)
            self.assertEqual(_timestamp(parts[-1]), 20)
            self.assertNotIn(b"stale", b"".join(parts))
            stream.dispose()

    def test_queue_is_bounded_and_overflow_requests_transport_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            stream = LocalTestStream(Path(directory) / "bounded.flv")
            stream.push_encoded(HEADER + AVC + AAC + tag(9, b"\x17\x01key", 0))
            for i in range(500):
                stream.push_encoded(tag(9, b"\x27\x01frame", i * 10))
            self.assertLessEqual(stream.metrics()["queue_depth"], stream.MAX_QUEUE_TAGS)
            self.assertLessEqual(stream.metrics()["queue_bytes"], stream.MAX_QUEUE_BYTES)
            self.assertGreater(stream.metrics()["dropped_tags"], 0)
            self.assertTrue(stream._restart.is_set())
            stream.dispose()

    def test_reconnect_budget_is_session_wide(self):
        with tempfile.TemporaryDirectory() as directory:
            stream = LocalTestStream(Path(directory) / "budget.flv", backoff_seconds=0)
            session = stream.session_id
            for _ in range(3):
                self.assertTrue(stream._recover())
            self.assertFalse(stream._recover())
            self.assertEqual(stream.metrics()["error"], "STREAM_RECONNECT_EXHAUSTED")
            self.assertEqual(stream.session_id, session)
            stream.dispose()

    def test_output_watchdog_ignores_preparation_then_unblocks_stalled_publisher_with_bounded_retry(self):
        class BlockedPublisher(GenericRTMPProvider):
            OUTPUT_TIMEOUT_SECONDS = 0.1

            def __init__(self):
                super().__init__("rtmp://127.0.0.1:1234/live", "fixture", ffmpeg_path=sys.executable, backoff_seconds=0)
                self.opens = 0
                self.interrupts = 0
                self.entered_write = threading.Event()

            def _open(self):
                self.opens += 1
                self.alive = True
                self.blocked_pipe = threading.Event()

            def _alive(self):
                return self.alive

            def _write(self, data):
                # Models a living FFmpeg child blocked on its publishing pipe,
                # with no output progress. A sole-writer check cannot recover it.
                pipe = self.blocked_pipe
                self.entered_write.set()
                if not pipe.wait(timeout=3):
                    raise AssertionError("Watchdog failed to unblock the publishing write")
                raise OSError("fixture publisher interrupted")

            def _interrupt(self):
                self.interrupts += 1
                self.alive = False
                self.blocked_pipe.set()

            def _close(self, graceful):
                self.alive = False
                self.blocked_pipe.set()

        stream = BlockedPublisher()
        producer_stop = threading.Event()
        producer = None
        try:
            stream.start()
            session = stream.session_id
            stream._started_at -= 31
            time.sleep(0.25)
            self.assertFalse(stream.health()["output_stalled"])
            self.assertEqual(stream.metrics()["reconnect_count"], 0)
            self.assertEqual(stream.opens, 1)
            stream.push_encoded(HEADER + AVC + AAC)
            def encode_continuously():
                timestamp = 0
                while not producer_stop.wait(0.02):
                    stream.push_encoded(tag(9, b"\x17\x01fresh-keyframe", timestamp) +
                                        tag(8, b"\xaf\x01fresh-audio", timestamp))
                    timestamp += 20
            producer = threading.Thread(target=encode_continuously, daemon=True)
            producer.start()
            self.assertTrue(stream.entered_write.wait(timeout=1))
            self.assertTrue(wait_until(lambda: stream.health()["status"] == "FAILED", timeout=3), stream.metrics())
            self.assertEqual(stream.metrics()["error"], "STREAM_RECONNECT_EXHAUSTED")
            self.assertEqual(stream.metrics()["reconnect_count"], 3)
            self.assertEqual(stream.metrics()["output_timeouts"], 4)
            self.assertEqual(stream.opens, 4)
            self.assertEqual(stream.interrupts, 4)
            self.assertEqual(stream.session_id, session)
        finally:
            producer_stop.set()
            if producer:
                producer.join(timeout=1)
            stream.dispose()
            self.assertFalse(stream._thread.is_alive())
            self.assertFalse(stream._watchdog_thread.is_alive())


class RealRTMPTests(unittest.TestCase):
    def test_continuous_av_arrives_before_producer_finishes_and_recovers(self):
        executable = resolve_ffmpeg_path()
        with socket.socket() as bound:
            bound.bind(("127.0.0.1", 0))
            port = bound.getsockname()[1]
        with tempfile.TemporaryDirectory() as directory:
            first = LocalRTMPReceiver(Path(directory) / "first.flv", port=port, ffmpeg_path=executable)
            second = LocalRTMPReceiver(Path(directory) / "second.flv", port=port, ffmpeg_path=executable)
            provider = GenericRTMPProvider(first.server_url, first.stream_key, ffmpeg_path=executable)
            producer = None
            reader = None
            try:
                first.start()
                time.sleep(0.3)
                provider.start()
                session_id = provider.session_id
                producer = subprocess.Popen([executable, "-hide_banner", "-loglevel", "error", "-re",
                    "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10", "-re", "-f", "lavfi",
                    "-i", "sine=frequency=660:sample_rate=16000", "-t", "14",
                    "-c:v", "libx264", "-preset", "ultrafast", "-threads", "1", "-g", "10",
                    "-bf", "0", "-b:v", "400k", "-c:a", "aac", "-b:a", "64k", "-f", "flv", "pipe:1"],
                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
                def pump():
                    while True:
                        data = producer.stdout.read1(65536)
                        if not data:
                            break
                        provider.push_encoded(data)
                reader = threading.Thread(target=pump, daemon=True)
                reader.start()
                self.assertTrue(wait_until(lambda: first.metrics()["received_bytes"] > 4096), provider.metrics())
                self.assertIsNone(producer.poll(), "Receiver must see bytes while producer is active")
                self.assertTrue(wait_until(lambda: provider.health()["status"] == "LIVE"))
                first.stop()
                second.start()
                time.sleep(0.3)
                # Actual network receiver loss triggers automatic bounded recovery.
                self.assertTrue(wait_until(lambda: provider.metrics()["reconnect_count"] >= 1), provider.metrics())
                self.assertTrue(wait_until(lambda: second.metrics()["received_bytes"] > 4096), provider.metrics())
                self.assertIsNone(producer.poll(), "Recovery receives continued producer output")
                self.assertEqual(provider.session_id, session_id)
                producer.wait(timeout=20)
                reader.join(timeout=3)
                provider.stop()
                # Receiver finishes when publisher closes its connection.
                if second.process.poll() is None:
                    second.process.wait(timeout=4)
                for receiver in (first, second):
                    decoded = subprocess.run([executable, "-v", "error", "-i", str(receiver.output),
                        "-map", "0:v:0", "-f", "framemd5", "pipe:1"], capture_output=True, timeout=8)
                    self.assertEqual(decoded.returncode, 0)
                    self.assertGreater(len([line for line in decoded.stdout.splitlines() if line and not line.startswith(b"#")]), 0)
                    audio = subprocess.run([executable, "-v", "error", "-i", str(receiver.output),
                        "-map", "0:a:0", "-f", "s16le", "pipe:1"], capture_output=True, timeout=8)
                    self.assertEqual(audio.returncode, 0)
                    self.assertGreater(len(audio.stdout), 1024)
                self.assertEqual(provider.metrics()["reconnect_count"], 1)
            finally:
                if producer and producer.poll() is None:
                    producer.kill()
                    producer.wait(timeout=3)
                if reader:
                    reader.join(timeout=3)
                if producer and producer.stdout:
                    producer.stdout.close()
                provider.dispose()
                first.stop()
                second.stop()


if __name__ == "__main__":
    unittest.main()
