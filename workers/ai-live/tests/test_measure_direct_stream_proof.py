"""Acceptance checks use explicit synthetic reports; no inference or network calls."""
from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from measure_direct_stream_proof import (live_player_measurements, measure, media_command, packet_measurements,
                                         receiver_progress, recording_measurements)


def packets():
    return {"streams": [{"index": 0, "codec_type": "video", "codec_name": "h264"},
                         {"index": 1, "codec_type": "audio", "codec_name": "aac"}],
            "packets": [{"stream_index": index, "pts_time": str(timestamp),
                         "dts_time": str(timestamp), "duration_time": "0.04"}
                        for timestamp in (-.04, 0, .04, .08) for index in (0, 1)]}


def receiver_samples(seconds=601, reconnect_at=90):
    return [{"elapsed_seconds": i, "received_bytes": i if i <= reconnect_at else i - reconnect_at,
             "receiving": True} for i in range(seconds + 1)]


def source_report(duration_ms=600100):
    transport = {"status": "LIVE", "dropped_tags": 0, "dropped_audio": 0, "bitrate_bps": 1000,
                 "queue_depth": 0, "reconnect_count": 1}
    encoder = {"status": "RUNNING", "encoder_fps": 25, "frames_encoded": 15000,
               "held_frames": 14000, "audio_dropped_samples": 0, "av_drift_ms": 8,
               "max_av_drift_ms": 64, "input_av_drift_ms": 0, "bitrate_kbps": 1,
               "queue_depth": 0, "transport": transport}
    before = {"status": "RUNNING", "encoder": encoder, "frames_generated": 1000,
              "average_fps": 1, "p50_latency_ms": 1000, "p95_latency_ms": 1100,
              "inference_audio_drops": 0, "ram_mb": 20}
    return {"completed": True, "measurementStartedAfterRealFrameAndLiveTransport": True,
            "proofBoundary": "LocalWorkerBoundary", "producerSessionCount": 1, "measuredDurationMs": duration_ms,
            "resourcesReleased": True, "productSource": "EXISTING_TEST_FIXTURE",
            "beforeStop": before, "afterStop": {"status": "STOPPED", "resources_released": True,
              "ram_mb": 10, "encoder": {"status": "STOPPED", "transport": {"status": "STOPPED"}}},
            "samples": [{"elapsedMs": 60000, "metrics": before}], "commentsAccepted": 51,
            "duplicatesRejected": 51, "speechCalls": 51, "audioDeliveredBytes": 10000,
            "maxAudioBufferMs": 1000, "maxCommentQueue": 1, "maxActionQueue": 2, "maxPresenterQueue": 4}


def player_report():
    return {"source": "RECEIVER_LIVE_FRAGMENTED_MP4", "fragments_received": 100, "max_cache_bytes": 10000,
            "observations": [{"generation": generation, "currentTime": index, "decodedVideoFrames": index * 25,
                "audioDecodedBytes": index * 16000, "readyState": 4, "playing": True, "soundEnabled": True,
                "audioRms": .05, "errors": 0} for generation in (1, 2) for index in range(1, 6)]}


class ReceiverPacketChecks(unittest.TestCase):
    def test_negative_initial_timestamps_are_valid_and_drift_comes_from_receiver(self):
        result = packet_measurements(packets())
        self.assertTrue(result["timestamps_monotonic"])
        self.assertEqual(result["video_packets"], 4)
        self.assertEqual(result["audio_packets"], 4)
        self.assertEqual(result["av_packet_drift_max_ms"], 0)

    def test_fragment_packet_order_does_not_invent_clock_drift(self):
        value = packets()
        value["packets"].sort(key=lambda packet: packet["stream_index"])
        self.assertEqual(packet_measurements(value)["av_packet_drift_max_ms"], 0)

    def test_timestamp_regression_is_rejected(self):
        value = packets()
        value["packets"][-1]["pts_time"] = "-0.01"
        with self.assertRaisesRegex(RuntimeError, "RECEIVER_TIMESTAMP_REGRESSION"):
            packet_measurements(value)

    def test_missing_audio_packets_are_rejected(self):
        value = packets()
        value["packets"] = [p for p in value["packets"] if p["stream_index"] == 0]
        with self.assertRaisesRegex(RuntimeError, "RECEIVER_AV_MISSING"):
            packet_measurements(value)

    def test_long_packet_gap_is_rejected(self):
        value = packets()
        for packet in value["packets"][-2:]:
            packet.update(pts_time="2", dts_time="2")
        with self.assertRaisesRegex(RuntimeError, "RECEIVER_PACKET_GAP"):
            packet_measurements(value)

    def test_receiver_drift_cannot_be_hidden_by_good_encoder_metrics(self):
        value = packets()
        for packet in value["packets"]:
            if packet["stream_index"] == 1:
                packet["pts_time"] = str(float(packet["pts_time"]) + .5)
                packet["dts_time"] = packet["pts_time"]
        with self.assertRaisesRegex(RuntimeError, "RECEIVER_AV_DRIFT"):
            packet_measurements(value)


