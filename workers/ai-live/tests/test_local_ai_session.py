"""Installed scheduler path with only native model/PCM sinks substituted.

Synthetic PCM below is explicitly a unit-test model boundary; it is never
bundled, selected by production or represented as a real commercial voice.
"""
from __future__ import annotations

import socket
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_ai_session import LocalAISession, LocalAIError
from local_brain import BrainScope, InMemoryProductStore, LocalBrainProvider, PendingLocalBrainRuntime
from local_llama_runtime import BrainRuntimeError, LlamaGeneration
from local_tts import ManagedLocalTTSProvider, PendingLocalTTSProvider
from local_agent.resource_manager import LocalResourceManager, LocalAIProfile


class NativeModelBoundary:
    def __init__(self, delay=0):
        self.delay = delay
        self.ready = False
        self.calls = 0

    def warmup(self, **_kwargs):
        self.ready = True
        return self.health()

    def health(self):
        return {"ready": self.ready}

    def generate(self, _messages, *, timeout_seconds, cancel_event=None, **_kwargs):
        self.calls += 1
        until = time.monotonic() + self.delay
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < until:
            if cancel_event and cancel_event.wait(0.002):
                raise BrainRuntimeError("LOCAL_BRAIN_CANCELLED")
            if time.monotonic() >= deadline:
                raise BrainRuntimeError("LOCAL_BRAIN_TIMEOUT")
        return LlamaGeneration("ขอบคุณที่แวะมาคุยกันค่ะ", self.delay * 1000, None, 5, None)

    def close(self):
        self.ready = False


class NativeVoiceBoundary:
    fingerprint = "explicit-unit-test-only-voice"
    def __init__(self, script_seconds=0.01):
        self.script_seconds = script_seconds
        self.started = threading.Event()
        self.calls = []
        self.active = self.maximum_active = 0
        self.closed = False
        self._lock = threading.Lock()

    def stream_sentence(self, text, stop):
        with self._lock:
            self.active += 1
            self.maximum_active = max(self.active, self.maximum_active)
            self.calls.append(text)
        try:
            marker = 3 if "ราคา" in text else 2 if "สคริปต์" in text else 4
            seconds = self.script_seconds if marker == 2 else 0.01
            if marker == 2:
                self.started.set()
            for _ in range(3 if marker == 2 else 1):
                if stop.is_set():
                    return
                yield bytes((marker, 0)) * int(16000 * seconds)
        finally:
            with self._lock:
                self.active -= 1

    def health(self):
        return {"ready": not self.closed}

    def close(self):
        self.closed = True


def wait_until(predicate, seconds=2):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.005)
    return False


