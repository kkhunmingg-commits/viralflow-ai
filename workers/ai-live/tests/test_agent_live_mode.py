"""LIVE Pro / LIVE Lite Auto selection at the authenticated agent boundary."""
from __future__ import annotations

import unittest
import uuid
from pathlib import Path

from local_agent.agent import LocalAgent
from local_agent.hardware import HardwareSnapshot, assess_hardware, assess_lite_hardware

from test_local_agent import (
    ACCOUNT, DEVICE, ORIGIN, REFERENCE_JPEG, OWNER_A, PRODUCT, AgentError, AgentFixture, RecordingWorker,
    registered_identity_fixture, signed, supported_hardware,
)


def ally_x_hardware() -> HardwareSnapshot:
    """ROG Ally X-like: AMD APU, no NVIDIA/CUDA, CPU and AMF encoders listed."""
    return HardwareSnapshot("Windows", "11", "AMD Ryzen Z1 Extreme", 24, None, None, None, None,
                            True, False, 400, 1, lite_encoders=("libx264", "h264_amf"), cpu_cores=16)
from test_local_agent import test_signature as _signature  # noqa: E402
import test_local_ai_agent  # module import: do not re-collect its tests here
from test_local_ai_agent import AIWorkerBoundaryFixture


class ModeRecordingWorker(RecordingWorker):
    """A worker that declares both modes, like ManagedRuntimeWorker."""
    live_modes = frozenset({"pro", "lite"})

    def __init__(self) -> None:
        super().__init__()
        self.modes: list[object] = []

    def start_session(self, owner_id: str, account_id: str, product_ids: tuple[str, ...],
                      presenter_path: Path, microphone_id: str | None, **options: object) -> str:
        self.modes.append(options.get("live_mode", "<absent>"))
        return super().start_session(owner_id, account_id, product_ids, presenter_path, microphone_id)


class ModePreparingWorker(AIWorkerBoundaryFixture):
    live_modes = frozenset({"pro", "lite"})

    def __init__(self) -> None:
        super().__init__()
        self.modes: list[object] = []

    def prepare_room(self, owner_id, account_id, product_ids, presenter_path, microphone_id, **options):
        self.modes.append(options.get("live_mode", "<absent>"))
        return super().prepare_room(owner_id, account_id, product_ids, presenter_path, microphone_id)


class AgentLiveModeStartTests(AgentFixture):
    def started(self, agent, token, **changes):
        challenge = str(agent.challenge(token, ORIGIN)["challenge"])
        body = self.start_body(challenge)
        body.update(changes)
        return agent.start(token, ORIGIN, body)

    def test_missing_mode_keeps_the_original_pro_worker_call(self) -> None:
        worker = ModeRecordingWorker()
        agent = self.make_agent(worker=worker)
        token, _, self.presenter = self.pair_and_reference(agent)
        self.assertTrue(self.started(agent, token)["sessionActive"])
        self.assertEqual(worker.modes, ["<absent>"])
        self.assertEqual(worker.calls, [("start", OWNER_A)])

    def test_explicit_pro_is_identical_to_missing_mode(self) -> None:
        worker = ModeRecordingWorker()
        agent = self.make_agent(worker=worker)
        token, _, self.presenter = self.pair_and_reference(agent)
        self.started(agent, token, liveMode="pro")
        self.assertEqual(worker.modes, ["<absent>"])

    def ally_agent(self, worker, *, validated: bool = False) -> LocalAgent:
        self.identity = registered_identity_fixture(
            Path(self.temp.name) / ("identity-" + str(uuid.uuid4())), DEVICE)
        agent = LocalAgent(self.config, worker=worker, hardware_probe=ally_x_hardware,
                           grant_signature_verifier=_signature, now=lambda: self.clock[0],
                           test_only_realtime_validated=validated, device_identity=self.identity)
        self.addCleanup(agent.close)
        return agent

    def test_lite_starts_on_a_machine_without_nvidia_while_pro_stays_blocked(self) -> None:
        worker = ModeRecordingWorker()
        agent = self.ally_agent(worker)
        token, _, self.presenter = self.pair_and_reference(agent)
        view = agent.status(token, ORIGIN)
        self.assertEqual((view["machineReady"], view["canStart"]), (False, False))
        self.assertEqual((view["lite"]["machineReady"], view["lite"]["commercialLive"]), (True, False))
        with self.assertRaises(AgentError) as denied:
            self.started(agent, token)
        self.assertEqual(denied.exception.code, "GPU_REQUIRED")
        self.assertTrue(self.started(agent, token, liveMode="lite")["sessionActive"])
        self.assertEqual(worker.modes, ["lite"])
        # Unverified capacity admits exactly one Lite room.
        self.presenter = agent.upload_reference(token, ORIGIN, REFERENCE_JPEG, "image/jpeg")["presenterId"]
        with self.assertRaises(AgentError) as busy:
            self.started(agent, token, liveMode="lite")
        self.assertIn(busy.exception.code, ("ROOM_CAPACITY_REACHED", "SESSION_BUSY"))

    def test_pro_gates_are_unchanged_by_lite(self) -> None:
        pro = assess_hardware(ally_x_hardware())
        self.assertFalse(pro.compatible)
        self.assertIn("NVIDIA_GPU_REQUIRED", pro.diagnostics["codes"])
        self.assertTrue(assess_lite_hardware(ally_x_hardware()).compatible)
        self.assertTrue(assess_hardware(supported_hardware()).compatible)

    def test_lite_rejects_machines_below_its_own_floor(self) -> None:
        weak = HardwareSnapshot("Windows", "11", "CPU", 4, None, None, None, None, True, False, 5, 0,
                                lite_encoders=(), cpu_cores=2)
        result = assess_lite_hardware(weak)
        self.assertFalse(result.compatible)
        self.assertEqual(set(result.diagnostics["codes"]),
                         {"SYSTEM_RAM_REQUIRED", "CPU_CORES_REQUIRED", "ENCODER_REQUIRED", "FREE_DISK_REQUIRED"})

    def test_lite_reaches_a_supporting_worker_without_microphone(self) -> None:
        worker = ModeRecordingWorker()
        agent = self.ally_agent(worker)
        token, _, self.presenter = self.pair_and_reference(agent)
        self.assertTrue(self.started(agent, token, liveMode="lite")["sessionActive"])
        self.assertEqual(worker.modes, ["lite"])

    def test_invalid_mode_values_and_lite_microphone_are_rejected_before_worker(self) -> None:
        worker = ModeRecordingWorker()
        agent = self.make_agent(worker=worker)
        token, _, self.presenter = self.pair_and_reference(agent)
        for changes, code in (
            ({"liveMode": "LITE"}, "LIVE_MODE_INVALID"), ({"liveMode": "turbo"}, "LIVE_MODE_INVALID"),
            ({"liveMode": None}, "LIVE_MODE_INVALID"), ({"liveMode": True}, "LIVE_MODE_INVALID"),
            ({"liveMode": ["lite"]}, "LIVE_MODE_INVALID"),
            ({"liveMode": "lite", "microphoneId": "default"}, "MICROPHONE_NOT_ALLOWED"),
        ):
            with self.subTest(changes=changes):
                with self.assertRaises(AgentError) as denied:
                    self.started(agent, token, **changes)
                self.assertEqual(denied.exception.code, code)
        self.assertEqual(worker.calls, [])

    def test_lite_is_refused_by_a_worker_that_does_not_declare_it(self) -> None:
        agent = self.make_agent()  # plain RecordingWorker: Pro only
        token, _, self.presenter = self.pair_and_reference(agent)
        with self.assertRaises(AgentError) as denied:
            self.started(agent, token, liveMode="lite")
        self.assertEqual(denied.exception.code, "LIVE_MODE_UNAVAILABLE")
        self.assertEqual(self.worker.calls, [])


