"""Incremental presenter-frame interface; never render a completed clip as preview."""

from __future__ import annotations

import importlib
import os
from pathlib import Path
from typing import Iterator, Protocol

from provider_config import selected_provider


class FrameEngine(Protocol):
    def prepare(self, reference: Path, fps: int) -> None:
        """Load the model and presenter reference before processing audio."""

    def render_pcm16_chunk(self, audio: bytes) -> Iterator[bytes]:
        """Yield JPEG frames incrementally as the PCM chunk is inferred."""

    def close(self) -> None:
        """Release GPU/model resources."""


def make_engine() -> FrameEngine:
    """Load an explicitly configured, local MuseTalk streaming adapter.

    Official MuseTalk's sample realtime script uses clip files; passing those
    completed files off as a live stream would violate LIVE-1. The adapter must
    yield genuine inference frames while each audio chunk is processed.
    """

    provider = selected_provider()
    renderer = os.getenv("AI_LIVE_AVATAR_RENDERER", "").strip()
    if renderer:
        # V2 uses the same incremental JPEG contract consumed by LiveStore and
        # the proven A/V encoder. No existing default provider is replaced.
        if renderer == "cpu_dev" and provider != "dev_fallback":
            raise RuntimeError("DEV_FALLBACK_DISABLED")
        if renderer != "cpu_dev" and provider == "dev_fallback":
            raise RuntimeError("AVATAR_PROVIDER_CONFIGURATION_MISMATCH")
        from avatar_renderer import AvatarFrameEngine, make_avatar_renderer
        return AvatarFrameEngine(make_avatar_renderer(renderer))
    module_name = (
        "dev_fallback_engine" if provider == "dev_fallback"
        else os.getenv("AI_LIVE_MUSETALK_STREAM_MODULE", "").strip()
    )
    if not module_name:
        raise RuntimeError("incremental MuseTalk frame backend is not configured")
    module = importlib.import_module(module_name)
    factory = getattr(module, "create_engine", None)
    if not callable(factory):
        raise RuntimeError("MuseTalk backend does not export create_engine()")
    engine = factory()
    for method in ("prepare", "render_pcm16_chunk", "close"):
        if not callable(getattr(engine, method, None)):
            raise RuntimeError(f"MuseTalk backend is missing {method}()")
    return engine
