from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import threading
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

WORKER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER))

from avatar_renderer import (AvatarFrameEngine, AvatarRenderer, DittoRenderer, FasterLivePortraitAdapter,
    GPUCandidateRenderer, IncrementalAvatarRenderer, MuseTalkHybrid, RenderedFrame, RendererCapabilities,
    RendererUnavailable, inspect_renderer_dependencies)
from engine import make_engine
from gesture_engine import Gesture, GestureEngine
from hybrid_compositor import GuardedHybridFrameEngine, HybridCompositor, HybridRenderInput, InferenceLayer
from motion_guards import MotionObservation, MotionQualityGuard, OcclusionGuard, OcclusionObservation, Region
from renderer_benchmark import BenchmarkRecorder, run_benchmark
from renderer_capacity import CapacityEvidence, HardwareCapacityPlanner, RendererDevice

JPEG = b"\xff\xd8unit-contract-fixture\xff\xd9"
PCM = b"\x01\x00" * 16000
READY = {"cuda_available": True, "dependencies_available": True, "backend_available": True,
         "models_available": True, "streaming_validated": True, "validated_gestures": ["neutral", "nod"]}


class ContractBackend:
    """Tests only. Production tests mock the inference boundary, not orchestration."""
    def __init__(self):
        self.closed = 0
        self.audio = []
        self.gestures = []

    def prepare(self, reference, fps):
        self.fps = fps

    def render_pcm16_chunk(self, pcm):
        self.audio.append(pcm)
        yield JPEG

    def set_gesture(self, gesture):
        self.gestures.append(gesture)

    def close(self):
        self.closed += 1


class AvatarRendererTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.reference = Path(self.temp.name) / "reference.jpg"
        self.reference.write_bytes(JPEG)

    def test_all_hardware_candidates_fail_gpu_gate_without_constructing_backend(self):
        for cls in (MuseTalkHybrid, DittoRenderer, FasterLivePortraitAdapter):
            calls = []
            renderer = cls(capability_probe=lambda: {"cuda_available": False}, backend_factory=lambda: calls.append(1))
            self.assertIsInstance(renderer, AvatarRenderer)
            self.assertEqual(renderer.health()["status"], "GPU_REQUIRED")
            with self.assertRaisesRegex(RendererUnavailable, "GPU_REQUIRED"):
                renderer.load_presenter(self.reference, 25)
            self.assertEqual(calls, [])

    def test_dependencies_and_real_streaming_validation_are_separate_gates(self):
        for missing, expected in (("dependencies_available", "DEPENDENCIES_REQUIRED"),
                                  ("backend_available", "INCREMENTAL_BACKEND_REQUIRED"),
                                  ("models_available", "MODELS_REQUIRED"),
                                  ("streaming_validated", "GPU_VALIDATION_REQUIRED")):
            probe = {**READY, missing: False}
            renderer = DittoRenderer(capability_probe=lambda: probe)
            self.assertEqual(renderer.health()["status"], expected)
            self.assertFalse(renderer.health()["ready"])

    def test_target_body_capability_is_not_claimed_from_cuda_or_lip_sync_only(self):
        renderer = MuseTalkHybrid(capability_probe=lambda: READY)
        self.assertFalse(renderer.capabilities().body_motion)
        self.assertFalse(renderer.capabilities().head_motion)
        self.assertNotIn(Gesture.SMALL_WAVE, renderer.capabilities().gestures)
        renderer = MuseTalkHybrid(capability_probe=lambda: {**READY, "head_motion_validated": True})
        self.assertTrue(renderer.capabilities().head_motion)
        self.assertFalse(renderer.capabilities().body_motion)

    def test_benchmark_mode_is_explicit_and_never_approves_production(self):
        probe = {**READY, "streaming_validated": False}
        production = DittoRenderer(capability_probe=lambda: probe)
        benchmark = DittoRenderer(capability_probe=lambda: probe, benchmark_only=True)
        self.assertFalse(production.health()["ready"])
        self.assertEqual(benchmark.health()["status"], "BENCHMARK_READY")
        self.assertFalse(benchmark.health()["performance_verified"])

    def test_v2_outputs_actual_backend_bytes_with_monotonic_frame_clock(self):
        backend = ContractBackend()
        renderer = DittoRenderer(capability_probe=lambda: READY, backend_factory=lambda: backend)
        renderer.load_presenter(self.reference, 25)
        first = list(renderer.render_audio(PCM))[0]
        second = list(renderer.render_audio(PCM))[0]
        self.assertEqual((first.jpeg, second.jpeg), (JPEG, JPEG))
        self.assertEqual((first.pts_us, second.pts_us, second.duration_us), (0, 40000, 40000))
        renderer.set_gesture(Gesture.NOD)
        self.assertEqual(backend.gestures, ["nod"])
        self.assertEqual(backend.audio, [PCM, PCM])
        renderer.stop()
        renderer.stop()
        self.assertEqual(backend.closed, 1)

    def test_v2_does_not_accept_backend_frames_ahead_of_audio(self):
        backend = ContractBackend()
        def burst(pcm):
            yield JPEG
            yield JPEG
        backend.render_pcm16_chunk = burst
        renderer = DittoRenderer(capability_probe=lambda: READY, backend_factory=lambda: backend)
        renderer.load_presenter(self.reference, 25)
        with self.assertRaisesRegex(RendererUnavailable, "FRAME_TIMELINE_EXCEEDS_AUDIO"):
            list(renderer.render_audio(b"xx"))
        self.assertEqual(renderer.health()["status"], "FAILED")
        renderer.stop()

    def test_native_release_timeout_is_bounded_and_does_not_claim_stopped(self):
        backend = ContractBackend()
        release = threading.Event()
        entered = threading.Event()
        def close():
            entered.set()
            release.wait(5)
            backend.closed += 1
        backend.close = close
        renderer = DittoRenderer(capability_probe=lambda: READY, backend_factory=lambda: backend)
        renderer.load_presenter(self.reference, 25)
        try:
            with self.assertRaisesRegex(RendererUnavailable, "RENDERER_RELEASE_PENDING"):
                renderer.stop()
            self.assertTrue(entered.is_set())
            self.assertEqual(renderer.health()["status"], "STOPPING")
        finally:
            release.set()
            renderer.stop()
        self.assertEqual(backend.closed, 1)

    def test_existing_make_engine_can_select_v2_cpu_and_preserve_jpeg_boundary(self):
        backend = ContractBackend()
        env = {"AI_LIVE_AVATAR_RENDERER": "cpu_dev", "PRESENTER_PROVIDER": "dev_fallback", "AI_LIVE_DEV_FALLBACK": "true"}
        with patch.dict(os.environ, env, clear=True), patch("dev_fallback_engine.create_engine", return_value=backend), \
                patch("dev_fallback_engine.probe_readiness", return_value={"ready": True, "status": "READY"}):
            engine = make_engine()
            self.assertIsInstance(engine, AvatarFrameEngine)
            engine.prepare(self.reference, 2)
            self.assertEqual(list(engine.render_pcm16_chunk(PCM)), [JPEG])
            engine.close()
        self.assertEqual(backend.closed, 1)

    def test_existing_production_make_engine_selects_real_adapter_without_mock(self):
        backend = ContractBackend()
        with patch.dict(os.environ, {"PRESENTER_PROVIDER": "musetalk", "AI_LIVE_AVATAR_RENDERER": "ditto"}, clear=True), \
                patch("avatar_renderer.GPUCandidateRenderer._default_probe", return_value=READY), \
                patch("avatar_renderer.GPUCandidateRenderer._configured_factory", return_value=backend):
            engine = make_engine()
            engine.prepare(self.reference, 25)
            self.assertEqual(list(engine.render_pcm16_chunk(PCM)), [JPEG])
            engine.close()

    def test_old_default_cpu_selection_still_uses_original_engine_directly(self):
        backend = ContractBackend()
        with patch.dict(os.environ, {"PRESENTER_PROVIDER": "dev_fallback", "AI_LIVE_DEV_FALLBACK": "true"}, clear=True), \
                patch("dev_fallback_engine.create_engine", return_value=backend):
            self.assertIs(make_engine(), backend)

    def test_dependency_manifest_is_used_and_does_not_download(self):
        with patch("avatar_renderer._dependency_exists", return_value=True):
            detected = inspect_renderer_dependencies("ditto", {})
        self.assertEqual(detected["status"], "SOURCE_REQUIRED")
        self.assertFalse(detected["models_available"])
        self.assertIn("stream_pipeline_online.py", detected["missing_source"])


