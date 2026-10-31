"""CPU benchmark for local Thai TTS candidates. Writes WAVs and benchmark.json into OUT_DIR.
Run by .github/workflows/tts-benchmark.yml; nothing here is used by the app at runtime."""
import json
import os
import resource
import subprocess
import sys
import time

import soundfile as sf

OUT = os.environ.get("OUT_DIR", "tts-out")
os.makedirs(OUT, exist_ok=True)
SAMPLES = [
    ("hook", "รู้ไหม เรื่องนี้มีเหตุผล"),
    ("graphic", "รู้ไหม เรื่องนี้มีเหตุผล วางของใช้บ่อยไว้ใกล้มือ ติดตามไว้ ตอนต่อไปมีอีก"),
    ("product", "ขวดน้ำเก็บความเย็นใบนี้ ฝาเปิดมือเดียว ดูรายละเอียดก่อนตัดสินใจนะคะ"),
    ("numbers", "ความจุห้าร้อยมิลลิลิตร น้ำหนักเบา พกง่ายทุกวัน"),
]
VOICES = {
    "female": "A warm, clear Thai female narrator in her late twenties, friendly and natural, medium pace",
    "male": "A calm, confident Thai male narrator in his thirties, clear articulation, medium pace",
}


def peak_rss_mb():
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)


def bench_voxcpm2(report):
    import torch
    from huggingface_hub import snapshot_download
    from voxcpm import VoxCPM

    torch.set_num_threads(os.cpu_count() or 4)
    t = time.time()
    path = snapshot_download("openbmb/VoxCPM2")
    size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(path) for f in fs)
    report["download_seconds"] = round(time.time() - t, 1)
    report["model_bytes"] = size
    t = time.time()
    model = VoxCPM.from_pretrained(path, load_denoiser=False, optimize=False, device="cpu")
    report["load_seconds"] = round(time.time() - t, 1)
    report["rss_after_load_mb"] = peak_rss_mb()
    sr = model.tts_model.sample_rate
    report["sample_rate"] = sr
    runs = []
    for voice_name, voice in VOICES.items():
        for name, text in SAMPLES:
            if voice_name == "male" and name not in ("graphic", "product"):
                continue
            torch.manual_seed(42)
            t = time.time()
            wav = model.generate(text=f"({voice}){text}", cfg_value=2.0, inference_timesteps=10)
            elapsed = time.time() - t
            dur = len(wav) / sr
            out = os.path.join(OUT, f"voxcpm2-{voice_name}-{name}.wav")
            sf.write(out, wav, sr)
            runs.append({"file": os.path.basename(out), "voice": voice_name, "text": text, "audio_seconds": round(dur, 2),
                         "synth_seconds": round(elapsed, 2), "rtf": round(elapsed / dur, 2) if dur else None})
            print(json.dumps(runs[-1], ensure_ascii=False), flush=True)
    report["runs"] = runs
    report["peak_rss_mb"] = peak_rss_mb()


def bench_espeak(report):
    runs = []
    for name, text in SAMPLES:
        out = os.path.join(OUT, f"espeak-ng-{name}.wav")
        t = time.time()
        subprocess.run(["espeak-ng", "-v", "th", "-s", "150", "-w", out, text], check=True)
        elapsed = time.time() - t
        info = sf.info(out)
        runs.append({"file": os.path.basename(out), "text": text, "audio_seconds": round(info.duration, 2),
                     "synth_seconds": round(elapsed, 3), "rtf": round(elapsed / info.duration, 3)})
    report["runs"] = runs


def main():
    which = sys.argv[1]
    report = {"engine": which, "cpus": os.cpu_count(), "python": sys.version.split()[0]}
    try:
        {"voxcpm2": bench_voxcpm2, "espeak-ng": bench_espeak}[which](report)
        report["ok"] = True
    except Exception as error:  # Report the failure instead of hiding it.
        report["ok"] = False
        report["error"] = f"{type(error).__name__}: {error}"[:2000]
    with open(os.path.join(OUT, f"benchmark-{which}.json"), "w") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
