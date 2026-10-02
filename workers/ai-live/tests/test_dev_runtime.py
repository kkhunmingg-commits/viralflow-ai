"""Gate and boundary tests use explicit doubles; real inference has separate proof."""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine import make_engine
from provider_config import dev_fallback_enabled, selected_provider
from presenter import DevFallbackPresenter, PresenterUnavailable
from capabilities import inspect_capabilities
from worker_core import LiveStore, LiveError

OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
REFERENCE = bytes.fromhex("ffd8ffc0000b080002000201011100ffd9")
FRAME = b"\xff\xd8explicit-test-frame\xff\xd9"
DEV_ENV = {"AI_LIVE_DEV_FALLBACK": "true", "PRESENTER_PROVIDER": "dev_fallback",
           "NODE_ENV": "development", "VERCEL_ENV": "", "AI_LIVE_ENV": "", "APP_ENV": "development", "VERCEL": ""}


class ExplicitTestEngine:
    def __init__(self):
        self.closed = False
        self.interrupted = threading.Event()
        self.received: list[bytes] = []

    def prepare(self, reference, fps):
        assert reference.is_file()

    def render_pcm16_chunk(self, audio):
        self.received.append(audio)
        yield FRAME

    def interrupt(self):
        self.interrupted.set()

    def close(self):
        self.closed = True


class ExplicitTestStream:
    def __init__(self, *_args):
        self.closed = False
        self.frames = []

    def push_frame(self, frame):
        self.frames.append(frame)

    def close(self):
        self.closed = True

    def metrics(self):
        return {"status": "STOPPED" if self.closed else "RUNNING", "frames_encoded": len(self.frames)}


def wait_until(condition, timeout=2):
    deadline = time.monotonic() + timeout
    while not condition():
        if time.monotonic() > deadline:
            raise AssertionError("Condition did not settle")
        time.sleep(.005)


class DevGateTests(unittest.TestCase):
    def test_health_accepts_ready_cpu_only_in_explicit_development_mode(self):
        ready = SimpleNamespace(probe_readiness=lambda: {"ready": True, "status": "READY", "backend": "MuseTalkCPUFloat32"})
        with patch("capabilities._command_output", return_value=None), patch("capabilities.importlib.util.find_spec", return_value=None), patch("capabilities.importlib.import_module", return_value=ready):
            with patch.dict(os.environ, DEV_ENV):
                health = inspect_capabilities()
                self.assertTrue(health["ready"])
                self.assertTrue(health["dev_fallback"])
                self.assertFalse(health["gpu"]["cuda_available"])
                self.assertFalse(health["ffmpeg"]["nvenc_usable"])
            for override in ({"NODE_ENV": "production"}, {"APP_ENV": "production"}, {"VERCEL": "1"}, {"AI_LIVE_DEV_FALLBACK": "false"}):
                with patch.dict(os.environ, DEV_ENV | override):
                    health = inspect_capabilities()
                    self.assertFalse(health["ready"])
                    self.assertEqual(health["presenter_status"], "GPU_REQUIRED")
                    self.assertNotIn("dev_fallback", health)

    def test_all_three_gates_are_required_and_each_production_environment_denies(self):
        for override in ({"AI_LIVE_DEV_FALLBACK": "false"}, {"PRESENTER_PROVIDER": "musetalk"},
                         {"NODE_ENV": "production"}, {"VERCEL_ENV": "production"}, {"AI_LIVE_ENV": "production"},
                         {"APP_ENV": "production"}, {"VERCEL": "1"}):
            with self.subTest(override=override), patch.dict(os.environ, DEV_ENV | override):
                self.assertFalse(dev_fallback_enabled())
        with patch.dict(os.environ, DEV_ENV):
            self.assertTrue(dev_fallback_enabled())

    def test_configuration_selects_real_factory_and_never_mock(self):
        engine = ExplicitTestEngine()
        with patch.dict(os.environ, DEV_ENV), patch("engine.importlib.import_module", return_value=SimpleNamespace(create_engine=lambda: engine)) as module:
            self.assertIs(make_engine(), engine)
            module.assert_called_once_with("dev_fallback_engine")
        with patch.dict(os.environ, {"PRESENTER_PROVIDER": "musetalk", "AI_LIVE_MUSETALK_STREAM_MODULE": "real_gpu_adapter"}), patch("engine.importlib.import_module", return_value=SimpleNamespace(create_engine=lambda: engine)) as module:
            self.assertIs(make_engine(), engine)
            module.assert_called_once_with("real_gpu_adapter")

    def test_unavailable_factory_is_not_replaced_by_mock(self):
        with patch.dict(os.environ, DEV_ENV), patch("engine.importlib.import_module", side_effect=ImportError("missing")):
            with self.assertRaises(ImportError):
                make_engine()
        with patch.dict(os.environ, DEV_ENV | {"AI_LIVE_DEV_FALLBACK": "false"}):
            with self.assertRaisesRegex(RuntimeError, "DEV_FALLBACK_DISABLED"):
                selected_provider()

    def test_dev_presenter_initialization_requires_readiness(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, DEV_ENV):
            reference = Path(directory) / "reference.jpg"
            reference.write_bytes(REFERENCE)
            engine = ExplicitTestEngine()
            presenter = DevFallbackPresenter(capability_probe=lambda: {"ready": True, "dev_fallback": True, "presenter_status": "READY"}, engine_factory=lambda: engine)
            presenter.load_presenter(reference, 3)
            presenter.start_stream()
            presenter.push_audio_chunk(b"\0\0" * 160)
            wait_until(lambda: presenter.metrics()["frames_generated"] == 1)
            self.assertEqual(list(presenter.receive_frames()), [FRAME])
            presenter.stop()
            self.assertTrue(engine.closed)
            with patch.dict(os.environ, {"NODE_ENV": "production"}):
                denied = DevFallbackPresenter()
                with self.assertRaises(PresenterUnavailable):
                    denied.load_presenter(reference, 3)