class ReceiverContinuityChecks(unittest.TestCase):
    def test_live_progress_and_one_reconnect_cover_the_window(self):
        result = receiver_progress(receiver_samples(), 600.1)
        self.assertEqual(result["observed_reconnects"], 1)
        self.assertEqual(result["max_progress_gap_seconds"], 1)

    def test_live_process_with_unchanging_late_file_fails(self):
        samples = receiver_samples()
        for sample in samples[500:]:
            sample["received_bytes"] = samples[499]["received_bytes"]
        with self.assertRaisesRegex(RuntimeError, "RECEIVER_OUTPUT_STALLED"):
            receiver_progress(samples, 600.1)

    def test_truncated_sample_window_fails(self):
        with self.assertRaisesRegex(RuntimeError, "RECEIVER_WINDOW_INCOMPLETE"):
            receiver_progress(receiver_samples()[:500], 600.1)

    def test_long_unobserved_sample_gap_fails(self):
        samples = receiver_samples()
        del samples[200:230]
        with self.assertRaisesRegex(RuntimeError, "RECEIVER_SAMPLE_GAP"):
            receiver_progress(samples, 600.1)

    def test_regressing_sample_time_fails(self):
        samples = receiver_samples()
        samples[200]["elapsed_seconds"] = 100
        with self.assertRaisesRegex(RuntimeError, "RECEIVER_SAMPLES_INVALID"):
            receiver_progress(samples, 600.1)

    def test_an_unbounded_second_counter_reset_fails(self):
        samples = receiver_samples()
        samples[500]["received_bytes"] = 1
        with self.assertRaisesRegex(RuntimeError, "RECEIVER_UNEXPECTED_RESET"):
            receiver_progress(samples, 600.1)

    def test_bounded_reconnect_interruption_is_allowed(self):
        samples = receiver_samples()
        for sample in samples[91:100]:
            sample["receiving"] = False
        self.assertLessEqual(receiver_progress(samples, 600.1)["max_progress_gap_seconds"], 12)


class AcceptanceChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.source = source_report()
        self.receiver = {"samples": receiver_samples(), "reconnect_injected": True,
                         "worker_closed": True, "receiver_closed": True, "live_player": player_report()}
        self.write_reports()
        (self.directory / "received.flv").write_bytes(b"x" * 90)
        (self.directory / "received-reconnected.flv").write_bytes(b"x" * 511)

    def write_reports(self):
        (self.directory / "pipeline.json").write_text(json.dumps(self.source), encoding="utf-8")
        (self.directory / "receiver.json").write_text(json.dumps(self.receiver), encoding="utf-8")

    def measurement(self, **kwargs):
        def recording(path, *_args):
            return {"filename": path.name, "bytes": path.stat().st_size,
                    "receiver_packets": {"av_span_seconds": 90 if path.name == "received.flv" else 510,
                                         "av_packet_drift_max_ms": 64}}
        with patch("measure_direct_stream_proof.resolve_ffmpeg_path", return_value="fixture"), \
             patch("measure_direct_stream_proof.recording_measurements", side_effect=recording):
            return measure(self.directory, Path("fixture"), **kwargs)

    def test_complete_receiver_acceptance_includes_boundary_and_measured_drift(self):
        result = self.measurement()
        self.assertTrue(result["ten_minute_acceptance"])
        self.assertEqual(result["proof_boundary"], "LocalWorkerBoundary")
        self.assertEqual(result["receiver_av_packet_drift_max_ms"], 64)

    def test_mp4_only_cannot_pass(self):
        (self.directory / "received.flv").unlink()
        (self.directory / "received-reconnected.flv").unlink()
        (self.directory / "completed.mp4").write_bytes(b"complete movie")
        with self.assertRaisesRegex(RuntimeError, "RECEIVER_RECORDINGS_REQUIRED"):
            self.measurement()

    def test_short_duration_requires_explicit_smoke_option(self):
        self.source["measuredDurationMs"] = 12050
        self.receiver["samples"] = receiver_samples(13, 4)
        self.write_reports()
        with self.assertRaisesRegex(RuntimeError, "PROOF_DURATION_TOO_SHORT"):
            self.measurement()
        with patch("measure_direct_stream_proof.recording_measurements", return_value={
                "bytes": 90, "receiver_packets": {"av_span_seconds": 6, "av_packet_drift_max_ms": 64}}), \
             patch("measure_direct_stream_proof.resolve_ffmpeg_path", return_value="fixture"):
            result = measure(self.directory, Path("fixture"), min_duration_seconds=12)
        self.assertFalse(result["ten_minute_acceptance"])

    def test_false_boundary_is_rejected(self):
        self.source["proofBoundary"] = "CompletedMovieUpload"
        self.write_reports()
        with self.assertRaisesRegex(RuntimeError, "PROOF_BOUNDARY_INVALID"):
            self.measurement()

    def test_two_producer_sessions_cannot_pass_reconnect_acceptance(self):
        self.source["producerSessionCount"] = 2
        self.write_reports()
        with self.assertRaisesRegex(RuntimeError, "PROOF_DUPLICATED_PRODUCER_SESSION"):
            self.measurement()

    def test_current_ten_minute_boundary_requires_observed_live_playback(self):
        self.receiver.pop("live_player")
        self.write_reports()
        with self.assertRaisesRegex(RuntimeError, "PLAYER_RECONNECT_EVIDENCE_REQUIRED"):
            self.measurement()

    def test_short_smoke_can_finish_without_browser_observations(self):
        self.source["measuredDurationMs"] = 12050
        self.receiver["samples"] = receiver_samples(13, 4)
        self.receiver.pop("live_player")
        self.write_reports()
        self.assertFalse(self.measurement(min_duration_seconds=12)["live_player"]["before_and_after_reconnect_verified"])

    def test_legacy_artifacts_are_explicitly_identified(self):
        self.source.pop("proofBoundary")
        self.write_reports()
        self.assertEqual(self.measurement()["proof_boundary"], "LEGACY_DEV_STORE")

    def test_pending_stop_cannot_claim_released(self):
        self.source["afterStop"]["encoder"]["transport"]["status"] = "LIVE"
        self.write_reports()
        with self.assertRaisesRegex(RuntimeError, "PROOF_RESOURCES_NOT_RELEASED"):
            self.measurement()

    def test_nonzero_decoder_error_even_with_success_exit_is_rejected_without_diagnostics(self):
        result = subprocess.CompletedProcess([], 0, b"", b"private-key path: late decoder error")
        with patch("measure_direct_stream_proof.subprocess.run", return_value=result), \
             self.assertRaisesRegex(RuntimeError, "^PROOF_MEDIA_CHECK_FAILED$"):
            media_command(["fixture"])

    def test_full_decode_failure_cannot_be_hidden_by_a_valid_introduction(self):
        metadata = packets()
        metadata["format"] = {"duration": "12"}
        with patch("measure_direct_stream_proof.media_command", side_effect=[
                json.dumps(metadata).encode(), RuntimeError("PROOF_MEDIA_CHECK_FAILED")]), \
             self.assertRaisesRegex(RuntimeError, "PROOF_MEDIA_CHECK_FAILED"):
            recording_measurements(self.directory / "received.flv", Path("fixture"), "fixture")


