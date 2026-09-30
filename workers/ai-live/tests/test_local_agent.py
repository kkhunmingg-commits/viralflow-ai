from __future__ import annotations

import base64
import hashlib
import hmac
import json
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from local_agent.agent import (  # noqa: E402
    AgentConfig, AgentError, LocalAgent, LocalEncoder, UnavailableWorker, VERSIONS,
)
from local_agent import MuseTalkLocalPresenter, PresenterProvider  # noqa: E402
from local_agent.bootstrap import BootstrapManager  # noqa: E402
from local_agent.hardware import (  # noqa: E402
    HardwareSnapshot, HardwareTiers, assess_hardware, inspect_hardware,
)
from local_agent.security import Pairing, SecurityError, canonical_json, verify_ed25519  # noqa: E402

OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
DEVICE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
ACCOUNT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
PRODUCT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
ORIGIN = "https://viralflow-ai-blond.vercel.app"
OTHER_ALLOWED_ORIGIN = "http://localhost:3000"
REFERENCE_JPEG = bytes.fromhex("ffd8ffc0000b080002000201011100ffd9")
TEST_KEY = b"test-only-hmac-key"


def test_signature(payload: bytes, signature: bytes, key: bytes) -> None:
    expected = hmac.digest(key, payload, "sha256") * 2
    if not hmac.compare_digest(signature, expected):
        raise SecurityError("INVALID_SIGNATURE")


def signed(payload: dict[str, object]) -> dict[str, object]:
    signature = hmac.digest(TEST_KEY, canonical_json(payload), "sha256") * 2
    return {"payload": payload,
            "signature": base64.urlsafe_b64encode(signature).rstrip(b"=").decode()}


def supported_hardware() -> HardwareSnapshot:
    return HardwareSnapshot("Windows", "11", "Test CPU", 32, "Test NVIDIA", 16,
                            "555.1", 8.6, True, True, 100, 1)


def missing_gpu_hardware() -> HardwareSnapshot:
    return HardwareSnapshot("Windows", "11", "Test CPU", 32, None, None,
                            None, None, True, False, 100, 1)


class RecordingWorker:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []
        self.session_id = str(uuid.uuid4())

    def health(self) -> dict[str, object]:
        return {"ready": True}

    def start_session(self, owner_id: str, account_id: str, product_ids: tuple[str, ...],
                      presenter_path: Path, microphone_id: str | None) -> str:
        assert account_id == ACCOUNT and product_ids == (PRODUCT,)
        assert presenter_path.is_file() and microphone_id is None
        self.calls.append(("start", owner_id))
        return self.session_id

    def pause_session(self, owner_id: str, _session_id: str) -> None:
        self.calls.append(("pause", owner_id))

    def resume_session(self, owner_id: str, _session_id: str) -> None:
        self.calls.append(("resume", owner_id))

    def stop_session(self, owner_id: str, _session_id: str) -> None:
        self.calls.append(("stop", owner_id))

    def recover_session(self, owner_id: str, _session_id: str) -> None:
        self.calls.append(("recover", owner_id))


