"""LIVE Pro / LIVE Lite Auto selection at the authenticated agent boundary."""
from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from local_agent.agent import LocalAgent
from local_agent.lite_presenters import LITE_VOICE_IDS, LitePresenterCatalog
from local_agent.speech_credentials import SpeechKeyStore
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


class XorProtector:
    """Fixture stand-in for DPAPI; the key bytes still never appear in plaintext."""
    def protect(self, data): return bytes(b ^ 0x5A for b in data)
    unprotect = protect


_PACKS: dict[str, Path] = {}


def lite_packs_root() -> Path:
    """Two small verified synthetic presenter packs plus one broken folder (built once)."""
    if "root" not in _PACKS:
        from lite_pack_builder import build_synthetic
        temp = tempfile.mkdtemp(prefix="lite-packs-")
        root = Path(temp)
        for folder in ("nara", "krit"):
            build_synthetic(root / folder, frames=8, output_size=(160, 288))
        (root / "broken").mkdir()
        (root / "broken" / "manifest.json").write_text("{}", encoding="utf-8")
        import atexit
        atexit.register(shutil.rmtree, temp, True)
        _PACKS["root"] = root
    return _PACKS["root"]


class LitePresenterWorker(ModePreparingWorker):
    """Records the full start/prepare options and presenter path the agent passes."""
    def __init__(self) -> None:
        super().__init__()
        self.options: list[dict] = []
        self.paths: list[Path] = []
        self.session_id = str(uuid.uuid4())

    def prepare_room(self, owner_id, account_id, product_ids, presenter_path, microphone_id, **options):
        self.options.append(dict(options))
        self.paths.append(presenter_path)
        return super().prepare_room(owner_id, account_id, product_ids, presenter_path, microphone_id, **options)

    def start_session(self, owner_id, account_id, product_ids, presenter_path, microphone_id, **options):
        self.options.append(dict(options))
        self.paths.append(presenter_path)
        assert presenter_path.is_file() and microphone_id is None
        self.calls.append(("start", owner_id))
        return self.session_id