class DevStoreTests(unittest.TestCase):
    def test_actual_received_frame_boundary_stop_cleanup_and_restart(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, DEV_ENV), patch("worker_core.SoftwareLocalStream", ExplicitTestStream):
            store = LiveStore(Path(directory))
            try:
                reference = store.save_reference(OWNER, REFERENCE, "image/jpeg")
                for _ in range(2):
                    engine = ExplicitTestEngine()
                    session_id, session = store.start_session(OWNER, reference, 3, engine)
                    wait_until(lambda: session.status == "RUNNING")
                    self.assertIsNone(session.latest_frame)
                    self.assertFalse(session.metrics()["audio_receiving"])
                    audio = b"\0\0" * 160
                    store.send_audio(OWNER, session_id, audio)
                    wait_until(lambda: session.frames_generated == 1)
                    self.assertEqual(engine.received, [audio])
                    self.assertEqual(session.latest_frame, FRAME)
                    self.assertEqual(session.stream.frames, [FRAME])
                    self.assertIsNotNone(session.metrics()["p50_latency_ms"])
                    store.stop_session(OWNER, session_id)
                    self.assertEqual(session.status, "STOPPED")
                    self.assertTrue(engine.closed and session.stream.closed)
                    self.assertEqual(session.audio.qsize(), 0)
                    self.assertTrue(session.metrics()["resources_released"])
            finally:
                store.close()

    def test_bounded_backpressure_interrupt_does_not_duplicate_queued_speech(self):
        class BlockedEngine(ExplicitTestEngine):
            def render_pcm16_chunk(self, audio):
                self.received.append(audio)
                self.interrupted.wait(2)
                if not self.interrupted.is_set():
                    yield FRAME
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, DEV_ENV), patch("worker_core.SoftwareLocalStream", ExplicitTestStream):
            store = LiveStore(Path(directory))
            try:
                reference = store.save_reference(OWNER, REFERENCE, "image/jpeg")
                engine = BlockedEngine()
                session_id, session = store.start_session(OWNER, reference, 3, engine)
                wait_until(lambda: session.status == "RUNNING")
                store.send_audio(OWNER, session_id, b"\0\0")
                wait_until(lambda: session.inference_active)
                for _ in range(4):
                    store.send_audio(OWNER, session_id, b"\0\0")
                with self.assertRaises(LiveError) as error:
                    store.send_audio(OWNER, session_id, b"\0\0")
                self.assertEqual(error.exception.code, "AUDIO_BACKPRESSURE")
                store.stop_session(OWNER, session_id)
                self.assertEqual(len(engine.received), 1)
                self.assertEqual(session.audio.qsize(), 0)
                self.assertEqual(session.frames_generated, 0)
            finally:
                store.close()


@unittest.skipUnless(importlib.util.find_spec("fastapi") and importlib.util.find_spec("httpx"), "HTTP test dependencies are absent")
class DevHttpTests(unittest.TestCase):
    def test_owner_auth_frame_transport_and_production_frame_denial(self):
        from app import create_app
        from fastapi.testclient import TestClient
        secret = "test-token-" + "x" * 32
        headers = {"Authorization": "Bearer " + secret, "X-ViralFlow-Owner-Id": OWNER}
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, DEV_ENV), patch("app.inspect_capabilities", return_value={"ready": True, "presenter_status": "READY"}), patch("app.make_engine", side_effect=ExplicitTestEngine), patch("worker_core.SoftwareLocalStream", ExplicitTestStream):
            api = create_app(secret, Path(directory))
            with TestClient(api) as client:
                self.assertEqual(client.get("/health").status_code, 401)
                reference = client.post("/references", headers=headers | {"Content-Type": "image/jpeg"}, content=REFERENCE).json()["reference_id"]
                session_id = client.post("/sessions", headers=headers, json={"reference_id": reference, "target_fps": 3}).json()["session_id"]
                url = "/sessions/" + session_id
                wait_until(lambda: client.get(url + "/metrics", headers=headers).json()["status"] == "RUNNING")
                self.assertEqual(client.get(url + "/frame", headers=headers).status_code, 204)
                client.post(url + "/audio", headers=headers | {"Content-Type": "application/octet-stream"}, content=b"\0\0" * 160)
                wait_until(lambda: client.get(url + "/metrics", headers=headers).json()["frames_generated"] == 1)
                response = client.get(url + "/frame", headers=headers)
                self.assertEqual(response.content, FRAME)
                self.assertEqual(response.headers["x-frame-count"], "1")
                self.assertEqual(client.get(url + "/frame", headers=headers | {"X-ViralFlow-Owner-Id": OTHER}).status_code, 404)
                with patch.dict(os.environ, {"NODE_ENV": "production"}):
                    self.assertEqual(client.get(url + "/frame", headers=headers).status_code, 404)
                client.post(url + "/stop", headers=headers)


if __name__ == "__main__":
    unittest.main()
