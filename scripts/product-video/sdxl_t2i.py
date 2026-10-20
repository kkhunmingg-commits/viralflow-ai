"""Storyboard stills with RealVisXL V5.0 Lightning (SDXL, CreativeML Open RAIL++-M, commercial use allowed) on CPU.
Reads {"prompt","negative","output_prefix","seeds":[...],"width","height"} on stdin; writes one PNG per seed and
prints one JSON line with timings. The watch in these stills is a stand-in: the real product face is composited later."""
import json
import os
import sys
import time

import torch
from diffusers import DPMSolverMultistepScheduler, StableDiffusionXLPipeline

MODEL = "SG161222/RealVisXL_V5.0_Lightning"
NEGATIVE = ("deformed hands, extra fingers, missing fingers, fused fingers, bad anatomy, blurry, lowres, text, watermark, logo, "
            "cartoon, illustration, 3d render, oversaturated")


def main() -> None:
    job = json.load(sys.stdin)
    torch.set_num_threads(os.cpu_count() or 4)
    started = time.monotonic()
    pipe = StableDiffusionXLPipeline.from_pretrained(MODEL, torch_dtype=torch.float32)
    pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config, algorithm_type="sde-dpmsolver++", use_karras_sigmas=True)
    report = {"engine": MODEL, "device": "cpu", "loadSeconds": round(time.monotonic() - started, 1), "images": []}
    for seed in job["seeds"]:
        t = time.monotonic()
        image = pipe(prompt=job["prompt"], negative_prompt=job.get("negative", NEGATIVE), width=job.get("width", 768), height=job.get("height", 1344),
                     num_inference_steps=job.get("steps", 6), guidance_scale=job.get("cfg", 1.5),
                     generator=torch.Generator("cpu").manual_seed(seed)).images[0]
        path = f"{job['output_prefix']}-{seed}.png"
        image.save(path)
        report["images"].append({"seed": seed, "path": path, "seconds": round(time.monotonic() - t, 1)})
        print(json.dumps(report["images"][-1]), file=sys.stderr, flush=True)
    report["totalSeconds"] = round(time.monotonic() - started, 1)
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