class AgentLitePresenterTests(AgentFixture):
    def setUp(self) -> None:
        super().setUp()
        self.root = lite_packs_root()
        self.store = SpeechKeyStore(Path(self.temp.name) / "speech", protector=XorProtector())
        self.lite_worker = LitePresenterWorker()

    def agent(self, *, root: Path | None = None, worker=None) -> LocalAgent:
        self.identity = registered_identity_fixture(
            Path(self.temp.name) / ("identity-" + str(uuid.uuid4())), DEVICE)
        packs = root if root is not None else self.root
        agent = LocalAgent(self.config, worker=worker or self.lite_worker, hardware_probe=ally_x_hardware,
                           grant_signature_verifier=_signature, now=lambda: self.clock[0],
                           device_identity=self.identity, speech_key_store=self.store,
                           lite_presenters=LitePresenterCatalog(lambda: packs))
        self.addCleanup(agent.close)
        return agent

    def paired(self, agent) -> str:
        token, _, self.presenter = self.pair_and_reference(agent)
        agent.sync_product_context(token, ORIGIN, signed(test_local_ai_agent.LocalAIAgentTests.context_payload(self)))
        return token

    def started(self, agent, token, **changes):
        challenge = str(agent.challenge(token, ORIGIN)["challenge"])
        body = self.start_body(challenge)
        body.pop("presenterId")
        body.update(changes)
        return agent.start(token, ORIGIN, body)

    def test_catalog_lists_verified_packs_voices_and_key_status_never_the_key(self) -> None:
        agent = self.agent()
        token = self.paired(agent)
        catalog = agent.lite_presenters(token, ORIGIN)
        self.assertEqual([item["folder"] for item in catalog["presenters"]], ["krit", "nara"])
        self.assertTrue(all(item["technicalTestOnly"] for item in catalog["presenters"]))
        self.assertEqual({voice["id"] for voice in catalog["voices"]}, LITE_VOICE_IDS)
        self.assertEqual(catalog["speechKey"], {"configured": False})
        self.assertEqual(catalog["freeTier"]["used_this_month"], 0)
        self.assertIs(catalog["freeTier"]["paid_fallback"], False)
        key = "K3y" * 12
        self.store.put("azure", key, "southeastasia")
        catalog = agent.lite_presenters(token, ORIGIN)
        self.assertEqual(catalog["speechKey"], {"configured": True, "provider": "azure", "region": "southeastasia"})
        self.assertNotIn(key, json.dumps(catalog))

    def test_catalog_is_empty_without_a_configured_packs_root(self) -> None:
        with patch.dict(os.environ, {"AI_LIVE_LITE_PACKS_ROOT": ""}):
            self.assertEqual(LitePresenterCatalog().presenters(), [])
        with patch.dict(os.environ, {"AI_LIVE_LITE_PACKS_ROOT": str(self.root / "missing")}):
            self.assertEqual(LitePresenterCatalog().presenters(), [])
        with patch.dict(os.environ, {"AI_LIVE_LITE_PACKS_ROOT": "relative/packs"}):
            self.assertEqual(LitePresenterCatalog().presenters(), [])
        with patch.dict(os.environ, {"AI_LIVE_LITE_PACKS_ROOT": str(self.root)}):
            self.assertEqual(len(LitePresenterCatalog().presenters()), 2)

    def test_catalog_and_thumbnail_require_an_authorized_device(self) -> None:
        agent = self.agent()
        token = str(agent.pair("one-time-code-123", ORIGIN)["token"])  # paired, no certificate
        for call in (lambda: agent.lite_presenters(token, ORIGIN),
                     lambda: agent.lite_presenter_thumbnail(token, ORIGIN, "nara")):
            with self.assertRaises(AgentError) as denied:
                call()
            self.assertIn(denied.exception.status, (401, 403))

    def test_thumbnail_is_the_verified_pack_reference_and_only_for_listed_folders(self) -> None:
        agent = self.agent()
        token = self.paired(agent)
        body = agent.lite_presenter_thumbnail(token, ORIGIN, "nara")
        self.assertEqual(body, (self.root / "nara" / "reference.jpg").read_bytes())
        self.assertTrue(body.startswith(b"\xff\xd8"))
        for folder in ("broken", "missing", "../nara", "nara/..", ".", "", "na ra", None, 3):
            with self.subTest(folder=folder):
                with self.assertRaises(AgentError) as denied:
                    agent.lite_presenter_thumbnail(token, ORIGIN, folder)
                self.assertEqual(denied.exception.code, "LITE_PRESENTER_NOT_FOUND")

    def test_lite_start_uses_the_chosen_pack_and_voice_without_a_photo(self) -> None:
        agent = self.agent()
        token = self.paired(agent)
        reference = self.root / "krit" / "reference.jpg"
        result = self.started(agent, token, liveMode="lite",
                              litePresenter={"folder": "krit", "voice": "th-TH-NiwatNeural"})
        self.assertTrue(result["sessionActive"])
        self.assertEqual(self.lite_worker.paths, [reference])
        self.assertEqual(self.lite_worker.options, [{"live_mode": "lite", "lite_pack_dir": self.root / "krit",
                                                     "lite_voice": "th-TH-NiwatNeural"}])
        self.assertTrue(reference.is_file(), "An installed pack is never deleted after start")
        self.assertIn(self.presenter, agent._references, "An unused upload is left alone")

    def test_lite_without_a_chosen_presenter_keeps_the_uploaded_photo_path(self) -> None:
        agent = self.agent()
        token = self.paired(agent)
        self.assertTrue(self.started(agent, token, liveMode="lite", presenterId=self.presenter)["sessionActive"])
        self.assertEqual(self.lite_worker.options, [{"live_mode": "lite"}])

    def test_lite_presenter_selection_is_strict_and_lite_only(self) -> None:
        agent = self.agent()
        token = self.paired(agent)
        good = {"folder": "nara", "voice": "th-TH-AcharaNeural"}
        for changes, code in (
            ({"litePresenter": good}, "LITE_PRESENTER_NOT_ALLOWED"),
            ({"liveMode": "pro", "litePresenter": good}, "LITE_PRESENTER_NOT_ALLOWED"),
            ({"liveMode": "lite", "litePresenter": {**good, "voice": "th-TH-Premwadee"}}, "LITE_VOICE_INVALID"),
            ({"liveMode": "lite", "litePresenter": {**good, "voice": "en-US-JennyNeural"}}, "LITE_VOICE_INVALID"),
            ({"liveMode": "lite", "litePresenter": {**good, "folder": "broken"}}, "LITE_PRESENTER_NOT_FOUND"),
            ({"liveMode": "lite", "litePresenter": {**good, "folder": "../nara"}}, "LITE_PRESENTER_NOT_FOUND"),
            ({"liveMode": "lite", "litePresenter": {**good, "folder": str(self.root / "nara")}}, "LITE_PRESENTER_NOT_FOUND"),
            ({"liveMode": "lite", "litePresenter": {**good, "path": "x"}}, "LITE_PRESENTER_INVALID"),
            ({"liveMode": "lite", "litePresenter": {"folder": "nara"}}, "LITE_PRESENTER_INVALID"),
            ({"liveMode": "lite", "litePresenter": "nara"}, "LITE_PRESENTER_INVALID"),
            ({"liveMode": "lite", "litePresenter": {**good, "folder": ["nara"]}}, "LITE_PRESENTER_INVALID"),
            ({"liveMode": "lite", "litePresenter": good, "presenterId": None}, "LITE_PRESENTER_INVALID"),
        ):
            with self.subTest(changes=changes):
                with self.assertRaises(AgentError) as denied:
                    self.started(agent, token, **changes)
                self.assertEqual(denied.exception.code, code)
        self.assertEqual(self.lite_worker.calls, [])

    def test_pro_still_requires_an_uploaded_presenter(self) -> None:
        agent = self.agent()
        token = self.paired(agent)
        with self.assertRaises(AgentError) as denied:
            self.started(agent, token)
        self.assertEqual(denied.exception.code, "PRESENTER_REQUIRED")

    def test_warmup_threads_the_chosen_pack_and_voice_to_preparation(self) -> None:
        agent = self.agent()
        token = self.paired(agent)
        base = {"accountId": ACCOUNT, "productIds": [PRODUCT], "microphoneId": None}
        choice = {"folder": "nara", "voice": "th-TH-PremwadeeNeural"}
        agent.warmup_ai(token, ORIGIN, {**base, "liveMode": "lite", "litePresenter": choice})
        agent._ai_warmup_thread.join(timeout=2)
        self.assertEqual(self.lite_worker.paths, [self.root / "nara" / "reference.jpg"])
        self.assertEqual(self.lite_worker.options, [{"live_mode": "lite", "lite_pack_dir": self.root / "nara",
                                                     "lite_voice": "th-TH-PremwadeeNeural"}])
        for selection, code in (
            ({**base, "liveMode": "pro", "litePresenter": choice}, "LITE_PRESENTER_NOT_ALLOWED"),
            ({**base, "litePresenter": choice}, "LOCAL_AI_WARMUP_REQUIRED"),
            ({**base, "liveMode": "lite", "litePresenter": choice, "presenterId": self.presenter}, "LOCAL_AI_WARMUP_REQUIRED"),
            ({**base, "liveMode": "lite", "litePresenter": {**choice, "voice": "th-TH-Other"}}, "LITE_VOICE_INVALID"),
            ({**base, "liveMode": "lite", "litePresenter": {**choice, "folder": "missing"}}, "LITE_PRESENTER_NOT_FOUND"),
        ):
            with self.subTest(selection=selection):
                with self.assertRaises(AgentError) as denied:
                    agent.warmup_ai(token, ORIGIN, selection)
                self.assertEqual(denied.exception.code, code)
        self.assertEqual(len(self.lite_worker.options), 1)


