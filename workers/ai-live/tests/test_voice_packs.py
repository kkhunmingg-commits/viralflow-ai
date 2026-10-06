from __future__ import annotations
import os
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from voice_packs import RecordingProvenance, VoiceConsent, VoicePackStore
from local_agent.security import SecurityError
from test_device_identity_fixture import FixtureProtector

OWNER = "00000000-0000-4000-8000-000000000001"
OTHER = "00000000-0000-4000-8000-000000000002"
ACCOUNT = "00000000-0000-4000-8000-000000000003"
PRESENTER = "00000000-0000-4000-8000-000000000004"
SPEAKER = "00000000-0000-4000-8000-000000000005"
NOW = 2_000_000_000
REFERENCE = b"\x11\x09" * 48_000  # Unit-test PCM bytes, never a real voice proof.
DOCUMENT = b"unit-test signed speaker permission fixture"


class VoicePackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "voices"
        self.protector = FixtureProtector()
        self.store = VoicePackStore(self.root, protector=self.protector, now=lambda: NOW)
        self.consent = VoiceConsent(SPEAKER, "Test speaker identity", "Test rights holder", OWNER,
                                    "signed-record-1", NOW - 100, ("synthesis", "cloning"), True, True, True)
        self.provenance = RecordingProvenance("studio-session-1", NOW - 200, "Test recorder", "สวัสดีค่ะ")

    def data(self, **patch):
        return dict(name="เสียงทดสอบ", account_ids=(ACCOUNT,), presenter_ids=(PRESENTER,), consent=self.consent,
                    provenance=self.provenance, reference_pcm16=REFERENCE, consent_document=DOCUMENT, **patch)

    def test_encrypted_reference_consent_restart_and_customer_metadata(self):
        card = self.store.put(OWNER, **self.data())
        self.assertEqual(card["status"], "VOICE_PACK_RECORDED")
        self.assertFalse(card["runtime_ready"])
        payload = self.store.target(OWNER).read_bytes()
        for private in (REFERENCE, DOCUMENT, b"Test speaker identity", "เสียงทดสอบ".encode()):
            self.assertNotIn(private, payload)
        restored = VoicePackStore(self.root, protector=self.protector, now=lambda: NOW)
        reference = restored.reference(OWNER, card["id"], account_id=ACCOUNT, presenter_id=PRESENTER)
        self.assertEqual(reference.reference_pcm16, REFERENCE)
        self.assertEqual(reference.speaker_id, SPEAKER)
        for private_field in ("reference", "consent_document", "consent", "speaker_identity"):
            self.assertNotIn(private_field, restored.list(OWNER)[0])

    def test_owner_account_presenter_usage_consent_and_revocation(self):
        card = self.store.put(OWNER, **self.data())
        self.assertEqual(self.store.list(OTHER), [])
        for owner, account, presenter in ((OTHER, ACCOUNT, PRESENTER), (OWNER, OTHER, PRESENTER), (OWNER, ACCOUNT, OTHER)):
            with self.assertRaises(SecurityError):
                self.store.reference(owner, card["id"], account_id=account, presenter_id=presenter)
        with self.assertRaisesRegex(SecurityError, "VOICE_USAGE_NOT_ALLOWED"):
            self.store.reference(OWNER, card["id"], account_id=ACCOUNT, presenter_id=PRESENTER, usage="training")
        self.store.revoke(OWNER, card["id"])
        self.assertEqual(self.store.list(OWNER)[0]["status"], "VOICE_CONSENT_REVOKED")
        with self.assertRaisesRegex(SecurityError, "VOICE_CONSENT_REQUIRED"):
            self.store.reference(OWNER, card["id"], account_id=ACCOUNT, presenter_id=PRESENTER)

    def test_consent_recording_evidence_and_identifiers_are_required(self):
        bad = [dict(consent=replace(self.consent, consent_confirmed=False)),
               dict(consent=replace(self.consent, commercial_allowed=False)),
               dict(consent=replace(self.consent, granted_to_owner=OTHER)),
               dict(consent=replace(self.consent, expires_at=NOW - 1)),
               dict(consent=replace(self.consent, allowed_usage=("impersonation",))),
               dict(account_ids=()), dict(presenter_ids=("../../private",)),
               dict(reference_pcm16=b"\x00\x00" * 48_000), dict(consent_document=b"")]
        for patch_data in bad:
            data = self.data()
            data.update(patch_data)
            with self.subTest(patch=list(patch_data)), self.assertRaises(SecurityError):
                self.store.put(OWNER, **data)
        self.store.put(OWNER, **self.data())
        self.store.target(OWNER).write_bytes(b"corrupt encrypted data")
        with self.assertRaisesRegex(SecurityError, "VOICE_PACK_STORAGE_INVALID"):
            self.store.list(OWNER)

    @unittest.skipUnless(os.name == "nt", "DPAPI requires Windows")
    def test_real_windows_dpapi_envelope_stays_encrypted(self):
        store = VoicePackStore(self.root, now=lambda: NOW)
        card = store.put(OWNER, **self.data())
        self.assertNotIn(DOCUMENT, store.target(OWNER).read_bytes())
        self.assertEqual(VoicePackStore(self.root, now=lambda: NOW).reference(
            OWNER, card["id"], account_id=ACCOUNT, presenter_id=PRESENTER).reference_pcm16, REFERENCE)


if __name__ == "__main__":
    unittest.main()
