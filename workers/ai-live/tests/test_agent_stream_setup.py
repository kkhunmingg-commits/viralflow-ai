"""Server-signed setup/preview boundaries, independent of GPU availability."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_agent.agent import AgentError
from local_agent.stream_credentials import StreamCredentialStore
from test_local_agent import AgentFixture, OWNER_A, OWNER_B, ACCOUNT, ORIGIN, signed
from test_device_identity_fixture import FixtureProtector


class AgentStreamSetupTests(AgentFixture):
    def prepare(self):
        agent = self.make_agent(validated=False, supported=False)
        token, challenge, self.presenter = self.pair_and_reference(agent)
        store = StreamCredentialStore(Path(self.temp.name) / "stream", protector=FixtureProtector())
        agent._stream_credentials = store
        calls = []
        agent._stream_setup_callback = lambda owner, account: calls.append((owner, account))
        return agent, token, challenge, store, calls

    def test_server_scope_opens_native_dialog_without_keys_or_gpu_bypass(self):
        agent, token, challenge, store, calls = self.prepare()
        result = agent.request_stream_setup(token, ORIGIN, self.grant(challenge))
        self.assertEqual(result, {"configured": False})
        self.assertEqual(calls, [(OWNER_A, ACCOUNT)])
        agent.save_stream_setup(OWNER_A, ACCOUNT, "rtmp://127.0.0.1/live", "fixture-secret")
        self.assertEqual(store.load(OWNER_A, ACCOUNT)["stream_key"], "fixture-secret")
        self.assertNotIn("fixture-secret", str(agent.status(token, ORIGIN)))
        self.assertFalse(agent.status(token, ORIGIN)["canStart"])
        self.assertEqual(self.worker.calls, [])
        # A browser/native caller cannot select a different owner or account.
        with self.assertRaisesRegex(AgentError, "STREAM_SETUP_EXPIRED"):
            agent.save_stream_setup(OWNER_B, ACCOUNT, "rtmp://127.0.0.1/live", "attack")

    def test_nonmember_expired_tampered_and_wrong_owner_grants_cannot_configure(self):
        for changed in ({"entitled": False}, {"expiresAt": 999}, {"ownerId": OWNER_B}):
            with self.subTest(changed=changed):
                # Each token challenge is consumed only once on successful setup.
                agent, token, challenge, store, calls = self.prepare()
                grant = self.grant(challenge)
                grant["payload"].update(changed)
                with self.assertRaises(AgentError):
                    agent.request_stream_setup(token, ORIGIN, signed(grant["payload"]))
                self.assertEqual(calls, [])
                self.assertIsNone(store.load(OWNER_A, ACCOUNT))

    def test_save_expiry_and_signed_revocation_clear_owner_credentials(self):
        agent, token, challenge, store, _ = self.prepare()
        agent.request_stream_setup(token, ORIGIN, self.grant(challenge))
        self.clock[0] = 1121
        with self.assertRaisesRegex(AgentError, "STREAM_SETUP_EXPIRED"):
            agent.save_stream_setup(OWNER_A, ACCOUNT, "rtmp://127.0.0.1/live", "fixture")
        self.clock[0] = 1000
        challenge = agent.challenge(token, ORIGIN)["challenge"]
        agent.request_stream_setup(token, ORIGIN, self.grant(challenge))
        agent.save_stream_setup(OWNER_A, ACCOUNT, "rtmp://127.0.0.1/live", "fixture")
        receipt = signed({"v": 1, "purpose": "AI_LIVE_DEVICE_REVOKED", "ownerId": OWNER_A,
            "deviceId": agent.config.device_id, "issuedAt": 1000, "expiresAt": 1120})
        agent.revoke_device(token, ORIGIN, receipt)
        self.assertIsNone(store.load(OWNER_A, ACCOUNT))

    def test_preview_requires_owned_validated_session(self):
        agent = self.make_agent()
        token, challenge, self.presenter = self.pair_and_reference(agent)
        agent.start(token, ORIGIN, self.start_body(challenge))
        actual = b"\xff\xd8real-frame-boundary-fixture\xff\xd9"
        self.worker.preview_frame = lambda owner, session: actual
        self.assertEqual(agent.preview_frame(token, ORIGIN, self.worker.session_id), actual)
        with self.assertRaises(AgentError):
            agent.preview_frame(token, ORIGIN, "ffffffff-ffff-4fff-8fff-ffffffffffff")
        agent._validated = False
        self.assertIsNone(agent.preview_frame(token, ORIGIN, self.worker.session_id))

    def test_stop_pending_is_retried_instead_of_claiming_stopped(self):
        agent = self.make_agent()
        token, challenge, self.presenter = self.pair_and_reference(agent)
        agent.start(token, ORIGIN, self.start_body(challenge))
        original = self.worker.stop_session
        def pending(_owner, _session):
            raise AgentError(503, "WORKER_STOP_PENDING", "กำลังหยุด")
        self.worker.stop_session = pending
        with self.assertRaisesRegex(AgentError, "WORKER_STOP_PENDING"):
            agent.stop(token, ORIGIN, self.worker.session_id)
        self.assertEqual(agent.status(token, ORIGIN)["state"], "STOPPING")
        self.worker.stop_session = original
        self.assertFalse(agent.stop(token, ORIGIN, self.worker.session_id)["sessionActive"])
