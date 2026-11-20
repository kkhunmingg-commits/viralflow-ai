"""Exercise the production signed-context and AI preparation boundaries.

Only the worker is a fixture; these tests do not claim model/GPU readiness.
"""
from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from test_local_agent import (
    ACCOUNT, DEVICE, ORIGIN, OWNER_A, OWNER_B, PRODUCT, REFERENCE_JPEG,
    VERSIONS, AgentError, AgentFixture, Pairing, RecordingWorker, signed,
)


SECOND_PRODUCT = "ffffffff-ffff-4fff-8fff-ffffffffffff"
PRIVATE_DIAGNOSTIC = "fixture-private-token-and-native-stack"


class AIWorkerBoundaryFixture(RecordingWorker):
    """Record already-authorized inputs without constructing local models."""

    def __init__(self) -> None:
        super().__init__()
        self.context_calls: list[tuple[str, str, list[dict]]] = []
        self.preparation_calls: list[tuple[str, str, tuple[str, ...], Path, str | None]] = []
        self.reference_bytes: list[bytes] = []
        self.warmup_calls = 0
        self.preparation_failure: Exception | None = None
        self.sync_failure: Exception | None = None

    def health(self) -> dict[str, object]:
        return {
            "ready": True, "brain_ready": True, "tts_ready": False,
            "presenter_ready": True, "encoder_ready": True, "warmup_passed": False,
            "diagnostics": PRIVATE_DIAGNOSTIC,
            "model_path": r"C:\private\models\secret-model.safetensors",
            "api_key": "fixture-secret-key", "traceback": "native private stack",
        }

    def sync_product_context(self, owner_id: str, account_id: str,
                             products: list[dict]) -> dict[str, str]:
        if self.sync_failure:
            raise self.sync_failure
        self.context_calls.append((owner_id, account_id, copy.deepcopy(products)))
        return {"diagnostics": PRIVATE_DIAGNOSTIC}

    def prepare_room(self, owner_id: str, account_id: str, product_ids: tuple[str, ...],
                     presenter_path: Path, microphone_id: str | None) -> dict[str, str]:
        self.preparation_calls.append((owner_id, account_id, product_ids,
                                       presenter_path, microphone_id))
        self.reference_bytes.append(presenter_path.read_bytes())
        if self.preparation_failure:
            raise self.preparation_failure
        return {"diagnostics": PRIVATE_DIAGNOSTIC}

    def warmup(self) -> dict[str, str]:
        self.warmup_calls += 1
        return {"diagnostics": PRIVATE_DIAGNOSTIC}