class GestureAndGuardTests(unittest.TestCase):
    def test_cooldown_neutral_recovery_repetition_and_stillness(self):
        engine = GestureEngine(probability=1, rng=lambda: 0)
        all_gestures = frozenset(Gesture)
        self.assertEqual(engine.choose("greeting", 0, all_gestures).gesture, Gesture.SMALL_WAVE)
        self.assertEqual(engine.current(2).gesture, Gesture.NEUTRAL)
        self.assertEqual(engine.choose("greeting", 3, all_gestures).gesture, Gesture.NEUTRAL)
        self.assertEqual(engine.choose("greeting", 7, all_gestures).gesture, Gesture.SMILE)
        self.assertEqual(engine.choose("greeting", 30, all_gestures).gesture, Gesture.NEUTRAL)
        self.assertEqual(engine.choose("unknown", 40, all_gestures).gesture, Gesture.NEUTRAL)
        self.assertEqual(engine.choose("safety", 41, all_gestures).gesture, Gesture.NEUTRAL)
        self.assertEqual(engine.metrics()["history_depth"], 2)

    def test_probability_cannot_drive_constant_motion(self):
        engine = GestureEngine(probability=.4, rng=lambda: .9)
        self.assertEqual(engine.choose("product_cta", 0, frozenset(Gesture)).gesture, Gesture.NEUTRAL)
        with self.assertRaisesRegex(ValueError, "GESTURE_TIME_NOT_MONOTONIC"):
            engine.current(-1)

    def test_unknown_or_stale_occlusion_downgrades_before_hand_motion(self):
        guard = OcclusionGuard()
        supported = frozenset(Gesture)
        result = guard.evaluate(Gesture.LIGHT_HAIR_TOUCH, supported, None, now=1)
        self.assertTrue(result.blocked)
        self.assertEqual(result.gesture, Gesture.NOD)
        observation = self._observation()
        self.assertTrue(guard.evaluate(Gesture.SMALL_WAVE, supported, observation, now=10).blocked)
        self.assertEqual(guard.metrics()["blocked_gesture_count"], 2)

    def _observation(self, hand=None):
        return OcclusionObservation(.99, (hand or Region(.01, .7, .1, .1),), Region(.3, .1, .4, .5),
                                    Region(.4, .4, .15, .1), (Region(.35, .2, .1, .05),), Region(.7, .6, .2, .2), 1)

    def test_face_mouth_eyes_and_product_regions_block_hand_overlap(self):
        guard = OcclusionGuard()
        for hand in (Region(.4, .4, .1, .1), Region(.35, .2, .1, .05), Region(.75, .65, .1, .1)):
            result = guard.evaluate(Gesture.POINT_PRODUCT, frozenset(Gesture), self._observation(hand), now=1.1)
            self.assertTrue(result.blocked)
            self.assertEqual(result.reason, "PROTECTED_REGION_OCCLUDED")
        self.assertFalse(guard.evaluate(Gesture.SMALL_WAVE, frozenset(Gesture), self._observation(), now=1.1).blocked)

    def test_unsupported_renderer_falls_back_to_neutral(self):
        result = OcclusionGuard().evaluate(Gesture.HOLD_PRODUCT, {Gesture.NEUTRAL}, self._observation(), now=1)
        self.assertEqual(result.gesture, Gesture.NEUTRAL)
        self.assertTrue(result.blocked)

    def test_motion_degrades_safe_to_neutral_then_recovers_only_on_measured_good_frames(self):
        guard = MotionQualityGuard(recovery_frames=2)
        good = MotionObservation(.99, .99, .99, .1, .99, 0, True, 1)
        failed = guard.evaluate(Gesture.SMALL_WAVE, replace(good, face_integrity=.1), now=1, has_latest_real_frame=True)
        self.assertFalse(failed.emit_candidate)
        self.assertTrue(failed.hold_latest_real_frame)
        self.assertEqual(failed.gesture, Gesture.NOD)
        failed = guard.evaluate(Gesture.SMALL_WAVE, None, now=1, has_latest_real_frame=True)
        self.assertEqual(failed.gesture, Gesture.NEUTRAL)
        for _ in range(4):
            self.assertTrue(guard.evaluate(Gesture.SMALL_WAVE, good, now=1, has_latest_real_frame=True).emit_candidate)
        self.assertEqual(guard.metrics()["motion_level"], "ADVANCED")

    def test_motion_missing_lip_hand_frozen_and_temporal_instability_are_rejected(self):
        good = MotionObservation(.99, .99, .99, .1, .99, 0, True, 1)
        for observation in (replace(good, lip_integrity=None), replace(good, hand_integrity=.3),
                            replace(good, frozen_seconds=4), replace(good, temporal_stability=.2),
                            replace(good, movement=float("nan")), replace(good, measured_at=0)):
            result = MotionQualityGuard().evaluate(Gesture.OPEN_PALM, observation, now=1, has_latest_real_frame=False)
            self.assertFalse(result.emit_candidate)
            self.assertFalse(result.hold_latest_real_frame)


