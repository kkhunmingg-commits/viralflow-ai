from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from local_agent.security import PairingStore, RememberedPairings, SecurityError  # noqa: E402

ORIGIN = "https://viralflow-ai-blond.vercel.app"
OTHER = "http://localhost:3000"


class RememberedPairingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "pairings.json"

    def tearDown(self) -> None:
        self.temp.cleanup()

    def store(self, code: str = "first-code-123") -> PairingStore:
        return PairingStore(code, remembered=RememberedPairings(self.path))

    def test_a_browser_that_paired_once_reconnects_after_a_restart_without_a_code(self) -> None:
        first = self.store()
        first.pair("first-code-123", ORIGIN)
        secret = first.remember(ORIGIN)
        self.assertIsNotNone(secret)
        # The companion restarts with a brand new code nobody has seen.
        restarted = self.store("second-code-456")
        self.assertTrue(restarted.remembers(ORIGIN))
        token, _ = restarted.resume(secret, ORIGIN)
        restarted.authenticate(token, ORIGIN)

    def test_the_file_holds_only_hashes_bound_to_the_origin(self) -> None:
        first = self.store()
        first.pair("first-code-123", ORIGIN)
        secret = first.remember(ORIGIN)
        saved = self.path.read_text(encoding="utf-8")
        self.assertNotIn(secret, saved)
        self.assertEqual([entry["origin"] for entry in json.loads(saved)], [ORIGIN])
        restarted = self.store("second-code-456")
        for wrong_secret, origin in ((secret, OTHER), ("x" * 43, ORIGIN), ("not valid!", ORIGIN)):
            with self.assertRaises(SecurityError) as denied:
                restarted.resume(wrong_secret, origin)
            self.assertEqual(denied.exception.code, "PAIRING_DENIED")

    def test_pairing_again_replaces_the_old_secret_for_that_origin(self) -> None:
        first = self.store()
        first.pair("first-code-123", ORIGIN)
        old = first.remember(ORIGIN)
        second = self.store("second-code-456")
        second.pair("second-code-456", ORIGIN)
        new = second.remember(ORIGIN)
        with self.assertRaises(SecurityError):
            second.resume(old, ORIGIN)
        second.resume(new, ORIGIN)

    def test_without_a_remembered_file_resume_is_refused(self) -> None:
        store = PairingStore("first-code-123")
        self.assertIsNone(store.remember(ORIGIN))
        self.assertFalse(store.remembers(ORIGIN))
        with self.assertRaises(SecurityError):
            store.resume("x" * 43, ORIGIN)


if __name__ == "__main__":
    unittest.main()
