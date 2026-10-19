"""LIVE Lite Auto presenter/voice choice for the Dashboard.

Only installed, verified presenter packs under the device-configured
``AI_LIVE_LITE_PACKS_ROOT`` can be chosen, by folder name; the browser never
supplies a path. Voices come from a fixed Thai allowlist. Speech keys are never
read or returned here (only the key store's metadata).
"""
from __future__ import annotations

import hashlib
import os
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path

PACKS_ROOT_ENV = "AI_LIVE_LITE_PACKS_ROOT"
# Azure Thai neural voices offered to customers; validated strictly.
LITE_VOICES: tuple[tuple[str, str], ...] = (
    ("th-TH-PremwadeeNeural", "เปรมวดี (หญิง)"),
    ("th-TH-AcharaNeural", "อัจฉรา (หญิง)"),
    ("th-TH-NiwatNeural", "นิวัฒน์ (ชาย)"),
)
LITE_VOICE_IDS = frozenset(voice for voice, _label in LITE_VOICES)
# Folder names are URL path segments; no dots-first, separators or encoding.
FOLDER_PATTERN = re.compile(r"^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$")
MAX_THUMBNAIL_BYTES = 4 * 1024 * 1024
CATALOG_TTL_SECONDS = 60.0


class LitePresenterError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class LitePresenterChoice:
    folder: str
    pack_dir: Path
    reference_path: Path
    voice: str


def packs_root() -> Path | None:
    value = os.getenv(PACKS_ROOT_ENV, "").strip()
    if not value:
        return None
    root = Path(value)
    if not root.is_absolute() or root.is_symlink() or not root.is_dir():
        return None
    return root


def voices() -> list[dict[str, str]]:
    return [{"id": voice, "label": label} for voice, label in LITE_VOICES]


def _signature(root: Path) -> tuple:
    entries = []
    try:
        for child in sorted(root.iterdir())[:50]:
            manifest = child / "manifest.json"
            try:
                stat = manifest.stat()
                entries.append((child.name, stat.st_mtime_ns, stat.st_size))
            except OSError:
                entries.append((child.name, None, None))
    except OSError:
        return ()
    return tuple(entries)


class LitePresenterCatalog:
    """Cached ``list_packs`` (verifying a pack hashes every frame) for one packs root."""

    def __init__(self, root_resolver=packs_root, *, clock=time.monotonic):
        self._root_resolver = root_resolver
        self._clock = clock
        self._lock = threading.Lock()
        self._cache: tuple[Path, tuple, float, list[dict]] | None = None

    def root(self) -> Path | None:
        try:
            return self._root_resolver()
        except Exception:
            return None

    def presenters(self) -> list[dict]:
        root = self.root()
        if root is None:
            return []
        signature = _signature(root)
        with self._lock:
            cached = self._cache
            if (cached is not None and cached[0] == root and cached[1] == signature
                    and self._clock() - cached[2] < CATALOG_TTL_SECONDS):
                return [dict(item) for item in cached[3]]
        try:
            from lite_presenter_pack import list_packs
            listed = list_packs(root)
        except Exception:
            # Missing optional dependencies or unreadable packs: nothing to choose.
            listed = []
        safe = [item for item in listed if isinstance(item.get("folder"), str) and FOLDER_PATTERN.fullmatch(item["folder"])]
        with self._lock:
            self._cache = (root, signature, self._clock(), safe)
        return [dict(item) for item in safe]

    def _pack(self, folder: object):
        if not isinstance(folder, str) or not FOLDER_PATTERN.fullmatch(folder):
            raise LitePresenterError("LITE_PRESENTER_NOT_FOUND")
        root = self.root()
        if root is None or folder not in {item["folder"] for item in self.presenters()}:
            raise LitePresenterError("LITE_PRESENTER_NOT_FOUND")
        pack_dir = root / folder
        if pack_dir.is_symlink() or root.resolve() not in pack_dir.resolve().parents:
            raise LitePresenterError("LITE_PRESENTER_NOT_FOUND")
        try:
            from lite_presenter_pack import load_pack
            return pack_dir, load_pack(pack_dir)
        except Exception:
            raise LitePresenterError("LITE_PRESENTER_NOT_FOUND") from None

    def choose(self, selection: object) -> LitePresenterChoice:
        """Strict ``{"folder", "voice"}`` selection of a listed pack and allowlisted voice."""
        if (not isinstance(selection, dict) or set(selection) != {"folder", "voice"}
                or type(selection["folder"]) is not str or type(selection["voice"]) is not str):
            raise LitePresenterError("LITE_PRESENTER_INVALID")
        if selection["voice"] not in LITE_VOICE_IDS:
            raise LitePresenterError("LITE_VOICE_INVALID")
        pack_dir, pack = self._pack(selection["folder"])
        return LitePresenterChoice(selection["folder"], pack_dir, pack.reference_path, selection["voice"])

    def thumbnail(self, folder: object) -> bytes:
        _pack_dir, pack = self._pack(folder)
        path = pack.reference_path
        try:
            if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_THUMBNAIL_BYTES:
                raise LitePresenterError("LITE_PRESENTER_NOT_FOUND")
            body = path.read_bytes()
        except OSError:
            raise LitePresenterError("LITE_PRESENTER_NOT_FOUND") from None
        if (len(body) > MAX_THUMBNAIL_BYTES or not body.startswith(b"\xff\xd8") or not body.endswith(b"\xff\xd9")
                or hashlib.sha256(body).hexdigest() != pack.reference_sha256):
            raise LitePresenterError("LITE_PRESENTER_NOT_FOUND")
        return body
