"""Developer build: produce an offline GUI setup EXE including Python runtime."""

from __future__ import annotations

import hashlib
import argparse
import json
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

VERSION = "0.3.0"
HERE = Path(__file__).resolve().parent
WORKER = HERE.parent
REPO = WORKER.parents[1]
BUILD = HERE / ".build"
DIST = HERE / ".dist"
RUNTIME_HIDDEN_IMPORTS = (
    "local_agent", "local_agent.updater", "local_agent.live_worker",
    "local_agent.stream_credentials", "av_encoder", "av_pipeline", "direct_stream",
    "sounddevice", "_sounddevice", "_sounddevice_data", "cffi", "_cffi_backend",
    "tkinter.messagebox", "installer.setup_app",
)


def runtime_arguments(trusted_config: list[str]) -> list[str]:
    """runpy's launcher imports and native microphone dependencies are explicit.

    The Windows sounddevice wheel supplies PortAudio. RawInputStream uses buffer
    objects without NumPy. Model/GPU packages are provisioned separately and are
    deliberately excluded from this unvalidated engineering runtime.
    """
    arguments = ["--onedir", "--windowed", "--name", "LocalLiveAgent", "--paths", str(WORKER)]
    for module in RUNTIME_HIDDEN_IMPORTS:
        arguments += ["--hidden-import", module]
    for module in ("torch", "numpy", "dev_fallback_engine", "imageio_ffmpeg"):
        arguments += ["--exclude-module", module]
    arguments += ["--collect-all", "cryptography", "--collect-all", "sounddevice",
                  "--collect-all", "_sounddevice_data", "--copy-metadata", "sounddevice",
                  "--add-data", f"{WORKER / 'local_agent' / 'launcher.pyw'};local_agent",
                  "--add-data", f"{WORKER / 'local_agent' / '__init__.py'};local_agent",
                  *trusted_config, str(HERE / "runtime_entry.py")]
    return arguments


def invoke(arguments: list[str]) -> None:
    subprocess.run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
                    "--workpath", str(BUILD), "--specpath", str(BUILD),
                    "--distpath", str(DIST), *arguments], cwd=WORKER, check=True)


def _public_pem(data: bytes) -> str:
    """Package only a validated verification key; reject every private key."""
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat, load_pem_public_key
    if len(data) > 4096 or b"PRIVATE KEY" in data:
        raise RuntimeError("Never package a private key")
    key = load_pem_public_key(data)
    if not isinstance(key, Ed25519PublicKey):
        raise RuntimeError("Only an Ed25519 verification public key can be packaged")
    return key.public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo).decode("ascii")


def public_key_configuration(path: Path) -> dict[str, str]:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 4096:
        raise RuntimeError("A valid trusted public-key file is required")
    return {"grantPublicKeyPem": _public_pem(path.read_bytes())}


def public_configuration(path: Path) -> dict[str, object]:
    """Release trust contains only public Ed25519 roots and an exact HTTPS origin."""
    from local_agent.update_transport import trusted_origin
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 32 * 1024:
        raise RuntimeError("Invalid public release configuration")
    config = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(config, dict) or set(config) - {"grantPublicKeyPem", "trustedKeys", "retiredKeyIds", "updateOrigin"}:
        raise RuntimeError("Only public trust configuration can be packaged")
    keys, retired = config.get("trustedKeys", {}), config.get("retiredKeyIds", [])
    key_id = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")
    if (not isinstance(keys, dict) or len(keys) > 8 or not isinstance(retired, list) or len(retired) > 8
            or any(not isinstance(value, str) or not key_id.fullmatch(value) for value in [*keys, *retired])):
        raise RuntimeError("Invalid installed signing key ring")
    validated: dict[str, object] = {"trustedKeys": {name: _public_pem(value.encode("ascii")) for name, value in keys.items()},
                                   "retiredKeyIds": retired}
    if "grantPublicKeyPem" in config:
        validated["grantPublicKeyPem"] = _public_pem(config["grantPublicKeyPem"].encode("ascii"))
    if "updateOrigin" in config:
        if not keys:
            raise RuntimeError("Update delivery requires an installed public signing key ring")
        validated["updateOrigin"] = trusted_origin(config["updateOrigin"])[0]
    return validated


def main() -> None:
    if sys.platform != "win32":
        raise SystemExit("Build the Windows package on Windows")
    BUILD.mkdir(exist_ok=True)
    DIST.mkdir(exist_ok=True)
    parser = argparse.ArgumentParser(description="Build offline Windows Local Live Agent setup")
    trust = parser.add_mutually_exclusive_group()
    trust.add_argument("--grant-public-key-file", type=Path,
                        help="Trusted Ed25519 public PEM only; never a signing private key")
    trust.add_argument("--public-config", type=Path,
                       help="Public key ring, retirement policy and fixed HTTPS update origin; no secrets")
    args = parser.parse_args()
    trusted_config: list[str] = []
    if args.grant_public_key_file is not None or args.public_config is not None:
        config = BUILD / "config.json"
        configuration = public_configuration(args.public_config) if args.public_config else public_key_configuration(args.grant_public_key_file)
        config.write_text(json.dumps(configuration), encoding="utf-8")
        trusted_config = ["--add-data", f"{config};local_agent"]
    invoke(runtime_arguments(trusted_config))
    bundle = DIST / "LocalLiveAgent"
    # Reuse already installed/pinned local binary; no runtime network download.
    node = subprocess.run(["node", "-e", "process.stdout.write(require('ffmpeg-static'))"],
                          cwd=REPO, check=True, capture_output=True, text=True)
    ffmpeg = Path(node.stdout)
    for filename in ("ffmpeg.exe", "ffmpeg.exe.LICENSE", "ffmpeg.exe.README"):
        source = ffmpeg.with_name(filename)
        if not source.is_file():
            raise RuntimeError("Bundled video runtime or license notice is missing")
        shutil.copyfile(source, bundle / filename)
    shutil.copyfile(HERE / "THIRD_PARTY_NOTICES.md", bundle / "THIRD_PARTY_NOTICES.md")
    python_license = Path(sys.base_prefix) / "LICENSE.txt"
    if not python_license.is_file():
        raise RuntimeError("Python runtime license notice is missing")
    shutil.copyfile(python_license, bundle / "PYTHON_LICENSE.txt")
    files = {path.relative_to(bundle).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
             for path in sorted(bundle.rglob("*")) if path.is_file()}
    manifest = {"format": "viralflow-local-live-agent-v1", "version": VERSION, "files": files}
    archive = BUILD / "payload.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output:
        output.writestr("bundle.json", json.dumps(manifest, sort_keys=True, separators=(",", ":")))
        for relative in files:
            output.write(bundle / relative, relative)
    metadata = {"version": VERSION, "sha256": hashlib.sha256(archive.read_bytes()).hexdigest()}
    info = BUILD / "payload-info.json"
    info.write_text(json.dumps(metadata), encoding="utf-8")
    invoke(["--onefile", "--windowed", "--name", f"ViralFlow-Live-Agent-Setup-{VERSION}",
            "--paths", str(WORKER), "--add-data", f"{archive};.", "--add-data", f"{info};.",
            str(HERE / "setup_app.py")])
    setup = DIST / f"ViralFlow-Live-Agent-Setup-{VERSION}.exe"
    print(json.dumps({"installer": str(setup), "sha256": hashlib.sha256(setup.read_bytes()).hexdigest(),
                      "sizeBytes": setup.stat().st_size, "version": VERSION, "signed": False}))


if __name__ == "__main__":
    main()
