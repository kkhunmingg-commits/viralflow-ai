"""Managed IPC integration with injected processes; no model/GPU/network install."""
from __future__ import annotations

import base64
import io
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from managed_worker_entry import MAX_MESSAGE, serve  # noqa: E402
from local_agent.agent import AgentError  # noqa: E402
from local_agent.managed_runtime import ManagedRuntimeWorker  # noqa: E402

OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
OTHER_OWNER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
ACCOUNT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
PRODUCT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
SESSION = "7774a04a-683c-4c85-9c6c-16457d63a369"
JPEG = bytes.fromhex("ffd8ffc0000b080002000201011100ffd9")


class Components:
    profile = "nvidia"

    def __init__(self, root):
        self.root = root
        self.state = "READY"
        self.verified = True
        self.verifications = 0

    def runtime_root(self):
        return self.root

    def status(self):
        return {"state": self.state}

    def verify_current(self):
        self.verifications += 1
        return self.verified


class OwnedWorker:
    """Injected real-method boundary; owner checks are deliberately enforced here."""
    def __init__(self):
        self.calls = []
        self.owner = None
        self.closed = False
        self.pcm = None

    def health(self):
        return {"ready": True}

    def start_session(self, owner, account, products, reference, microphone):
        if account != ACCOUNT or products != (PRODUCT,) or not isinstance(reference, Path):
            raise AgentError(400, "INVALID_SESSION", "private invalid setup")
        self.owner = owner
        self.calls.append(("start_session", owner, account, products, reference, microphone))
        return SESSION

    def _owned(self, owner, session):
        if owner != self.owner or session != SESSION:
            raise AgentError(404, "SESSION_NOT_FOUND", "private-owner / private-native-path")

    def pause_session(self, owner, session):
        self._owned(owner, session)
        self.calls.append(("pause_session", owner, session))

    def resume_session(self, owner, session):
        self._owned(owner, session)
        self.calls.append(("resume_session", owner, session))

    def stop_session(self, owner, session):
        self._owned(owner, session)
        self.calls.append(("stop_session", owner, session))

    def recover_session(self, owner, session):
        self._owned(owner, session)
        self.calls.append(("recover_session", owner, session))

    def push_audio(self, owner, session, pcm):
        self._owned(owner, session)
        self.pcm = pcm

    def preview_frame(self, owner, session):
        self._owned(owner, session)
        return JPEG

    def customer_stream(self, owner, session):
        self._owned(owner, session)
        return {"phase": "CONNECTING", "connectionQuality": "UNAVAILABLE"}

    def close(self):
        self.closed = True


class PipeReader:
    def __init__(self):
        self.lines = queue.Queue()
        self.closed = False

    def readline(self, limit=-1):
        value = self.lines.get()
        return value if limit < 0 else value[:limit]

    def close(self):
        if not self.closed:
            self.closed = True
            self.lines.put(b"")


class PipeWriter:
    def __init__(self, reader, *, modifier=None, hang_method=None):
        self.reader = reader
        self.modifier = modifier
        self.hang_method = hang_method
        self.closed = False
        self.writes = []
        self.release = threading.Event()

    def write(self, value):
        value = bytes(value)
        if self.closed:
            raise BrokenPipeError
        self.writes.append(value)
        if self.hang_method and json.loads(value).get("method") == self.hang_method:
            self.release.wait()
            if self.closed:
                raise BrokenPipeError
        output = self.modifier(value) if self.modifier else value
        if output is not None:
            self.reader.lines.put(output)
        return len(value)

    def flush(self):
        if self.closed:
            raise BrokenPipeError

    def close(self):
        self.closed = True
        self.release.set()
        self.reader.close()


class InheritedPipeProcess:
    """Runs the actual serve() protocol against inherited in-memory pipes."""
    def __init__(self, worker, *, modifier=None, hang_method=None):
        self.worker = worker
        self.source = PipeReader()
        self.stdout = PipeReader()
        self.stdin = PipeWriter(self.source, hang_method=hang_method)
        self.destination = PipeWriter(self.stdout, modifier=modifier)
        self.returncode = None
        self.killed = False
        self.config = None

        def factory(root, profile, component_root):
            self.config = (root, profile, component_root)
            return worker

        def run():
            try:
                serve(self.source, self.destination, worker_factory=factory)
                if self.returncode is None:
                    self.returncode = 0
            except Exception:
                if self.returncode is None:
                    self.returncode = 1
            finally:
                self.stdout.close()

        self.thread = threading.Thread(target=run, daemon=True)
        self.thread.start()

    def poll(self):
        return self.returncode

    def kill(self):
        self.killed = True
        self.returncode = -9
        self.stdin.close()
        self.stdout.close()

    def wait(self, timeout=None):
        self.thread.join(timeout)
        if self.thread.is_alive():
            raise subprocess.TimeoutExpired("injected-private-worker", timeout)
        return self.returncode


class ManagedRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.env = patch.dict(os.environ, {}, clear=False)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.root = Path(self.temp.name) / "verified component root"
        (self.root / "runtime").mkdir(parents=True)
        (self.root / "worker").mkdir()
        (self.root / "runtime" / "python.exe").write_bytes(b"injected interpreter; never executed")
        (self.root / "worker" / "managed_worker_entry.py").write_bytes(b"injected signed entry")
        self.reference = Path(self.temp.name) / "portrait.jpg"
        self.reference.write_bytes(JPEG)
        self.components = Components(self.root)
        self.processes = []
        self.launches = []

    def make_bridge(self, *, modifier=None, hang_method=None):
        def launch(command, **kwargs):
            self.launches.append((command, kwargs))
            process = InheritedPipeProcess(OwnedWorker(), modifier=modifier, hang_method=hang_method)
            self.processes.append(process)
            return process

        bridge = ManagedRuntimeWorker(Path(self.temp.name) / "app", self.components,
                                      process_factory=launch, timeout_seconds=0.25)
        self.addCleanup(bridge.close)
        return bridge

    def start(self, bridge):
        self.assertEqual(bridge.start_session(OWNER, ACCOUNT, (PRODUCT,), self.reference, None), SESSION)

    def test_fixed_private_isolated_runtime_and_environment(self):
        os.environ.update({"AI_LIVE_WORKER_TOKEN": "do-not-inherit", "PYTHONPATH": "unsafe-search-path",
                           "OPENAI_API_KEY": "do-not-inherit", "PATH": "unsafe-system-interpreter"})
        bridge = self.make_bridge()
        self.assertEqual(bridge.health(), {"ready": True})
        command, kwargs = self.launches[0]
        self.assertEqual(command, [str(self.root / "runtime" / "python.exe"), "-I", "-B",
                                   str(self.root / "worker" / "managed_worker_entry.py")])
        self.assertFalse(kwargs["shell"])
        self.assertEqual(kwargs["cwd"], self.root)
        self.assertEqual(kwargs["stderr"], subprocess.DEVNULL)
        self.assertEqual(kwargs["env"]["PATH"], str(self.root / "runtime"))
        self.assertEqual(kwargs["env"]["HF_HUB_OFFLINE"], "1")
        for forbidden in ("AI_LIVE_WORKER_TOKEN", "PYTHONPATH", "OPENAI_API_KEY"):
            self.assertNotIn(forbidden, kwargs["env"])
        self.assertEqual(self.processes[0].config, (Path(self.temp.name) / "app", "nvidia", self.root))

    def test_absent_components_never_start_a_process(self):
        self.components.root = None
        self.components.state = "NOT_CONFIGURED"
        bridge = self.make_bridge()
        self.assertFalse(bridge.health()["ready"])
        with self.assertRaises(AgentError) as error:
            self.start(bridge)
        self.assertEqual(error.exception.code, "COMPONENTS_REQUIRED")
        self.assertEqual(self.launches, [])

    def test_unverified_or_missing_private_files_never_launch(self):
        bridge = self.make_bridge()
        self.components.verified = False
        with self.assertRaises(AgentError) as error:
            self.start(bridge)
        self.assertEqual(error.exception.code, "COMPONENTS_REPAIR_REQUIRED")
        self.components.verified = True
        (self.root / "runtime" / "python.exe").unlink()
        with self.assertRaises(AgentError) as error:
            self.start(bridge)
        self.assertEqual(error.exception.code, "COMPONENTS_REQUIRED")
        self.assertEqual(self.launches, [])

    def test_cpu_profile_is_blocked_without_explicit_nonproduction_dev_permission(self):
        self.components.profile = "cpu-dev"
        bridge = self.make_bridge()
        for production in (False, True):
            with self.subTest(production=production), patch.dict(os.environ, {
                "AI_LIVE_DEV_FALLBACK": "true" if production else "false",
                "PRESENTER_PROVIDER": "dev_fallback", "AI_LIVE_ENV": "production" if production else "development",
            }):
                with self.assertRaises(AgentError) as error:
                    self.start(bridge)
                self.assertEqual(error.exception.code, "DEV_FALLBACK_DISABLED")
        self.assertEqual(self.launches, [])

    def test_actual_protocol_converts_start_arguments_audio_and_jpeg(self):
        bridge = self.make_bridge()
        self.start(bridge)
        worker = self.processes[0].worker
        self.assertEqual(worker.calls[0], ("start_session", OWNER, ACCOUNT, (PRODUCT,), self.reference, None))
        pcm = b"\x01\x00\xff\x7f" * 10
        bridge.push_audio(OWNER, SESSION, pcm)
        self.assertEqual(worker.pcm, pcm)
        self.assertEqual(bridge.preview_frame(OWNER, SESSION), JPEG)
        self.assertEqual(bridge.customer_stream(OWNER, SESSION), {"phase": "CONNECTING", "connectionQuality": "UNAVAILABLE"})
        bridge.pause_session(OWNER, SESSION)
        bridge.resume_session(OWNER, SESSION)
        bridge.recover_session(OWNER, SESSION)
        bridge.stop_session(OWNER, SESSION)
        self.assertEqual(len(self.launches), 1)
        bridge.close()
        self.assertTrue(worker.closed)
        self.assertTrue(self.processes[0].stdin.closed)
        self.assertTrue(self.processes[0].stdout.closed)

    def test_owner_and_session_denials_are_redacted_and_do_not_leak_frames(self):
        bridge = self.make_bridge()
        self.start(bridge)
        for owner, session in ((OTHER_OWNER, SESSION), (OWNER, "other-session")):
            for method, extra in ((bridge.preview_frame, ()), (bridge.push_audio, (b"\x00\x00",)),
                                  (bridge.pause_session, ()), (bridge.stop_session, ())):
                with self.subTest(owner=owner, method=method.__name__), self.assertRaises(AgentError) as error:
                    method(owner, session, *extra)
                self.assertEqual(error.exception.code, "SESSION_NOT_FOUND")
                self.assertNotIn("private", error.exception.message)
        self.assertEqual(bridge.preview_frame(OWNER, SESSION), JPEG)

    def test_response_timeout_kills_process_and_closes_pipes(self):
        def drop_response(raw):
            return raw if "ready" in json.loads(raw) else None

        bridge = self.make_bridge(modifier=drop_response)
        self.assertFalse(bridge.health()["ready"])
        process = self.processes[0]
        self.assertTrue(process.killed)
        self.assertTrue(process.stdin.closed)
        self.assertTrue(process.stdout.closed)
        self.assertTrue(process.worker.closed)

    def test_invalid_handshake_is_rejected_and_cleaned(self):
        bridge = self.make_bridge(modifier=lambda _raw: b'{"ready":true,"extra":"private"}\n')
        self.assertFalse(bridge.health()["ready"])
        self.assertTrue(self.processes[0].killed)

    def test_invalid_response_protocol_is_cleaned(self):
        for payload in (b"not-json\n", b'[]\n', b'{"id":9999,"value":{"ready":true}}\n',
                        b'{"id":1}\n', b'{"id":1,"value":{"ready":true},"extra":"private"}\n',
                        b'{"id":1,"value":{"ready":true},"error":"WORKER_UNAVAILABLE"}\n',
                        b'{"id":1,"value":null}', b"x" * (MAX_MESSAGE + 1)):
            with self.subTest(payload=payload[:50]):
                def corrupt(raw):
                    return raw if "ready" in json.loads(raw) else payload

                bridge = self.make_bridge(modifier=corrupt)
                self.assertFalse(bridge.health()["ready"])
                self.assertTrue(self.processes[-1].killed)
                bridge.close()

    def test_dead_process_relaunch_closes_old_pipes_and_discards_old_responses(self):
        bridge = self.make_bridge()
        self.assertTrue(bridge.health()["ready"])
        old = self.processes[0]
        old.returncode = 1
        old.source.close()
        old.thread.join(1)
        self.assertTrue(bridge.health()["ready"])
        self.assertEqual(len(self.launches), 2)
        self.assertTrue(old.stdin.closed)
        self.assertTrue(old.stdout.closed)

    def test_invalid_preview_encoding_fails_safely_and_cleans_process(self):
        def corrupt_frame(raw):
            response = json.loads(raw)
            if isinstance(response.get("value"), dict) and "bytes" in response["value"]:
                response["value"] = {"bytes": "not-valid-base64!"}
            return json.dumps(response).encode() + b"\n"

        bridge = self.make_bridge(modifier=corrupt_frame)
        self.start(bridge)
        with self.assertRaises(AgentError):
            bridge.preview_frame(OWNER, SESSION)
        self.assertTrue(self.processes[0].killed)

    def test_non_jpeg_and_oversized_preview_payloads_are_rejected(self):
        for frame in (b"<svg>unsafe-type</svg>", b"\xff\xd8" + b"x" * (4 * 1024 * 1024) + b"\xff\xd9"):
            with self.subTest(size=len(frame)):
                def replace_frame(raw):
                    response = json.loads(raw)
                    if isinstance(response.get("value"), dict) and "bytes" in response["value"]:
                        response["value"] = {"bytes": base64.b64encode(frame).decode()}
                    return json.dumps(response).encode() + b"\n"

                bridge = self.make_bridge(modifier=replace_frame)
                self.start(bridge)
                with self.assertRaises(AgentError) as error:
                    bridge.preview_frame(OWNER, SESSION)
                self.assertEqual(error.exception.code, "PREVIEW_UNAVAILABLE")
                self.assertTrue(self.processes[-1].killed)
                bridge.close()

    def test_boolean_response_id_cannot_match_integer_request_id(self):
        def boolean_id(raw):
            response = json.loads(raw)
            if "id" in response:
                response["id"] = True
            return json.dumps(response).encode() + b"\n"

        bridge = self.make_bridge(modifier=boolean_id)
        self.assertFalse(bridge.health()["ready"])
        self.assertTrue(self.processes[0].killed)

    def test_stalled_stdin_write_has_bounded_failure_and_cleanup(self):
        bridge = self.make_bridge(hang_method="health")
        result = []
        completed = threading.Event()

        def call():
            try:
                result.append(bridge.health())
            finally:
                completed.set()

        thread = threading.Thread(target=call, daemon=True)
        thread.start()
        bounded = completed.wait(1.5)
        if not bounded and self.processes:
            self.processes[0].kill()  # Always release injected test threads even on a failing implementation.
            completed.wait(2)
        thread.join(1)
        self.assertTrue(bounded, "Private stdin write must time out; pipe backpressure cannot freeze the agent")
        self.assertFalse(result[0]["ready"])
        self.assertTrue(self.processes[0].killed)


class EntryProtocolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.environment = patch.dict(os.environ, {}, clear=False)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.config = {"root": self.temp.name, "componentRoot": self.temp.name, "profile": "nvidia"}

    def serve_messages(self, messages, worker=None):
        worker = worker or OwnedWorker()
        source = io.BytesIO(b"\n".join(json.dumps(value).encode() for value in [self.config, *messages]) + b"\n")
        destination = io.BytesIO()
        serve(source, destination, worker_factory=lambda *_args: worker)
        return worker, [json.loads(line) for line in destination.getvalue().splitlines()]

    def test_unknown_methods_bool_ids_and_extra_fields_never_invoke_worker(self):
        worker, replies = self.serve_messages([
            {"id": 1, "method": "arbitrary_command", "args": ["unsafe"]},
            {"id": True, "method": "health", "args": []},
            {"id": 2, "method": "health", "args": [], "private": "ignored?"},
        ])
        self.assertEqual(replies[0], {"ready": True})
        self.assertTrue(all(response.get("error") == "WORKER_UNAVAILABLE" for response in replies[1:]))
        self.assertEqual(worker.calls, [])
        self.assertTrue(worker.closed)

    def test_error_payload_redacts_exception_text_and_invalid_codes(self):
        class FailedWorker(OwnedWorker):
            def health(self):
                raise AgentError(503, "secret-key/unsafe-path", "streamKey=private-password")

        _, replies = self.serve_messages([{"id": 1, "method": "health", "args": []}], FailedWorker())
        self.assertEqual(replies[-1], {"id": 1, "error": "WORKER_UNAVAILABLE"})
        self.assertNotIn("private-password", json.dumps(replies))

    def test_malformed_outer_protocol_closes_worker(self):
        worker = OwnedWorker()
        source = io.BytesIO(json.dumps(self.config).encode() + b"\nnot-json\n")
        with self.assertRaises(ValueError):
            serve(source, io.BytesIO(), worker_factory=lambda *_args: worker)
        self.assertTrue(worker.closed)

    def test_invalid_initial_config_does_not_construct_worker(self):
        constructed = []
        for config in ({**self.config, "command": "unsafe"}, {**self.config, "profile": "cpu"},
                       {**self.config, "root": "relative-path"}):
            with self.subTest(config=config), self.assertRaises(ValueError):
                serve(io.BytesIO(json.dumps(config).encode() + b"\n"), io.BytesIO(),
                      worker_factory=lambda *_args: constructed.append(True))
        self.assertEqual(constructed, [])


