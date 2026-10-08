"""Offline ASR of actual decoded audio; observations cannot certify media safety."""
import hashlib
import json
import os
from pathlib import Path
import sys
import wave

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"


def main():
    import numpy as np
    import torch
    from transformers import GenerationConfig, WhisperFeatureExtractor, WhisperForConditionalGeneration, WhisperTokenizer
    root = Path(__file__).resolve().parents[1]
    model_dir = root / ".ai-live-dev" / "models" / "whisper"
    tokenizer_dir = root / ".video-cache" / "compliance-readiness" / "asr-tokenizer"
    manifest = json.loads((tokenizer_dir / "source-manifest.json").read_text(encoding="utf8"))
    if hashlib.sha256((model_dir / "model.safetensors").read_bytes()).hexdigest() != manifest["existing_weight_sha256"]:
        raise RuntimeError("ASR_CHECKSUM_INVALID")
    for row in manifest["files"]:
        if Path(row["filename"]).name != row["filename"]:
            raise RuntimeError("ASR_MANIFEST_INVALID")
        if hashlib.sha256((tokenizer_dir / row["filename"]).read_bytes()).hexdigest() != row["sha256"]:
            raise RuntimeError("ASR_CHECKSUM_INVALID")
    with wave.open(sys.argv[1], "rb") as source:
        if source.getnchannels() != 1 or source.getframerate() != 16000 or source.getsampwidth() != 2 or source.getnframes() > 30 * 16000:
            raise RuntimeError("ASR_AUDIO_INVALID")
        samples = np.frombuffer(source.readframes(source.getnframes()), dtype="<i2").astype(np.float32) / 32768
    if samples.size == 0 or float(np.sqrt(np.mean(samples ** 2))) < .003:
        print(json.dumps({"transcript": "", "status": "NO_SPEECH_CONFIRMED", "coverageComplete": False}))
        return
    torch.set_num_threads(4)
    tokenizer = WhisperTokenizer.from_pretrained(tokenizer_dir, local_files_only=True)
    extractor = WhisperFeatureExtractor.from_pretrained(model_dir, local_files_only=True)
    model = WhisperForConditionalGeneration.from_pretrained(model_dir, local_files_only=True, use_safetensors=True,
                                                          torch_dtype=torch.float32).eval()
    model.generation_config = GenerationConfig.from_pretrained(tokenizer_dir, local_files_only=True)
    model.generation_config.forced_decoder_ids = None
    with torch.inference_mode():
        inputs = extractor(samples, sampling_rate=16000, return_tensors="pt", return_attention_mask=True)
        result = model.generate(inputs.input_features, attention_mask=inputs.attention_mask, task="transcribe",
                                max_new_tokens=180, do_sample=False)
    print(json.dumps({"transcript": tokenizer.batch_decode(result, skip_special_tokens=True)[0].strip(),
                      "status": "OBSERVED", "coverageComplete": False}, ensure_ascii=True))


if __name__ == "__main__":
    main()