class CompositorTests(unittest.TestCase):
    """Colored JPEGs are compositor fixtures only; not presenter/GPU proof."""
    @staticmethod
    def frame(color, sequence=0):
        from PIL import Image
        buffer = io.BytesIO()
        Image.new("RGB", (32, 32), color).save(buffer, format="JPEG")
        return RenderedFrame(buffer.getvalue(), sequence * 40000, 40000, sequence, True)

    def test_composes_registered_real_layers_without_overwriting_lip(self):
        from PIL import Image
        lip = self.frame("red")
        layer_quality = MotionObservation(.99, .99, None, .1, .99, 0, True, 1)
        head = InferenceLayer(self.frame("blue"), Region(0, 0, 1, 1), .99, 0, layer_quality)
        compositor = HybridCompositor(frozenset(Gesture))
        observation = MotionObservation(.99, .99, None, .1, .99, 0, True, 1)
        frame = compositor.compose(lip, Region(.3, .3, .4, .4), gesture=Gesture.NEUTRAL,
                                   observation=observation, occlusion=None, measured_now=1, head=head)
        self.assertIsNotNone(frame)
        with Image.open(io.BytesIO(frame.jpeg)) as image:
            self.assertGreater(image.getpixel((16, 16))[0], 200)
            self.assertGreater(image.getpixel((2, 2))[2], 200)
        self.assertEqual(frame.pts_us, 0)

    def test_unknown_quality_holds_only_previously_accepted_real_frame(self):
        compositor = HybridCompositor(frozenset(Gesture))
        observation = MotionObservation(.99, .99, None, .1, .99, 0, True, 1)
        first = compositor.compose(self.frame("red"), Region(.3, .3, .4, .4), gesture=Gesture.NEUTRAL,
                                   observation=observation, occlusion=None, measured_now=1)
        second = compositor.compose(self.frame("green", 1), Region(.3, .3, .4, .4), gesture=Gesture.NEUTRAL,
                                    observation=None, occlusion=None, measured_now=2)
        self.assertEqual(first.jpeg, second.jpeg)
        self.assertEqual(second.pts_us, 40000)
        self.assertTrue(second.held)
        self.assertEqual(compositor.metrics()["held_real_frames"], 1)

    def test_unvalidated_first_frame_is_not_replaced_with_synthetic_frame(self):
        compositor = HybridCompositor(frozenset(Gesture))
        result = compositor.compose(self.frame("red"), Region(.3, .3, .4, .4), gesture=Gesture.NEUTRAL,
                                    observation=None, occlusion=None, measured_now=0)
        self.assertIsNone(result)

    def test_stale_unregistered_layer_is_rejected_and_non_inference_forbidden(self):
        compositor = HybridCompositor(frozenset(Gesture))
        observation = MotionObservation(.99, .99, None, .1, .99, 0, False, 1)
        layer = InferenceLayer(self.frame("blue", 2), Region(0, 0, 1, 1), .99, 2)
        compositor.compose(self.frame("red"), Region(.3, .3, .4, .4), gesture=Gesture.NEUTRAL,
                           observation=observation, occlusion=None, measured_now=1, head=layer)
        self.assertEqual(compositor.metrics()["rejected_layers"], 1)
        with self.assertRaisesRegex(ValueError, "REAL_INFERENCE_REQUIRED"):
            compositor.compose(replace(self.frame("red", 1), real_inference=False), Region(.3, .3, .4, .4), gesture=Gesture.NEUTRAL,
                               observation=observation, occlusion=None, measured_now=1)

    def test_production_hybrid_boundary_downgrades_unmeasured_hand_before_source_inference(self):
        frames = [self.frame("red", 0), self.frame("red", 1)]
        class FixtureLipRenderer:
            def load_presenter(self, reference, fps): pass
            def render_audio(self, audio):
                yield frames.pop(0)
            def stop(self): pass
            def interrupt(self): pass
        class FixtureMeasuredSource:
            """Tests only; does not implement or claim GPU motion inference."""
            selected = []
            def prepare(self, reference, fps): pass
            def predict_occlusion(self, lip, requested): return None, lip.sequence + 1
            def render_layers(self, lip, audio, gesture):
                self.selected.append(gesture)
                now = lip.sequence + 1
                quality = MotionObservation(.99, .99, None, .1, .99, 0, True, now)
                return HybridRenderInput(Region(.3, .3, .4, .4), quality, None, now)
            def close(self): pass
        source = FixtureMeasuredSource()
        backend = GuardedHybridFrameEngine(FixtureLipRenderer(), source, frozenset(Gesture))
        proof = {**READY, "validated_gestures": ["small_wave", "nod"], "body_motion_validated": True}
        renderer = MuseTalkHybrid(capability_probe=lambda: proof, backend_factory=lambda: backend)
        with tempfile.TemporaryDirectory() as root:
            reference = Path(root) / "reference.jpg"
            reference.write_bytes(JPEG)
            renderer.load_presenter(reference, 25)
            renderer.set_gesture(Gesture.SMALL_WAVE)
            first = list(renderer.render_audio(PCM))[0]
            second = list(renderer.render_audio(PCM))[0]
        self.assertEqual(source.selected, [Gesture.NOD, Gesture.NOD])
        self.assertEqual((first.pts_us, second.pts_us), (0, 40000))
        self.assertEqual(renderer.metrics()["blocked_gesture_count"], 2)
        renderer.stop()

    def test_unguarded_hybrid_backend_cannot_reach_live_encoder(self):
        backend = ContractBackend()
        renderer = MuseTalkHybrid(capability_probe=lambda: READY, backend_factory=lambda: backend)
        with tempfile.TemporaryDirectory() as root:
            reference = Path(root) / "reference.jpg"
            reference.write_bytes(JPEG)
            with self.assertRaisesRegex(RendererUnavailable, "GUARDED_HYBRID_BACKEND_REQUIRED"):
                renderer.load_presenter(reference, 25)
        self.assertEqual(backend.closed, 1)


