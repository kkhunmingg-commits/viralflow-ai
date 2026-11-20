from __future__ import annotations

import base64
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_agent.presenter_library import PresenterLibrary
from local_agent.security import SecurityError
from test_device_identity_fixture import FixtureProtector
from test_local_agent import OWNER_A, OWNER_B, ACCOUNT, REFERENCE_JPEG
import test_local_agent_http as http_fixture


class PresenterLibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.protector = FixtureProtector()
        self.root = Path(self.temp.name) / "library"
        self.library = PresenterLibrary(self.root, protector=self.protector)

    def data(self, **patch):
        return {"id": None, "name": "คน LIVE ทดสอบ", "voiceLabel": "เสียงของฉัน", "assignedAccountIds": [ACCOUNT],
                "consentConfirmed": True, "image": base64.b64encode(REFERENCE_JPEG).decode(),
                "mediaType": "image/jpeg", **patch}

    def test_crud_owner_isolation_encrypted_reference_restart(self):
        card = self.library.put(OWNER_A, self.data())
        self.assertEqual(card["status"], "READY")
        self.assertEqual(self.library.list(OWNER_B), [])
        with self.assertRaises(SecurityError):
            self.library.reference(OWNER_B, card["id"])
        on_disk = self.library.target(OWNER_A).read_bytes()
        self.assertNotIn(REFERENCE_JPEG, on_disk)
        self.assertNotIn("คน LIVE ทดสอบ".encode(), on_disk)
        restored = PresenterLibrary(self.root, protector=self.protector)
        self.assertEqual(restored.reference(OWNER_A, card["id"]), (REFERENCE_JPEG, "image/jpeg"))
        updated = restored.put(OWNER_A, self.data(id=card["id"], image=None, mediaType=None, name="แก้ชื่อ"))
        self.assertEqual(updated["name"], "แก้ชื่อ")
        self.assertEqual(len(restored.list(OWNER_A)), 1)
        with self.assertRaises(SecurityError):
            restored.delete(OWNER_B, card["id"])
        restored.delete(OWNER_A, card["id"])
        self.assertEqual(restored.list(OWNER_A), [])

    def test_validation_consent_no_executable_fields_and_corruption(self):
        for patch in ({"consentConfirmed": False}, {"image": "garbage"}, {"id": "../../private"},
                      {"assignedAccountIds": [ACCOUNT, ACCOUNT]}, {"assignedAccountIds": [{}]},
                      {"mediaType": "image/svg+xml"}):
            with self.assertRaises(SecurityError):
                self.library.put(OWNER_A, self.data(**patch))
        with self.assertRaises(SecurityError):
            self.library.put(OWNER_A, self.data(command="run.exe"))
        self.library.put(OWNER_A, self.data())
        self.library.target(OWNER_A).write_bytes(b"corrupt")
        with self.assertRaises(SecurityError):
            self.library.list(OWNER_A)


class PresenterHTTPTests(unittest.TestCase):
    setUp = http_fixture.LoopbackHTTPTests.setUp
    close_server = http_fixture.LoopbackHTTPTests.close_server
    request = http_fixture.LoopbackHTTPTests.request
    pair = http_fixture.LoopbackHTTPTests.pair
    json_body = staticmethod(http_fixture.LoopbackHTTPTests.json_body)
    def test_presenter_api_uses_signed_owner_and_returns_only_customer_metadata(self):
        token = self.pair()
        status, _, data = self.request("GET", "/v1/presenters", token=token)
        self.assertEqual((status, data["presenters"]), (200, []))
        body = {"id": None, "name": "Presenter", "voiceLabel": "My voice", "assignedAccountIds": [ACCOUNT],
                "consentConfirmed": True, "image": base64.b64encode(REFERENCE_JPEG).decode(), "mediaType": "image/jpeg"}
        status, _, saved = self.request("POST", "/v1/presenters", self.json_body(body), token=token,
                                        headers={"Content-Type": "application/json"})
        self.assertEqual(status, 200)
        card = saved["presenter"]
        self.assertNotIn("image", card)
        self.assertNotIn("configuration", card)
        self.assertNotIn("owner", card)
        status, _, _ = self.request("POST", f'/v1/presenters/{card["id"]}/delete', token=token)
        self.assertEqual(status, 200)
        self.clock[0] = 100000
        status, _, _ = self.request("GET", "/v1/presenters", token=token)
        self.assertEqual(status, 401)


if __name__ == "__main__":
    unittest.main()
