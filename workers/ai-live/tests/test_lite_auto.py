"""LIVE Lite Auto: prepared presenter, routed brain, director, voice and destination gate.

The synthetic pack and espeak-free fake transports here are unit-test
boundaries; they are never represented as a customer presenter or voice.
"""
from __future__ import annotations

import io
import json
import math
import queue
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import unittest.mock
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from av_encoder import EncoderConfig
from cloud_tts import (AzureSpeechBackend, WindowsOneCoreBackend, CloudTTSError, FreeTierGuard, SpeechProvider, UsageMeter,
                       backend_from_env)
from lite_audio_features import FrameFeatureExtractor, OpennessTracker
from lite_brain import CLARIFY_SPOKEN, UNKNOWN_SPOKEN, LiteRoutedBrain, NoLLMRuntime, similarity
from lite_destination import LiteDestinationProvider, classify
from lite_director import LiteShowDirector, product_script
from lite_pack_builder import build_synthetic
from lite_presenter_engine import LitePresenterEngine
from lite_presenter_pack import PresenterPackError, load_pack
from direct_stream import StreamError
from local_brain import BrainRequest, BrainScope, InMemoryProductStore, LocalBrainProvider, ProductSnapshot

SCOPE = BrainScope("owner", "account", "room")
FACTS = {"price": 299, "currency": "THB", "colors": ["ดำ", "ขาว"],
         "attributes": {"วัสดุ": "สแตนเลสค่ะ"},
         "faq": {"ใส่น้ำร้อนได้ไหม": "ใส่น้ำร้อนได้ค่ะ", "ล้างเครื่องล้างจานได้ไหม": "ล้างมือดีกว่าค่ะ"}}


def tone(seconds: float, amplitude: float = 0.3) -> bytes:
    t = np.arange(int(16000 * seconds)) / 16000
    return (np.sin(2 * math.pi * 220 * t) * amplitude * 32767).astype("<i2").tobytes()


class AudioFeatureTests(unittest.TestCase):
    def test_features_align_to_frames_without_dropping_samples(self):
        extractor = FrameFeatureExtractor(25)
        features = extractor.push(tone(0.3)) + extractor.push(tone(0.7))
        self.assertEqual(len(features), 25)
        self.assertTrue(all(feature.voiced for feature in features))

    def test_openness_rises_with_speech_and_falls_in_silence(self):
        extractor, tracker = FrameFeatureExtractor(25), OpennessTracker()
        speaking = [tracker.update(f) for f in extractor.push(tone(0.4))]
        silent = [tracker.update(f) for f in extractor.push(bytes(16000))]
        self.assertGreater(max(speaking), 0.5)
        self.assertLess(silent[-1], 0.05)


class PresenterPackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.pack = build_synthetic(Path(self.temp.name) / "pack", frames=12, output_size=(256, 448))

    def tearDown(self):
        self.temp.cleanup()

    def test_tampered_frame_is_rejected(self):
        frame = self.pack.root / self.pack.frames[0].file
        frame.write_bytes(frame.read_bytes() + b"x")
        with self.assertRaises(PresenterPackError) as caught:
            load_pack(self.pack.root)
        self.assertEqual(caught.exception.code, "LITE_PACK_HASH_MISMATCH")

    def test_real_likeness_requires_consent(self):
        manifest = json.loads((self.pack.root / "manifest.json").read_text(encoding="utf-8"))
        manifest.update(source="RECORDED_VIDEO", technical_test_only=False, consent=None)
        (self.pack.root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaises(PresenterPackError) as caught:
            load_pack(self.pack.root)
        self.assertEqual(caught.exception.code, "LITE_PACK_CONSENT_REQUIRED")

    def test_synthetic_character_needs_licensed_provenance(self):
        from lite_presenter_pack import list_packs
        manifest = json.loads((self.pack.root / "manifest.json").read_text(encoding="utf-8"))
        manifest.update(source="SYNTHETIC_CHARACTER", technical_test_only=False, display_name="นารา",
                        default_voice="th-TH-PremwadeeNeural",
                        provenance={"synthetic_person": True, "generator": "stable-diffusion.cpp",
                                    "model": "some-non-commercial-model", "license": "CC-BY-NC-4.0", "seed": 1})
        (self.pack.root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaises(PresenterPackError) as caught:
            load_pack(self.pack.root)
        self.assertEqual(caught.exception.code, "LITE_PACK_PROVENANCE_REQUIRED")
        manifest["provenance"].update(model="FLUX.1-schnell", license="Apache-2.0")
        (self.pack.root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        pack = load_pack(self.pack.root)
        self.assertEqual((pack.source, pack.technical_test_only, pack.default_voice),
                         ("SYNTHETIC_CHARACTER", False, "th-TH-PremwadeeNeural"))
        listed = list_packs(self.pack.root.parent)
        self.assertEqual([(item["name"], item["defaultVoice"]) for item in listed], [("นารา", "th-TH-PremwadeeNeural")])

    def test_technical_pack_needs_explicit_opt_in(self):
        engine = LitePresenterEngine(self.pack.root)
        with self.assertRaises(PresenterPackError):
            engine.prepare(self.pack.reference_path, 25)

    def test_reference_must_match_pack(self):
        other = Path(self.temp.name) / "other.jpg"
        other.write_bytes(self.pack.reference_path.read_bytes() + b"\0")
        engine = LitePresenterEngine(self.pack.root, allow_technical_test=True)
        with self.assertRaises(PresenterPackError) as caught:
            engine.prepare(other, 25)
        self.assertEqual(caught.exception.code, "LITE_PACK_REFERENCE_MISMATCH")

    def test_speech_yields_paced_jpeg_frames_and_idle_keeps_moving(self):
        engine = LitePresenterEngine(self.pack.root, allow_technical_test=True)
        engine.prepare(self.pack.reference_path, 25)
        started = time.monotonic()
        frames = list(engine.render_pcm16_chunk(tone(0.4)))
        elapsed = time.monotonic() - started
        self.assertEqual(len(frames), 10)
        self.assertTrue(all(f.startswith(b"\xff\xd8") and f.endswith(b"\xff\xd9") for f in frames))
        self.assertGreater(elapsed, 0.3)  # paced to the audio clock, not dumped at once
        idle = list(engine.render_idle(0.12))
        self.assertGreaterEqual(len(idle), 2)
        metrics = engine.metrics()
        self.assertEqual(metrics["technical_test_only"], True)
        self.assertLess(metrics["compose_p95_ms"], 40)
        engine.close()

    def test_interrupt_stops_speech_frames(self):
        engine = LitePresenterEngine(self.pack.root, allow_technical_test=True)
        engine.prepare(self.pack.reference_path, 25)
        frames = engine.render_pcm16_chunk(tone(1.0))
        next(frames)
        engine.interrupt()
        self.assertLess(len(list(frames)), 5)
        engine.close()


def store_with(facts=FACTS) -> InMemoryProductStore:
    store = InMemoryProductStore()
    store.put(ProductSnapshot(SCOPE, "p1", "กระบอกน้ำ", "v1", facts))
    return store


class LiteBrainTests(unittest.TestCase):
    def setUp(self):
        self.brain = LiteRoutedBrain(LocalBrainProvider(NoLLMRuntime(), store_with()))

    def ask(self, text):
        return self.brain.generate(BrainRequest(SCOPE, text, "p1"))

    def test_pro_template_answer_is_kept(self):
        self.assertEqual(self.ask("ราคาเท่าไหร่").source, "authoritative_product")

    def test_paraphrased_question_routes_to_stored_fact(self):
        answer = self.ask("ใส่น้ำร้อนได้มั้ยคะ")
        self.assertEqual((answer.text, answer.source), ("ใส่น้ำร้อนได้ค่ะ", "lite_routed_fact"))

    def test_unmarked_question_routes_only_on_strong_match(self):
        self.assertEqual(self.ask("เข้าเครื่องล้างจานได้ป่าว").text, "ล้างมือดีกว่าค่ะ")
        self.assertEqual(self.ask("ขอบคุณนะ").source, "guarded_template")

    def test_missing_fact_is_never_invented(self):
        answer = self.ask("กันกระแทกไหม")
        self.assertEqual((answer.text, answer.source), (UNKNOWN_SPOKEN, "guarded_unknown"))

    def test_llm_router_can_only_pick_a_listed_fact(self):
        class Picker(NoLLMRuntime):
            def __init__(self, text):
                self.text = text
            def generate(self, messages, **kwargs):
                return type("G", (), {"text": self.text, "first_token_ms": None,
                                      "tokens_per_second": None, "completion_tokens": 1})()
        for reply, expected in (("1", "ใส่น้ำร้อนได้ค่ะ"), ("ราคา 10 บาท", UNKNOWN_SPOKEN), ("9", UNKNOWN_SPOKEN)):
            brain = LiteRoutedBrain(LocalBrainProvider(Picker(reply), store_with()))
            facts = brain._candidates(BrainRequest(SCOPE, "x", "p1"))
            index = [answer for _key, answer in facts].index("ใส่น้ำร้อนได้ค่ะ") + 1
            if reply == "1":
                brain.base.runtime.text = str(index)
            self.assertEqual(brain.generate(BrainRequest(SCOPE, "เก็บอุณหภูมิตอนเติมของร้อนได้ไหม", "p1")).text,
                             expected)

    def test_one_gram_keys_do_not_match(self):
        self.assertEqual(similarity("มีสีอะไร", "สี"), 0.0)


class MultiSkuTests(unittest.TestCase):
    def setUp(self):
        store = store_with()
        store.put(ProductSnapshot(SCOPE, "p2", "ผ้าขนหนูคอตตอนเซ็ตสามผืน", "v1",
                                  {"price": 390, "currency": "THB", "faq": {"ผ้าเป็นขุยไหม": "มีขุยนิดหน่อยค่ะ"}}))
        store.put(ProductSnapshot(SCOPE, "p3", "ผ้าขนหนูไมโครไฟเบอร์", "v1", {"price": 150, "currency": "THB"}))
        store.put(ProductSnapshot(BrainScope("other", "account", "room"), "x", "ผ้าขนหนูของคนอื่น", "v1",
                                  {"price": 1, "currency": "THB"}))
        self.store = store
        self.brain = LiteRoutedBrain(LocalBrainProvider(NoLLMRuntime(), store))

    def ask(self, text):
        return self.brain.generate(BrainRequest(SCOPE, text, "p1"))

    def test_presented_product_stays_the_default(self):
        self.assertEqual(self.ask("ราคาเท่าไหร่").text, "ราคาสินค้าตอนนี้ 299 บาทค่ะ")

    def test_named_other_sku_is_answered_from_its_own_snapshot(self):
        answer = self.ask("ไมโครไฟเบอร์ราคาเท่าไหร่")
        self.assertEqual(answer.text, "สำหรับผ้าขนหนูไมโครไฟเบอร์ ราคาสินค้าตอนนี้ 150 บาทค่ะ")

    def test_fact_of_other_sku_is_found_without_its_name(self):
        self.assertIn("มีขุยนิดหน่อยค่ะ", self.ask("ผ้าเป็นขุยมั้ย").text)

    def test_ambiguous_product_gets_a_question_not_a_guess(self):
        self.assertEqual(self.ask("ผ้าขนหนูราคาเท่าไหร่").text, CLARIFY_SPOKEN)

    def test_short_accidental_thai_overlap_does_not_switch_product(self):
        self.store.put(ProductSnapshot(SCOPE, "p4", "โคมไฟตั้งโต๊ะ LED พับได้", "v1", {"price": 459, "currency": "THB"}))
        self.assertNotIn("โคมไฟ", self.ask("ซื้อสองใบได้ส่วนลดไหม").text)
        self.assertIn("459", self.ask("โคมไฟราคาเท่าไหร่").text)

    def test_other_owners_products_are_never_searched(self):
        self.assertNotIn("x", [p.product_id for p in self.brain._scope_products(SCOPE)])


class FakeSession:
    def __init__(self):
        self.scope, self.product_ids = SCOPE, ("p1",)
        self.product_store = store_with()
        self.current_product_id = "p1"
        self.speaking = False
        self.queued = []

    def snapshot(self):
        return {"paused": False, "comment_queue_depth": 0, "speech_queue_depth": 0}

    def queue_speech(self, key, text, *, priority, product_id):
        self.queued.append((key, text, priority, product_id))
        return True


class DirectorTests(unittest.TestCase):
    def test_script_uses_only_present_facts(self):
        lines = product_script("กระบอกน้ำ", {"price": 299, "currency": "THB"})
        self.assertIn("ราคาตอนนี้ 299 บาทค่ะ", lines)
        self.assertFalse(any("ส่ง" in line and "ฟรี" in line for line in lines))

    def test_director_queues_low_priority_lines_when_quiet(self):
        now = [0.0]
        session = FakeSession()
        director = LiteShowDirector(session, idle_gap_seconds=0.5, clock=lambda: now[0])
        self.assertFalse(director.step())
        now[0] = 1.0
        self.assertTrue(director.step())
        key, text, priority, product = session.queued[0]
        self.assertEqual((priority, product), (10, "p1"))
        session.speaking = True
        now[0] = 5.0
        self.assertFalse(director.step())


class Response:
    def __init__(self, body: bytes):
        self._body = io.BytesIO(body)
    def read(self, size=-1):
        return self._body.read(size)
    def close(self):
        pass


class SpeechTests(unittest.TestCase):
    def test_cloud_voice_fails_closed_without_key(self):
        with tempfile.TemporaryDirectory() as temp:
            with unittest.mock.patch.dict("os.environ", {"AI_LIVE_LITE_TTS": "azure", "LOCALAPPDATA": temp,
                                                         "AZURE_SPEECH_KEY": "k" * 32}):
                with self.assertRaises(CloudTTSError) as caught:
                    backend_from_env()  # an env key is ignored; only the encrypted store counts
        self.assertEqual(caught.exception.code, "TTS_KEY_NOT_CONFIGURED")
        with unittest.mock.patch.dict("os.environ", {"AI_LIVE_LITE_TTS": ""}):
            with self.assertRaises(CloudTTSError):
                backend_from_env()

    def test_azure_streams_pcm_and_meters_characters(self):
        seen = []
        def transport(request, timeout):
            seen.append(request)
            return Response(tone(0.5))
        meter = UsageMeter("azure-speech", price_usd_per_million=16.0, free_characters=0)
        backend = AzureSpeechBackend(key="k" * 32, region="southeastasia", transport=transport, meter=meter)
        provider = SpeechProvider(backend, context_id="c")
        self.assertTrue(provider.warmup()["ready"])
        pcm = b"".join(chunk.pcm16 for chunk in provider.stream_text("ราคา 299 บาทค่ะ", "u1"))
        self.assertEqual(len(pcm), 16000)
        self.assertIn(b"th-TH-PremwadeeNeural", seen[-1].data)
        self.assertEqual(seen[-1].get_header("X-microsoft-outputformat"), "raw-16khz-16bit-mono-pcm")
        usage = provider.usage()
        self.assertGreater(usage["characters"], 0)
        self.assertEqual(usage["cost_basis"], "OWNER_CONFIGURED_PRICE")
        health = provider.health()
        self.assertEqual((health["local"], health["requires_api_key"]), (False, True))

    def test_auth_failure_is_reported_not_substituted(self):
        def transport(request, timeout):
            raise urllib.error.HTTPError(request.full_url, 401, "no", {}, None)
        backend = AzureSpeechBackend(key="k" * 32, region="southeastasia", transport=transport,
                                     meter=UsageMeter("azure-speech"))
        provider = SpeechProvider(backend, context_id="c")
        self.assertFalse(provider.warmup()["ready"])


class FreeTierGuardTests(unittest.TestCase):
    def test_monthly_cap_refuses_before_any_request(self):
        with tempfile.TemporaryDirectory() as temp:
            guard = FreeTierGuard(Path(temp), monthly_characters=20)
            guard.admit(15, threading.Event())
            with self.assertRaises(CloudTTSError) as caught:
                guard.admit(10, threading.Event())
            self.assertEqual(caught.exception.code, "TTS_FREE_TIER_BUDGET_REACHED")
            self.assertEqual(FreeTierGuard(Path(temp), monthly_characters=20).used(), 15)  # persisted

    def test_cap_cannot_exceed_the_free_allowance(self):
        with self.assertRaises(CloudTTSError):
            FreeTierGuard(None, monthly_characters=10_000_000)

    def test_per_minute_limit_waits_instead_of_failing(self):
        now = [1000.0]
        guard = FreeTierGuard(None, requests_per_minute=2, clock=lambda: now[0])
        stop = threading.Event()
        guard.admit(1, stop)
        guard.admit(1, stop)
        original = stop.wait
        def advance(seconds):
            now[0] += seconds
            return False
        stop.wait = advance
        guard.admit(1, stop)
        self.assertGreaterEqual(now[0], 1060)
        stop.wait = original

    def test_azure_backend_is_refused_by_the_guard(self):
        calls = []
        backend = AzureSpeechBackend(key="k" * 32, region="southeastasia",
                                     transport=lambda request, timeout: calls.append(1) or Response(tone(0.1)),
                                     meter=UsageMeter("azure-speech"), guard=FreeTierGuard(None, monthly_characters=1))
        with self.assertRaises(CloudTTSError):
            list(backend.stream_sentence("ยาวเกินงบ", threading.Event()))
        self.assertEqual(calls, [])


class SpeechKeyStoreTests(unittest.TestCase):
    def test_key_is_encrypted_at_rest_and_metadata_never_contains_it(self):
        from local_agent.speech_credentials import SpeechKeyStore
        class Xor:
            def protect(self, data): return bytes(b ^ 0x5A for b in data)
            unprotect = protect
        with tempfile.TemporaryDirectory() as temp:
            store = SpeechKeyStore(Path(temp), protector=Xor())
            key = "A1b2" * 12
            store.put("azure", key, "southeastasia")
            raw = (Path(temp) / "speech-key.bin").read_bytes()
            self.assertNotIn(key.encode(), raw)
            self.assertEqual(store.load()["key"], key)
            self.assertNotIn(key, json.dumps(store.metadata()))
            from local_agent.security import SecurityError
            with self.assertRaises(SecurityError):
                store.put("azure", "short", "southeastasia")
            store.delete()
            self.assertEqual(store.metadata(), {"configured": False})


class FakeOneCoreHost:
    """Stands in for the PowerShell OneCore host: echoes one WAV per request line."""

    def __init__(self, *args, **kwargs):
        import base64, wave
        self.args, self.env = args, kwargs.get("env", {})
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as handle:
            handle.setnchannels(1); handle.setsampwidth(2); handle.setframerate(22050)
            handle.writeframes((np.ones(22050, dtype="<i2") * 1000).tobytes())
        self.wav = base64.b64encode(buffer.getvalue()).decode()
        self.requests = []
        self.lines = queue.Queue()
        self.lines.put("READY Microsoft Pattara\n")
        host = self

        class Stdin:
            def write(self, line):
                host.requests.append(line)
                host.lines.put(f"OK {host.wav}\n")
            def flush(self): pass
            def close(self): pass

        class Stdout:
            def readline(self):
                return host.lines.get(timeout=1)

        self.stdin, self.stdout = Stdin(), Stdout()

    def poll(self): return None
    def wait(self, timeout=None): return 0
    def kill(self): pass


class WindowsVoiceTests(unittest.TestCase):
    def test_onecore_thai_voice_streams_16k_pcm_and_reuses_one_host(self):
        hosts = []
        backend = WindowsOneCoreBackend("Pattara", popen=lambda *a, **k: hosts.append(FakeOneCoreHost(*a, **k)) or hosts[-1])
        for _ in range(2):
            pcm = b"".join(backend.stream_sentence("สวัสดีค่ะ", threading.Event()))
            self.assertEqual(len(pcm), 16000 * 2)  # one second resampled to 16 kHz mono
        self.assertEqual(len(hosts), 1)
        self.assertEqual(hosts[0].env["LITE_ONECORE_VOICE"], "Pattara")
        self.assertEqual(backend.health()["voice"], "Microsoft Pattara")
        self.assertEqual(backend.meter.report()["characters"], 2 * len("สวัสดีค่ะ"))
        self.assertNotIn("api_key", json.dumps(backend.health()))


class SpeechBankTests(unittest.TestCase):
    """Natural pre-rendered voice: every line the room can say is in the bank; misses fail closed."""

    def setUp(self):
        from lite_live_proof import PRODUCTS, QUESTIONS
        import lite_speech_bank as bank
        self.bank, self.questions = bank, QUESTIONS
        self.snapshots = [ProductSnapshot(SCOPE, p["productId"], p["name"], p["version"], p["facts"]) for p in PRODUCTS]
        self.store = InMemoryProductStore()
        for snapshot in self.snapshots:
            self.store.put(snapshot)

    def test_bank_covers_every_answer_and_script_line(self):
        sentences = set(self.bank.bank_sentences(self.bank.product_utterances(self.snapshots)))
        brain = LiteRoutedBrain(LocalBrainProvider(NoLLMRuntime(), self.store))
        spoken = [brain.generate(BrainRequest(SCOPE, question, product.product_id)).text
                  for product in self.snapshots for question in self.questions]
        spoken += [line for product in self.snapshots for line in product_script(product.name, product.facts)]
        missing = {s for text in spoken for s in self.bank.spoken_sentences(text)} - sentences
        self.assertEqual(missing, set())

    def test_bank_follows_the_session_split_then_provider_normalize_path(self):
        from thai_speech import normalize_thai_speech, sentence_chunks
        text = "ตอนนี้มาดู กระบอกน้ำเก็บความเย็น 600 มล. กันนะคะ"
        session_path = [s for raw in sentence_chunks(text) for s in sentence_chunks(normalize_thai_speech(raw))]
        self.assertEqual(list(self.bank.spoken_sentences(text)), session_path)
        self.assertGreater(len(session_path), 1)  # the period in "มล." ends a session sentence
        sentences = set(self.bank.bank_sentences(self.bank.product_utterances(self.snapshots)))
        self.assertIn("สวัสดีค่ะ", sentences)  # LIVE Pro's speech warm-up line

    def test_bank_plays_hits_and_fails_closed_on_miss(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / "bank"
            sentences = self.bank.bank_sentences(["ราคาสินค้าตอนนี้ 299 บาทค่ะ"])
            summary = self.bank.build_bank(sentences, lambda s: b"\x01\x00" * 8000, out,
                                           voice={"engine": "fixture"}, log=lambda _l: None)
            self.assertEqual(summary["sentences"], 1)
            # Resuming renders nothing new; a different voice is refused.
            self.assertEqual(self.bank.build_bank(sentences, None, out, voice={"engine": "fixture"},
                                                  log=lambda _l: None)["rendered_now"], 0)
            with self.assertRaises(SystemExit):
                self.bank.build_bank(sentences, None, out, voice={"engine": "other"}, log=lambda _l: None)
            backend = self.bank.SpeechBankBackend(out)
            provider = SpeechProvider(backend, context_id="test")
            pcm = b"".join(chunk.pcm16 for chunk in provider.stream_text("ราคาสินค้าตอนนี้ 299 บาทค่ะ", "u1"))
            self.assertEqual(len(pcm), 16000)
            with self.assertRaises(CloudTTSError):
                list(backend.stream_sentence("ประโยคที่ไม่มีในคลัง", threading.Event()))
            self.assertEqual(provider.usage()["speech_bank"]["misses"], 1)


class DestinationTests(unittest.TestCase):
    def test_loopback_test_server_is_technical_only(self):
        destination = classify("rtmp://127.0.0.1:1935/live")
        self.assertEqual((destination.kind, destination.commercial), ("TECHNICAL_TEST", False))

    def test_tiktok_is_blocked_until_policy_verified(self):
        for url in ("rtmps://push-rtmp-l11-sg01.tiktokcdn.com/game", "rtmp://live.tiktok.com/x"):
            with self.assertRaises(StreamError) as caught:
                classify(url)
            self.assertEqual(caught.exception.code, "TIKTOK_AI_PRESENTER_POLICY_UNVERIFIED")

    def test_public_platform_needs_owner_attestation(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "attest.json"
            with self.assertRaises(StreamError):
                classify("rtmp://a.rtmp.youtube.com/live2", path)
            path.write_text(json.dumps({"platforms": [{"platform": "youtube", "hosts": ["a.rtmp.youtube.com"],
                "ai_presenter_allowed": True, "ai_voice_allowed": True, "evidence": "policy page reviewed",
                "verified_at": "2026-10-18"}]}), encoding="utf-8")
            destination = classify("rtmp://a.rtmp.youtube.com/live2", path)
            self.assertEqual((destination.kind, destination.commercial), ("OWNER_ATTESTED_PLATFORM", True))
            factory = LiteDestinationProvider(path)
            factory("rtmp://127.0.0.1:1935/live", "key")
            self.assertEqual(factory.last.kind, "TECHNICAL_TEST")


class ProCompatibilityTests(unittest.TestCase):
    def test_amd_encoder_is_accepted(self):
        self.assertEqual(EncoderConfig(video_codec="h264_amf").video_codec, "h264_amf")
        with self.assertRaises(ValueError):
            EncoderConfig(video_codec="h264_qsv_typo")

    def test_prepared_engine_forwards_only_optional_lite_hooks(self):
        from local_agent.live_worker import _PreparedEngine
        class Pro:
            def close(self): pass
        class Lite(Pro):
            def render_idle(self, seconds): return iter(())
        self.assertFalse(hasattr(_PreparedEngine(Pro(), "d", 25), "render_idle"))
        self.assertTrue(callable(_PreparedEngine(Lite(), "d", 25).render_idle))
        with self.assertRaises(AttributeError):
            _PreparedEngine(Lite(), "d", 25).anything_else

    def test_worker_core_emits_idle_frames_only_for_engines_that_offer_them(self):
        from worker_core import LiveStore
        jpeg = b"\xff\xd8idle\xff\xd9"
        class Engine:
            def __init__(self): self.idle_calls = 0
            def prepare(self, reference, fps): pass
            def render_pcm16_chunk(self, pcm): return iter(())
            def render_idle(self, seconds):
                self.idle_calls += 1
                time.sleep(0.01)
                yield jpeg
            def close(self): pass
        with tempfile.TemporaryDirectory() as temp:
            store = LiveStore(Path(temp))
            image = build_synthetic(Path(temp) / "p", frames=8, output_size=(64, 64)).reference_path.read_bytes()
            reference = store.save_reference("o", image, "image/jpeg")
            engine = Engine()
            session_id, session = store.start_session("o", reference, 25, engine)
            deadline = time.monotonic() + 2
            while session.frames_generated < 3 and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertGreaterEqual(session.frames_generated, 3)
            self.assertEqual(list(session.latency_samples), [])  # idle frames are not speech latency
            store.stop_session("o", session_id)
            store.close()


if __name__ == "__main__":
    unittest.main()