class CapacityAndHarnessTests(unittest.TestCase):
    def setUp(self):
        self.device = RendererDevice("unmeasured NVIDIA", 24000, 64000, "driver", "ditto", "revision", "runtime")
        self.planner = HardwareCapacityPlanner()

    def evidence(self, rooms):
        return CapacityEvidence(self.device.fingerprint(), rooms, 100, 600, 25, 90, 50, 0, 0,
                                True, True, True, True, True, True, 10)

    def test_gpu_name_vram_and_unknown_measurements_never_approve_capacity(self):
        report = self.planner.evaluate(self.device, [], now=100)
        self.assertEqual(report["status"], "UNVERIFIED_CAPACITY")
        self.assertIsNone(report["max_rooms"])
        partial = replace(self.evidence(1), lip_sync_passed=None)
        self.assertIsNone(self.planner.evaluate(self.device, [partial], now=100)["max_rooms"])

    def test_capacity_requires_matching_recent_stable_complete_sequential_evidence(self):
        result = self.planner.evaluate(self.device, [self.evidence(1), self.evidence(2), self.evidence(3)], now=100)
        self.assertEqual(result["max_rooms"], 3)
        self.assertIsNone(self.planner.evaluate(self.device, [self.evidence(3)], now=100)["max_rooms"])
        for bad in (replace(self.evidence(1), duration_seconds=599), replace(self.evidence(1), fingerprint="other"),
                    replace(self.evidence(1), max_av_drift_ms=500), replace(self.evidence(1), crash_count=1),
                    replace(self.evidence(1), minimum_room_fps=float("nan"))):
            self.assertIsNone(self.planner.evaluate(self.device, [bad], now=100)["max_rooms"])
        self.assertIsNone(self.planner.evaluate(self.device, [self.evidence(1)], now=100 + 8 * 86400)["max_rooms"])

    def test_benchmark_without_gpu_is_not_run_with_null_measurements_and_no_audio_read(self):
        report = run_benchmark("ditto", 3, reference=Path("missing"), audio=Path("missing"), output=Path("not-created"),
                               renderer_factory=lambda: DittoRenderer(capability_probe=lambda: {"cuda_available": False}))
        self.assertEqual(report["status"], "NOT_RUN")
        self.assertEqual(report["reason"], "GPU_REQUIRED")
        self.assertTrue(all(value is None for value in report["metrics"].values()))

    def test_recorder_uses_observed_metrics_and_preserves_unknowns(self):
        with patch("renderer_benchmark._nvidia_sample", return_value={"vram_used_mb": None, "gpu_utilization_percent": None}), \
                patch("renderer_benchmark._process_ram_mb", return_value=None):
            recorder = BenchmarkRecorder()
            for latency in (10, 20, 30, 40):
                recorder.frame(latency, True)
            result = recorder.finish({"status": "RUNNING", "max_av_drift_ms": 25}, elapsed=2)
        self.assertEqual(result["fps"], 2)
        self.assertEqual(result["p50_latency_ms"], 25)
        self.assertEqual(result["p95_latency_ms"], 40)
        self.assertIsNone(result["lip_sync"])
        self.assertEqual(result["stability"], "INCOMPLETE")

    def test_renderer_planning_manifest_is_packaged_inside_signed_runtime_input(self):
        from installer.build_components import stage_worker
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / "worker"
            stage_worker(WORKER, target)
            plan = json.loads((target / "renderer-dependencies.json").read_text())
            self.assertFalse(plan["automatic_download"])
            self.assertTrue((target / "avatar_renderer.py").is_file())


if __name__ == "__main__":
    unittest.main()
