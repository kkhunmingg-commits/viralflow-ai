"""Download only the official, public CPU proof-of-flow model artifacts.

No credentials or paid inference are used. Run explicitly; the frame engine
never downloads at runtime. MuseTalk and its weights: MIT; Whisper: Apache-2.0;
sd-vae-ft-mse model card: MIT. NASA astronaut sample is research test data.
"""

from __future__ import annotations

import hashlib
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / ".ai-live-dev"
ARTIFACTS = {
    "TMElyralab/MuseTalk": ["musetalkV15/musetalk.json", "musetalkV15/unet.pth"],
    "stabilityai/sd-vae-ft-mse": ["config.json", "diffusion_pytorch_model.safetensors"],
    "openai/whisper-tiny": ["config.json", "model.safetensors", "preprocessor_config.json"],
}
DESTINATIONS = {"TMElyralab/MuseTalk": "", "stabilityai/sd-vae-ft-mse": "sd-vae", "openai/whisper-tiny": "whisper"}


def download(url: str, path: Path, expected_sha: str | None = None) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file() and expected_sha:
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest() if hasattr(hashlib, "file_digest") else _digest(stream)
        if digest == expected_sha:
            return digest
    temporary = path.with_suffix(path.suffix + ".partial")
    digest = hashlib.sha256()
    with urllib.request.urlopen(url, timeout=120) as response, temporary.open("wb") as stream:
        while data := response.read(8 * 1024 * 1024):
            stream.write(data)
            digest.update(data)
    value = digest.hexdigest()
    if expected_sha and value != expected_sha:
        raise RuntimeError(f"MODEL_CHECKSUM_MISMATCH: {path.name}")
    temporary.replace(path)
    return value


def _digest(stream) -> str:
    digest = hashlib.sha256()
    while data := stream.read(8 * 1024 * 1024):
        digest.update(data)
    return digest.hexdigest()


def main() -> None:
    manifest = []
    for repository, files in ARTIFACTS.items():
        with urllib.request.urlopen(f"https://huggingface.co/api/models/{repository}?blobs=true", timeout=30) as response:
            info = json.load(response)
        revision = info["sha"]
        siblings = {item["rfilename"]: item for item in info["siblings"]}
        for filename in files:
            item = siblings[filename]
            checksum = item.get("lfs", {}).get("sha256")
            destination = ROOT / "models" / DESTINATIONS[repository] / filename
            print(f"Downloading {repository}/{filename}", flush=True)
            value = download(f"https://huggingface.co/{repository}/resolve/{revision}/{filename}", destination, checksum)
            manifest.append({"repository": repository, "revision": revision, "file": filename, "sha256": value, "bytes": destination.stat().st_size})
    ROOT.mkdir(parents=True, exist_ok=True)
    (ROOT / "model-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    download("https://raw.githubusercontent.com/scikit-image/scikit-image/v0.25.2/skimage/data/astronaut.png", ROOT / "reference-astronaut.png")
    print("Official models ready; manifest saved.", flush=True)


if __name__ == "__main__":
    main()
