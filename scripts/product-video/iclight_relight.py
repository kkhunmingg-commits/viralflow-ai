"""Relights the real product to the scene's light with IC-Light (lllyasviel, foreground+background conditioned model
on Stable Diffusion 1.5), on CPU. Only the soft light and colour of the product are used afterwards: harmonize_merge.py
keeps the licensed photo's fine detail (lettering, logo, stitching), so the product's shape and markings never change.
Reads {"composite","mask","background","prompt","seeds","output_prefix"} on stdin."""
import json
import os
import sys
import time

import numpy as np
import safetensors.torch as sf
import torch
from diffusers import AutoencoderKL, DPMSolverMultistepScheduler, StableDiffusionPipeline, UNet2DConditionModel
from huggingface_hub import hf_hub_download
from PIL import Image
from transformers import CLIPTextModel, CLIPTokenizer

BASE = os.environ.get("ICLIGHT_BASE", "stablediffusionapi/realistic-vision-v51")
NEGATIVE = "lowres, bad quality, worst quality, deformed, distorted, text, watermark"
WIDTH, HEIGHT = 512, 896


def to_tensor(images):
    arr = np.stack([np.asarray(im, dtype=np.float32) / 127.5 - 1.0 for im in images])
    return torch.from_numpy(arr).permute(0, 3, 1, 2)


def main() -> None:
    job = json.load(sys.stdin)
    torch.set_num_threads(os.cpu_count() or 4)
    started = time.monotonic()
    tokenizer = CLIPTokenizer.from_pretrained(BASE, subfolder="tokenizer")
    text_encoder = CLIPTextModel.from_pretrained(BASE, subfolder="text_encoder")
    vae = AutoencoderKL.from_pretrained(BASE, subfolder="vae")
    unet = UNet2DConditionModel.from_pretrained(BASE, subfolder="unet")
    # The fbc model takes the noisy latent plus the foreground and background latents: 4 + 8 input channels.
    with torch.no_grad():
        conv = torch.nn.Conv2d(12, unet.conv_in.out_channels, unet.conv_in.kernel_size, unet.conv_in.stride, unet.conv_in.padding)
        conv.weight.zero_()
        conv.weight[:, :4].copy_(unet.conv_in.weight)
        conv.bias = unet.conv_in.bias
        unet.conv_in = conv
    offset = sf.load_file(hf_hub_download("lllyasviel/ic-light", "iclight_sd15_fbc.safetensors"))
    origin = unet.state_dict()
    unet.load_state_dict({k: origin[k] + offset[k] for k in origin}, strict=True)
    forward = unet.forward

    def hooked(sample, timestep, encoder_hidden_states, **kwargs):
        cond = kwargs["cross_attention_kwargs"]["concat_conds"].to(sample)
        cond = torch.cat([cond] * (sample.shape[0] // cond.shape[0]), dim=0)
        kwargs["cross_attention_kwargs"] = {}
        return forward(torch.cat([sample, cond], dim=1), timestep, encoder_hidden_states, **kwargs)

    unet.forward = hooked
    scheduler = DPMSolverMultistepScheduler(num_train_timesteps=1000, beta_start=0.00085, beta_end=0.012, algorithm_type="sde-dpmsolver++",
                                            use_karras_sigmas=True, steps_offset=1)
    pipe = StableDiffusionPipeline(vae=vae, text_encoder=text_encoder, tokenizer=tokenizer, unet=unet, scheduler=scheduler,
                                   safety_checker=None, feature_extractor=None, requires_safety_checker=False)
    composite = Image.open(job["composite"]).convert("RGB").resize((WIDTH, HEIGHT), Image.LANCZOS)
    mask = np.asarray(Image.open(job["mask"]).convert("L").resize((WIDTH, HEIGHT), Image.LANCZOS), dtype=np.float32)[..., None] / 255
    fg = Image.fromarray((np.asarray(composite, dtype=np.float32) * mask + 127 * (1 - mask)).astype(np.uint8))
    bg = Image.open(job["background"]).convert("RGB").resize((WIDTH, HEIGHT), Image.LANCZOS)
    with torch.no_grad():
        latents = vae.encode(to_tensor([fg, bg])).latent_dist.mode() * vae.config.scaling_factor
    concat = torch.cat([latents[0:1], latents[1:2]], dim=1)
    report = {"engine": "IC-Light fbc (lllyasviel/ic-light) on " + BASE, "loadSeconds": round(time.monotonic() - started, 1), "images": []}
    for seed in job["seeds"]:
        t = time.monotonic()
        image = pipe(prompt=job["prompt"] + ", best quality, photorealistic", negative_prompt=NEGATIVE, width=WIDTH, height=HEIGHT,
                     num_inference_steps=job.get("steps", 20), guidance_scale=job.get("cfg", 7.0),
                     generator=torch.Generator("cpu").manual_seed(seed), cross_attention_kwargs={"concat_conds": concat}).images[0]
        path = f"{job['output_prefix']}-{seed}.png"
        image.save(path)
        report["images"].append({"seed": seed, "path": path, "seconds": round(time.monotonic() - t, 1)})
        print(json.dumps(report["images"][-1]), file=sys.stderr, flush=True)
    report["totalSeconds"] = round(time.monotonic() - started, 1)
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