class LivePlayerChecks(unittest.TestCase):
    def test_actual_decode_and_audible_playback_before_and_after_reconnect_are_summarized(self):
        result = live_player_measurements(player_report(), required=True)
        self.assertTrue(result["before_and_after_reconnect_verified"])
        self.assertEqual([c["generation"] for c in result["connections"]], [1, 2])
        self.assertTrue(all(c["video_frames_progress"] > 0 and c["audio_bytes_progress"] > 0
                            and c["sound_enabled"] and c["audio_rms_max"] > 0 for c in result["connections"]))

    def test_missing_post_reconnect_generation_is_rejected(self):
        data = player_report()
        data["observations"] = [r for r in data["observations"] if r["generation"] == 1]
        with self.assertRaisesRegex(RuntimeError, "PLAYER_RECONNECT_EVIDENCE_REQUIRED"):
            live_player_measurements(data, required=True)

    def test_observed_zero_browser_rms_is_reported_without_inventing_audio_energy(self):
        data = player_report()
        for row in data["observations"]:
            if row["generation"] == 2:
                row["audioRms"] = 0
        result = live_player_measurements(data, required=True)
        self.assertEqual(result["connections"][1]["audio_rms_max"], 0)

    def test_muted_post_reconnect_playback_is_rejected(self):
        data = player_report()
        for row in data["observations"]:
            if row["generation"] == 2:
                row["soundEnabled"] = False
        with self.assertRaisesRegex(RuntimeError, "PLAYER_SOUND_ENABLED_PROGRESS_MISSING"):
            live_player_measurements(data, required=True)

    def test_nominal_playing_flag_cannot_hide_frozen_decode(self):
        data = player_report()
        data["observations"].extend(copy.deepcopy(data["observations"][-1]) for _ in range(15))
        with self.assertRaisesRegex(RuntimeError, "PLAYER_PLAYBACK_FROZEN"):
            live_player_measurements(data, required=True)

    def test_player_decoder_error_is_rejected(self):
        data = player_report()
        data["observations"][-1]["errors"] = 1
        with self.assertRaisesRegex(RuntimeError, "PLAYER_DECODE_FAILED"):
            live_player_measurements(data, required=True)

    def test_raw_fields_are_not_echoed_into_summary(self):
        data = player_report()
        data["stream_key"] = "never-echo-private-key"
        data["observations"][0]["debug_url"] = "rtmp://private.example/key"
        result = json.dumps(live_player_measurements(data, required=True))
        self.assertNotIn("never-echo", result)
        self.assertNotIn("private.example", result)


if __name__ == "__main__":
    unittest.main()
