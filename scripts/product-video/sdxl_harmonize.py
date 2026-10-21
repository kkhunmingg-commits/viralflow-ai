"""Relights a composite so the pasted real product and the scene share one light: RealVisXL V5.0 Lightning img2img over
the whole frame at low strength. The product's lettering and edges are restored afterwards from the licensed photo
(harmonize_merge.py keeps the photo's fine detail and takes only the soft light and colour from this pass).
Reads {"image","prompt","negative","strengths":[...],"seeds":[...],"output_prefix"} on stdin."""
import json
import os
import sys
import time

import torch
from diffusers import DPMSolverMultistepScheduler, StableDiffusionXLImg2ImgPipeline
from PIL import Image

MODEL = "SG161222/RealVisXL_V5.0_Lightning"
NEGATIVE = "sticker, cutout, flat lighting, floating object, duplicate object, text, watermark, blurry, lowres, cartoon, illustration, 3d render"


def main() -> None:
    job = json.load(sys.stdin)
    torch.set_num_threads(os.cpu_count() or 4)
    started = time.monotonic()
    pipe = StableDiffusionXLImg2ImgPipeline.from_pretrained(MODEL, torch_dtype=torch.float32)
    pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config, algorithm_type="sde-dpmsolver++", use_karras_sigmas=True)
    image = Image.open(job["image"]).convert("RGB")
    report = {"engine": MODEL, "mode": "img2img relight", "loadSeconds": round(time.monotonic() - started, 1), "images": []}
    for strength in job["strengths"]:
        for seed in job["seeds"]:
            t = time.monotonic()
            out = pipe(prompt=job["prompt"], negative_prompt=job.get("negative", NEGATIVE), image=image, strength=strength,
                       num_inference_steps=job.get("steps", 12), guidance_scale=job.get("cfg", 1.5),
                       generator=torch.Generator("cpu").manual_seed(seed)).images[0]
            path = f"{job['output_prefix']}-s{int(strength * 100)}-{seed}.png"
            out.save(path)
            report["images"].append({"strength": strength, "seed": seed, "path": path, "seconds": round(time.monotonic() - t, 1)})
            print(json.dumps(report["images"][-1]), file=sys.stderr, flush=True)
    report["totalSeconds"] = round(time.monotonic() - started, 1)
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