class LocalAIAgentTests(AgentFixture):
    def setUp(self) -> None:
        super().setUp()
        self.worker = AIWorkerBoundaryFixture()
        self.agent = self.make_agent(worker=self.worker)
        self.token, self.challenge, self.presenter = self.pair_and_reference(self.agent)
        self.addCleanup(self.finish_warmup)

    def finish_warmup(self) -> None:
        thread = self.agent._ai_warmup_thread
        if thread is not None:
            thread.join(timeout=2)
            self.assertFalse(thread.is_alive(), "fixture AI warmup did not finish")

    def context_payload(self, **changes: object) -> dict[str, object]:
        payload: dict[str, object] = {
            "v": 1, "purpose": "AI_LIVE_PRODUCT_CONTEXT", "ownerId": OWNER_A,
            "deviceId": DEVICE, "accountId": ACCOUNT, "productIds": [PRODUCT],
            "products": [{
                "productId": PRODUCT, "name": "เสื้อสีฟ้า",
                "version": "2026-10-06T00:00:00Z",
                "facts": {"price": 1290, "currency": "THB", "stock": 3,
                          "colors": ["ฟ้า"], "sizes": ["M"]},
            }],
            "issuedAt": 1000, "expiresAt": 1120, "versions": VERSIONS.copy(),
        }
        payload.update(changes)
        return payload

    def selection(self, **changes: object) -> dict[str, object]:
        selection: dict[str, object] = {
            "accountId": ACCOUNT, "productIds": [PRODUCT],
            "presenterId": self.presenter, "microphoneId": None,
        }
        selection.update(changes)
        return selection

    def sync_context(self, **changes: object) -> dict[str, object]:
        return self.agent.sync_product_context(self.token, ORIGIN,
                                               signed(self.context_payload(**changes)))

    def test_signed_context_preserves_authorized_owner_account_products_and_version(self) -> None:
        payload = self.context_payload()
        result = self.agent.sync_product_context(self.token, ORIGIN, signed(payload))
        self.assertEqual(result, {"synced": True})
        self.assertEqual(self.worker.context_calls, [(OWNER_A, ACCOUNT, payload["products"])])
        self.assertEqual(self.agent._product_contexts, {(OWNER_A, ACCOUNT): (1120, (PRODUCT,))})
        self.assertEqual(self.worker.context_calls[0][2][0]["version"], "2026-10-06T00:00:00Z")
        self.assertEqual(self.worker.context_calls[0][2][0]["facts"]["price"], 1290)

    def test_tampered_signed_facts_never_reach_worker(self) -> None:
        envelope = signed(self.context_payload())
        envelope["payload"]["products"][0]["facts"]["price"] = 1
        with self.assertRaises(AgentError) as denied:
            self.agent.sync_product_context(self.token, ORIGIN, envelope)
        self.assertEqual(denied.exception.code, "INVALID_SIGNATURE")
        self.assertEqual(self.worker.context_calls, [])
        self.assertEqual(self.agent._product_contexts, {})

    def test_wrong_owner_device_protocol_version_and_purpose_are_denied(self) -> None:
        for changes in (
            {"ownerId": OWNER_B}, {"deviceId": OWNER_B},
            {"versions": {**VERSIONS, "worker": "9.0.0"}},
            {"purpose": "AI_LIVE_START"}, {"v": True},
            {"modelPath": r"C:\customer\arbitrary-model"},
        ):
            with self.subTest(changes=changes):
                with self.assertRaises(AgentError) as denied:
                    self.sync_context(**changes)
                self.assertEqual(denied.exception.code, "LOCAL_PRODUCT_SCOPE_MISMATCH")
        self.assertEqual(self.worker.context_calls, [])
        self.assertEqual(self.agent._product_contexts, {})

    def test_expired_future_and_overlong_contexts_are_denied(self) -> None:
        for changes in (
            {"issuedAt": 880, "expiresAt": 1000},
            {"issuedAt": 1000, "expiresAt": 1000},
            {"issuedAt": 1031, "expiresAt": 1120},
            {"issuedAt": 999, "expiresAt": 1120},
            {"issuedAt": True}, {"expiresAt": 1120.0},
        ):
            with self.subTest(changes=changes):
                with self.assertRaises(AgentError) as denied:
                    self.sync_context(**changes)
                self.assertEqual(denied.exception.code, "LOCAL_PRODUCT_CONTEXT_INVALID")
        self.assertEqual(self.worker.context_calls, [])
        self.assertEqual(self.sync_context(issuedAt=1030, expiresAt=1150), {"synced": True})

    def test_invalid_account_product_scope_and_duplicate_products_are_denied(self) -> None:
        for changes in (
            {"accountId": "browser-account"}, {"productIds": []},
            {"productIds": [PRODUCT, PRODUCT]},
            {"productIds": [SECOND_PRODUCT]},
            {"products": []},
            {"products": [{"productId": SECOND_PRODUCT, "facts": {"price": 1}}]},
        ):
            with self.subTest(changes=changes):
                with self.assertRaises(AgentError) as denied:
                    self.sync_context(**changes)
                self.assertEqual(denied.exception.code, "LOCAL_PRODUCT_CONTEXT_INVALID")
        self.assertEqual(self.worker.context_calls, [])
        self.assertEqual(self.agent._product_contexts, {})

    def test_browser_facts_and_extra_envelope_fields_are_denied(self) -> None:
        payload = self.context_payload()
        for body in (
            payload, {"accountId": ACCOUNT, "products": payload["products"]},
            {"payload": payload}, {**signed(payload), "facts": {"price": 1}},
        ):
            with self.subTest(fields=set(body)):
                with self.assertRaises(AgentError) as denied:
                    self.agent.sync_product_context(self.token, ORIGIN, body)
                self.assertEqual(denied.exception.code, "INVALID_SIGNED_ENVELOPE")
        self.assertEqual(self.worker.context_calls, [])

    def test_unpaired_or_another_owner_cannot_sync_or_warmup(self) -> None:
        self.agent._pairings._tokens["other-owner-token"] = Pairing(ORIGIN, 1800, OWNER_B)
        for token, code in (("unknown-token", "LOCAL_AUTH_REQUIRED"),
                            ("other-owner-token", "OWNER_NOT_VERIFIED")):
            for operation in ("sync", "warmup"):
                with self.subTest(token=token, operation=operation):
                    with self.assertRaises(AgentError) as denied:
                        if operation == "sync":
                            self.agent.sync_product_context(token, ORIGIN,
                                                            signed(self.context_payload()))
                        else:
                            self.agent.warmup_ai(token, ORIGIN, self.selection())
                    self.assertEqual(denied.exception.code, code)
        self.assertEqual(self.worker.context_calls, [])
        self.assertEqual(self.worker.preparation_calls, [])

    def test_selected_warmup_resolves_only_owned_reference_and_signed_context(self) -> None:
        self.sync_context()
        result = self.agent.warmup_ai(self.token, ORIGIN, self.selection(microphoneId="default"))
        self.finish_warmup()
        self.assertEqual(result, {"preparing": True})
        self.assertEqual(len(self.worker.preparation_calls), 1)
        owner, account, products, reference, microphone = self.worker.preparation_calls[0]
        self.assertEqual((owner, account, products, microphone),
                         (OWNER_A, ACCOUNT, (PRODUCT,), "default"))
        self.assertEqual(reference, self.agent._references[self.presenter].path)
        self.assertEqual(self.worker.reference_bytes, [REFERENCE_JPEG])
        self.assertEqual(self.agent._references[self.presenter].owner_id, OWNER_A)
        self.assertEqual(self.worker.warmup_calls, 0)
        self.assertNotIn(str(reference), json.dumps(result))

    def test_selected_warmup_denies_account_products_reference_or_microphone_changes(self) -> None:
        self.sync_context()
        self.agent._pairings._tokens["other-pairing-token"] = Pairing(ORIGIN, 1800, OWNER_A)
        another_reference = self.agent.upload_reference("other-pairing-token", ORIGIN,
                                                        REFERENCE_JPEG, "image/jpeg")["presenterId"]
        for changes in (
            {"accountId": OWNER_B}, {"productIds": [SECOND_PRODUCT]},
            {"productIds": [PRODUCT, PRODUCT]},
            {"presenterId": "missing-presenter"}, {"presenterId": another_reference},
            {"presenterId": str(self.config.data_dir / "arbitrary.jpg")},
            {"microphoneId": "browser-arbitrary-device"},
        ):
            with self.subTest(changes=changes):
                with self.assertRaises(AgentError) as denied:
                    self.agent.warmup_ai(self.token, ORIGIN, self.selection(**changes))
                self.assertEqual(denied.exception.code, "LOCAL_AI_SELECTION_NOT_ALLOWED")
        self.assertEqual(self.worker.preparation_calls, [])
        self.assertIsNone(self.agent._references[self.presenter].owner_id)
        self.assertIsNone(self.agent._references[another_reference].owner_id)

    def test_selected_warmup_denies_unsigned_facts_and_malformed_selection(self) -> None:
        self.sync_context()
        for selection in (
            {**self.selection(), "products": self.context_payload()["products"]},
            {**self.selection(), "modelPath": r"C:\customer\model"},
            {"accountId": ACCOUNT, "productIds": [PRODUCT]},
            self.selection(productIds=[]), self.selection(productIds=[None]),
        ):
            with self.subTest(selection=selection):
                with self.assertRaises(AgentError) as denied:
                    self.agent.warmup_ai(self.token, ORIGIN, selection)
                self.assertEqual(denied.exception.code, "LOCAL_AI_WARMUP_REQUIRED")
        self.assertEqual(self.worker.preparation_calls, [])

    def test_fresh_signed_context_is_required_for_selected_warmup_and_start(self) -> None:
        for state in ("missing", "expired"):
            with self.subTest(state=state):
                if state == "expired":
                    self.sync_context()
                    self.clock[0] = 1120.0
                with self.assertRaises(AgentError) as warmup:
                    self.agent.warmup_ai(self.token, ORIGIN, self.selection())
                self.assertEqual(warmup.exception.code, "LOCAL_AI_SELECTION_NOT_ALLOWED")
                challenge = str(self.agent.challenge(self.token, ORIGIN)["challenge"])
                body = self.start_body(challenge, issuedAt=int(self.clock[0]),
                                       expiresAt=int(self.clock[0]) + 120)
                with self.assertRaises(AgentError) as start:
                    self.agent.start(self.token, ORIGIN, body)
                self.assertEqual(start.exception.code, "LOCAL_PRODUCT_CONTEXT_REQUIRED")
        self.assertEqual(self.worker.preparation_calls, [])
        self.assertEqual(self.worker.calls, [])
        self.assertEqual(self.sync_context(issuedAt=1120, expiresAt=1240), {"synced": True})
        self.assertEqual(self.agent.warmup_ai(self.token, ORIGIN, self.selection()), {"preparing": True})
        self.finish_warmup()
        self.assertEqual(len(self.worker.preparation_calls), 1)

    def test_customer_responses_hide_native_diagnostics_secrets_and_failed_warmup(self) -> None:
        sync_result = self.sync_context()
        self.worker.preparation_failure = RuntimeError(PRIVATE_DIAGNOSTIC)
        warmup_result = self.agent.warmup_ai(self.token, ORIGIN, self.selection())
        self.finish_warmup()
        status_result = self.agent.status(self.token, ORIGIN)
        self.assertEqual(sync_result, {"synced": True})
        self.assertEqual(warmup_result, {"preparing": True})
        self.assertEqual(status_result["aiReadiness"], {
            "brain": "READY", "voice": "PREPARING", "presenter": "PREPARING", "encoder": "PREPARING",
        })
        public = json.dumps([sync_result, warmup_result, status_result])
        for forbidden in (PRIVATE_DIAGNOSTIC, "fixture-secret-key", "secret-model.safetensors",
                          "model_path", "api_key", "traceback", "native private stack", self.temp.name):
            self.assertNotIn(forbidden, public)
        self.assertFalse(self.agent._ai_warming)

    def test_invalid_worker_context_is_converted_to_customer_safe_error(self) -> None:
        self.worker.sync_failure = TypeError(PRIVATE_DIAGNOSTIC)
        with self.assertRaises(AgentError) as denied:
            self.sync_context()
        self.assertEqual(denied.exception.code, "LOCAL_PRODUCT_CONTEXT_INVALID")
        self.assertNotIn(PRIVATE_DIAGNOSTIC, denied.exception.message)
        self.assertIsNone(denied.exception.__cause__)
        self.assertEqual(self.agent._product_contexts, {})


if __name__ == "__main__":
    unittest.main()
