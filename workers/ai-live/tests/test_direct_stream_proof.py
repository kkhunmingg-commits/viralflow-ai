"""Failure cleanup for the opt-in proof; no model or network substitutions in acceptance."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from direct_stream_proof import ProofCleanup, main, stop_child, stop_server


class ProofCleanupTests(unittest.TestCase):
    def test_failed_release_does_not_skip_other_resources_or_mask_original_error(self):
        released = []
        cleanup = ProofCleanup()
        def fail():
            released.append("worker")
            raise RuntimeError("native diagnostic must stay private")
        with self.assertRaisesRegex(ValueError, "original"):
            with cleanup:
                cleanup.release(released.append, "player")
                cleanup.release(fail)
                cleanup.release(released.append, "receiver")
                raise ValueError("original")
        self.assertTrue(cleanup.failed)
        self.assertEqual(released, ["receiver", "worker", "player"])

    def test_child_timeout_kills_and_reaps_only_owned_process(self):
        child = Mock()
        child.poll.return_value = None
        child.wait.side_effect = [subprocess.TimeoutExpired("owned", 5), 0]
        stop_child(child)
        child.terminate.assert_called_once()
        child.kill.assert_called_once()
        self.assertEqual(child.wait.call_count, 2)

    def test_never_started_server_thread_does_not_join(self):
        server, thread = Mock(), Mock()
        thread.ident = None
        thread.is_alive.return_value = False
        stop_server(server, thread)
        self.assertTrue(server.should_exit)
        thread.join.assert_not_called()

    def test_unclosed_worker_thread_is_not_reported_as_success(self):
        server, thread = Mock(), Mock()
        thread.is_alive.return_value = True
        with self.assertRaisesRegex(RuntimeError, "PROOF_WORKER_STOP_FAILED"):
            stop_server(server, thread)

    def test_missing_reference_releases_started_resources_and_encrypted_credential(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            context = root / "context.json"
            context.write_text(json.dumps({"ownerId": "owner", "accountId": "account", "products": []}))
            argv = ["proof", "--context", str(context), "--reference", str(root / "missing.png"), "--output", str(root / "out")]
            with patch("sys.argv", argv), patch("direct_stream_proof.dev_fallback_enabled", return_value=True), \
                 patch.dict("os.environ", {"AI_LIVE_DIRECT_STREAM_PROOF": "1"}), \
                 patch("direct_stream_proof.time.sleep"), \
                 patch("direct_stream_proof.ReceiverPlayer") as player, \
                 patch("direct_stream_proof.PlayingRTMPReceiver") as receiver, \
                 patch("local_agent.stream_credentials.StreamCredentialStore") as credentials, \
                 patch("local_agent.live_worker.LocalWorkerBoundary") as worker:
                worker.return_value.close.side_effect = RuntimeError("cleanup diagnostic")
                with self.assertRaises(FileNotFoundError):
                    main()
                worker.return_value.close.assert_called_once()
                credentials.return_value.delete.assert_called_once_with("owner", "account")
                receiver.return_value.stop.assert_called_once()
                player.return_value.stop.assert_called_once()

    def test_receiver_start_failure_still_stops_player_and_partial_receiver(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            context = root / "context.json"
            context.write_text("{}")
            argv = ["proof", "--context", str(context), "--reference", str(root / "reference.png"), "--output", str(root / "out")]
            with patch("sys.argv", argv), patch("direct_stream_proof.dev_fallback_enabled", return_value=True), \
                 patch.dict("os.environ", {"AI_LIVE_DIRECT_STREAM_PROOF": "1"}), \
                 patch("direct_stream_proof.ReceiverPlayer") as player, \
                 patch("direct_stream_proof.PlayingRTMPReceiver") as receiver:
                receiver.return_value.start.side_effect = RuntimeError("start failed")
                with self.assertRaisesRegex(RuntimeError, "start failed"):
                    main()
                receiver.return_value.stop.assert_called_once()
                player.return_value.stop.assert_called_once()


if __name__ == "__main__":
    unittest.main()
