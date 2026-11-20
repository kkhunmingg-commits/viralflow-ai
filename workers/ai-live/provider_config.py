"""Explicit development opt-in; deployed production always stays GPU gated."""
from __future__ import annotations

import os
from collections.abc import Mapping


def dev_fallback_enabled(environment: Mapping[str, str] | None = None) -> bool:
    env = os.environ if environment is None else environment
    return (
        env.get("AI_LIVE_DEV_FALLBACK", "").strip().lower() == "true"
        and env.get("PRESENTER_PROVIDER", "musetalk").strip().lower() == "dev_fallback"
        and env.get("NODE_ENV", "").strip().lower() != "production"
        and env.get("VERCEL_ENV", "").strip().lower() != "production"
        and env.get("AI_LIVE_ENV", "").strip().lower() != "production"
        and env.get("APP_ENV", "").strip().lower() != "production"
        and not env.get("VERCEL", "").strip()
    )


def selected_provider() -> str:
    value = os.getenv("PRESENTER_PROVIDER", "musetalk").strip().lower()
    if value not in ("musetalk", "dev_fallback"):
        raise RuntimeError("PRESENTER_PROVIDER_UNSUPPORTED")
    if value == "dev_fallback" and not dev_fallback_enabled():
        raise RuntimeError("DEV_FALLBACK_DISABLED")
    return value
