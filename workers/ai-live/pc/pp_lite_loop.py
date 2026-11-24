# LIVE Lite from a LIVE Pro presenter (Lucky 2026-11-25): the Lite body is a seamless loop cut from the Pro presenter's own walk
# (its real Wan2.2 motion frames), and every frame of that loop gets ~10 mouth shapes rendered ahead of time with Pro's MuseTalk 1.5
# (same latents, masks, paste and mouth sharpening as live_engine.py). A Lite PC then only plays the loop and picks the mouth that
# matches the voice: no graphics card needed during the live. Run with venv-gpu python while the live is OFF:
#   python pp_lite_loop.py --avatar avatar3b --out D:\ViralFlowAI\ai-live-lite-packs\praew-loop --calibration-wav <...>\calibration.wav
#        [--levels 14] [--min-s 6] [--max-s 15] [--name "แพรว"] [--voice th-TH-PremwadeeNeural] [--consent consent.json | --praew]
# Writes only under --out (and a preview mp4 next to it with --preview). Nothing on C:.
import os, sys, json, pickle, glob, argparse, time, tempfile
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__)); LAB = os.path.dirname(HERE)
MT = os.path.join(LAB, "MuseTalk"); PRAEW = os.path.join(LAB, "praew"); LIVE = os.path.join(LAB, "live")
LITE = os.environ.get("PP_LITE_CODE", r"D:\vf-lite\workers\ai-live")
FPS = 25

