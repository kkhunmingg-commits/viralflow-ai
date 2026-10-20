"""Image-to-video with LTX-Video 2B distilled (Lightricks, LTX Open Weights License) on CPU.

A real photo of the product is the first frame; the model generates the motion and camera move after it.
No paid API. Reads one shot as JSON on stdin:
  {"image": "path.jpg", "prompt": "...", "output": "shot.mp4", "width": 480, "height": 832,
   "frames": 97, "seed": 7, "timesteps": [...]}  (timesteps optional; default is the 2B 0.9.8 distilled first pass)
Prints one JSON line with timings and what actually ran.

Setup (render machine only):
  pip install --extra-index-url https://download.pytorch.org/whl/cpu torch diffusers==0.35.2 transformers==4.57.1 \
    sentencepiece accelerate safetensors huggingface_hub imageio imageio-ffmpeg Pillow
"""
import gc
import json
import os
import sys
import time

import torch
from diffusers import AutoencoderKLLTXVideo, LTXConditionPipeline, LTXVideoTransformer3DModel
from diffusers.pipelines.ltx.pipeline_ltx_condition import LTXVideoCondition
from diffusers.utils import export_to_video
from huggingface_hub import hf_hub_download, snapshot_download
from PIL import Image, ImageOps

REPO = "Lightricks/LTX-Video"
CHECKPOINT = os.environ.get("LTX_CHECKPOINT", "ltxv-2b-0.9.8-distilled.safetensors")
# Text encoder, tokenizer and scheduler come from the 2B diffusers release the checkpoint was built on.
BASE = "Lightricks/LTX-Video-0.9.5"
# First-pass timesteps of the 2B 0.9.8 distilled config (configs/ltxv-2b-0.9.8-distilled.yaml), no CFG.
DISTILLED_TIMESTEPS = [1000, 993, 987, 981, 975, 909, 725, 0.03]
NEGATIVE = "worst quality, inconsistent motion, blurry, jittery, distorted, deformed product, wrong text, extra parts"


def fit(image: Image.Image, width: int, height: int) -> Image.Image:
    """Cover-crop to the frame without stretching the product."""
    return ImageOps.fit(ImageOps.exif_transpose(image).convert("RGB"), (width, height), Image.LANCZOS, centering=(0.5, 0.5))


def main() -> None:
    shot = json.load(sys.stdin)
    width, height, frames = int(shot.get("width", 480)), int(shot.get("height", 832)), int(shot.get("frames", 97))
    timesteps = shot.get("timesteps") or DISTILLED_TIMESTEPS
    torch.set_num_threads(os.cpu_count() or 4)
    started = time.monotonic()
    report = {"engine": f"{REPO}/{CHECKPOINT}", "base": BASE, "device": "cpu", "width": width, "height": height,
              "frames": frames, "steps": len(timesteps), "seed": shot.get("seed", 0), "torch": torch.__version__}

    # 1. Text encoder only, then free it: the T5 encoder alone is larger than the video model.
    base = snapshot_download(BASE, allow_patterns=["model_index.json", "scheduler/*", "tokenizer/*", "text_encoder/*"])
    encoder_pipe = LTXConditionPipeline.from_pretrained(base, transformer=None, vae=None, torch_dtype=torch.bfloat16)
    with torch.no_grad():
        embeds, mask, _, _ = encoder_pipe.encode_prompt(shot["prompt"], do_classifier_free_guidance=False,
                                                        max_sequence_length=256, device="cpu", dtype=torch.float32)
    tokenizer, scheduler = encoder_pipe.tokenizer, encoder_pipe.scheduler
    del encoder_pipe
    gc.collect()
    report["textEncoderSeconds"] = round(time.monotonic() - started, 1)

    # 2. Video model and VAE from the distilled single-file checkpoint.
    path = hf_hub_download(REPO, CHECKPOINT)
    transformer = LTXVideoTransformer3DModel.from_single_file(path, torch_dtype=torch.float32)
    vae = AutoencoderKLLTXVideo.from_single_file(path, torch_dtype=torch.float32)
    vae.enable_tiling()
    pipe = LTXConditionPipeline(scheduler=scheduler, vae=vae, text_encoder=None, tokenizer=tokenizer, transformer=transformer)
    report["loadSeconds"] = round(time.monotonic() - started - report["textEncoderSeconds"], 1)

    image = fit(Image.open(shot["image"]), width, height)
    image.save(shot["output"].replace(".mp4", "-first-frame.png"))
    step_times = []
    last = [time.monotonic()]

    def on_step(_pipe, index, _timestep, kwargs):
        now = time.monotonic()
        step_times.append(round(now - last[0], 1))
        last[0] = now
        print(json.dumps({"step": index, "seconds": step_times[-1]}), file=sys.stderr, flush=True)
        return kwargs

    generate_started = time.monotonic()
    with torch.no_grad():
        video = pipe(conditions=[LTXVideoCondition(image=image, frame_index=0)], prompt_embeds=embeds, prompt_attention_mask=mask,
                     width=width, height=height, num_frames=frames, frame_rate=25, timesteps=timesteps, guidance_scale=1.0,
                     decode_timestep=0.05, decode_noise_scale=0.025, image_cond_noise_scale=0.025,
                     generator=torch.Generator("cpu").manual_seed(int(shot.get("seed", 0))),
                     callback_on_step_end=on_step).frames[0]
    report["stepSeconds"] = step_times
    report["generateSeconds"] = round(time.monotonic() - generate_started, 1)
    export_to_video(video, shot["output"], fps=25)
    report["totalSeconds"] = round(time.monotonic() - started, 1)
    report["output"] = shot["output"]
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
