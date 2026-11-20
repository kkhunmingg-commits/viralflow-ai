"""Encrypted LIVE configuration ownership and deletion boundaries."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_agent.security import SecurityError
from local_agent.stream_credentials import StreamCredentialStore
from test_device_identity_fixture import FixtureProtector


class StreamCredentialTests(unittest.TestCase):
    def test_encrypted_reload_and_secret_free_browser_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            protector = FixtureProtector()
            store = StreamCredentialStore(root, protector=protector)
            store.put("owner-a", "account-a", "rtmps://publish.example/live", "never-plaintext-key")
            raw = next(root.glob("*.bin")).read_bytes()
            self.assertNotIn(b"never-plaintext-key", raw)
            self.assertNotIn(b"publish.example", raw)
            restored = StreamCredentialStore(root, protector=protector)
            self.assertEqual(restored.load("owner-a", "account-a")["stream_key"], "never-plaintext-key")
            self.assertEqual(restored.metadata("owner-a", "account-a"), {"configured": True, "account_id": "account-a"})
            self.assertFalse(list(root.glob("*.tmp")))

    def test_other_owner_cannot_read_replace_or_delete(self):
        with tempfile.TemporaryDirectory() as directory:
            store = StreamCredentialStore(Path(directory).resolve(), protector=FixtureProtector())
            store.put("owner-a", "account-a", "rtmp://127.0.0.1/live", "fixture")
            for operation in (lambda: store.load("owner-b", "account-a"),
                              lambda: store.metadata("owner-b", "account-a"),
                              lambda: store.put("owner-b", "account-a", "rtmp://127.0.0.1/live", "other"),
                              lambda: store.delete("owner-b", "account-a")):
                with self.assertRaisesRegex(SecurityError, "STREAM_OWNER_MISMATCH"):
                    operation()
            store.delete("owner-a", "account-a")
            self.assertIsNone(store.load("owner-a", "account-a"))

    def test_revoke_clears_only_matching_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            store = StreamCredentialStore(Path(directory).resolve(), protector=FixtureProtector())
            store.put("owner-a", "account-a", "rtmp://127.0.0.1/live", "first")
            store.put("owner-b", "account-b", "rtmp://127.0.0.1/live", "second")
            store.revoke_owner("owner-a")
            self.assertIsNone(store.load("owner-a", "account-a"))
            self.assertIsNotNone(store.load("owner-b", "account-b"))

    @unittest.skipUnless(os.name == "nt", "DPAPI requires Windows")
    def test_real_dpapi_roundtrip_tampering_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            store = StreamCredentialStore(root)
            store.put("owner-a", "account-a", "rtmps://publish.example/live", "user-issued-key")
            self.assertEqual(StreamCredentialStore(root).load("owner-a", "account-a")["stream_key"], "user-issued-key")
            target = next(root.glob("*.bin"))
            self.assertNotIn(b"user-issued-key", target.read_bytes())
            target.write_bytes(b"tampered")
            with self.assertRaises(SecurityError):
                store.load("owner-a", "account-a")


if __name__ == "__main__":
    unittest.main()