class LocalAISessionTests(unittest.TestCase):
    def session(self, *, account="account-a", price=1290, runtime=None, voice=None, pending=False,
                brain_timeout=0.3, pace=False, resources=None):
        scope = BrainScope("owner", account, "room-" + account)
        store = InMemoryProductStore()
        runtime = runtime or NativeModelBoundary()
        voice = voice or NativeVoiceBoundary()
        brain = LocalBrainProvider(runtime, store)
        tts = PendingLocalTTSProvider() if pending else ManagedLocalTTSProvider(voice, context_id=scope.room_id)
        output = []
        session = LocalAISession(scope, brain, tts, store, lambda pcm: output.append(pcm),
            product_ids=("product",), brain_timeout_seconds=brain_timeout, pace_audio=pace,
            resource_manager=resources)
        session.sync_products([{"productId": "product", "name": "สินค้าทดสอบ", "version": "unit-v1", "facts": {"price": price}}])
        self.addCleanup(lambda: session.stop())
        return session, output, runtime, voice

    def comment(self, text, key="comment", viewer="viewer"):
        return {"commentId": key, "viewerId": viewer, "text": text, "createdAtMs": 1000}

    def test_grounded_comment_uses_real_orchestration_and_offline_pcm_boundary(self):
        session, output, native, voice = self.session()
        with patch.object(socket, "create_connection", side_effect=AssertionError("OUTBOUND_AI_FORBIDDEN")):
            self.assertTrue(session.warmup()["ready"])
            session.start()
            self.assertEqual(session.submit_comment(self.comment("ราคาเท่าไหร่")), {"accepted": True})
            self.assertTrue(wait_until(lambda: bool(output)))
        self.assertIn("1,290", session.snapshot()["currentResponse"])
        self.assertEqual(native.calls, 0, "Database/template intent must not invoke the model")
        self.assertTrue(all(len(pcm) <= 32000 and len(pcm) % 2 == 0 for pcm in output))
        self.assertEqual(voice.maximum_active, 1)
        self.assertEqual(session.snapshot()["replies"], 1)
        self.assertIn("กำลังตอบผู้ชม", session.snapshot()["activity"])

    def test_dead_provider_invalidates_prepared_readiness_and_start(self):
        for provider in ("brain", "voice"):
            with self.subTest(provider=provider):
                session, _output, native, voice = self.session()
                self.assertTrue(session.warmup()["ready"])
                if provider == "brain": native.ready = False
                else: voice.closed = True
                self.assertFalse(session.health()["ready"])
                self.assertFalse(session.health()["warmup_passed"])
                with self.assertRaises(LocalAIError):
                    session.start()

    def test_changed_signed_snapshot_replaces_live_price_cache_and_product_speech(self):
        session, _output, native, _voice = self.session()
        session.warmup(); session.start()
        session.submit_comment(self.comment("ราคาเท่าไหร่", "old-price", "old-viewer"))
        self.assertTrue(wait_until(lambda: "1,290" in (session.snapshot()["currentResponse"] or "")))
        session.pause()
        session.queue_speech("stale-price-script", "ราคา 1,290 บาท", product_id="product")
        session.sync_products([{"productId": "product", "name": "สินค้าทดสอบ", "version": "unit-v2", "facts": {"price": 990}}])
        self.assertEqual(session.snapshot()["speech_queue_depth"], 0)
        session.resume()
        session.submit_comment(self.comment("ราคาเท่าไหร่", "new-price", "new-viewer"))
        self.assertTrue(wait_until(lambda: "990" in (session.snapshot()["currentResponse"] or "")))
        self.assertEqual(native.calls, 0)
        with self.assertRaises(LocalAIError):
            session.sync_products([{"productId": "other-product", "name": "อื่น", "version": "v1", "facts": {}}])

    def test_pending_voice_never_starts_or_produces_fake_audio(self):
        session, output, _native, _voice = self.session(pending=True)
        health = session.warmup()
        self.assertFalse(health["ready"])
        self.assertTrue(health["brain_ready"])
        self.assertFalse(health["tts_ready"])
        self.assertEqual(health["code"], "LOCAL_TTS_MODEL_PENDING")
        with self.assertRaises(LocalAIError) as caught:
            session.start()
        self.assertEqual(caught.exception.code, "LOCAL_TTS_MODEL_PENDING")
        self.assertEqual(output, [])

    def test_general_comment_uses_local_model_and_voice_with_outbound_blocked(self):
        session, output, native, voice = self.session()
        with patch.object(socket, "create_connection", side_effect=AssertionError("OUTBOUND_AI_FORBIDDEN")):
            self.assertTrue(session.warmup()["ready"])
            session.start()
            session.submit_comment(self.comment("ขอบคุณที่มาไลฟ์วันนี้"))
            self.assertTrue(wait_until(lambda: bool(output)))
        self.assertEqual(native.calls, 1)
        self.assertEqual(session.snapshot()["currentResponse"], "ขอบคุณที่แวะมาคุยกันค่ะ")
        self.assertIn("ขอบคุณที่แวะมาคุยกันค่ะ", voice.calls)
        self.assertEqual(session.snapshot()["replies"], 1)
        self.assertEqual(session.safety.metrics()["fallback_activations"], 0)
        self.assertEqual(voice.maximum_active, 1)

    def test_pending_brain_does_not_silently_use_template_only_as_ready(self):
        session, output, _native, _voice = self.session(runtime=PendingLocalBrainRuntime())
        self.assertFalse(session.warmup()["ready"])
        with self.assertRaises(LocalAIError):
            session.start()
        self.assertEqual(output, [])

    def test_priority_interrupts_script_then_resumes_without_voice_overlap(self):
        backend = NativeVoiceBoundary(script_seconds=0.05)
        session, output, _native, voice = self.session(voice=backend, pace=True)
        session.warmup(); session.start()
        self.assertTrue(session.queue_speech("script", "สคริปต์ประโยคแรก. สคริปต์ประโยคต่อไป."))
        self.assertTrue(backend.started.wait(1))
        self.assertTrue(wait_until(lambda: bool(output)))
        session.submit_comment(self.comment("ราคาเท่าไหร่"))
        self.assertTrue(wait_until(lambda: session.snapshot()["replies"] == 1))
        self.assertTrue(wait_until(lambda: len([text for text in backend.calls if "สคริปต์" in text]) >= 3))
        self.assertEqual(voice.maximum_active, 1)
        markers = [pcm[0] for pcm in output]
        self.assertIn(3, markers)
        self.assertIn(2, markers[markers.index(3) + 1:], "The interrupted sales script resumes after the answer")
        self.assertFalse(session.queue_speech("script", "duplicate"))

    def test_pause_keeps_session_and_queues_comments_until_resume(self):
        session, output, _native, _voice = self.session()
        session.warmup(); session.start(); session.pause()
        session.submit_comment(self.comment("ราคาเท่าไหร่"))
        time.sleep(0.03)
        self.assertEqual(output, [])
        self.assertEqual(session.snapshot()["comment_queue_depth"], 1)
        session.resume()
        self.assertTrue(wait_until(lambda: bool(output)))
        self.assertEqual(session.snapshot()["currentResponse"], "ราคาสินค้าตอนนี้ 1,290 บาทค่ะ")

    def test_timeout_uses_only_prepared_real_voice_and_records_no_invented_reply(self):
        session, output, _native, _voice = self.session(runtime=NativeModelBoundary(delay=0.3), brain_timeout=0.03)
        session.warmup(); session.start()
        session.submit_comment(self.comment("ขอบคุณที่มาไลฟ์วันนี้"))
        self.assertTrue(wait_until(lambda: bool(output)))
        self.assertIsNone(session.snapshot()["currentResponse"])
        self.assertEqual(session.snapshot()["replies"], 0)
        self.assertEqual(session.safety.metrics()["fallback_activations"], 1)
        self.assertTrue(all(pcm[0] == 4 for pcm in output))

    def test_no_prepared_filler_means_honest_silence_after_timeout(self):
        session, output, _native, _voice = self.session(runtime=NativeModelBoundary(delay=0.3), brain_timeout=0.03)
        session.warmup(); session.safety.clear(); session.start()
        session.submit_comment(self.comment("ขอบคุณที่มาไลฟ์วันนี้"))
        self.assertTrue(wait_until(lambda: session.snapshot()["lastComment"] is not None))
        time.sleep(0.1)
        self.assertEqual(output, [])
        self.assertIsNone(session.snapshot()["currentResponse"])

    def test_rooms_isolate_products_voice_state_and_stop(self):
        resources = LocalResourceManager(LocalAIProfile("CPU_DEV", 0, 0, 0))
        a, a_pcm, _, a_voice = self.session(account="account-a", price=111, resources=resources)
        b, b_pcm, _, b_voice = self.session(account="account-b", price=222, resources=resources)
        a.warmup(); b.warmup(); a.start(); b.start()
        a.submit_comment(self.comment("ราคาเท่าไหร่", "a"))
        b.submit_comment(self.comment("ราคาเท่าไหร่", "b"))
        self.assertTrue(wait_until(lambda: bool(a_pcm) and bool(b_pcm)))
        self.assertIn("111", a.snapshot()["currentResponse"])
        self.assertIn("222", b.snapshot()["currentResponse"])
        a.pause(); a.stop()
        self.assertFalse(b.snapshot()["paused"])
        self.assertFalse(b_voice.closed)
        self.assertTrue(a_voice.closed)
        self.assertTrue(b.health()["ready"])
        self.assertEqual(resources.metrics()["allocated_vram_mib"], 0)

    def test_dedupe_spam_cooldown_and_queue_are_bounded(self):
        session, _, _, _ = self.session()
        session.warmup(); session.pause(); session.start()
        first = self.comment("ราคาเท่าไหร่")
        self.assertTrue(session.submit_comment(first)["accepted"])
        self.assertEqual(session.submit_comment(first)["reason"], "DUPLICATE")
        self.assertEqual(session.submit_comment(self.comment("hello", "new"))["reason"], "COOLDOWN")
        self.assertEqual(session.submit_comment(self.comment("https://bad.example", "spam", "new-viewer"))["reason"], "SPAM")
        for index in range(200):
            session.submit_comment(self.comment("สวัสดี", f"id-{index}", f"viewer-{index}"))
        self.assertEqual(session.snapshot()["comment_queue_depth"], 100)
        for index in range(200):
            session.queue_speech(f"speech-{index}", "สวัสดี")
        self.assertEqual(session.snapshot()["speech_queue_depth"], 100)

    def test_stuck_native_inference_is_quarantined_and_stop_is_honest(self):
        released = threading.Event()
        class NonCooperativeNative(NativeModelBoundary):
            def generate(self, *_args, **_kwargs):
                self.calls += 1
                released.wait(5)
                return LlamaGeneration("ขอบคุณที่แวะมาคุยกันค่ะ", 0, None, 1, None)
        native = NonCooperativeNative()
        session, _output, _, _ = self.session(runtime=native, brain_timeout=0.02)
        session.warmup(); session.start()
        session.submit_comment(self.comment("ขอบคุณที่มาไลฟ์วันนี้", "first", "first"))
        self.assertTrue(wait_until(lambda: session.snapshot()["readiness"]["code"] == "LOCAL_AI_NATIVE_STOP_PENDING"))
        session.submit_comment(self.comment("ขอบคุณมาก", "second", "second"))
        time.sleep(0.05)
        self.assertEqual(native.calls, 1)
        try:
            with self.assertRaises(LocalAIError) as caught:
                session.stop(timeout_seconds=0.02)
            self.assertEqual(caught.exception.code, "LOCAL_AI_NATIVE_STOP_PENDING")
        finally:
            released.set()
        session.stop(timeout_seconds=1)
        self.assertFalse(session._thread.is_alive())


if __name__ == "__main__":
    unittest.main()