if __name__ == "__main__":
    unittest.main()


class FakeBuildProcess:
    """Stands in for the lite_photo_presenter.py child: progress on stderr, JSON result on stdout."""

    def __init__(self, command, *, ok=True, release=None, **_kwargs):
        import io
        self.command = command
        out = Path(command[command.index("--out") + 1])
        self.out = out
        self.returncode = None
        self._ok = ok
        self._release = release
        self.stderr = io.StringIO("rendered 4 library frames\nrendered 9 library frames\n")
        self.stdout = self

    def read(self):
        if self._release is not None:
            self._release.wait(5)
        if self._ok:
            from lite_pack_builder import build_synthetic
            build_synthetic(self.out)
            self.returncode = 0
            return json.dumps({"ok": True, "pack_id": "x", "frames": 32}) + "\n"
        self.out.mkdir(parents=True, exist_ok=True)
        (self.out / "partial.jpg").write_bytes(b"x")
        self.returncode = 2
        return json.dumps({"ok": False, "code": "LITE_PHOTO_NO_FACE", "message": "ไม่เจอใบหน้าในรูป"}, ensure_ascii=False) + "\n"

    def wait(self, timeout=None):
        return self.returncode

    def kill(self):
        self.returncode = -9


class AgentLitePhotoBuildTests(AgentLitePresenterTests):
    """'Use my own photo' for LIVE Lite: consented library photo -> background pack build, owner-only."""

    def setUp(self) -> None:
        super().setUp()
        import threading
        from local_agent.presenter_library import PresenterLibrary
        self.photo_root = Path(tempfile.mkdtemp(prefix="lite-photo-packs-"))
        self.addCleanup(shutil.rmtree, self.photo_root, True)
        for folder in ("nara",):
            shutil.copytree(self.root / folder, self.photo_root / folder)
        self.calibration = Path(self.temp.name) / "calibration.wav"
        import wave
        with wave.open(str(self.calibration), "wb") as handle:
            handle.setnchannels(1); handle.setsampwidth(2); handle.setframerate(16000)
            handle.writeframes(bytes(16000 * 2 * 4))
        self.library = PresenterLibrary(Path(self.temp.name) / "library", protector=XorProtector())
        self.processes: list[FakeBuildProcess] = []
        self.ok = True
        self.release = threading.Event()
        self.release.set()

    def popen(self, command, **kwargs):
        process = FakeBuildProcess(command, ok=self.ok, release=self.release)
        self.processes.append(process)
        return process

    def photo_agent(self):
        from local_agent.lite_photo_builds import LitePhotoBuilds
        builds = LitePhotoBuilds(lambda: self.photo_root, calibration_resolver=lambda: self.calibration,
                                 popen=self.popen, python="python")
        self.identity = registered_identity_fixture(Path(self.temp.name) / ("identity-" + str(uuid.uuid4())), DEVICE)
        agent = LocalAgent(self.config, worker=self.lite_worker, hardware_probe=ally_x_hardware,
                           grant_signature_verifier=_signature, now=lambda: self.clock[0],
                           device_identity=self.identity, speech_key_store=self.store,
                           presenter_library=self.library,
                           lite_presenters=LitePresenterCatalog(lambda: self.photo_root), lite_photo_builds=builds)
        self.addCleanup(agent.close)
        return agent

    def saved_photo(self, agent, token, consent=True) -> str:
        import base64
        return agent.save_presenter(token, ORIGIN, {
            "id": None, "name": "ลัคกี้", "voiceLabel": "เสียง", "assignedAccountIds": [], "consentConfirmed": consent,
            "image": base64.b64encode(REFERENCE_JPEG).decode(), "mediaType": "image/jpeg"})["presenter"]["id"]

    def wait_done(self, agent, token):
        import time as _time
        for _ in range(200):
            builds = agent.lite_photo_builds(token, ORIGIN)["builds"]
            if builds and builds[0]["state"] != "RUNNING":
                return builds[0]
            _time.sleep(0.02)
        self.fail("build did not finish")

    def test_build_from_saved_photo_becomes_an_owner_only_lite_presenter(self) -> None:
        agent = self.photo_agent()
        token = self.paired(agent)
        presenter = self.saved_photo(agent, token)
        started = agent.lite_photo_build(token, ORIGIN, {"presenterId": presenter, "voice": "th-TH-PremwadeeNeural"})["build"]
        self.assertEqual(started["state"], "RUNNING")
        self.assertTrue(started["folder"].startswith("photo-"))
        done = self.wait_done(agent, token)
        self.assertEqual(done["state"], "READY")
        self.assertEqual(done["progress"], 1.0)
        command = self.processes[0].command
        self.assertEqual(command[command.index("--name") + 1], "ลัคกี้")
        self.assertEqual(command[command.index("--calibration-wav") + 1], str(self.calibration))
        consent_path = Path(command[command.index("--consent") + 1])
        self.assertFalse(consent_path.exists(), "the copied photo and consent are removed after the build")
        self.assertFalse(Path(command[command.index("--photo") + 1]).exists())
        # The synthetic stand-in pack has no consent; give it the owner's consent as the real builder would.
        manifest_path = self.photo_root / done["folder"] / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        from local_agent.lite_photo_builds import owner_ref
        manifest["consent"] = {"likeness_use": True, "person": "ลัคกี้", "signed_at": "2026-11-20", "owner_ref": owner_ref(OWNER_A)}
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
        catalog = agent.lite_presenters(token, ORIGIN)["presenters"]
        own = [item for item in catalog if item["folder"] == done["folder"]]
        self.assertEqual(len(own), 1)
        self.assertTrue(own[0]["ownPhoto"])
        self.assertNotIn("ownerRef", own[0])
        # Another owner on the same device never sees or uses it.
        other = LitePresenterCatalog(lambda: self.photo_root)
        self.assertNotIn(done["folder"], [item["folder"] for item in other.presenters(owner_ref("someone-else"))])
        from local_agent.lite_presenters import LitePresenterError
        with self.assertRaises(LitePresenterError):
            other.choose({"folder": done["folder"], "voice": "th-TH-PremwadeeNeural"}, owner_ref("someone-else"))
        self.assertEqual(other.choose({"folder": done["folder"], "voice": "th-TH-PremwadeeNeural"},
                                      owner_ref(OWNER_A)).folder, done["folder"])

    def test_failed_build_reports_reason_and_leaves_no_pack(self) -> None:
        self.ok = False
        agent = self.photo_agent()
        token = self.paired(agent)
        presenter = self.saved_photo(agent, token)
        agent.lite_photo_build(token, ORIGIN, {"presenterId": presenter, "voice": "th-TH-NiwatNeural"})
        done = self.wait_done(agent, token)
        self.assertEqual((done["state"], done["code"]), ("FAILED", "LITE_PHOTO_NO_FACE"))
        self.assertEqual(done["message"], "ไม่เจอใบหน้าในรูป")
        self.assertFalse((self.photo_root / done["folder"]).exists())

    def test_requests_are_strict_and_one_build_at_a_time(self) -> None:
        agent = self.photo_agent()
        token = self.paired(agent)
        presenter = self.saved_photo(agent, token)
        for body, code in (({"presenterId": presenter}, "INVALID_LITE_PHOTO_REQUEST"),
                           ({"presenterId": presenter, "voice": "en-US-Guy"}, "LITE_VOICE_INVALID"),
                           ({"presenterId": str(uuid.uuid4()), "voice": "th-TH-NiwatNeural"}, "PRESENTER_NOT_FOUND"),
                           ({"presenterId": presenter, "voice": "th-TH-NiwatNeural", "x": 1}, "INVALID_LITE_PHOTO_REQUEST")):
            with self.subTest(code=code), self.assertRaises(AgentError) as denied:
                agent.lite_photo_build(token, ORIGIN, body)
            self.assertEqual(denied.exception.code, code)
        self.release.clear()
        agent.lite_photo_build(token, ORIGIN, {"presenterId": presenter, "voice": "th-TH-NiwatNeural"})
        with self.assertRaises(AgentError) as busy:
            agent.lite_photo_build(token, ORIGIN, {"presenterId": presenter, "voice": "th-TH-NiwatNeural"})
        self.assertEqual(busy.exception.code, "LITE_PHOTO_BUILD_BUSY")
        with self.assertRaises(AgentError) as live_blocked:
            self.started(agent, token, liveMode="lite", litePresenter={"folder": "nara", "voice": "th-TH-NiwatNeural"})
        self.assertEqual(live_blocked.exception.code, "LITE_PHOTO_BUILD_RUNNING")
        self.release.set()
        self.assertEqual(self.wait_done(agent, token)["state"], "READY")

    def test_missing_calibration_audio_is_reported(self) -> None:
        from local_agent.lite_photo_builds import LitePhotoBuilds
        agent = self.photo_agent()
        agent._lite_photo_builds = LitePhotoBuilds(lambda: self.photo_root, calibration_resolver=lambda: None, popen=self.popen)
        token = self.paired(agent)
        presenter = self.saved_photo(agent, token)
        with self.assertRaises(AgentError) as denied:
            agent.lite_photo_build(token, ORIGIN, {"presenterId": presenter, "voice": "th-TH-NiwatNeural"})
        self.assertEqual((denied.exception.status, denied.exception.code), (503, "LITE_CALIBRATION_AUDIO_MISSING"))