class AgentFixture(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.clock = [1000.0]
        self.worker = RecordingWorker()
        self.config = AgentConfig(DEVICE, "one-time-code-123", TEST_KEY,
                                  Path(self.temp.name) / "references")

    def make_agent(self, *, supported: bool = True, validated: bool = True,
                   worker: object | None = None) -> LocalAgent:
        agent = LocalAgent(
            self.config, worker=worker if worker is not None else self.worker,
            hardware_probe=supported_hardware if supported else missing_gpu_hardware,
            grant_signature_verifier=test_signature,
            now=lambda: self.clock[0],
            test_only_realtime_validated=validated,
        )
        self.addCleanup(agent.close)
        return agent

    def pair_and_reference(self, agent: LocalAgent) -> tuple[str, str, str]:
        paired = agent.pair("one-time-code-123", ORIGIN)
        token = str(paired["token"])
        challenge = str(agent.challenge(token, ORIGIN)["challenge"])
        presenter = agent.upload_reference(token, ORIGIN, REFERENCE_JPEG,
                                           "image/jpeg")["presenterId"]
        return token, challenge, presenter

    def grant(self, challenge: str, *, owner: str = OWNER_A,
              entitled: bool = True, versions: dict[str, str] | None = None) -> dict[str, object]:
        return signed({
            "v": 1, "ownerId": owner, "deviceId": DEVICE, "challenge": challenge,
            "accountId": ACCOUNT, "productIds": [PRODUCT], "grantId": str(uuid.uuid4()),
            "issuedAt": 1000, "expiresAt": 1120, "entitled": entitled,
            "versions": versions if versions is not None else VERSIONS.copy(),
        })

    def start_body(self, challenge: str, **grant_changes: object) -> dict[str, object]:
        grant = self.grant(challenge)
        grant["payload"].update(grant_changes)
        return {"grant": signed(grant["payload"]), "accountId": ACCOUNT,
                "productIds": [PRODUCT], "presenterId": self.presenter,
                "microphoneId": None}


class LocalAgentTests(AgentFixture):
    def test_release_gate_and_no_mock_fallback(self) -> None:
        from presenter import MuseTalkPresenter
        self.assertIs(MuseTalkLocalPresenter, MuseTalkPresenter)
        agent = self.make_agent(validated=False)
        token, challenge, self.presenter = self.pair_and_reference(agent)
        self.assertFalse(agent.status(token, ORIGIN)["canStart"])
        with self.assertRaises(AgentError) as denied:
            agent.start(token, ORIGIN, self.start_body(challenge))
        self.assertEqual(denied.exception.code, "GPU_VALIDATION_REQUIRED")
        self.assertEqual(self.worker.calls, [])
        self.assertEqual(agent.developer_diagnostics()["providerMode"], "LOCAL_GPU")
        self.assertFalse(agent.developer_diagnostics()["realtimeValidated"])
        with self.assertRaises(AgentError) as encoder:
            LocalEncoder().start()
        self.assertEqual(encoder.exception.code, "ENCODER_NOT_VALIDATED")

    def test_missing_gpu_and_unsupported_hardware_block_start(self) -> None:
        agent = self.make_agent(supported=False)
        token, challenge, self.presenter = self.pair_and_reference(agent)
        view = agent.hardware(token, ORIGIN)
        self.assertEqual(view["state"], "GPU_REQUIRED")
        self.assertIn("ไม่พบการ์ดจอที่รองรับ", view["reasons"])
        self.assertNotIn("CUDA", json.dumps(view, ensure_ascii=False))
        with self.assertRaises(AgentError) as denied:
            agent.start(token, ORIGIN, self.start_body(challenge))
        self.assertEqual(denied.exception.code, "GPU_REQUIRED")
        self.assertEqual(self.worker.calls, [])

    def test_entitlement_version_and_absent_worker_block_start(self) -> None:
        for case in ("entitlement", "version", "worker"):
            with self.subTest(case=case):
                self.config = AgentConfig(DEVICE, "one-time-code-123", TEST_KEY,
                                          Path(self.temp.name) / case)
                agent = self.make_agent(worker=UnavailableWorker() if case == "worker" else self.worker)
                token, challenge, self.presenter = self.pair_and_reference(agent)
                body = self.start_body(challenge)
                if case == "entitlement":
                    body["grant"] = self.grant(challenge, entitled=False)
                if case == "version":
                    body["grant"] = self.grant(challenge, versions={**VERSIONS, "agent": "9.0.0"})
                with self.assertRaises(AgentError) as denied:
                    agent.start(token, ORIGIN, body)
                self.assertEqual(denied.exception.code, {
                    "entitlement": "ENTITLEMENT_REQUIRED",
                    "version": "UPDATE_REQUIRED",
                    "worker": "WORKER_NOT_VALIDATED",
                }[case])
        self.assertEqual(self.worker.calls, [])

    def test_signed_grant_signature_scope_challenge_and_owner_binding(self) -> None:
        agent = self.make_agent()
        token, challenge, self.presenter = self.pair_and_reference(agent)
        bad = self.start_body(challenge)
        bad["grant"]["payload"]["ownerId"] = OWNER_B  # signature stays unchanged
        with self.assertRaises(AgentError) as invalid:
            agent.start(token, ORIGIN, bad)
        self.assertEqual(invalid.exception.code, "INVALID_SIGNATURE")
        with self.assertRaises(AgentError) as extra:
            agent.start(token, ORIGIN,
                        {**self.start_body(challenge), "grant": {**self.grant(challenge),
                                                                    "url": "https://example.invalid"}})
        self.assertEqual(extra.exception.code, "INVALID_GRANT")
        body = self.start_body(challenge)
        body["accountId"] = OWNER_B
        with self.assertRaises(AgentError) as scope:
            agent.start(token, ORIGIN, body)
        self.assertEqual(scope.exception.code, "GRANT_SCOPE_MISMATCH")
        # A verified grant consumes its challenge even if later local checks fail.
        with self.assertRaises(AgentError) as replay:
            agent.start(token, ORIGIN, body)
        self.assertEqual(replay.exception.code, "CHALLENGE_REQUIRED")
        new_challenge = str(agent.challenge(token, ORIGIN)["challenge"])
        with self.assertRaises(AgentError) as owner:
            agent.start(token, ORIGIN,
                        {**self.start_body(new_challenge), "grant": self.grant(new_challenge, owner=OWNER_B)})
        self.assertEqual(owner.exception.code, "OWNER_MISMATCH")

    def test_pause_resume_stop_and_bounded_recovery(self) -> None:
        agent = self.make_agent()
        token, challenge, self.presenter = self.pair_and_reference(agent)
        started = agent.start(token, ORIGIN, self.start_body(challenge))
        session_id = str(started["sessionId"])
        self.assertTrue(started["sessionActive"])
        self.assertEqual(agent.pause(token, ORIGIN, session_id)["state"], "PAUSED")
        self.assertEqual(agent.resume(token, ORIGIN, session_id)["state"], "BUSY")
        agent.report_worker_failure(session_id)
        self.assertEqual(agent.status(token, ORIGIN)["state"], "ERROR")
        self.assertEqual(agent.status(token, ORIGIN)["sessionId"], session_id)
        self.assertTrue(agent.status(token, ORIGIN)["sessionActive"])
        agent._pairings._tokens["other-owner-token"] = Pairing(ORIGIN, 1800, OWNER_B)
        other = agent.status("other-owner-token", ORIGIN)
        self.assertFalse(other["sessionActive"])
        self.assertNotIn("sessionId", other)
        with self.assertRaises(AgentError) as cross_owner_stop:
            agent.stop("other-owner-token", ORIGIN, session_id)
        self.assertEqual(cross_owner_stop.exception.code, "SESSION_NOT_FOUND")
        agent._pairings._tokens["unbound-token"] = Pairing(ORIGIN, 1800)
        unbound = agent.status("unbound-token", ORIGIN)
        self.assertFalse(unbound["sessionActive"])
        self.assertNotIn("sessionId", unbound)
        with self.assertRaises(AgentError) as unbound_stop:
            agent.stop("unbound-token", ORIGIN, session_id)
        self.assertEqual(unbound_stop.exception.code, "OWNER_NOT_VERIFIED")
        self.assertEqual(agent.recover(token, ORIGIN, session_id)["state"], "BUSY")
        agent.report_worker_failure(session_id)
        with self.assertRaises(AgentError) as bounded:
            agent.recover(token, ORIGIN, session_id)
        self.assertEqual(bounded.exception.code, "RECOVERY_UNAVAILABLE")
        self.clock[0] = 1121
        self.assertFalse(agent.stop(token, ORIGIN, session_id)["sessionActive"])
        self.assertIn(("stop", OWNER_A), self.worker.calls)

    def test_same_owner_can_resume_after_grant_expiry_but_cannot_restart_recovery(self) -> None:
        agent = self.make_agent()
        token, challenge, self.presenter = self.pair_and_reference(agent)
        started = agent.start(token, ORIGIN, self.start_body(challenge))
        session_id = str(started["sessionId"])
        agent.pause(token, ORIGIN, session_id)
        self.clock[0] = 1121
        self.assertEqual(agent.resume(token, ORIGIN, session_id)["state"], "BUSY")
        agent.report_worker_failure(session_id)
        with self.assertRaises(AgentError) as expired:
            agent.recover(token, ORIGIN, session_id)
        self.assertEqual(expired.exception.code, "RECOVERY_UNAVAILABLE")
        self.assertFalse(agent.stop(token, ORIGIN, session_id)["sessionActive"])

    def test_pairing_is_one_time_origin_bound_and_reference_is_not_a_path(self) -> None:
        agent = self.make_agent()
        token, challenge, self.presenter = self.pair_and_reference(agent)
        with self.assertRaises(AgentError) as reused:
            agent.pair("one-time-code-123", ORIGIN)
        self.assertEqual(reused.exception.code, "PAIRING_DENIED")
        with self.assertRaises(AgentError) as other_origin:
            agent.status(token, OTHER_ALLOWED_ORIGIN)
        self.assertEqual(other_origin.exception.code, "LOCAL_AUTH_REQUIRED")
        with self.assertRaises(AgentError) as arbitrary_path:
            agent.start(token, ORIGIN,
                        {**self.start_body(challenge), "presenterId": "C:\\Windows\\secret.png"})
        self.assertEqual(arbitrary_path.exception.code, "PRESENTER_NOT_FOUND")
        self.assertEqual(self.worker.calls, [])

    def test_renew_rotates_bearer_and_preserves_verified_owner(self) -> None:
        agent = self.make_agent()
        token, challenge, self.presenter = self.pair_and_reference(agent)
        started = agent.start(token, ORIGIN, self.start_body(challenge))
        self.clock[0] = 1800
        renewed = agent.renew(token, ORIGIN)
        new_token = str(renewed["token"])
        self.assertNotEqual(new_token, token)
        self.assertEqual(renewed["expiresAt"], 2700)
        with self.assertRaises(AgentError) as old_token:
            agent.status(token, ORIGIN)
        self.assertEqual(old_token.exception.code, "LOCAL_AUTH_REQUIRED")
        self.assertTrue(agent.status(new_token, ORIGIN)["sessionActive"])
        self.assertFalse(agent.stop(new_token, ORIGIN, str(started["sessionId"]))["sessionActive"])


class HardwareTests(unittest.TestCase):
    def test_supported_fixture_is_provisional_not_claimed_validated(self) -> None:
        assessed = assess_hardware(supported_hardware())
        self.assertTrue(assessed.compatible)
        self.assertEqual(assessed.tier, "HIGH_PERFORMANCE")
        self.assertTrue(assessed.validation_required)
        self.assertEqual(assessed.diagnostics["marker"], "GPU_VALIDATION_REQUIRED")
        self.assertEqual(assessed.customer()["state"], "กำลังเตรียม")
        provisional = assess_hardware(supported_hardware(), HardwareTiers(minimum_vram_gb=18,
                                                                           recommended_vram_gb=20,
                                                                           high_performance_vram_gb=24))
        self.assertFalse(provisional.compatible)
        self.assertEqual(provisional.tier, "UNSUPPORTED")

    def test_probe_uses_fixed_commands_and_extracts_hardware(self) -> None:
        calls: list[tuple[str, ...]] = []

        def run(args):
            calls.append(tuple(args))
            if str(args[0]).endswith("nvidia-smi.exe"):
                return "Test NVIDIA, 16384, 555.1, 8.6\n"
            return " V..... h264_nvenc NVIDIA NVENC H.264 encoder\n"

        with tempfile.TemporaryDirectory() as directory:
            with patch("local_agent.hardware.platform.system", return_value="Windows"), \
                 patch("local_agent.hardware.platform.processor", return_value="Test CPU"), \
                 patch("local_agent.hardware._nvidia_smi_path", return_value="C:/fixed/nvidia-smi.exe"), \
                 patch("local_agent.hardware._windows_ram_gb", return_value=32), \
                 patch("local_agent.hardware._windows_microphone_count", return_value=1):
                snapshot = inspect_hardware(Path(directory), command=run,
                                            which=lambda _name: "C:/fixed/ffmpeg.exe")
        self.assertEqual(snapshot.gpu_name, "Test NVIDIA")
        self.assertEqual(snapshot.vram_gb, 16)
        self.assertTrue(snapshot.encoder_listed)
        self.assertEqual(calls[0][0], "C:/fixed/nvidia-smi.exe")
        self.assertEqual(calls[1][0], "C:/fixed/ffmpeg.exe")


class BootstrapTests(unittest.TestCase):
    def test_signed_allowlisted_manifest_hash_repair_and_uninstall(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = BootstrapManager(Path(directory).resolve() / "install", TEST_KEY,
                                       allowed_hosts=frozenset({"downloads.viralflow.example"}),
                                       verifier=test_signature)
            content = b"verified small bundle"
            item = {"name": "worker", "version": "0.1.0",
                    "url": "https://downloads.viralflow.example/viralflow/ai-live/worker.bundle",
                    "sha256": hashlib.sha256(content).hexdigest(), "sizeBytes": len(content)}
            manager.load_manifest(signed({"v": 1, "artifacts": [item]}))
            self.assertEqual(manager.status()["state"], "INSTALLING")
            with self.assertRaises(SecurityError):
                manager.stage_verified_bytes("worker", b"wrong")
            manager.stage_verified_bytes("worker", content)
            self.assertEqual(manager.status()["state"], "READY")
            self.assertEqual(manager.repair_needed(), [])
            manager.uninstall_cleanup()
            self.assertEqual(manager.status()["state"], "NOT_INSTALLED")
            with self.assertRaises(SecurityError) as denied:
                manager.load_manifest(signed({"v": 1, "artifacts": [
                    {**item, "url": "https://downloads.viralflow.example.evil/viralflow/ai-live/worker.bundle"}]}))
            self.assertEqual(denied.exception.code, "INSTALL_URL_NOT_ALLOWED")

    def test_verifier_fails_closed_when_crypto_is_unavailable_or_signature_invalid(self) -> None:
        with self.assertRaises(SecurityError) as denied:
            verify_ed25519(b"message", b"s" * 64, b"not a key")
        self.assertIn(denied.exception.code,
                      {"SIGNATURE_VERIFIER_UNAVAILABLE", "INVALID_PUBLIC_KEY"})


if __name__ == "__main__":
    unittest.main()