class MultiRoomProcessTests(unittest.TestCase):
    setUp = ManagedRuntimeTests.setUp
    def multi_bridge(self):
        class RoomWorker(OwnedWorker):
            def start_session(self, owner, account, products, reference, microphone):
                self.owner = owner
                self.session = str(uuid.uuid4())
                self.calls.append(("start_session", owner, account, products))
                return self.session

            def _owned(self, owner, session):
                if owner != self.owner or session != self.session:
                    raise AgentError(404, "SESSION_NOT_FOUND", "private-owner")

        def launch(command, **kwargs):
            self.launches.append((command, kwargs))
            process = InheritedPipeProcess(RoomWorker())
            self.processes.append(process)
            return process

        bridge = ManagedRuntimeWorker(Path(self.temp.name) / "app", self.components,
            process_factory=launch, timeout_seconds=0.25)
        self.addCleanup(bridge.close)
        return bridge

    def test_distinct_children_owner_queues_stop_and_crash_isolation(self):
        bridge = self.multi_bridge()
        a = bridge.start_session(OWNER, ACCOUNT, (PRODUCT,), self.reference, None)
        account_b = "11111111-1111-4111-8111-111111111111"
        b = bridge.start_session(OWNER, account_b, (PRODUCT,), self.reference, None)
        self.assertEqual(len(self.processes), 2)
        first, second = self.processes
        self.assertNotEqual(a, b)
        self.assertNotEqual(json.loads(first.stdin.writes[0])["roomId"], json.loads(second.stdin.writes[0])["roomId"])
        bridge.push_audio(OWNER, a, b"\x01\x00")
        bridge.push_audio(OWNER, b, b"\x02\x00")
        self.assertEqual(first.worker.pcm, b"\x01\x00")
        self.assertEqual(second.worker.pcm, b"\x02\x00")
        bridge.pause_session(OWNER, a)
        self.assertNotIn(("pause_session", OWNER, a), second.worker.calls)
        with self.assertRaises(AgentError):
            bridge.push_audio(OTHER_OWNER, b, b"\x03\x00")
        first.kill()
        first.thread.join(1)
        self.assertEqual(bridge.customer_stream(OWNER, a)["phase"], "ERROR")
        self.assertEqual(bridge.preview_frame(OWNER, b), JPEG)
        self.assertFalse(second.killed or second.worker.closed)
        bridge.stop_session(OWNER, a)
        self.assertFalse(second.worker.closed)
        self.assertEqual(bridge.customer_stream(OWNER, a)["phase"], "STOPPED")
        self.assertEqual(len(self.launches), 2, "Stop/crash must not create a replacement live process")
        bridge.stop_session(OWNER, b)
        self.assertTrue(second.worker.closed)

    def test_timed_out_room_cannot_kill_other_room_or_silently_restart(self):
        bridge = self.multi_bridge()
        a = bridge.start_session(OWNER, ACCOUNT, (PRODUCT,), self.reference, None)
        b = bridge.start_session(OWNER, "11111111-1111-4111-8111-111111111111", (PRODUCT,), self.reference, None)
        first, second = self.processes
        first.stdin.hang_method = "push_audio"
        with self.assertRaises(AgentError):
            bridge.push_audio(OWNER, a, b"\x01\x00")
        self.assertTrue(first.killed)
        bridge.pause_session(OWNER, b)
        self.assertFalse(second.killed)
        self.assertEqual(bridge.preview_frame(OWNER, b), JPEG)
        with self.assertRaises(AgentError):
            bridge.resume_session(OWNER, a)
        self.assertEqual(len(self.launches), 2)
        with self.assertRaises(AgentError) as duplicate:
            bridge.start_session(OWNER, ACCOUNT, (PRODUCT,), self.reference, None)
        self.assertEqual(duplicate.exception.code, "SESSION_BUSY")


if __name__ == "__main__":
    unittest.main()
