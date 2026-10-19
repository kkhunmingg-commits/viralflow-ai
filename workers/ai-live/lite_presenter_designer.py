"""Design fictional, photorealistic LIVE Lite presenters on the owner's own PC.

Images are generated locally and offline with FLUX.1 [schnell] (Apache-2.0,
commercial use allowed) through stable-diffusion.cpp (MIT, Vulkan build runs
on AMD iGPUs such as the ROG Ally X). No paid image API is called and no real
person's photo is used: each character is a new synthetic face described in
words, and its generator, model, licence, prompt and seed are recorded so the
presenter pack can prove where the face came from.

    python lite_presenter_designer.py --sd sd.exe --models models/flux --out presenters --seeds 3

Then build each chosen character's mouth library with lite_pack_builder.py
frame-engine --character presenters/<id>/character.json.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

MODEL = {"name": "FLUX.1-schnell", "license": "Apache-2.0",
         "files": {"diffusion": "flux1-schnell-Q4_K_S.gguf", "vae": "ae.safetensors",
                   "clip_l": "clip_l.safetensors", "t5xxl": "t5-v1_1-xxl-encoder-Q5_K_M.gguf"}}
STYLE = ("photorealistic vertical portrait photo for a live shopping stream, head and shoulders, "
         "person centered in the upper half of the frame, looking straight into the camera, "
         "mouth closed with a gentle natural smile, eyes open, soft even studio lighting, "
         "sharp focus on the face, natural skin texture, plain softly blurred bright studio background, "
         "no text, no logo, no watermark, no hands near the face, no glasses")
CHARACTERS = (
    {"id": "nara", "display_name": "นารา", "default_voice": "th-TH-PremwadeeNeural",
     "description": "a friendly Thai woman in her late twenties with shoulder-length black hair, "
                    "wearing a plain cream blouse"},
    {"id": "mali", "display_name": "มะลิ", "default_voice": "th-TH-AcharaNeural",
     "description": "a cheerful Thai woman in her early thirties with long black hair tied back, "
                    "wearing a light blue collared shirt"},
    {"id": "krit", "display_name": "กฤต", "default_voice": "th-TH-NiwatNeural",
     "description": "a warm Thai man in his early thirties with short neat black hair, "
                    "wearing a plain navy polo shirt"},
)
WIDTH, HEIGHT = 768, 1344  # multiples of 64; the presenter engine cover-crops to 720x1280


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def generate(sd: Path, models: Path, out: Path, character: dict, seed: int, steps: int) -> Path:
    files = {key: models / name for key, name in MODEL["files"].items()}
    missing = [str(path) for path in files.values() if not path.is_file()]
    if missing:
        raise SystemExit(json.dumps({"ok": False, "code": "MODEL_FILES_MISSING", "missing": missing}))
    target = out / character["id"] / f"seed-{seed}.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    prompt = f"{STYLE}, {character['description']}"
    command = [str(sd), "--diffusion-model", str(files["diffusion"]), "--vae", str(files["vae"]),
               "--clip_l", str(files["clip_l"]), "--t5xxl", str(files["t5xxl"]),
               "-p", prompt, "--cfg-scale", "1.0", "--sampling-method", "euler", "--steps", str(steps),
               "-W", str(WIDTH), "-H", str(HEIGHT), "-s", str(seed), "-o", str(target)]
    started = time.monotonic()
    result = subprocess.run(command, capture_output=True, text=True, timeout=3600,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if result.returncode or not target.is_file():
        raise SystemExit(json.dumps({"ok": False, "code": "GENERATION_FAILED", "stderr": result.stderr[-800:]}))
    (target.with_suffix(".json")).write_text(json.dumps({
        "prompt": prompt, "seed": seed, "steps": steps, "seconds": round(time.monotonic() - started, 1),
        "sha256": _sha256(target)}, ensure_ascii=False, indent=2), encoding="utf-8")
    return target


def single_face(path: Path) -> bool:
    from lite_pack_builder import face_box_for
    from lite_presenter_pack import PresenterPackError
    import cv2
    image = cv2.imread(str(path))
    try:
        return image is not None and bool(face_box_for(image))
    except PresenterPackError:
        return False


def choose(out: Path, character_id: str, seed: int) -> Path:
    """Record the chosen seed as the character's reference plus provenance."""
    character = next(item for item in CHARACTERS if item["id"] == character_id)
    image = out / character_id / f"seed-{seed}.png"
    meta = json.loads(image.with_suffix(".json").read_text(encoding="utf-8"))
    if meta["sha256"] != _sha256(image) or not single_face(image):
        raise SystemExit(json.dumps({"ok": False, "code": "REFERENCE_INVALID"}))
    reference = out / character_id / "reference.png"
    reference.write_bytes(image.read_bytes())
    record = {"display_name": character["display_name"], "default_voice": character["default_voice"],
              "reference": reference.name, "reference_sha256": _sha256(reference),
              "provenance": {"synthetic_person": True, "generator": "stable-diffusion.cpp",
                             "model": MODEL["name"], "license": MODEL["license"], "seed": seed,
                             "prompt": meta["prompt"], "steps": meta["steps"],
                             "note": "Fictional person generated from a text description; no photo of a real person was used."}}
    path = out / character_id / "character.json"
    path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, required=True)
    sub = parser.add_subparsers(dest="command", required=True)
    make = sub.add_parser("generate")
    make.add_argument("--sd", type=Path, required=True, help="stable-diffusion.cpp executable (sd.exe)")
    make.add_argument("--models", type=Path, required=True)
    make.add_argument("--seeds", type=int, default=3)
    make.add_argument("--steps", type=int, default=4)
    make.add_argument("--only", choices=[item["id"] for item in CHARACTERS])
    pick = sub.add_parser("choose")
    pick.add_argument("--character", choices=[item["id"] for item in CHARACTERS], required=True)
    pick.add_argument("--seed", type=int, required=True)
    args = parser.parse_args()
    if args.command == "generate":
        results = []
        for character in CHARACTERS:
            if args.only and character["id"] != args.only:
                continue
            for seed in range(1001, 1001 + args.seeds):
                image = generate(args.sd, args.models, args.out, character, seed, args.steps)
                results.append({"character": character["id"], "seed": seed, "image": str(image),
                                "single_face": single_face(image)})
                print(json.dumps(results[-1], ensure_ascii=False), flush=True)
    else:
        print(json.dumps({"ok": True, "character": str(choose(args.out, args.character, args.seed))}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
