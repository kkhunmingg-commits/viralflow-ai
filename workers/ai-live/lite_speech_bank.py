"""Natural local Thai voice for LIVE Lite without a cloud key: a pre-rendered speech bank.

Everything LIVE Lite says comes from approved product facts or fixed guard
lines, so the full set of sentences is known once the room's products are
chosen. A slow but natural local model (VoxCPM2, Apache-2.0) renders every
sentence ahead of time on the owner's PC; during the LIVE the bank plays them
instantly. A sentence that is not in the bank is reported as a miss and goes
to the configured live fallback (or fails closed) instead of being guessed.

    python lite_speech_bank.py build --products products.json --out bank --engine voxcpm \
        --model-dir <VoxCPM2 dir> --prompt-wav voice.wav --prompt-text "..."
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
import threading
import time
import wave
from pathlib import Path
from typing import Iterable, Iterator

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np

from cloud_tts import CHUNK_BYTES, PCM_RATE, CloudTTSError, UsageMeter, _resample_to_16k, _wav_to_pcm16
from lite_brain import CLARIFY_SPOKEN, UNKNOWN_SPOKEN, _fact_entries
from lite_director import product_script
from local_brain import UNKNOWN, BrainScope, ProductSnapshot, grounded_answer
from thai_speech import NORMALIZER_VERSION, normalize_thai_speech, sentence_chunks

BANK_FORMAT = "viralflow-lite-speech-bank-v1"
FIXED_LINES = (UNKNOWN, UNKNOWN_SPOKEN, CLARIFY_SPOKEN, "สวัสดีค่ะ", "ยินดีต้อนรับค่ะ", "ขอสักครู่นะคะ กำลังตรวจสอบข้อมูลให้ค่ะ",
               "สวัสดีค่ะ ยินดีต้อนรับเข้าร้านนะคะ", "ขอคุยเรื่องสินค้าและการสั่งซื้ออย่างปลอดภัยนะคะ",
               "สนใจกดตะกร้าด้านล่างได้เลยนะคะ", "มีคำถามพิมพ์มาในคอมเมนต์ได้เลยค่ะ", "มาดูสินค้าตัวนี้กันนะคะ")
# Questions that exercise every grounded template once per product.
_PROBES = (("price", "ราคา"), ("stock", "เหลือ"), ("shipping", "ส่ง"), ("promotion", "โปร"),
           ("purchase_intent", "ซื้อ"), ("size_color", "สี"), ("size_color", "ขนาด"), ("size_color", "สีและขนาด"))


def _key(sentence: str) -> str:
    return hashlib.sha256(f"{NORMALIZER_VERSION}\0{sentence}".encode()).hexdigest()


def spoken_sentences(text: str) -> tuple[str, ...]:
    """The exact sentence strings Pro's speech provider will ask a backend for.

    LocalAISession splits the raw text first (so "600 มล." ends a sentence at its period),
    then the speech provider normalizes each piece and splits again.
    """
    return tuple(sentence for raw in sentence_chunks(text)
                 for sentence in sentence_chunks(normalize_thai_speech(raw)))


def _snapshot(product: dict) -> ProductSnapshot:
    """Same product-context entry shape the Dashboard syncs to the worker."""
    scope = BrainScope("bank", "bank", "bank")
    return ProductSnapshot(scope, product["productId"], product["name"], product["version"], product["facts"])


def product_utterances(products: Iterable[ProductSnapshot]) -> list[str]:
    """Every line LIVE Lite can say for these products, including other-SKU answers."""
    products = list(products)
    lines: list[str] = list(FIXED_LINES)
    for product in products:
        answers = [answer for intent, probe in _PROBES
                   if (answer := grounded_answer(intent, probe, product)) and answer != UNKNOWN]
        answers += [answer for _key_text, answer in _fact_entries(product)]
        lines += product_script(product.name, product.facts) + answers
        if product.name and len(product.name) <= 60:
            lines += [(f"สำหรับ{product.name} " + answer)[:320] for answer in answers]
    return list(dict.fromkeys(lines))


def bank_sentences(utterances: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(sentence for line in utterances for sentence in spoken_sentences(line)))


def _pcm_to_wav(pcm: bytes) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(PCM_RATE)
        handle.writeframes(pcm)
    return buffer.getvalue()


def build_bank(sentences: Iterable[str], render, out: Path, *, voice: dict, log=print) -> dict:
    """render(sentence) -> 16 kHz PCM16. Existing entries are reused, so a build can resume."""
    out.mkdir(parents=True, exist_ok=True)
    index_path = out / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.is_file() else {}
    if index and index.get("voice") != voice:
        raise SystemExit(json.dumps({"ok": False, "code": "BANK_VOICE_MISMATCH"}))
    entries = index.get("entries", {})
    timings = []
    for sentence in sentences:
        key = _key(sentence)
        if key in entries and (out / entries[key]["file"]).is_file():
            continue
        started = time.monotonic()
        pcm = render(sentence)
        if not pcm:
            raise SystemExit(json.dumps({"ok": False, "code": "BANK_RENDER_EMPTY", "sentence": sentence}))
        seconds = time.monotonic() - started
        audio = len(pcm) / (PCM_RATE * 2)
        (out / f"{key}.wav").write_bytes(_pcm_to_wav(pcm))
        entries[key] = {"file": f"{key}.wav", "text": sentence, "audio_seconds": round(audio, 2),
                        "render_seconds": round(seconds, 2)}
        timings.append((seconds, audio))
        index = {"format": BANK_FORMAT, "normalizer": NORMALIZER_VERSION, "voice": voice, "entries": entries}
        index_path.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
        log(json.dumps({"rendered": sentence[:40], "seconds": round(seconds, 1), "audio": round(audio, 1)},
                       ensure_ascii=False))
    index = {"format": BANK_FORMAT, "normalizer": NORMALIZER_VERSION, "voice": voice, "entries": entries}
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    render_total, audio_total = sum(t for t, _ in timings), sum(a for _, a in timings)
    return {"sentences": len(entries), "rendered_now": len(timings), "render_seconds": round(render_total, 1),
            "audio_seconds": round(audio_total, 1),
            "real_time_factor": round(render_total / audio_total, 2) if audio_total else None}


class SpeechBankBackend:
    """PCMBackend that plays pre-rendered sentences; misses go to `fallback` or fail closed."""
    technical_test_only = False

    def __init__(self, bank_dir: Path, *, fallback=None):
        index = json.loads((Path(bank_dir) / "index.json").read_text(encoding="utf-8"))
        if index.get("format") != BANK_FORMAT or index.get("normalizer") != NORMALIZER_VERSION:
            raise CloudTTSError("SPEECH_BANK_INVALID")
        self._dir = Path(bank_dir)
        self._entries = index["entries"]
        self.voice = index.get("voice", {})
        self.provider = "speech-bank:" + str(self.voice.get("engine", "unknown"))
        self.fallback = fallback
        self.meter = UsageMeter(self.provider, 0.0)
        self.hits = self.misses = 0
        self.missed: list[str] = []
        self._lock = threading.Lock()

    @property
    def fingerprint(self) -> str:
        return hashlib.sha256(json.dumps(self.voice, sort_keys=True).encode() + str(len(self._entries)).encode()
                              ).hexdigest()

    def health(self) -> dict[str, object]:
        return {"ready": bool(self._entries), "provider": self.provider, "sentences": len(self._entries),
                "voice": self.voice, "fallback": getattr(self.fallback, "provider", None),
                "hits": self.hits, "misses": self.misses, "technical_test_only": False}

    def stream_sentence(self, text: str, stop: threading.Event) -> Iterator[bytes]:
        entry = self._entries.get(_key(text))
        with self._lock:
            if entry is None:
                self.misses += 1
                if len(self.missed) < 50:
                    self.missed.append(text)
            else:
                self.hits += 1
        if entry is None:
            if self.fallback is None:
                raise CloudTTSError("SPEECH_NOT_PRERENDERED")
            yield from self.fallback.stream_sentence(text, stop)
            return
        started = time.monotonic()
        pcm = _wav_to_pcm16((self._dir / entry["file"]).read_bytes())
        self.meter.record(len(text), (time.monotonic() - started) * 1000)
        for offset in range(0, len(pcm), CHUNK_BYTES):
            if stop.is_set():
                return
            yield pcm[offset:offset + CHUNK_BYTES]

    def close(self) -> None:
        if self.fallback is not None:
            self.fallback.close()


REFERENCE_LINE = "สวัสดีค่ะ วันนี้มีสินค้าดีๆ ราคาพิเศษมาแนะนำ สนใจถามในคอมเมนต์ได้เลยนะคะ"


def voxcpm_renderer(model_dir: Path, prompt_wav: Path | None, prompt_text: str | None, *, device: str = "cpu",
                    design: str | None = None, reference_out: Path | None = None):
    """VoxCPM2 (Apache-2.0 code and weights). The prompt voice must itself be synthetic or licensed.

    With `design`, a new fictional voice is described in words (VoxCPM2 voice design), rendered once
    as the reference, and then every sentence is cloned from that reference so the voice stays the same.
    """
    from voxcpm import VoxCPM
    model = VoxCPM(voxcpm_model_path=str(model_dir), zipenhancer_model_path=None, enable_denoiser=False,
                   optimize=False, device=device)
    rate = model.tts_model.sample_rate
    if design and not prompt_wav:
        reference = np.asarray(model.generate(text=f"({design}){REFERENCE_LINE}", cfg_value=2.0,
                                              inference_timesteps=10, normalize=False, denoise=False,
                                              retry_badcase=True), dtype=np.float32).reshape(-1)
        prompt_wav, prompt_text = reference_out, REFERENCE_LINE
        with wave.open(str(prompt_wav), "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(rate)
            handle.writeframes((np.clip(reference, -1.0, 1.0) * 32767).astype("<i2").tobytes())

    def render(sentence: str) -> bytes:
        kwargs = {"prompt_wav_path": str(prompt_wav), "prompt_text": prompt_text} if prompt_wav else {}
        wav = model.generate(text=sentence, cfg_value=2.0, inference_timesteps=10, normalize=False,
                             denoise=False, retry_badcase=True, **kwargs)
        samples = np.asarray(wav, dtype=np.float32).reshape(-1)
        return _resample_to_16k(np.clip(samples, -1.0, 1.0) * 32767, rate)
    return render


def backend_renderer(backend):
    def render(sentence: str) -> bytes:
        return b"".join(backend.stream_sentence(sentence, threading.Event()))
    return render


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser("build")
    build.add_argument("--products", type=Path, required=True, help="JSON list of product context entries, or 'proof'")
    build.add_argument("--out", type=Path, required=True)
    build.add_argument("--engine", choices=("voxcpm", "windows", "espeak"), required=True)
    build.add_argument("--model-dir", type=Path)
    build.add_argument("--prompt-wav", type=Path)
    build.add_argument("--prompt-text")
    build.add_argument("--design", help="describe a new fictional voice, e.g. 'young Thai woman, warm, friendly'")
    build.add_argument("--voice-name", default="")
    build.add_argument("--device", default="cpu")
    listing = sub.add_parser("sentences")
    listing.add_argument("--products", type=Path, required=True)
    args = parser.parse_args()
    if str(args.products) == "proof":  # the three products lite_live_proof.py streams
        from lite_live_proof import PRODUCTS as source
    else:
        source = json.loads(args.products.read_text(encoding="utf-8"))
    products = [_snapshot(item) for item in source]
    sentences = bank_sentences(product_utterances(products))
    if args.command == "sentences":
        print(json.dumps({"count": len(sentences), "sentences": sentences}, ensure_ascii=False, indent=1))
        return 0
    if args.engine == "voxcpm":
        if not args.model_dir:
            parser.error("--model-dir is required for voxcpm")
        args.out.mkdir(parents=True, exist_ok=True)
        reference = args.out / "voice-reference.wav"
        if args.design and reference.is_file() and not args.prompt_wav:  # resume with the same designed voice
            args.prompt_wav, args.prompt_text = reference, REFERENCE_LINE
        render = voxcpm_renderer(args.model_dir, args.prompt_wav, args.prompt_text, device=args.device,
                                 design=args.design, reference_out=reference)
        prompt = args.prompt_wav or reference
        voice = {"engine": "voxcpm2", "license": "Apache-2.0", "name": args.voice_name, "design": args.design,
                 "synthetic_voice": bool(args.design),
                 "prompt_sha256": hashlib.sha256(prompt.read_bytes()).hexdigest() if prompt.is_file() else None}
    else:
        from cloud_tts import EspeakTechnicalBackend, WindowsOneCoreBackend
        backend = WindowsOneCoreBackend(args.voice_name) if args.engine == "windows" else EspeakTechnicalBackend()
        render, voice = backend_renderer(backend), {"engine": args.engine, "name": args.voice_name}
    print(json.dumps({"ok": True, **build_bank(sentences, render, args.out, voice=voice)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
