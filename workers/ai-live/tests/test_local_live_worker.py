"""Local adapter ownership/lifecycle checks; inference/network are test doubles."""
from __future__ import annotations

import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_agent.agent import AgentError, REALTIME_VALIDATED, WorkerBoundary
from local_agent.live_worker import LocalWorkerBoundary
from local_agent.security import SecurityError
from local_brain import LocalBrainProvider, PendingLocalBrainRuntime
from local_tts import ManagedLocalTTSProvider, PendingLocalTTSProvider

REFERENCE = bytes.fromhex("ffd8ffc0000b080002000201011100ffd9")


class Credentials:
    def __init__(self, missing=False):
        self.calls = []
        self.missing = missing

    def load(self, owner, account):
        self.calls.append((owner, account))
        if owner != "owner":
            raise SecurityError("STREAM_OWNER_MISMATCH")
        return None if self.missing else {"server_url": "rtmp://unit.invalid/live", "stream_key": "fixture-secret"}


class InferenceFixture:
    def __init__(self):
        self.closed = False

    def prepare(self, path, fps):
        assert path.read_bytes() == REFERENCE and fps == 25
        self.prepare_calls = getattr(self, "prepare_calls", 0) + 1

    def render_pcm16_chunk(self, pcm):
        yield REFERENCE

    def close(self):
        self.closed = True


class ProviderFixture:
    def __init__(self, url, key):
        assert url == "rtmp://unit.invalid/live" and key == "fixture-secret"
        self.status = "IDLE"
        self.reconnects = 0
        self.disposed = False

    def reconnect(self):
        self.reconnects += 1
        self.status = "RECONNECTING"

    def health(self):
        return {"status": self.status, "healthy": self.status == "LIVE", "output_stalled": False}

    def metrics(self):
        return self.health()

    def dispose(self):
        self.status = "STOPPED"
        self.disposed = True


class MediaFixture:
    def __init__(self, output, provider, config):
        self.provider = provider
        self.audio = []
        self.frames = []
        self.status = "READY"
        self.config = config

    def start(self):
        self.status = "RUNNING"
        self.provider.status = "CONNECTING"

    def push_frame(self, jpeg):
        self.frames.append(jpeg)
        self.provider.status = "LIVE"

    def push_audio(self, pcm):
        self.audio.append(pcm)
        return True

    def metrics(self):
        return {"status": self.status}

    def close(self):
        self.status = "STOPPED"
        self.provider.dispose()


class MicrophoneFixture:
    def __init__(self, **settings):
        assert settings["samplerate"] == 16000 and settings["channels"] == 1
        assert settings["dtype"] == "int16" and settings["blocksize"] == 1600
        self.callback = settings["callback"]
        self.started = self.stopped = self.closed = False

    def start(self):
        self.started = True

    def stop(self):
        self.stopped = True

    def close(self):
        self.closed = True


class BrainModelFixture:
    """Only the native local model boundary is substituted, not orchestration."""
    def health(self):
        return {"ready": True}

    def warmup(self, **_kwargs):
        return self.health()

    def close(self):
        pass


class SpeechModelFixture:
    fingerprint = "unit-native-voice"

    def health(self):
        return {"ready": True}

    def stream_sentence(self, text, stop):
        if not stop.is_set():
            yield b"\x01\x00" * 160

    def close(self):
        pass


class WarmupEncoderFixture:
    """Native encoder boundary. Warmup must submit real generated frame/PCM."""
    def __init__(self, config, output):
        self.frame = self.audio = None
        self.started = self.disposed = False

    def start(self):
        self.started = True

    def push_frame(self, frame, timestamp):
        assert self.started and frame == REFERENCE and timestamp == 0
        self.frame = frame

    def push_audio(self, pcm, timestamp):
        assert self.started and pcm and any(pcm) and timestamp == 0
        self.audio = pcm

    def dispose(self):
        self.disposed = True

    def metrics(self):
        return {"error": None, "encoded_bytes": 100 if self.frame and self.audio else 0,
                "audio_encoded": bool(self.audio)}


class LocalLiveWorkerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.reference = self.root / "presenter.jpg"
        self.reference.write_bytes(REFERENCE)

    def worker(self, credentials=None, **kwargs):
        encoder = patch("local_agent.live_worker.InternalAVEncoder", WarmupEncoderFixture)
        encoder.start()
        self.addCleanup(encoder.stop)
        kwargs.setdefault("ai_provider_factory", lambda scope, store:
            (LocalBrainProvider(BrainModelFixture(), store),
             ManagedLocalTTSProvider(SpeechModelFixture(), context_id=scope.room_id)))
        worker = LocalWorkerBoundary(self.root / "worker", credentials or Credentials(),
            engine_factory=InferenceFixture, provider_factory=ProviderFixture,
            stream_factory=MediaFixture, capability_probe=lambda: {"ready": True}, **kwargs)
        self.addCleanup(worker.close)
        return worker

    def start(self, worker, microphone=None):
        self.prepare(worker, "account", ("product",), microphone)
        session_id = worker.start_session("owner", "account", ("product",), self.reference, microphone)
        deadline = time.monotonic() + 2
        while worker.store.get_session("owner", session_id).status == "STARTING" and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(worker.store.get_session("owner", session_id).status, "RUNNING")
        return session_id

    def prepare(self, worker, account, products, microphone=None):
        worker.sync_product_context("owner", account, [{"productId": product, "name": "สินค้าทดสอบ",
            "version": "unit-v1", "facts": {"price": 1290}} for product in products])
        worker.prepare_room("owner", account, products, self.reference, microphone)

    def test_signed_context_updates_only_matching_live_room_and_prepared_room(self):
        worker = self.worker()
        first = self.start(worker)
        self.prepare(worker, "account-b", ("product-b",))
        ai_a = worker._sessions[first].ai
        ai_b = worker._prepared[("owner", "account-b")]["ai"]
        worker.sync_product_context("owner", "account", [{"productId": "product", "name": "สินค้า",
            "version": "unit-v2", "facts": {"price": 990}}])
        self.assertEqual(ai_a.product_store.fetch(ai_a.scope, "product").facts["price"], 990)
        self.assertEqual(ai_b.product_store.fetch(ai_b.scope, "product-b").facts["price"], 1290)
        worker.sync_product_context("owner", "account-b", [{"productId": "product-b", "name": "สินค้า B",
            "version": "unit-v2", "facts": {"price": 100}}])
        self.assertEqual(ai_b.product_store.fetch(ai_b.scope, "product-b").facts["price"], 100)
        with self.assertRaises(AgentError):
            worker.sync_product_context("owner", "account", [{"productId": "different", "name": "อื่น",
                "version": "v1", "facts": {}}])
        self.assertEqual(ai_a.product_store.fetch(ai_a.scope, "product").facts["price"], 990)

    def test_actual_worker_boundary_connects_inputs_pause_resume_stop_and_owner(self):
        worker = self.worker()
        self.assertIsInstance(worker, WorkerBoundary)
        self.assertFalse(REALTIME_VALIDATED)
        session_id = self.start(worker)
        self.assertEqual(worker.customer_stream("owner", session_id)["phase"], "CONNECTING")
        worker.push_audio("owner", session_id, b"\x01\x00" * 1600)
        deadline = time.monotonic() + 1
        while not worker._sessions[session_id].stream.frames and time.monotonic() < deadline:
            time.sleep(0.01)
        record = worker._sessions[session_id]
        self.assertEqual(len(record.stream.audio), 1)
        self.assertEqual(record.stream.frames, [REFERENCE])
        self.assertEqual(worker.preview_frame("owner", session_id), REFERENCE)
        self.assertEqual(worker.customer_stream("owner", session_id), {"phase": "LIVE", "connectionQuality": "GOOD"})
        worker.pause_session("owner", session_id)
        self.assertEqual(worker.push_audio("owner", session_id, b"\x00\x00" * 1600), 0)
        self.assertEqual(len(record.stream.audio), 1)
        self.assertEqual(record.stream.status, "RUNNING", "Pause must preserve the encoder timeline")
        worker.resume_session("owner", session_id)
        worker.push_audio("owner", session_id, b"\x01\x00" * 1600)
        self.assertEqual(len(record.stream.audio), 2)
        for operation in (worker.pause_session, worker.resume_session, worker.stop_session, worker.recover_session, worker.customer_stream):
            with self.assertRaises(AgentError) as caught:
                operation("other-owner", session_id)
            self.assertEqual(caught.exception.code, "SESSION_NOT_FOUND")
        worker.stop_session("owner", session_id)
        worker.stop_session("owner", session_id)
        self.assertEqual(record.stream.status, "STOPPED")
        self.assertTrue(record.provider.disposed)
        self.assertTrue(self.reference.exists(), "Agent owns its original presenter reference")
        self.assertEqual(len(worker.store.references), 0)
        self.assertEqual(worker.customer_stream("owner", session_id)["phase"], "STOPPED")

    def test_transport_credentials_required_before_inference_and_owner_checked(self):
        credentials = Credentials(missing=True)
        worker = self.worker(credentials)
        with self.assertRaises(AgentError) as caught:
            worker.start_session("owner", "account", (), self.reference, None)
        self.assertEqual(caught.exception.code, "TIKTOK_LIVE_TRANSPORT_REQUIRED")
        self.assertEqual(len(worker.store.sessions), 0)
        with self.assertRaises(AgentError) as caught:
            worker.start_session("other-owner", "account", (), self.reference, None)
        self.assertEqual(caught.exception.code, "STREAM_OWNER_MISMATCH")
        self.assertEqual(len(worker.store.references), 0)

    def test_selected_warmup_reuses_actual_engine_and_comment_pcm_path(self):
        worker = self.worker()
        self.prepare(worker, "account", ("product",))
        prepared = worker._prepared[("owner", "account")]
        engine, ai = prepared["engine"], prepared["ai"]
        session_id = worker.start_session("owner", "account", ("product",), self.reference, None)
        record = worker._sessions[session_id]
        self.assertIs(record.ai, ai)
        self.assertIs(record.store.get_session("owner", session_id).engine, engine)
        self.assertEqual(engine.engine.prepare_calls, 1, "Start must reuse selected model/reference warmup")
        deadline = time.monotonic() + 1
        while record.store.get_session("owner", session_id).status != "RUNNING" and time.monotonic() < deadline:
            time.sleep(0.01)
        reply = worker.submit_comment("owner", session_id, {"commentId": "real-comment", "viewerId": "viewer",
            "text": "ราคาเท่าไหร่", "createdAtMs": 1000})
        self.assertEqual(reply, {"accepted": True})
        deadline = time.monotonic() + 1
        while not record.stream.audio and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(record.stream.audio)
        self.assertIn("1,290", worker.session_ai_status("owner", session_id)["currentResponse"])
        for operation in (worker.session_ai_status,):
            with self.assertRaises(AgentError) as caught:
                operation("other-owner", session_id)
            self.assertEqual(caught.exception.code, "SESSION_NOT_FOUND")

    def test_missing_commercial_voice_blocks_selected_warmup_without_native_presenter(self):
        created = []
        def engine():
            created.append(True)
            return InferenceFixture()
        worker = self.worker(ai_provider_factory=lambda scope, store:
            (LocalBrainProvider(BrainModelFixture(), store), PendingLocalTTSProvider()))
        worker._engine_factory = engine
        worker.sync_product_context("owner", "account", [{"productId": "product", "name": "สินค้า", "version": "1", "facts": {}}])
        with self.assertRaises(AgentError) as caught:
            worker.prepare_room("owner", "account", ("product",), self.reference)
        self.assertEqual(caught.exception.code, "LOCAL_TTS_MODEL_PENDING")
        self.assertEqual(created, [], "No presenter or transport can start with a pending voice")
        self.assertEqual(worker._prepared, {})
        self.assertEqual(len(worker.store.sessions), 0)

    def test_missing_local_models_never_silently_enable_live(self):
        worker = self.worker(ai_provider_factory=lambda scope, store:
            (LocalBrainProvider(PendingLocalBrainRuntime(), store), PendingLocalTTSProvider()))
        self.assertFalse(worker.warmup()["ready"])
        self.assertFalse(worker.health()["brain_ready"])
        self.assertFalse(worker.health()["tts_ready"])
        self.assertEqual(len(worker.store.sessions), 0)

    def test_two_accounts_have_distinct_real_room_resources_and_pause_keeps_stream_alive(self):
        worker = self.worker(microphone_factory=MicrophoneFixture)
        first = self.start(worker, "default")
        self.prepare(worker, "account-b", ("product-b",), "default")
        second = worker.start_session("owner", "account-b", ("product-b",), self.reference, "default")
        a, b = worker._sessions[first], worker._sessions[second]
        deadline = time.monotonic() + 2
        while b.store.get_session("owner", second).status == "STARTING" and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(b.store.get_session("owner", second).status, "RUNNING")
        for field in ("store", "provider", "stream", "microphone", "microphone_queue", "microphone_stop"):
            self.assertIsNot(getattr(a, field), getattr(b, field), field)
        self.assertIsNot(a.store.get_session("owner", first).engine, b.store.get_session("owner", second).engine)
        worker.push_audio("owner", first, b"\x01\x00" * 1600)
        worker.push_audio("owner", second, b"\x02\x00" * 1600)
        self.assertEqual(a.stream.audio, [b"\x01\x00" * 1600])
        self.assertEqual(b.stream.audio, [b"\x02\x00" * 1600])
        worker.pause_session("owner", first)
        self.assertEqual(worker.push_audio("owner", first, b"\x03\x00" * 1600), 0)
        self.assertGreaterEqual(worker.push_audio("owner", second, b"\x04\x00" * 1600), 1)
        self.assertEqual(b.stream.audio[-1], b"\x04\x00" * 1600)
        self.assertFalse(b.paused)
        self.assertEqual(a.stream.status, "RUNNING")
        worker.stop_session("owner", first)
        self.assertTrue(a.cleanup_complete and a.provider.disposed)
        self.assertFalse(b.cleanup_complete or b.provider.disposed or b.microphone.closed)
        self.assertEqual(b.product_ids, ("product-b",))
        worker.resume_session("owner", second)
        with self.assertRaises(AgentError) as duplicate:
            worker.start_session("owner", "account-b", (), self.reference, None)
        self.assertEqual(duplicate.exception.code, "SESSION_BUSY")

    def test_watchdog_failure_does_not_stop_or_contaminate_another_room(self):
        worker = self.worker()
        first = self.start(worker)
        self.prepare(worker, "account-b", ("product-b",))
        second = worker.start_session("owner", "account-b", ("product-b",), self.reference, None)
        a, b = worker._sessions[first], worker._sessions[second]
        deadline = time.monotonic() + 2
        while b.store.get_session("owner", second).status == "STARTING" and time.monotonic() < deadline:
            time.sleep(0.01)
        with a.store.get_session("owner", first).lock:
            a.store.get_session("owner", first).inference_active = True
            a.store.get_session("owner", first).inference_started_at = time.monotonic() - 6
        self.assertTrue(worker.session_metrics("owner", first)["presenter_stalled"])
        self.assertFalse(worker.session_metrics("owner", second)["presenter_stalled"])
        a.stream.status = "FAILED"
        self.assertEqual(worker.customer_stream("owner", first)["phase"], "ERROR")
        self.assertNotEqual(worker.customer_stream("owner", second)["phase"], "ERROR")
        self.assertFalse(b.provider.disposed)

    def test_reconnect_is_bounded_and_preserves_same_presenter_and_encoder(self):
        worker = self.worker()
        session_id = self.start(worker)
        record = worker._sessions[session_id]
        stream = record.stream
        engine = worker.store.get_session("owner", session_id).engine
        worker.recover_session("owner", session_id)
        self.assertEqual(record.provider.reconnects, 1)
        self.assertIs(record.stream, stream)
        self.assertIs(worker.store.get_session("owner", session_id).engine, engine)
        self.assertEqual(worker.customer_stream("owner", session_id)["phase"], "RECONNECTING")
        with self.assertRaises(AgentError) as caught:
            worker.recover_session("owner", session_id)
        self.assertEqual(caught.exception.code, "RECOVERY_UNAVAILABLE")

    def test_microphone_bounded_callback_pause_and_cleanup(self):
        worker = self.worker(microphone_factory=MicrophoneFixture)
        session_id = self.start(worker, "default")
        record = worker._sessions[session_id]
        microphone = record.microphone
        self.assertTrue(microphone.started)
        microphone.callback(b"\x00\x00" * 1600, 1600, None, False)
        deadline = time.monotonic() + 1
        while not record.stream.audio and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(len(record.stream.audio), 1)
        worker.pause_session("owner", session_id)
        microphone.callback(b"\x00\x00" * 1600, 1600, None, False)
        self.assertEqual(record.microphone_queue.qsize(), 0)
        self.assertEqual(record.microphone_queue.maxsize, 8)
        worker.stop_session("owner", session_id)
        self.assertTrue(microphone.stopped and microphone.closed)
        self.assertFalse(record.microphone_thread.is_alive())

    def test_health_does_not_open_production_gate_or_claim_nvenc_without_gpu(self):
        with patch.dict("os.environ", {"AI_LIVE_ENCODER": "h264_nvenc"}):
            worker = self.worker()
        self.assertFalse(worker.health()["ready"])
        self.assertFalse(worker.health()["encoder_ready"])
        self.assertFalse(REALTIME_VALIDATED)

    def test_cpu_inference_fps_is_independent_of_continuous_encoder_fps(self):
        class CPUFixture(InferenceFixture):
            def prepare(self, path, fps):
                assert path.read_bytes() == REFERENCE and fps == 2

        with patch.dict("os.environ", {"AI_LIVE_DEV_FALLBACK": "true", "PRESENTER_PROVIDER": "dev_fallback",
                "NODE_ENV": "development", "VERCEL_ENV": "", "AI_LIVE_ENV": "", "APP_ENV": "", "VERCEL": ""}):
            worker = self.worker()
            worker._engine_factory = CPUFixture
            session_id = self.start(worker)
        self.assertEqual(worker.store.get_session("owner", session_id).fps_target, 2)
        self.assertEqual(worker._sessions[session_id].stream.config.fps, 25)

    def test_pending_native_inference_stop_can_retry_without_claiming_released(self):
        entered = threading.Event()
        release = threading.Event()

        class SlowNativeFixture(InferenceFixture):
            def render_pcm16_chunk(self, pcm):
                if not getattr(self, "warmed", False):
                    self.warmed = True
                    yield REFERENCE
                    return
                entered.set()
                release.wait(5)
                yield REFERENCE

            def interrupt(self):
                pass  # Models can finish the current native operation first.

        worker = self.worker(stop_timeout_seconds=0.05)
        worker._engine_factory = SlowNativeFixture
        session_id = self.start(worker)
        worker.push_audio("owner", session_id, b"\x00\x00" * 1600)
        self.assertTrue(entered.wait(1))
        try:
            with self.assertRaises(AgentError) as caught:
                worker.stop_session("owner", session_id)
            self.assertEqual(caught.exception.code, "WORKER_STOP_PENDING")
            self.assertEqual(worker.customer_stream("owner", session_id)["phase"], "STOPPING")
            self.assertFalse(worker.session_metrics("owner", session_id)["resources_released"])
            self.assertEqual(worker._sessions[session_id].stream.status, "STOPPED")
            self.assertTrue(worker._sessions[session_id].provider.disposed)
            self.assertEqual(len(worker.store.references), 1)
        finally:
            release.set()
        worker.store.get_session("owner", session_id).thread.join(timeout=2)
        worker.stop_session("owner", session_id)
        self.assertTrue(worker.session_metrics("owner", session_id)["resources_released"])
        self.assertEqual(len(worker.store.references), 0)

    def test_prepared_renderer_preserves_native_interrupt_for_stop(self):
        entered = threading.Event()
        released = threading.Event()

        class InterruptibleNativeFixture(InferenceFixture):
            def render_pcm16_chunk(self, pcm):
                if not getattr(self, "warmed", False):
                    self.warmed = True
                    yield REFERENCE
                    return
                entered.set()
                released.wait(2)
                yield REFERENCE

            def interrupt(self):
                self.interrupted = True
                released.set()

        worker = self.worker(stop_timeout_seconds=0.5)
        worker._engine_factory = InterruptibleNativeFixture
        session_id = self.start(worker)
        prepared = worker.store.get_session("owner", session_id).engine
        worker.push_audio("owner", session_id, b"\x01\x00" * 1600)
        self.assertTrue(entered.wait(1))
        try:
            worker.stop_session("owner", session_id)
            self.assertTrue(prepared.engine.interrupted)
            self.assertTrue(worker.session_metrics("owner", session_id)["resources_released"])
            self.assertTrue(prepared.engine.closed)
        finally:
            released.set()

    def test_pending_inference_without_frame_progress_degrades_connection_quality(self):
        worker = self.worker()
        session_id = self.start(worker)
        session = worker.store.get_session("owner", session_id)
        worker._sessions[session_id].provider.status = "LIVE"
        with session.lock:
            session.inference_active = True
            session.inference_started_at = time.monotonic() - 6
        self.assertTrue(worker.session_metrics("owner", session_id)["presenter_stalled"])
        self.assertEqual(worker.customer_stream("owner", session_id)["connectionQuality"], "PROBLEM")
        with session.lock:
            session.dev_fallback = True
        self.assertFalse(worker.session_metrics("owner", session_id)["presenter_stalled"])


if __name__ == "__main__":
    unittest.main()