def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--avatar", required=True); ap.add_argument("--out", required=True); ap.add_argument("--calibration-wav", required=True)
    ap.add_argument("--levels", type=int, default=14); ap.add_argument("--min-s", type=float, default=6); ap.add_argument("--max-s", type=float, default=15)
    ap.add_argument("--name", default=None); ap.add_argument("--voice", default=None)
    ap.add_argument("--consent", default=None, help="consent.json of the real person (likeness_use, person, signed_at)")
    ap.add_argument("--praew", action="store_true", help="Praew: fictional AI presenter (provenance instead of consent)")
    ap.add_argument("--sharpen", type=float, default=None, help="mouth unsharp amount (default: live_config mouth_sharpen_by_avatar)")
    ap.add_argument("--preview", action="store_true", help="also write <out>_preview.mp4 (10 s, calibration voice) to check by eye")
    a = ap.parse_args()
    sys.path.insert(0, LITE)
    from pathlib import Path
    from lite_pack_builder import choose_loop, build_loop_pack, read_wav_pcm16
    from lite_presenter_pack import mouth_measurements
    AV = os.path.join(PRAEW, a.avatar)
    if not os.path.isfile(os.path.join(AV, "walk.json")): sys.exit(f"no Pro presenter at {AV} (walk.json missing: build the full presenter first)")
    if not 2 <= a.levels <= 20: sys.exit("--levels must be 2..20")

    # 1) the loop: the longest seamless slice of Pro's calm base walk, sized so frames x levels fits a pack
    wj = json.load(open(os.path.join(AV, "walk.json")))
    max_len = int(min(a.max_s * FPS, 8000 // a.levels))
    start, n = choose_loop(wj["walk"], wj.get("base_len"), min_len=int(a.min_s * FPS), max_len=max_len)
    walk = wj["walk"][start:start + n]
    bodies = sorted(set(walk)); at = {j: i for i, j in enumerate(bodies)}
    log(f"loop: walk[{start}:{start + n}] = {n / FPS:.1f} s, {len(bodies)} different frames")

    # 2) Pro's own material for those frames
    SRC = os.path.join(AV, "src") if os.path.isdir(os.path.join(AV, "src")) else os.path.join(PRAEW, "idle2_src")
    files = sorted(glob.glob(os.path.join(SRC, "*.png")) + glob.glob(os.path.join(SRC, "*.jpg")))
    coords = pickle.load(open(os.path.join(AV, "coords.pkl"), "rb"))
    masks, mboxes = pickle.load(open(os.path.join(AV, "masks.pkl"), "rb"))
    src = {j: cv2.imread(files[j]) for j in bodies}
    keep = {j: (masks[j], mboxes[j]) for j in bodies}; del masks
    cfg = json.load(open(os.path.join(LIVE, "live_config.json"), encoding="utf-8"))
    k_sharp = a.sharpen if a.sharpen is not None else float(cfg.get("mouth_sharpen_by_avatar", {}).get(a.avatar, 0.0))
    WY = np.clip((np.arange(256, dtype=np.float32) - 110) / 40.0, 0, 1)[:, None, None]   # lower half only, feathered

    def sharpen(face):
        if k_sharp <= 0: return face
        f = face.astype(np.float32); blur = cv2.GaussianBlur(f, (0, 0), 1.2)
        return np.clip(f + k_sharp * (f - blur) * WY, 0, 255).astype(np.uint8)

    def paste(j, face256):   # = live_engine.paste: the generated face into the box, blended through Pro's own mask
        m, (xs, ys, xe, ye) = keep[j]; x1, y1, x2, y2 = coords[j]
        al = (m.astype(np.float32) / 255.0)[..., None] if m.dtype == np.uint8 else m
        base = src[j][ys:ye, xs:xe].astype(np.float32); reg = src[j][ys:ye, xs:xe].copy()
        reg[y1 - ys:y2 - ys, x1 - xs:x2 - xs] = cv2.resize(sharpen(face256), (x2 - x1, y2 - y1), interpolation=cv2.INTER_LANCZOS4)
        return (base + (reg.astype(np.float32) - base) * al + 0.5).astype(np.uint8)   # the box region only

    # 3) MuseTalk exactly as live_engine.py loads it
    import torch
    torch.set_grad_enabled(False); dev, dt = torch.device("cuda"), torch.float16
    cwd = os.getcwd(); os.chdir(MT); sys.path.insert(0, MT)
    from transformers import WhisperModel
    from musetalk.utils.audio_processor import AudioProcessor
    from musetalk.models.vae import VAE
    from musetalk.models.unet import PositionalEncoding
    from diffusers import UNet2DConditionModel
    vae = VAE(model_path="./models/sd-vae")
    with torch.device(dev): unet = UNet2DConditionModel(**json.load(open("./models/musetalkV15/musetalk.json")))
    w_ = torch.load("./models/musetalkV15/unet.pth", map_location=dev); unet.load_state_dict(w_); del w_
    unet = unet.to(dev, dt).eval(); pe = PositionalEncoding(d_model=384).to(dev, dt); vae.vae = vae.vae.to(dev, dt)
    apr = AudioProcessor(feature_extractor_path="./models/whisper")
    whisper = WhisperModel.from_pretrained("./models/whisper").to(dev, dt).eval()
    os.chdir(cwd)
    lat_all = torch.load(os.path.join(AV, "latents.pt"))
    TS = torch.tensor([0], device=dev)

    def chunks_for(pcm16):
        f = os.path.join(tempfile.gettempdir(), "pp_lite_loop.wav")
        import soundfile as sf; sf.write(f, np.frombuffer(pcm16, np.int16), 16000)
        feats, alen = apr.get_audio_feature(f, weight_dtype=dt)
        return apr.get_whisper_chunk(feats, dev, dt, whisper, alen, fps=FPS, audio_padding_length_left=2, audio_padding_length_right=2)

    def render(j, ch):   # -> list of 256x256 BGR faces for frame j, one per audio chunk
        lat = lat_all[j]; lat = (lat if lat.dim() == 4 else lat[None]).to(dev, dt)
        out = []
        for b in range(0, len(ch), 16):
            c = ch[b:b + 16]
            pred = unet(lat.repeat(len(c), 1, 1, 1), TS, encoder_hidden_states=pe(c.to(dev, dt))).sample
            img = ((vae.vae.decode(pred / vae.scaling_factor).sample) / 2 + 0.5).clamp(0, 1)
            out += list((img.permute(0, 2, 3, 1).float().cpu().numpy() * 255).round().astype(np.uint8)[..., ::-1])
        return [np.ascontiguousarray(f) for f in out]

    # 4) the mouth levels: from the calibration speech, the chunks whose mouth is closed ... wide open (measured on one frame)
    calib = read_wav_pcm16(Path(a.calibration_wav))
    ch = chunks_for(bytes(16000 * 2) + calib)                   # 1 s silence first: its middle chunk = closed mouth
    j0 = walk[0]
    faces = render(j0, ch)
    closed_i = 12                                                # middle of the silence second
    open_, _ = mouth_measurements(faces, faces[closed_i])
    open_ = np.array(open_); voiced = np.arange(25, len(open_))
    order = voiced[np.argsort(open_[voiced])]   # quantiles from 5 %: half-open shapes too, not only open ones
    picks = [closed_i] + [int(order[min(len(order) - 1, int(q * (len(order) - 1)))]) for q in np.linspace(0.05, 0.99, a.levels - 1)]
    lv = np.array([0.0] + [float(open_[i]) for i in picks[1:]]); lv = (lv - lv.min()) / max(1e-6, lv.max() - lv.min())
    sel = ch[picks]
    log("mouth levels (openness):", [round(float(v), 2) for v in lv])

    # 5) every loop frame x every level, pasted the way Pro pastes it
    mouths, t0 = [], time.time()
    for i, j in enumerate(bodies):
        for k, face in enumerate(render(j, sel)):
            mouths.append((i, paste(j, face), float(lv[k])))
        if i % 25 == 0: log(f"frame {i + 1}/{len(bodies)}  {time.time() - t0:.0f} s")
    boxes = [tuple(int(v) for v in keep[j][1]) for j in bodies]
    consent = character = None
    name = a.name
    if a.praew:
        character = {"display_name": name or "แพรว", "default_voice": a.voice or "th-TH-PremwadeeNeural",
                     "provenance": {"synthetic_person": True, "license": "Apache-2.0", "model": "Wan2.2-TI2V-5B (GGUF Q8) motion + MuseTalk 1.5 mouth",
                                    "generator": f"presenter-lab praew/{a.avatar} walk[{start}:{start + n}] (LIVE Pro loop)", "seed": 7306}}
    elif a.consent:
        consent = json.load(open(a.consent, encoding="utf-8"))
    pack = build_loop_pack(Path(a.out), loop_images=[src[j] for j in bodies], boxes=boxes, sequence=[at[j] for j in walk],
                           mouths=mouths, fps=FPS, technical=not (consent or character), consent=consent, character=character,
                           display_name=name, default_voice=a.voice)
    log("pack", pack.pack_id, len(pack.loop_frames), "frames", len(pack.frames), "mouths", f"{time.time() - t0:.0f} s")
    print(json.dumps({"ok": True, "pack_id": pack.pack_id, "loop_s": round(n / FPS, 1), "frames": len(bodies), "mouths": len(mouths)}))

    if a.preview:   # the Lite engine itself (CPU path) speaking the calibration voice for 10 s
        from lite_presenter_engine import LitePresenterEngine
        eng = LitePresenterEngine(Path(a.out), allow_technical_test=True); eng.prepare(pack.reference_path, FPS)
        pcm = calib[:16000 * 2 * 10]
        frames = [eng.idle_array(t=t) for t in range(25)] + eng.frames_for_pcm16(pcm, t0=25)
        h, w = frames[0].shape[:2]; vid = a.out.rstrip("\\/") + "_preview_video.mp4"
        vw = cv2.VideoWriter(vid, cv2.VideoWriter_fourcc(*"mp4v"), FPS, (w, h))
        for f in frames: vw.write(f)
        vw.release()
        wav = a.out.rstrip("\\/") + "_preview.wav"
        import soundfile as sf; sf.write(wav, np.concatenate([np.zeros(16000, np.int16), np.frombuffer(pcm, np.int16)]), 16000)
        log("preview", vid, wav, eng.metrics())

if __name__ == "__main__": main()
