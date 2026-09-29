from __future__ import annotations

import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from worker_core import LiveError, LiveStore, MAX_AUDIO_BYTES, MAX_REFERENCE_BYTES  # noqa: E402


OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
JPEG = b"\xff\xd8real-frame\xff\xd9"
REFERENCE_JPEG = bytes.fromhex("ffd8ffc0000b080002000201011100ffd9")


class StreamingEngine:
    def __init__(self):
        self.closed = False

    def prepare(self, reference: Path, fps: int) -> None:
        assert reference.is_file()
        assert fps == 25

    def render_pcm16_chunk(self, audio: bytes):
        assert audio == b"\x00\x00" * 160
        yield JPEG

    def close(self) -> None:
        self.closed = True


class WorkerCoreTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.store = LiveStore(Path(self.temp_dir.name))
        self.addCleanup(self.store.close)
        self.reference = self.store.save_reference(
            OWNER_A, REFERENCE_JPEG, "image/jpeg"
        )

    def wait_for(self, session, status: str) -> None:
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            if session.metrics()["status"] == status:
                return
            time.sleep(0.01)
        self.fail(f"Session did not reach {status}")

    def test_cross_owner_reference_and_session_are_hidden(self):
        with self.assertRaises(LiveError) as context:
            self.store.get_reference(OWNER_B, self.reference)
        self.assertEqual(context.exception.status, 404)
        session_id, session = self.store.start_session(OWNER_A, self.reference, 25, StreamingEngine())
        self.wait_for(session, "RUNNING")
        for action in (
            lambda: self.store.get_session(OWNER_B, session_id),
            lambda: self.store.send_audio(OWNER_B, session_id, b"\x00\x00"),
            lambda: self.store.stop_session(OWNER_B, session_id),
            lambda: next(self.store.frames(OWNER_B, session_id)),
        ):
            with self.assertRaises(LiveError) as denied:
                action()
            self.assertEqual(denied.exception.status, 404)
        self.store.stop_session(OWNER_A, session_id)
        self.wait_for(session, "STOPPED")

    def test_frames_only_arrive_after_incremental_audio(self):
        engine = StreamingEngine()
        session_id, session = self.store.start_session(OWNER_A, self.reference, 25, engine)
        self.wait_for(session, "RUNNING")
        self.assertEqual(session.metrics()["frames_generated"], 0)
        stream = self.store.frames(OWNER_A, session_id)
        # Prime the stream in a separate thread so it subscribes before audio.
        import threading

        received = []
        reader = threading.Thread(target=lambda: received.append(next(stream)))
        reader.start()
        time.sleep(0.02)
        self.store.send_audio(OWNER_A, session_id, b"\x00\x00" * 160)
        reader.join(timeout=2)
        self.assertFalse(reader.is_alive())
        self.assertIn(JPEG, received[0])
        self.assertEqual(session.metrics()["frames_generated"], 1)
        self.assertIsNotNone(session.metrics()["latency_ms"])
        stream.close()
        self.store.stop_session(OWNER_A, session_id)
        self.wait_for(session, "STOPPED")
        self.assertTrue(engine.closed)

    def test_rejects_unbounded_or_misaligned_audio(self):
        session_id, session = self.store.start_session(OWNER_A, self.reference, 25, StreamingEngine())
        self.wait_for(session, "RUNNING")
        for payload in (b"", b"\x00", b"\x00" * (MAX_AUDIO_BYTES + 1)):
            with self.assertRaises(LiveError) as invalid:
                self.store.send_audio(OWNER_A, session_id, payload)
            self.assertEqual(invalid.exception.code, "INVALID_AUDIO_CHUNK")
        self.store.stop_session(OWNER_A, session_id)

    def test_rejects_wrong_image_or_reference_owner(self):
        with self.assertRaises(LiveError):
            self.store.save_reference(OWNER_A, b"not a photo", "image/jpeg")
        with self.assertRaises(LiveError) as denied:
            self.store.start_session(OWNER_B, self.reference, 25, StreamingEngine())
        self.assertEqual(denied.exception.status, 404)

    def test_no_audio_timeout_closes_engine_and_allows_next_session(self):
        store = LiveStore(Path(self.temp_dir.name) / "idle", audio_idle_timeout_seconds=0.05)
        self.addCleanup(store.close)
        reference = store.save_reference(
            OWNER_A, REFERENCE_JPEG, "image/jpeg"
        )
        first_engine = StreamingEngine()
        _, first = store.start_session(OWNER_A, reference, 25, first_engine)
        self.wait_for(first, "STOPPED")
        self.assertEqual(first.metrics()["stop_reason"], "AUDIO_IDLE_TIMEOUT")
        self.assertTrue(first_engine.closed)

        second_id, second = store.start_session(OWNER_A, reference, 25, StreamingEngine())
        self.wait_for(second, "RUNNING")
        store.stop_session(OWNER_A, second_id)
        self.wait_for(second, "STOPPED")

    def test_per_owner_quota_does_not_block_other_owner(self):
        store = LiveStore(
            Path(self.temp_dir.name) / "quota", max_references=2,
            max_references_per_owner=1,
        )
        self.addCleanup(store.close)
        store.save_reference(OWNER_A, REFERENCE_JPEG, "image/jpeg")
        with self.assertRaises(LiveError) as full:
            store.save_reference(OWNER_A, REFERENCE_JPEG, "image/jpeg")
        self.assertEqual(full.exception.code, "REFERENCE_QUOTA_EXCEEDED")
        store.save_reference(OWNER_B, REFERENCE_JPEG, "image/jpeg")

    def test_expired_reference_removed_and_restart_cleans_orphan(self):
        folder = Path(self.temp_dir.name) / "expiration"
        store = LiveStore(folder, reference_ttl_seconds=0.05, janitor_interval_seconds=0.02)
        self.addCleanup(store.close)
        reference_id = store.save_reference(OWNER_A, REFERENCE_JPEG, "image/jpeg")
        path = store.get_reference(OWNER_A, reference_id).path
        deadline = time.monotonic() + 2
        while path.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertFalse(path.exists(), "janitor must delete expired reference")
        with self.assertRaises(LiveError):
            store.get_reference(OWNER_A, reference_id)

        orphan_id = store.save_reference(OWNER_A, REFERENCE_JPEG, "image/jpeg")
        orphan_path = store.get_reference(OWNER_A, orphan_id).path
        store.close()
        restarted = LiveStore(folder)
        self.addCleanup(restarted.close)
        self.assertFalse(orphan_path.exists(), "restart must delete inaccessible UUID files")

    def test_rejects_extreme_image_dimensions(self):
        # 8192 by 8192 dimensions fit in a tiny JPEG header but would decode
        # into an unacceptably large image for model preparation.
        oversized = bytes.fromhex("ffd8ffc0000b082000200001011100ffd9")
        with self.assertRaises(LiveError) as rejected:
            self.store.save_reference(OWNER_A, oversized, "image/jpeg")
        self.assertEqual(rejected.exception.code, "REFERENCE_DIMENSIONS_TOO_LARGE")

    def test_reference_upload_is_bounded_to_four_mib(self):
        oversized = REFERENCE_JPEG[:-2] + b"x" * MAX_REFERENCE_BYTES + b"\xff\xd9"
        with self.assertRaises(LiveError) as rejected:
            self.store.save_reference(OWNER_A, oversized, "image/jpeg")
        self.assertEqual(rejected.exception.status, 413)


if __name__ == "__main__":
    unittest.main()
