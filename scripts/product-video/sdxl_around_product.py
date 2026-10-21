"""Draws the scene around the real product instead of pasting the product into a finished scene.

The product cutout (from the licensed photo) is placed on the canvas first and held fixed while RealVisXL V5.0
Lightning (SDXL inpainting over everything except the product) paints the table, floor, light and shadows around it,
so perspective, contact shadow and light direction are built for the product. The product's own pixels are put back
unchanged at the end. Reads {"product","x","bottom","width","prompt","negative","seeds","output_prefix"} on stdin."""
import json
import os
import sys
import time

import numpy as np
import torch
from diffusers import DPMSolverMultistepScheduler, StableDiffusionXLInpaintPipeline
from PIL import Image, ImageFilter

MODEL = "SG161222/RealVisXL_V5.0_Lightning"
NEGATIVE = ("second product, duplicate, extra pot, extra shoe, floating object, hands, people, text, watermark, blurry, lowres, "
            "cartoon, illustration, 3d render, oversaturated")


def place(product: Image.Image, width: int, height: int, x: float, bottom: float, size: float):
    box = product.getbbox()
    product = product.crop(box)
    scale = size / product.width
    product = product.resize((round(product.width * scale), round(product.height * scale)), Image.LANCZOS)
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    layer.paste(product, (round(x - product.width / 2), round(bottom - product.height)), product)
    return layer


def main() -> None:
    job = json.load(sys.stdin)
    torch.set_num_threads(os.cpu_count() or 4)
    width, height = job.get("width", 768), job.get("height", 1344)
    layer = place(Image.open(job["product"]).convert("RGBA"), width, height, job["x"], job["bottom"], job["width_px"])
    alpha = layer.split()[3]
    # Neutral warm grey under the product so the model starts from no particular scene.
    init = Image.new("RGB", (width, height), (128, 120, 110))
    init.paste(layer, (0, 0), layer)
    # Repaint everything except the product; the 3 px inside its edge are repainted too so the edge blends.
    keep = alpha.point(lambda a: 255 if a > 200 else 0).filter(ImageFilter.MinFilter(7))
    mask = Image.eval(keep, lambda a: 255 - a)
    started = time.monotonic()
    pipe = StableDiffusionXLInpaintPipeline.from_pretrained(MODEL, torch_dtype=torch.float32)
    pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config, algorithm_type="sde-dpmsolver++", use_karras_sigmas=True)
    report = {"engine": MODEL, "mode": "inpaint around the fixed product", "loadSeconds": round(time.monotonic() - started, 1), "images": []}
    for seed in job["seeds"]:
        t = time.monotonic()
        image = pipe(prompt=job["prompt"], negative_prompt=job.get("negative", NEGATIVE), image=init, mask_image=mask,
                     width=width, height=height, strength=1.0, num_inference_steps=job.get("steps", 8), guidance_scale=job.get("cfg", 1.5),
                     generator=torch.Generator("cpu").manual_seed(seed)).images[0]
        # The product's own pixels go back exactly, with a soft edge.
        soft = alpha.filter(ImageFilter.GaussianBlur(0.8))
        out = Image.composite(layer.convert("RGB"), image.convert("RGB"), soft)
        path = f"{job['output_prefix']}-{seed}.png"
        out.save(path)
        image.save(f"{job['output_prefix']}-{seed}-raw.png")
        report["images"].append({"seed": seed, "path": path, "seconds": round(time.monotonic() - t, 1)})
        print(json.dumps(report["images"][-1]), file=sys.stderr, flush=True)
    report["totalSeconds"] = round(time.monotonic() - started, 1)
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
