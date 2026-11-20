"""Production admission/controller path, signed grants and test-only hardware evidence."""
from __future__ import annotations
import json
import uuid
import threading

from test_local_agent import (AgentFixture, AgentError, OWNER_A, OWNER_B, ACCOUNT, PRODUCT,
    ORIGIN, REFERENCE_JPEG, signed, VERSIONS, Pairing, supported_hardware, TEST_KEY)
from local_agent.room_capacity import hardware_fingerprint

ACCOUNT_B = "11111111-1111-4111-8111-111111111111"
ACCOUNT_C = "22222222-2222-4222-8222-222222222222"


class RoomWorker:
    def __init__(self):
        self.sessions, self.calls = {}, []

    def health(self):
        return {"ready": True}

    def start_session(self, owner, account, products, path, microphone):
        assert path.is_file()
        session = str(uuid.uuid4())
        self.sessions[session] = {"owner": owner, "account": account, "products": products, "state": "BUSY"}
        self.calls.append(("start", session))
        return session

    def pause_session(self, owner, session):
        assert self.sessions[session]["owner"] == owner
        self.sessions[session]["state"] = "PAUSED"
        self.calls.append(("pause", session))

    def resume_session(self, owner, session):
        self.sessions[session]["state"] = "BUSY"
        self.calls.append(("resume", session))

    def stop_session(self, owner, session):
        self.sessions[session]["state"] = "STOPPED"
        self.calls.append(("stop", session))

    def customer_stream(self, owner, session):
        return {"phase": "STOPPED" if self.sessions[session]["state"] == "STOPPED" else "LIVE",
                "connectionQuality": "GOOD", "secret": "must-not-leak"}


