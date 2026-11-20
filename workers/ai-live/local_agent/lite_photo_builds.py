"""Build LIVE Lite presenters from the owner's own consented photo, on the device.

The Dashboard names a photo already saved in the owner's encrypted presenter
library (saved only with likeness consent). The agent runs
``lite_photo_presenter.py`` in a child process (it loads MuseTalk on the CPU for
10-20 minutes), one build at a time, writing a normal LIVE Lite pack into the
device's packs root as ``photo-<id>``. The pack records the consent and a hash
of the owner id, so only that owner sees and uses it. The copied photo is
deleted when the build ends; a failed build leaves no pack behind.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
import wave
from dataclasses import dataclass, field
from pathlib import Path

from .lite_presenters import LITE_VOICE_IDS, packs_root

CALIBRATION_ENV = "AI_LIVE_LITE_CALIBRATION_WAV"
WORK_DIR = ".photo-builds"
BUILDER = Path(__file__).resolve().parents[1] / "lite_photo_presenter.py"
MAX_BUILDS_KEPT = 10
MAX_BUILD_SECONDS = 3 * 3600
PROGRESS = re.compile(r"rendered (\d+) library frames")
# Shown to the customer; codes from lite_photo_presenter.PHOTO_ERRORS keep their own text.
FAILURE_TEXT = "สร้างพิธีกรจากรูปไม่สำเร็จ ลองใหม่หรือใช้รูปอื่น"


class LitePhotoBuildError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def owner_ref(owner: str) -> str:
    return hashlib.sha256(("viralflow-lite-owner:" + owner).encode()).hexdigest()


def calibration_wav() -> Path | None:
    value = os.getenv(CALIBRATION_ENV, "").strip()
    candidates = [Path(value)] if value else []
    root = packs_root()
    if root is not None:
        candidates.append(root / "calibration.wav")
    for path in candidates:
        if path.is_absolute() and path.is_file() and not path.is_symlink():
            return path
    return None


def _expected_frames(path: Path, fps: int = 5) -> int:
    try:
        with wave.open(str(path), "rb") as handle:
            seconds = handle.getnframes() / float(handle.getframerate())
    except (OSError, wave.Error, ZeroDivisionError):
        return 0
    return int((seconds + 1.5) * fps)  # builder adds 1 s lead-in and 0.5 s tail of silence


@dataclass
class _Build:
    build_id: str
    owner_ref: str
    name: str
    folder: str
    started_at: int
    state: str = "RUNNING"            # RUNNING | READY | FAILED
    frames: int = 0
    expected_frames: int = 0
    code: str | None = None
    message: str | None = None
    finished_at: int | None = None
    process: object | None = field(default=None, repr=False)

    def view(self) -> dict[str, object]:
        progress = None
        if self.state == "READY":
            progress = 1.0
        elif self.expected_frames:
            progress = round(min(0.99, self.frames / self.expected_frames), 3)
        return {"buildId": self.build_id, "name": self.name, "folder": self.folder, "state": self.state,
                "progress": progress, "startedAt": self.started_at, "finishedAt": self.finished_at,
                "code": self.code, "message": self.message}


class LitePhotoBuilds:
    def __init__(self, root_resolver=packs_root, *, calibration_resolver=calibration_wav,
                 popen=subprocess.Popen, python: str = sys.executable, clock=time.time):
        self._root_resolver = root_resolver
        self._calibration_resolver = calibration_resolver
        self._popen = popen
        self._python = python
        self._clock = clock
        self._lock = threading.Lock()
        self._builds: list[_Build] = []

    def running(self) -> bool:
        with self._lock:
            return any(build.state == "RUNNING" for build in self._builds)

    def list(self, owner: str) -> list[dict[str, object]]:
        ref = owner_ref(owner)
        with self._lock:
            return [build.view() for build in reversed(self._builds) if build.owner_ref == ref]

    def start(self, owner: str, photo: bytes, media_type: str, name: str, voice: str) -> dict[str, object]:
        if voice not in LITE_VOICE_IDS:
            raise LitePhotoBuildError("LITE_VOICE_INVALID")
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80 or not photo:
            raise LitePhotoBuildError("LITE_PHOTO_INVALID")
        root = self._root_resolver()
        if root is None:
            raise LitePhotoBuildError("LITE_PACKS_ROOT_MISSING")
        calibration = self._calibration_resolver()
        if calibration is None:
            raise LitePhotoBuildError("LITE_CALIBRATION_AUDIO_MISSING")
        build_id = str(uuid.uuid4())
        folder = "photo-" + build_id.split("-")[0]
        work = root / WORK_DIR / build_id
        with self._lock:
            if any(build.state == "RUNNING" for build in self._builds):
                raise LitePhotoBuildError("LITE_PHOTO_BUILD_BUSY")
            work.mkdir(parents=True, exist_ok=False)
            suffix = ".png" if media_type == "image/png" else ".jpg"
            (work / ("photo" + suffix)).write_bytes(photo)
            consent = {"likeness_use": True, "person": name.strip()[:80], "signed_at": time.strftime("%Y-%m-%d"),
                       "method": "dashboard_presenter_upload", "owner_ref": owner_ref(owner)}
            (work / "consent.json").write_text(json.dumps(consent, ensure_ascii=False), encoding="utf-8")
            command = [self._python, str(BUILDER), "--out", str(root / folder), "--photo", str(work / ("photo" + suffix)),
                       "--consent", str(work / "consent.json"), "--calibration-wav", str(calibration),
                       "--name", name.strip()[:40], "--voice", voice]
            try:
                process = self._popen(command, cwd=str(BUILDER.parent), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                      text=True, encoding="utf-8", errors="replace",
                                      creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)
                                      | getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0))
            except OSError:
                shutil.rmtree(work, ignore_errors=True)
                raise LitePhotoBuildError("LITE_PHOTO_BUILD_FAILED") from None
            build = _Build(build_id, owner_ref(owner), name.strip()[:40], folder, int(self._clock() * 1000),
                           expected_frames=_expected_frames(calibration), process=process)
            self._builds.append(build)
            del self._builds[:-MAX_BUILDS_KEPT]
        threading.Thread(target=self._watch, args=(build, root / folder, work), name="viralflow-lite-photo-build",
                         daemon=True).start()
        return build.view()

    def _watch(self, build: _Build, out: Path, work: Path) -> None:
        process = build.process
        stderr_thread = threading.Thread(target=self._read_progress, args=(build, process.stderr), daemon=True)
        stderr_thread.start()
        result: dict = {}
        timer = threading.Timer(MAX_BUILD_SECONDS, process.kill)
        timer.daemon = True
        timer.start()
        try:
            stdout = process.stdout.read() if process.stdout is not None else ""
            process.wait()
            for line in reversed((stdout or "").strip().splitlines()):
                try:
                    result = json.loads(line)
                    break
                except json.JSONDecodeError:
                    continue
        except Exception:
            result = {"ok": False, "code": "LITE_PHOTO_BUILD_FAILED"}
        finally:
            timer.cancel()
        stderr_thread.join(timeout=5)
        ok = process.returncode == 0 and result.get("ok") is True and (out / "manifest.json").is_file()
        if not ok:
            shutil.rmtree(out, ignore_errors=True)
        shutil.rmtree(work, ignore_errors=True)
        with self._lock:
            build.state = "READY" if ok else "FAILED"
            build.finished_at = int(self._clock() * 1000)
            build.process = None
            if not ok:
                build.code = str(result.get("code") or "LITE_PHOTO_BUILD_FAILED")[:60]
                message = result.get("message")
                build.message = message if isinstance(message, str) and message else FAILURE_TEXT

    @staticmethod
    def _read_progress(build: _Build, stream) -> None:
        if stream is None:
            return
        for line in stream:
            match = PROGRESS.search(line)
            if match:
                build.frames = int(match.group(1))
