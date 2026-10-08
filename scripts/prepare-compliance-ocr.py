"""Explicit bootstrap of public Apache-2.0 OCR data; inference never downloads files."""
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / ".video-cache" / "compliance-real-world" / "ocr-models"


def get(url, limit):
    with urllib.request.urlopen(url, timeout=30) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise RuntimeError("OCR_BOOTSTRAP_FILE_TOO_LARGE")
    return data


def main():
    # Version changes require a deliberate bootstrap + scanner checksum change.
    revision = "87416418657359cb625c412a48b6e1d6d41c29bd"
    if len(revision) != 40 or any(c not in "0123456789abcdef" for c in revision):
        raise RuntimeError("OCR_BOOTSTRAP_REVISION_INVALID")
    tree = json.loads(get(f"https://api.github.com/repos/tesseract-ocr/tessdata_fast/git/trees/{revision}", 200_000))
    entries = {row["path"]: row for row in tree["tree"]}
    DEST.mkdir(parents=True, exist_ok=True)
    files = []
    for name in ("eng.traineddata", "tha.traineddata", "LICENSE"):
        data = get(f"https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/{revision}/{name}", 10_000_000)
        blob = hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
        if blob != entries[name]["sha"]:
            raise RuntimeError("OCR_BOOTSTRAP_CHECKSUM_MISMATCH")
        (DEST / name).write_bytes(data)
        files.append({"name": name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "gitBlob": blob})
    manifest = {"repository": "tesseract-ocr/tessdata_fast", "revision": revision, "license": "Apache-2.0", "files": files}
    (DEST / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf8")
    print(json.dumps({"prepared": True, "languages": ["eng", "tha"], "revision": revision}))


if __name__ == "__main__":
    main()
