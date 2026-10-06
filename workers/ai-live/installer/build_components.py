"""Publisher-only portable runtime/model archives; customers never run pip.

Input Python distribution and the offline wheel lock are publisher-controlled.
This tool does not fetch code, execute archive setup scripts, sign, or publish.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

CHUNK_BYTES = 4 * 1024 * 1024
WORKER = Path(__file__).resolve().parent.parent
EXCLUDED = {"installer", "tests", "__pycache__", ".git", ".venv", ".venv-dev", ".ai-live-dev", "models", "node_modules"}
REQUIRED_IMPORTS = ("torch", "diffusers", "transformers", "numpy", "cv2", "safetensors",
                    "accelerate", "psutil", "sounddevice", "cryptography")
VERSION_PATTERN = r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"


def validate_models(source: Path, profile: str) -> None:
    root = source / "musetalk"
    if profile == "cpu-dev":
        from bootstrap_dev_fallback import ARTIFACTS, DESTINATIONS
        required = [Path(DESTINATIONS[repository]) / name
                    for repository, names in ARTIFACTS.items() for name in names]
    elif profile == "nvidia":
        from capabilities import MUSETALK_REQUIRED_ASSETS
        required = [Path(name) for name in MUSETALK_REQUIRED_ASSETS]
    else:
        raise ValueError("Invalid model profile")
    if any(not (root / name).is_file() or (root / name).is_symlink()
           or (root / name).stat().st_size == 0 for name in required):
        raise ValueError("Required presenter model files are missing or empty")


def _files(root: Path, *, excluded: set[str] | None = None):
    """Do not allow a trusted input tree to silently include external links."""
    if root.is_symlink() or not root.is_dir():
        raise ValueError("A regular archive source directory is required")
    for directory, children, filenames in os.walk(root, followlinks=False):
        base = Path(directory)
        children[:] = sorted(name for name in children
                             if not excluded or (name not in excluded and not name.startswith(".")))
        for name in [*children, *sorted(filenames)]:
            path = base / name
            if path.is_symlink() or getattr(path.lstat(), "st_file_attributes", 0) & 0x400:
                raise ValueError("Archive sources must not contain links or junctions")
            if path.is_file():
                relative = path.relative_to(root)
                if any(part.endswith((".", " ")) or ":" in part or re.fullmatch(
                        r"(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?", part)
                        for part in relative.parts):
                    raise ValueError("Archive source contains unsafe Windows filename")
                yield path, relative


def _digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for data in iter(lambda: stream.read(CHUNK_BYTES), b""):
            digest.update(data)
    return digest.hexdigest()


def stage_python(source: Path, target: Path) -> None:
    """Relocate a supplied official full or embeddable CPython distribution."""
    if not (source / "python.exe").is_file() or source.is_symlink():
        raise ValueError("A Windows CPython distribution with python.exe is required")
    if target.exists():
        raise ValueError("Runtime stage must be new")
    target.mkdir(parents=True)
    dlls = [path for path in source.glob("python*.dll")
            if re.fullmatch(r"python[0-9]{2,3}\.dll", path.name)]
    if len(dlls) != 1:
        raise ValueError("Exactly one versioned Python DLL is required")
    stem = dlls[0].stem
    if stem != f"python{sys.version_info.major}{sys.version_info.minor}":
        raise ValueError("Publisher Python must match the supplied runtime ABI")
    license_files = list(source.glob("LICENSE*"))
    if not license_files:
        raise ValueError("Python distribution license is required")
    names = {"python.exe", "pythonw.exe", "python3.dll", dlls[0].name,
             *(path.name for path in source.glob("vcruntime*.dll")),
             *(path.name for path in source.glob("python*.zip")),
             *(path.name for path in license_files)}
    for path, relative in _files(source, excluded={"site-packages", "test", "tests", "__pycache__", "ensurepip", "idlelib"}):
        if len(relative.parts) == 1 and path.name in names:
            destination = target / relative
        elif relative.parts[0] in {"Lib", "DLLs"} and not any(
                part in {"site-packages", "test", "tests", "__pycache__", "ensurepip", "idlelib"}
                for part in relative.parts):
            destination = target / relative
        else:
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, destination)
    # A fixed _pth isolates the relocated interpreter from user Python/PATH.
    paths = [".", "DLLs", "Lib", "Lib/site-packages"]
    paths += [path.name for path in sorted(target.glob("python*.zip"))]
    (target / (stem + "._pth")).write_text("\n".join(paths + ["import site", ""]), encoding="utf-8")


def install_locked_wheels(wheelhouse: Path, lockfile: Path, target: Path) -> None:
    """All transitive dependencies need pinned versions and wheel SHA-256s."""
    if not wheelhouse.is_dir() or not lockfile.is_file() or lockfile.is_symlink():
        raise ValueError("Publisher offline wheelhouse and hash lock are required")
    if any(path.suffix != ".whl" for path in wheelhouse.iterdir() if path.is_file()):
        raise ValueError("Wheelhouse must contain only binary wheels")
    _ = list(_files(wheelhouse))
    text = lockfile.read_text(encoding="utf-8")
    # Avoid URLs, recursive files, editable packages, and per-line index options.
    logical = text.replace("\\\r\n", " ").replace("\\\n", " ")
    if not any(line.strip() and not line.strip().startswith("#") for line in logical.splitlines()):
        raise ValueError("Dependency hash lock must not be empty")
    for line in logical.splitlines():
        line = line.strip()
        if line and not line.startswith("#") and not re.fullmatch(
                r"[A-Za-z0-9][A-Za-z0-9_.-]*(?:\[[A-Za-z0-9_,.-]+\])?==[A-Za-z0-9.+_-]+"
                r"(?:\s+--hash=sha256:[a-fA-F0-9]{64})+", line):
            raise ValueError("Lock must contain exact versions and SHA-256 wheel hashes only")
    environment = {key: value for key, value in os.environ.items()
                   if not key.upper().startswith("PIP_")}
    environment.update({"PIP_CONFIG_FILE": os.devnull, "PIP_DISABLE_PIP_VERSION_CHECK": "1"})
    subprocess.run([sys.executable, "-m", "pip", "install", "--no-index", "--no-compile",
                    "--only-binary=:all:", "--require-hashes", "--find-links", str(wheelhouse),
                    "--target", str(target / "Lib" / "site-packages"), "-r", str(lockfile)],
                   env=environment, check=True, timeout=600, shell=False,
                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def stage_worker(source: Path, target: Path) -> None:
    target.mkdir(parents=True, exist_ok=False)
    for path, relative in _files(source, excluded=EXCLUDED):
        if path.suffix != ".py" or any(part in EXCLUDED or part.startswith(".") for part in relative.parts):
            continue
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, destination)
    # Renderer planning data travels inside the existing signed/hash-verified
    # runtime archive. It does not authorize downloads or executable releases.
    candidates = source / "renderer-dependencies.json"
    if candidates.exists():
        if candidates.is_symlink() or not candidates.is_file() or candidates.stat().st_size > 64 * 1024:
            raise ValueError("Invalid renderer dependency planning manifest")
        plan = json.loads(candidates.read_text(encoding="utf-8"))
        if (plan.get("format") != "viralflow-avatar-renderer-candidates-v2"
                or plan.get("automatic_download") is not False):
            raise ValueError("Invalid renderer dependency planning manifest")
        shutil.copyfile(candidates, target / candidates.name)
    for name, expected_format in (("local-brain-candidates.json", "viralflow-local-brain-candidates-v1"),
                                  ("local-tts-candidates.json", "viralflow-local-tts-research-v1")):
        planning = source / name
        if planning.exists():
            if planning.is_symlink() or not planning.is_file() or planning.stat().st_size > 256 * 1024:
                raise ValueError("Invalid local AI planning manifest")
            value = json.loads(planning.read_bytes())
            if value.get("format") != expected_format:
                raise ValueError("Invalid local AI planning manifest")
            shutil.copyfile(planning, target / name)
    # LocalAgent's public package imports updater, which imports delivery.
    # Include that small library without any installer GUI/build entry points.
    for name in ("__init__.py", "delivery.py"):
        path = source / "installer" / name
        if path.is_symlink() or not path.is_file():
            raise ValueError("Required worker delivery library is missing")
        (target / "installer").mkdir(exist_ok=True)
        shutil.copyfile(path, target / "installer" / name)
    if not (target / "managed_worker_entry.py").is_file():
        raise ValueError("Fixed managed worker entry is missing")


def check_runtime(runtime: Path) -> None:
    # Locate dependencies without importing their native GPU/ML modules or
    # opening devices. Actual performance/driver validation remains separate.
    script = ("import importlib.util,json,sys; names=" + repr(REQUIRED_IMPORTS)
              + "; missing=[n for n in names if importlib.util.find_spec(n) is None];"
              "print(json.dumps({'missing':missing,'isolated':sys.flags.isolated}));"
              "sys.exit(bool(missing) or not sys.flags.isolated)")
    completed = subprocess.run([str(runtime / "python.exe"), "-I", "-B", "-c", script],
        capture_output=True, text=True, timeout=30, check=False, shell=False,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if completed.returncode:
        raise ValueError("Managed runtime is missing required presenter/audio packages")
    entry = runtime.parent / "worker" / "managed_worker_entry.py"
    script = ("import sys;sys.path.insert(0," + repr(str(entry.parent)) + ");"
              "import managed_worker_entry;from local_agent.live_worker import LocalWorkerBoundary;"
              "from local_agent.agent import REALTIME_VALIDATED;assert REALTIME_VALIDATED is False")
    completed = subprocess.run([str(runtime / "python.exe"), "-I", "-B", "-c", script],
        capture_output=True, text=True, timeout=30, check=False, shell=False,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if completed.returncode:
        raise ValueError("Managed worker imports or unchanged release gate check failed")


def archive_item(stage: Path, output: Path, *, name: str, version: str,
                 profile: str, origin: str) -> dict[str, object]:
    from local_agent.update_transport import trusted_origin
    if (name not in {"runtime", "models"} or profile not in {"cpu-dev", "nvidia"}
            or len(version) > 32 or not re.fullmatch(VERSION_PATTERN, version)):
        raise ValueError("Invalid managed component identity")
    origin = trusted_origin(origin)[0]
    if name == "models":
        catalog = stage / "models" / "local-ai" / "catalog.json"
        if catalog.exists():
            from local_agent.model_manager import validate_catalog
            if catalog.is_symlink() or catalog.stat().st_size > 512 * 1024:
                raise ValueError("Local AI model catalog is invalid")
            validate_catalog(json.loads(catalog.read_bytes()))
    output.mkdir(parents=True, exist_ok=True)
    temporary = output / (name + ".zip.new")
    if temporary.exists():
        raise ValueError("Archive staging path already exists")
    files = {}
    case_names = set()
    try:
        from local_agent.components import _relative
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for path, relative in _files(stage):
                _relative(relative.as_posix())
                folded = relative.as_posix().casefold()
                if folded in case_names:
                    raise ValueError("Component paths must be unique under Windows case folding")
                case_names.add(folded)
                archive.write(path, relative.as_posix())
                files[relative.as_posix()] = {"sha256": _digest(path), "sizeBytes": path.stat().st_size}
        if not files:
            raise ValueError("Component archive must contain files")
        from local_agent.components import MAX_FILES, MAX_EXPANDED_BYTES, MAX_ARCHIVE_BYTES
        if (len(files) > MAX_FILES or sum(value["sizeBytes"] for value in files.values()) > MAX_EXPANDED_BYTES
                or temporary.stat().st_size > MAX_ARCHIVE_BYTES):
            raise ValueError("Component exceeds installed manager limits")
        digest = _digest(temporary)
        destination = output / (name + "-" + digest + ".zip")
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    chunks = []
    with destination.open("rb") as archive:
        for data in iter(lambda: archive.read(CHUNK_BYTES), b""):
            chunks.append({"sha256": hashlib.sha256(data).hexdigest(), "sizeBytes": len(data)})
    item = {"name": name, "version": version,
            "url": f"{origin}/viralflow/ai-live/components/{version}/{profile}/{destination.name}",
            "sha256": digest, "sizeBytes": destination.stat().st_size,
            "expandedBytes": sum(value["sizeBytes"] for value in files.values()),
            "files": files, "chunks": chunks}
    (output / (name + "-item.json")).write_text(json.dumps(item, sort_keys=True, indent=2), encoding="utf-8")
    return item


def main() -> None:
    parser = argparse.ArgumentParser(description="Publisher-only offline managed worker archives")
    parser.add_argument("--python-source", type=Path, required=True)
    parser.add_argument("--wheelhouse", type=Path, required=True)
    parser.add_argument("--requirements-lock", type=Path, required=True)
    parser.add_argument("--ffmpeg", type=Path, required=True)
    parser.add_argument("--models-source", type=Path, required=True,
                        help="Directory containing musetalk/ and any configured voice assets")
    parser.add_argument("--llama-runtime", type=Path,
                        help="Publisher verified llama.cpp Windows runtime directory including license notices")
    parser.add_argument("--stage", type=Path, required=True, help="New publisher workspace staging directory")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--release-version", required=True)
    parser.add_argument("--profile", choices=("cpu-dev", "nvidia"), required=True)
    parser.add_argument("--origin", required=True)
    args = parser.parse_args()
    if sys.platform != "win32":
        parser.error("Build Windows components on Windows")
    if args.stage.exists():
        parser.error("Choose a new staging directory; existing files are never deleted")
    runtime_stage, model_stage = args.stage / "runtime-component", args.stage / "models-component"
    runtime = runtime_stage / "runtime"
    stage_python(args.python_source, runtime)
    install_locked_wheels(args.wheelhouse, args.requirements_lock, runtime)
    stage_worker(WORKER, runtime_stage / "worker")
    if args.llama_runtime:
        if (not (args.llama_runtime / "llama-server.exe").is_file()
                or not any(args.llama_runtime.glob("LICENSE*"))):
            raise ValueError("Managed local brain runtime and redistribution notices are required")
        for source, relative in _files(args.llama_runtime):
            destination = runtime / "llama" / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
    for source in (args.ffmpeg, args.ffmpeg.with_name(args.ffmpeg.name + ".LICENSE"),
                   args.ffmpeg.with_name(args.ffmpeg.name + ".README")):
        if not source.is_file() or source.is_symlink():
            raise ValueError("FFmpeg executable and both redistribution notices are required")
        shutil.copyfile(source, runtime / source.name)
    if args.ffmpeg.name != "ffmpeg.exe":
        raise ValueError("Fixed managed FFmpeg filename must be ffmpeg.exe")
    check_runtime(runtime)
    validate_models(args.models_source, args.profile)
    for source, relative in _files(args.models_source):
        target = model_stage / "models" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    items = [archive_item(stage, args.output, name=name, version=args.release_version,
                          profile=args.profile, origin=args.origin)
             for stage, name in ((runtime_stage, "runtime"), (model_stage, "models"))]
    catalog_path = model_stage / "models" / "local-ai" / "catalog.json"
    local_models = {}
    if catalog_path.exists():
        from local_agent.model_manager import verify_installed_catalog
        # Models and runtime are separate archives but one atomic signed release.
        files = {name: file for item in items for name, file in item["files"].items()}
        catalog = json.loads(catalog_path.read_bytes())
        from local_agent.model_manager import validate_catalog
        validate_catalog(catalog, files)
        # Each archive already hashes the actual bytes; metadata must match it.
        verify_installed_catalog(model_stage, files)
        local_models = {args.profile: catalog}
    print(json.dumps({"profile": args.profile, "items": items, "signed": False,
                      "localModels": local_models, "realtimeValidated": False}, sort_keys=True))


if __name__ == "__main__":
    sys.path.insert(0, str(WORKER))
    main()
