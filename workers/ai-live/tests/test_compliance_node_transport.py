"""Real bundled Node private pipes and Python binding; signers/pack are ephemeral test data."""
from __future__ import annotations

import copy
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

WORKER = Path(__file__).resolve().parents[1]
REPO = WORKER.parents[1]
sys.path.insert(0, str(WORKER))
from compliance_node_transport import ManagedNodeComplianceTransport
from compliance_speech import ComplianceSpeechError, LocalSpeechGate
from local_brain import BrainScope, InMemoryProductStore
from local_ai_session import LocalAISession, _Speech
from local_tts import ManagedLocalTTSProvider


class CompliancePrivatePipeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        node = shutil.which("node")
        if not node:
            raise unittest.SkipTest("Installed Node is needed to build this local pipe regression fixture")
        subprocess.run([node, "scripts/build-compliance-local-bridge.mjs"], cwd=REPO, check=True, timeout=30)
        scratch = REPO / ".ai-live-dev" / "compliance"
        scratch.mkdir(parents=True, exist_ok=True)
        cls.temporary = tempfile.TemporaryDirectory(prefix="pipe-test-", dir=scratch)
        cls.root = Path(cls.temporary.name)
        try:
            subprocess.run([node, "--import", "tsx", "workers/ai-live/tests/create_compliance_bridge_fixture.ts", str(cls.root)],
                           cwd=REPO, check=True, timeout=30, stdout=subprocess.DEVNULL)
        except BaseException:
            cls.temporary.cleanup()
            raise
        cls.fixture = json.loads((cls.root / "fixture.json").read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def setUp(self):
        self.app = self.root / ("app-" + self.id().rsplit(".", 1)[-1])
        shutil.copytree(self.root / "app", self.app)
        self.transport = ManagedNodeComplianceTransport(self.app, self.root / "components", self.fixture["files"])
        self.addCleanup(self.transport.close)
        self.scope = BrainScope(self.fixture["ownerId"], self.fixture["accountId"], "room-pipe")
        self.gate = LocalSpeechGate(self.transport)

    def test_real_signed_context_engine_rewrite_binding_audit_and_cleanup(self):
        self.assertFalse(self.transport.health()["ready"])
        self.transport.sync_context(self.fixture["signedContext"])
        self.assertTrue(self.transport.health()["ready"])
        safe = self.gate.authorize(self.fixture["approved"], self.scope, self.fixture["productId"], "fixture-v1")
        self.assertEqual(safe.text, self.fixture["approved"])
        with self.assertRaisesRegex(ComplianceSpeechError, "REFUSED"):
            self.gate.authorize("รักษาสิวหายขาดแน่นอนใน 3 วัน", self.scope, self.fixture["productId"], "fixture-v1")
        rewritten = self.gate.authorize("ราคา 1 บาท", self.scope, self.fixture["productId"], "fixture-v1")
        self.assertEqual(rewritten.text, self.fixture["approved"])
        audit = self.app / "compliance-audit" / self.fixture["deviceId"] / self.fixture["ownerId"] / self.fixture["accountId"] / "decisions.jsonl"
        raw = audit.read_text(encoding="utf-8")
        records = [json.loads(line) for line in raw.splitlines()]
        self.assertEqual([record["finalStatus"] for record in records], ["PASS", "BLOCK", "PASS"])
        self.assertIn(self.fixture["claimId"], records[0]["claimRefs"])
        self.assertIn(self.fixture["evidenceId"], records[0]["evidenceRefs"])
        self.assertTrue(records[1]["policyRefs"])
        self.assertEqual(records[2]["contentHash"], records[2]["rewrites"][0]["inputHash"])
        self.assertEqual(records[2]["finalContentHash"], records[2]["rewrites"][0]["outputHash"])
        for private_text in (self.fixture["approved"], "ราคา 1 บาท", "รักษาสิว", "Synthetic test label", "shop.example"):
            self.assertNotIn(private_text, raw)
        child = self.transport._process
        self.transport.close()
        self.assertIsNotNone(child.poll())
        self.assertTrue(child.stdin.closed and child.stdout.closed)

    def test_actual_bridge_denies_missing_policy_and_audit_failure(self):
        shutil.rmtree(self.app / "compliance-policy")
        self.transport.sync_context(self.fixture["signedContext"])
        with self.assertRaisesRegex(ComplianceSpeechError, "REFUSED"):
            self.gate.authorize(self.fixture["approved"], self.scope, self.fixture["productId"], "fixture-v1")
        self.transport.close()
        shutil.copytree(self.root / "app" / "compliance-policy", self.app / "compliance-policy")
        # An internal audit path obstructed by a regular file must not release permitted speech.
        shutil.rmtree(self.app / "compliance-audit")
        (self.app / "compliance-audit").write_bytes(b"obstructed")
        transport = ManagedNodeComplianceTransport(self.app, self.root / "components", self.fixture["files"])
        self.addCleanup(transport.close)
        transport.sync_context(self.fixture["signedContext"])
        with self.assertRaisesRegex(ComplianceSpeechError, "REFUSED"):
            LocalSpeechGate(transport).authorize(self.fixture["approved"], self.scope, self.fixture["productId"], "fixture-v1")

    def test_missing_managed_artifact_and_tampered_context_fail_closed(self):
        for name in self.fixture["files"]:
            records = copy.deepcopy(self.fixture["files"])
            records.pop(name)
            with self.assertRaises(ComplianceSpeechError):
                ManagedNodeComplianceTransport(self.app, self.root / "components", records)
        signed = copy.deepcopy(self.fixture["signedContext"])
        signed["payload"]["products"][0]["facts"]["price"] = 99
        with self.assertRaises(ComplianceSpeechError):
            self.transport.sync_context(signed)
        self.assertFalse(self.transport.health()["ready"])
        self.assertTrue(self.transport._closed)

    def test_cancelled_real_transport_never_releases_speech(self):
        self.transport.sync_context(self.fixture["signedContext"])
        cancelled = threading.Event()
        cancelled.set()
        started = time.monotonic()
        with self.assertRaises(ComplianceSpeechError):
            self.gate.authorize(self.fixture["approved"], self.scope, self.fixture["productId"], "fixture-v1", cancel_event=cancelled)
        self.assertLess(time.monotonic() - started, .1)

    def test_completed_startup_write_failure_releases_actual_node(self):
        children = []
        class BrokenPipe:
            def __init__(self, source):
                self.source = source
            def write(self, _value):
                raise OSError("synthetic private-pipe write failure")
            def close(self):
                self.source.close()
        def failed_write(*args, **kwargs):
            child = subprocess.Popen(*args, **kwargs)
            children.append(child)
            child.stdin = BrokenPipe(child.stdin)
            return child
        transport = ManagedNodeComplianceTransport(self.app, self.root / "components", self.fixture["files"], process_factory=failed_write)
        self.addCleanup(transport.close)
        with self.assertRaises(ComplianceSpeechError):
            transport.sync_context(self.fixture["signedContext"])
        self.assertIsNone(transport._process)
        self.assertIsNotNone(children[0].poll())

    def test_stalled_actual_node_startup_is_bounded_and_killed(self):
        children = []
        def stalled_node(args, **kwargs):
            # Substitute only the external process boundary with a silent Node process.
            child = subprocess.Popen([args[0], "-e", "setInterval(() => {}, 1000)"], **kwargs)
            children.append(child)
            return child
        transport = ManagedNodeComplianceTransport(self.app, self.root / "components", self.fixture["files"], process_factory=stalled_node)
        self.addCleanup(transport.close)
        start = time.monotonic()
        with self.assertRaises(ComplianceSpeechError):
            transport._rpc("authorize", {}, .05, threading.Event())
        self.assertLess(time.monotonic() - start, .5)
        self.assertIsNone(transport._process)
        self.assertIsNotNone(children[0].poll())

    def test_actual_session_tts_and_cached_pcm_use_same_signed_authority(self):
        class NativeVoiceFixture:
            fingerprint = "native-voice-boundary-fixture"
            def __init__(self):
                self.sentences = []
            def health(self):
                return {"ready": True}
            def stream_sentence(self, text, _stop):
                self.sentences.append(text)
                yield b"\x01\x00\x02\x00"
                yield b"\x03\x00\x04\x00"
            def close(self):
                pass
        class UnusedBrainFixture:
            def close(self):
                pass
        self.transport.sync_context(self.fixture["signedContext"])
        backend, emitted = NativeVoiceFixture(), []
        voice = ManagedLocalTTSProvider(backend, context_id="actual-pipe-room")
        def output(pcm):
            emitted.append(pcm)
            if revoke:
                for file in (self.app / "compliance-policy").glob("last-good-*.json"):
                    file.write_text('{"disabled":true}', encoding="utf-8")
        session = LocalAISession(self.scope, UnusedBrainFixture(), voice, InMemoryProductStore(), output,
            product_ids=(self.fixture["productId"],), pace_audio=False, compliance_transport=self.transport)
        self.addCleanup(session.stop)
        product = self.fixture["signedContext"]["payload"]["products"][0]
        session.sync_products([{name: product[name] for name in ("productId", "name", "version", "facts")}])
        revoke = False
        with self.assertRaisesRegex(ComplianceSpeechError, "REFUSED"):
            session._speak(_Speech("unsafe", "รักษาสิวหายขาดแน่นอนใน 3 วัน", 50, "SCRIPT", self.fixture["productId"], 0))
        self.assertEqual(backend.sentences, [])
        self.assertEqual(emitted, [])
        session._speak(_Speech("safe", self.fixture["approved"], 50, "SCRIPT", self.fixture["productId"], 1))
        self.assertEqual(backend.sentences, [self.fixture["spokenApproved"]])
        self.assertEqual(len(emitted), 2)
        emitted.clear()
        revoke = True
        with self.assertRaisesRegex(ComplianceSpeechError, "REFUSED"):
            session._speak(_Speech("cached", self.fixture["approved"], 50, "SCRIPT", self.fixture["productId"], 2))
        self.assertEqual(len(emitted), 1)  # Remaining cached PCM is denied after current policy is disabled.
        self.assertEqual(len(backend.sentences), 1)  # The unchanged voice cache was used, never exempted.


if __name__ == "__main__":
    unittest.main()