class MultiRoomAgentTests(AgentFixture):
    def create(self, capacity):
        worker = RoomWorker()
        agent = self.make_agent(worker=worker)
        agent._test_room_capacity = capacity  # Explicit test-only fixture; no HTTP or env can set this.
        token, _, self.presenter = self.pair_and_reference(agent)
        return agent, worker, token

    def start_room(self, agent, token, account):
        challenge = str(agent.challenge(token, ORIGIN)["challenge"])
        presenter = agent.upload_reference(token, ORIGIN, REFERENCE_JPEG, "image/jpeg")["presenterId"]
        grant = self.grant(challenge)
        grant["payload"]["accountId"] = account
        return agent.start(token, ORIGIN, {"grant": signed(grant["payload"]), "accountId": account,
            "productIds": [PRODUCT], "presenterId": presenter, "microphoneId": None})

    def test_unknown_capacity_blocks_start_even_with_other_release_gates_validated(self):
        agent, worker, token = self.create(None)
        view = agent.rooms(token, ORIGIN)
        self.assertEqual(view["capacity"]["status"], "UNVERIFIED_CAPACITY")
        self.assertIsNone(view["capacity"]["maximumRooms"])
        self.assertFalse(view["canStart"])
        with self.assertRaises(AgentError) as error:
            self.start_room(agent, token, ACCOUNT)
        self.assertEqual(error.exception.code, "UNVERIFIED_CAPACITY")
        self.assertFalse(worker.calls)

    def test_three_distinct_accounts_admit_then_account_controls_are_isolated(self):
        agent, worker, token = self.create(3)
        a = self.start_room(agent, token, ACCOUNT)["sessionId"]
        b = self.start_room(agent, token, ACCOUNT_B)["sessionId"]
        self.assertNotEqual(a, b)
        self.assertEqual({item["accountId"] for item in agent.rooms(token, ORIGIN)["rooms"]}, {ACCOUNT, ACCOUNT_B})
        agent.pause(token, ORIGIN, a)
        self.assertEqual(worker.sessions[a]["state"], "PAUSED")
        self.assertEqual(worker.sessions[b]["state"], "BUSY")
        self.assertTrue(agent.rooms(token, ORIGIN)["canStart"])
        agent.resume(token, ORIGIN, a)
        c = self.start_room(agent, token, ACCOUNT_C)["sessionId"]
        self.assertEqual(agent.rooms(token, ORIGIN)["capacity"]["activeRooms"], 3)
        with self.assertRaises(AgentError) as duplicate:
            self.start_room(agent, token, ACCOUNT_B)
        self.assertEqual(duplicate.exception.code, "SESSION_BUSY")
        agent.stop(token, ORIGIN, a)
        self.assertEqual(worker.sessions[b]["state"], "BUSY")
        self.assertEqual(worker.sessions[c]["state"], "BUSY")
        self.assertEqual(agent.rooms(token, ORIGIN)["capacity"]["activeRooms"], 2)
        self.assertNotIn("must-not-leak", json.dumps(agent.rooms(token, ORIGIN)))

    def test_room_and_capacity_projection_never_expose_another_owner_sessions(self):
        agent, _, token = self.create(2)
        room = self.start_room(agent, token, ACCOUNT)["sessionId"]
        agent._pairings._tokens["another-owner-token"] = Pairing(ORIGIN, 1800, OWNER_B)
        self.assertEqual(agent.rooms("another-owner-token", ORIGIN)["rooms"], [])
        with self.assertRaises(AgentError) as denied:
            agent.pause("another-owner-token", ORIGIN, room)
        self.assertEqual(denied.exception.code, "SESSION_NOT_FOUND")

    def test_failures_retain_capacity_until_stop_and_a_different_room_continues(self):
        agent, worker, token = self.create(2)
        a = self.start_room(agent, token, ACCOUNT)["sessionId"]
        b = self.start_room(agent, token, ACCOUNT_B)["sessionId"]
        agent.report_worker_failure(a)
        self.assertFalse(agent.rooms(token, ORIGIN)["capacity"]["canStartAnotherRoom"])
        with self.assertRaises(AgentError) as full:
            self.start_room(agent, token, ACCOUNT_C)
        self.assertEqual(full.exception.code, "ROOM_CAPACITY_REACHED")
        agent.stop(token, ORIGIN, a)
        self.assertEqual(worker.sessions[b]["state"], "BUSY")
        self.assertTrue(agent.rooms(token, ORIGIN)["capacity"]["canStartAnotherRoom"])

    def test_only_signed_current_device_hardware_capacity_evidence_admits_rooms(self):
        agent, _, token = self.create(None)
        payload = {"v": 1, "purpose": "AI_LIVE_DEVICE_CAPACITY", "ownerId": OWNER_A,
            "deviceId": agent.config.device_id, "versions": VERSIONS,
            "hardwareFingerprint": hardware_fingerprint(supported_hardware()),
            "benchmarkId": "verified-test-evidence-0001", "measuredAt": 999, "expiresAt": 1300, "maximumRooms": 2}
        path = agent.config.data_dir / "room-capacity.json"
        path.write_text(json.dumps(signed(payload)))
        self.assertEqual(agent.rooms(token, ORIGIN)["capacity"]["maximumRooms"], 2)
        for change in ({"ownerId": OWNER_B}, {"maximumRooms": True}, {"expiresAt": 999},
                       {"versions": {**VERSIONS, "worker": "other"}}, {"hardwareFingerprint": "0" * 64}):
            path.write_text(json.dumps(signed({**payload, **change})))
            self.assertEqual(agent.rooms(token, ORIGIN)["capacity"]["status"], "UNVERIFIED_CAPACITY")
        unsigned = signed(payload)
        unsigned["payload"]["maximumRooms"] = 9
        path.write_text(json.dumps(unsigned))
        self.assertEqual(agent.rooms(token, ORIGIN)["capacity"]["status"], "UNVERIFIED_CAPACITY")

    def test_start_reservation_is_atomic_and_does_not_block_stop_of_another_room(self):
        agent, worker, token = self.create(2)
        b = self.start_room(agent, token, ACCOUNT_B)["sessionId"]
        entered, release, complete = threading.Event(), threading.Event(), threading.Event()
        original_start = worker.start_session
        errors = []

        def slow_start(owner, account, products, path, microphone):
            if account == ACCOUNT:
                entered.set()
                release.wait(3)
            return original_start(owner, account, products, path, microphone)

        worker.start_session = slow_start

        def start():
            try:
                self.start_room(agent, token, ACCOUNT)
            except Exception as error:
                errors.append(error)
            finally:
                complete.set()

        thread = threading.Thread(target=start, daemon=True)
        thread.start()
        try:
            self.assertTrue(entered.wait(1))
            self.assertEqual(agent.rooms(token, ORIGIN)["capacity"]["activeRooms"], 2)
            with self.assertRaises(AgentError) as full:
                self.start_room(agent, token, ACCOUNT_C)
            self.assertEqual(full.exception.code, "ROOM_CAPACITY_REACHED")
            stopped = threading.Event()
            stop_thread = threading.Thread(target=lambda: (agent.stop(token, ORIGIN, b), stopped.set()), daemon=True)
            stop_thread.start()
            self.assertTrue(stopped.wait(0.5), "Stop B must not wait for model initialization in room A")
            self.assertEqual(worker.sessions[b]["state"], "STOPPED")
        finally:
            release.set()
            thread.join(2)
        self.assertTrue(complete.is_set())
        self.assertEqual(errors, [])

    def test_revoke_during_model_start_stops_the_new_room_without_admitting_it(self):
        agent, worker, token = self.create(2)
        entered, release = threading.Event(), threading.Event()
        original_start = worker.start_session
        errors = []

        def slow_start(*arguments):
            entered.set()
            release.wait(3)
            return original_start(*arguments)

        worker.start_session = slow_start

        def start():
            try:
                self.start_room(agent, token, ACCOUNT)
            except AgentError as error:
                errors.append(error.code)

        thread = threading.Thread(target=start, daemon=True)
        thread.start()
        try:
            self.assertTrue(entered.wait(1))
            agent.revoke_device(token, ORIGIN, signed({"v": 1, "purpose": "AI_LIVE_DEVICE_REVOKED",
                "ownerId": OWNER_A, "deviceId": agent.config.device_id, "issuedAt": 1000, "expiresAt": 1120}))
        finally:
            release.set()
            thread.join(2)
        self.assertEqual(errors, ["DEVICE_REVOKED"])
        self.assertTrue(all(item["state"] == "STOPPED" for item in worker.sessions.values()))
        self.assertEqual(agent.rooms(token, ORIGIN)["rooms"], [])
        self.assertEqual(agent.rooms(token, ORIGIN)["capacity"]["activeRooms"], 0)
