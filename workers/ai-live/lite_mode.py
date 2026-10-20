"""LIVE Lite Auto: LIVE Pro's worker with low-spec parts plugged in.

Nothing here replaces Pro. LocalWorkerBoundary, LocalAISession (comment
brain, safety voice, recovery), the A/V encoder and the stream transport are
reused as they are; Lite only supplies the factories they already accept:
  engine_factory      -> LitePresenterEngine (prepared pack + light lip-sync)
  ai_provider_factory -> Pro brain wrapped by LiteRoutedBrain + cloud/local voice
  provider_factory    -> LiteDestinationProvider (policy gate, no evasion)
plus a show director so no human host is needed.
"""
from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Callable

from cloud_tts import SpeechProvider, backend_from_env
from lite_brain import LiteRoutedBrain, NoLLMRuntime
from lite_destination import LiteDestinationProvider
from lite_director import LiteShowDirector
from lite_presenter_engine import create_engine
from local_agent.live_worker import LocalWorkerBoundary
from local_brain import LocalBrainProvider

MODE = "LITE_AUTO"


def lite_ai_providers(*, backend_factory: Callable[[], object] = backend_from_env,
                      runtime_factory: Callable[[], object] | None = None):
    """(scope, product_store) -> (brain, voice), the factory LocalWorkerBoundary takes."""
    def build(scope, product_store):
        runtime = runtime_factory() if runtime_factory else NoLLMRuntime()
        brain = LiteRoutedBrain(LocalBrainProvider(runtime, product_store))
        voice = SpeechProvider(backend_factory(), context_id="/".join(vars(scope).values()))
        return brain, voice
    return build


def inspect_lite_capabilities() -> dict[str, object]:
    """Worker readiness for Lite: no CUDA/MuseTalk runtime, only what Lite really uses."""
    import subprocess
    from direct_stream import StreamError, resolve_ffmpeg_path
    from lite_presenter_pack import PresenterPackError, load_pack
    blockers = []
    codec = os.getenv("AI_LIVE_ENCODER", "libx264").strip() or "libx264"
    try:
        ffmpeg = resolve_ffmpeg_path()
        probe = subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                                "color=c=black:s=64x64:r=1", "-frames:v", "1", "-c:v", codec, "-f", "null", "-"],
                               capture_output=True, timeout=15,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if probe.returncode:
            blockers.append("ENCODER_UNUSABLE")
    except (StreamError, OSError, subprocess.TimeoutExpired):
        blockers.append("FFMPEG_UNAVAILABLE")
    pack = os.getenv("AI_LIVE_LITE_PACK_DIR", "").strip()
    try:
        if not pack:
            raise PresenterPackError("LITE_PRESENTER_PACK_REQUIRED")
        load_pack(Path(pack))
    except PresenterPackError as exc:
        blockers.append(exc.code)
    if os.getenv("AI_LIVE_LITE_TTS", "").strip() not in ("azure", "bank", "windows", "espeak"):
        blockers.append("LITE_TTS_NOT_CONFIGURED")
    return {"ready": not blockers, "blockers": blockers, "dev_fallback": False, "mode": MODE,
            "encoder": codec, "presenter_status": "READY" if not blockers else "LITE_SETUP_REQUIRED"}


class LiteWorkerBoundary(LocalWorkerBoundary):
    """Same API and lifecycle as Pro's worker; adds the autonomous director."""

    def __init__(self, data_dir: Path, credential_store, *, seconds_per_product: float | None = None, **kwargs):
        kwargs.setdefault("engine_factory", create_engine)
        kwargs.setdefault("capability_probe", inspect_lite_capabilities)
        kwargs.setdefault("provider_factory", LiteDestinationProvider())
        kwargs.setdefault("ai_provider_factory", lite_ai_providers())
        self.destination = kwargs["provider_factory"]
        super().__init__(data_dir, credential_store, **kwargs)
        self._seconds_per_product = seconds_per_product or float(os.getenv("AI_LIVE_LITE_SECONDS_PER_PRODUCT", "180"))
        self._directors: dict[str, LiteShowDirector] = {}
        self._director_lock = threading.Lock()

    def start_session(self, owner_id, account_id, product_ids, presenter_path, microphone_id):
        if microphone_id is not None:
            # Lite Auto has no human presenter; the microphone path stays Pro-only.
            raise self._error("LITE_MICROPHONE_NOT_USED", 422)
        session_id = super().start_session(owner_id, account_id, product_ids, presenter_path, None)
        record = self._owned(owner_id, session_id)
        director = LiteShowDirector(record.ai, seconds_per_product=self._seconds_per_product, idle_gap_seconds=0.4)
        with self._director_lock:
            self._directors[session_id] = director
        director.start()
        return session_id

    def stop_session(self, owner_id, session_id):
        with self._director_lock:
            director = self._directors.pop(session_id, None)
        if director:
            director.stop()
        return super().stop_session(owner_id, session_id)

    def session_ai_status(self, owner_id, session_id):
        status = super().session_ai_status(owner_id, session_id)
        record = self._owned(owner_id, session_id)
        with self._director_lock:
            director = self._directors.get(session_id)
        destination = getattr(self.destination, "last", None)
        status["lite"] = {
            "mode": MODE,
            "director": director.metrics() if director else None,
            "brain": record.ai.brain.metrics() if record.ai and hasattr(record.ai.brain, "metrics") else None,
            "voice": record.ai.tts.health() if record.ai else None,
            "usage": record.ai.tts.usage() if record.ai and hasattr(record.ai.tts, "usage") else None,
            "destination": None if destination is None else {"kind": destination.kind,
                "commercial": destination.commercial, "platform": destination.platform},
        }
        return status

    def close(self):
        with self._director_lock:
            directors = list(self._directors.values())
            self._directors.clear()
        for director in directors:
            director.stop()
        return super().close()