class AgentLiveModeWarmupTests(AgentFixture):
    def setUp(self) -> None:
        super().setUp()
        self.worker = ModePreparingWorker()
        self.agent = self.make_agent(worker=self.worker)
        self.token, _, self.presenter = self.pair_and_reference(self.agent)
        self.agent.sync_product_context(self.token, ORIGIN, signed(test_local_ai_agent.LocalAIAgentTests.context_payload(self)))
        self.addCleanup(self.finish)

    def finish(self) -> None:
        thread = self.agent._ai_warmup_thread
        if thread is not None:
            thread.join(timeout=2)
            self.assertFalse(thread.is_alive())

    def selection(self, **changes):
        value = {"accountId": ACCOUNT, "productIds": [PRODUCT], "presenterId": self.presenter, "microphoneId": None}
        value.update(changes)
        return value

    def test_selected_warmup_threads_lite_and_keeps_pro_unchanged(self) -> None:
        self.agent.warmup_ai(self.token, ORIGIN, self.selection())
        self.finish()
        self.agent.warmup_ai(self.token, ORIGIN, self.selection(liveMode="pro"))
        self.finish()
        self.agent.warmup_ai(self.token, ORIGIN, self.selection(liveMode="lite"))
        self.finish()
        self.assertEqual(self.worker.modes, ["<absent>", "<absent>", "lite"])

    def test_selected_warmup_rejects_invalid_mode_and_lite_microphone(self) -> None:
        for changes, code in (({"liveMode": "Lite"}, "LIVE_MODE_INVALID"), ({"liveMode": 1}, "LIVE_MODE_INVALID"),
                              ({"liveMode": "lite", "microphoneId": "default"}, "MICROPHONE_NOT_ALLOWED")):
            with self.subTest(changes=changes):
                with self.assertRaises(AgentError) as denied:
                    self.agent.warmup_ai(self.token, ORIGIN, self.selection(**changes))
                self.assertEqual(denied.exception.code, code)
        with self.assertRaises(AgentError) as denied:
            self.agent.warmup_ai(self.token, ORIGIN, {**self.selection(), "liveMode": "lite", "extra": 1})
        self.assertEqual(denied.exception.code, "LOCAL_AI_WARMUP_REQUIRED")
        self.assertEqual(self.worker.preparation_calls, [])


if __name__ == "__main__":
    unittest.main()
