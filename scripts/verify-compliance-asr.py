"""Opt-in local ASR evidence proof; never grants media compliance or downloads model weights.

Reuses existing Apache-2.0 Whisper-tiny weights. --prepare-tokenizer downloads only
small tokenizer/config files from the public official repository at a pinned revision.
All artifacts remain in .video-cache; no credentials are read or sent.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request
import wave

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / ".video-cache" / "compliance-readiness"
MODEL = ROOT / ".ai-live-dev" / "models" / "whisper"
TOKENIZER = ARTIFACTS / "asr-tokenizer"
TOKEN_FILES = (
    "vocab.json", "merges.txt", "tokenizer_config.json", "special_tokens_map.json",
    "added_tokens.json", "normalizer.json", "generation_config.json",
)
SPOKEN_REFERENCE = "This cream restores your skin DNA."


def get_public(url: str, maximum: int) -> bytes:
    # Fixed public model files only. No auth header, secret or user media in this request.
    with urllib.request.urlopen(url, timeout=30) as response:
        data = response.read(maximum + 1)
    if len(data) > maximum:
        raise RuntimeError("PUBLIC_ASR_FILE_TOO_LARGE")
    return data


def prepare_tokenizer() -> None:
    metadata = json.loads(get_public("https://huggingface.co/api/models/openai/whisper-tiny?blobs=true", 200_000))
    revision = metadata["sha"]
    if len(revision) != 40 or any(char not in "0123456789abcdef" for char in revision):
        raise RuntimeError("PUBLIC_ASR_REVISION_INVALID")
    siblings = {row["rfilename"]: row for row in metadata["siblings"]}
    weight = siblings.get("model.safetensors", {}).get("lfs", {})
    actual_weight_hash = hashlib.sha256((MODEL / "model.safetensors").read_bytes()).hexdigest()
    if actual_weight_hash != weight.get("sha256"):
        raise RuntimeError("EXISTING_ASR_WEIGHTS_DO_NOT_MATCH_OFFICIAL_REVISION")
    TOKENIZER.mkdir(parents=True, exist_ok=True)
    records = []
    for filename in TOKEN_FILES:
        row = siblings.get(filename)
        if row is None:
            raise RuntimeError("PUBLIC_ASR_TOKENIZER_FILE_MISSING")
        data = get_public(f"https://huggingface.co/openai/whisper-tiny/resolve/{revision}/{filename}", 2_000_000)
        git_hash = hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
        if git_hash != row.get("blobId"):
            raise RuntimeError("PUBLIC_ASR_TOKENIZER_CHECKSUM_MISMATCH")
        (TOKENIZER / filename).write_bytes(data)
        records.append({"filename": filename, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "git_blob": git_hash})
    (TOKENIZER / "source-manifest.json").write_text(json.dumps({"repository": "openai/whisper-tiny", "revision": revision,
        "license": "Apache-2.0", "weight_downloaded": False, "existing_weight_sha256": actual_weight_hash, "files": records}, indent=2), encoding="utf8")


def speech_fixture() -> tuple[Path, Path]:
    path = ARTIFACTS / "spoken-claim.wav"
    # Fixed fixture sentence through the local OS speech engine, no user-supplied shell text.
    env = dict(os.environ, COMPLIANCE_LOCAL_SPEECH_OUTPUT=str(path))
    command = (
        "Add-Type -AssemblyName System.Speech; "
        "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer; "
        "$s.SetOutputToWaveFile($env:COMPLIANCE_LOCAL_SPEECH_OUTPUT); "
        "$s.Speak('This cream restores your skin DNA.'); $s.Dispose()"
    )
    subprocess.run(["powershell", "-NoProfile", "-Command", command], env=env, check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20,
                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    video = ARTIFACTS / "spoken-claim-fixture.mp4"
    normalized = ARTIFACTS / "spoken-claim-16k.wav"
    binary = ROOT / "node_modules" / "ffmpeg-static" / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
    reference = ROOT / "benchmark-assets" / "beauty.jpg"
    if not reference.is_file():
        raise RuntimeError("LOCAL_PRODUCT_FIXTURE_MISSING")
    # Mux actual OS-synthesized speech first, then extract the encoded AAC audio for transcription.
    subprocess.run([str(binary), "-nostdin", "-y", "-hide_banner", "-loglevel", "error", "-loop", "1", "-i", str(reference),
                    "-i", str(path), "-vf", "scale=360:640:force_original_aspect_ratio=increase,crop=360:640,format=yuv420p",
                    "-af", "apad", "-t", "8", "-r", "15", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
                    "-b:a", "64k", "-movflags", "+faststart", str(video)], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20,
                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    subprocess.run([str(binary), "-nostdin", "-y", "-hide_banner", "-loglevel", "error", "-i", str(video),
                    "-vn",
                    "-ac", "1", "-ar", "16000", "-acodec", "pcm_s16le", str(normalized)], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20,
                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    return normalized, video


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepare-tokenizer", action="store_true")
    args = parser.parse_args()
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    if args.prepare_tokenizer:
        prepare_tokenizer()
    if not (TOKENIZER / "source-manifest.json").is_file():
        raise RuntimeError("LOCAL_ASR_TOKENIZER_NOT_PREPARED")
    # From here no networking is permitted or necessary.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import numpy as np
    import torch
    from transformers import GenerationConfig, WhisperFeatureExtractor, WhisperForConditionalGeneration, WhisperTokenizer

    audio, video = speech_fixture()
    with wave.open(str(audio), "rb") as source:
        if source.getnchannels() != 1 or source.getframerate() != 16000 or source.getsampwidth() != 2:
            raise RuntimeError("LOCAL_ASR_PCM_FORMAT_INVALID")
        samples = np.frombuffer(source.readframes(source.getnframes()), dtype="<i2").astype(np.float32) / 32768
    tokenizer = WhisperTokenizer.from_pretrained(TOKENIZER, local_files_only=True)
    extractor = WhisperFeatureExtractor.from_pretrained(MODEL, local_files_only=True)
    started = time.monotonic()
    model = WhisperForConditionalGeneration.from_pretrained(MODEL, local_files_only=True, use_safetensors=True, torch_dtype=torch.float32).eval()
    model.generation_config = GenerationConfig.from_pretrained(TOKENIZER, local_files_only=True)
    model.generation_config.forced_decoder_ids = None
    torch.set_num_threads(4)
    with torch.inference_mode():
        features = extractor(samples, sampling_rate=16000, return_tensors="pt", return_attention_mask=True)
        ids = model.generate(features.input_features, attention_mask=features.attention_mask,
                             language="en", task="transcribe", max_new_tokens=80, do_sample=False)
    transcript = tokenizer.batch_decode(ids, skip_special_tokens=True)[0].strip()
    if not transcript:
        raise RuntimeError("LOCAL_ASR_NO_TRANSCRIPT")
    report = {"schemaVersion": 1, "kind": "EXPERIMENTAL_ACTUAL_LOCAL_ASR_PROOF", "fixtureOnly": True,
              "audioPath": str(audio), "audioSha256": hashlib.sha256(audio.read_bytes()).hexdigest(),
              "videoPath": str(video), "videoSha256": hashlib.sha256(video.read_bytes()).hexdigest(),
              "audioExtractedFromEncodedVideo": True,
              "model": "openai/whisper-tiny", "runtime": "CPU_FLOAT32", "audioSeconds": len(samples) / 16000,
              "localGenerationSeconds": time.monotonic() - started, "referenceText": SPOKEN_REFERENCE,
              "actualTranscript": transcript, "speechTranscriptComparedByHuman": False,
              "evidenceVerified": False, "mediaCoverageComplete": False, "requiredGateState": "REVIEW_REQUIRED",
              "inferenceNetworkCalls": 0, "paidCalls": 0, "tikTokPostingCalls": 0,
              "limitations": ["One English synthesized fixture is not Thai/English ASR quality validation",
                              "ASR may omit or hallucinate words; transcription cannot establish visual compliance",
                              "This transcript is a local observation only; no production attestation is written"]}
    path = ARTIFACTS / "asr-report.json"
    path.write_text(json.dumps(report, indent=2), encoding="utf8")
    print(json.dumps({"reportPath": str(path), "actualTranscript": transcript, "localGenerationSeconds": report["localGenerationSeconds"],
                      "requiredGateState": "REVIEW_REQUIRED", "paidCalls": 0}))


if __name__ == "__main__":
    main()
