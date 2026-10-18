# Thai Voice and Original Graphic Story

Phase 2 adds two zero-cost local formats to the Local Composer so a reviewed concept can become a
finished clip without the owner recording a voice or finding files for every clip. The Media Rights
Ledger and Local Composer are reused unchanged in design; nothing here calls a paid video API,
uploads to TikTok or changes production data.

## Production methods chosen by Creative Brain

| Method | Account mode | Source media | Voice |
|---|---|---|---|
| `REAL_FOOTAGE_EDIT`, `REAL_IMAGE_MOTION` | Affiliate and Growth | Ledger-cleared owner, manufacturer, shop or licensed stock media for this product and account | Required: owner voice, else licensed local TTS. No caption-only product ads. |
| `ORIGINAL_GRAPHIC_STORY` (new) | Growth only | None. The system draws gradient cards with Noto Sans Thai (OFL) | Owner voice, else licensed local TTS, else caption-only if the readability check passes |
| `GENERATIVE_ATMOSPHERE` | Growth only | Generated atmosphere, never product proof | Unchanged; still Assisted and never routed to a paid provider without approval |
| `WAIT_FOR_EVIDENCE` | Any | Missing rights or facts | Nothing renders |

The strategist only marks a graphic story ready when a verified fact exists and the hook, the point and
the call to action each fit on one card (`GRAPHIC_CARD_MAX_CHARS`, 32 base characters, about 2.4 s at
14 characters per second). The LLM agent is held to the same rule and must cite the fact as a claim.
The provider router returns `LOCAL_COMPOSER_ONLY` for this method, so no provider is ever paid for it.
Every concept still needs the owner's review before Video Factory renders it.

## Narration order

`resolveNarration` chooses without asking the owner:

1. The owner's own recording for the project, if its ledger record is a cleared `VOICE` for this account.
2. Licensed local Thai TTS, if the renderer is configured for it. The output must be shorter than 7.8 s or
   the script has to be shortened; it is never cut mid-sentence.
3. Caption-only, only for formats that plan for it (the graphic story).
4. Otherwise no narration, which fails the `VOICE` check so the clip is not released.

Provenance is stored in `quality_explanation_json.narration`, and `aiGeneratedVoice` is set when TTS was
used so the post can carry TikTok's AI-generated content label.

## Caption-only quality gate

`READABILITY` passes only when text is on screen for at least 80% of the clip, every line stays at least
1.5 s, and no line needs more than 14 base characters per second. Thai lines break at the writer's
spaces first, then at dictionary word boundaries. A clip that fails is stored as `RETRY`, not shipped.

## Thai TTS licence check (2026-10-18)

| Item | Licence | Source |
|---|---|---|
| VoxCPM2 weights `openbmb/VoxCPM2` | Apache-2.0, commercial use allowed | Hugging Face model card |
| `voxcpm` 2.0.3 package | Apache-2.0 (`License-Expression` in the wheel) | PyPI |
| torch, torchaudio, transformers, gradio, einops, inflect, soundfile and others | BSD, Apache-2.0, MIT, ISC, MPL-2.0 or PSF | PyPI metadata |
| torchcodec | No licence field on PyPI; upstream repository is BSD-3-Clause | needs a recheck before redistribution |

Voices are designed from a text description, never cloned from a reference recording. The model card asks
users not to impersonate real people and to label AI-generated audio; the training data provenance is not
disclosed. Rejected alternatives: Piper Thai voices, Thonburian, MMS and F5 Thai (non-commercial), PyThaiTTS
voices (licence unclear), KhanomTan (weights Apache-2.0 but Thai speaker data provenance unclear).

## Running TTS on a render machine

```bash
python -m venv .venv-tts && .venv-tts/bin/pip install "voxcpm==2.0.3" soundfile
export THAI_TTS_PROVIDER=voxcpm2 THAI_TTS_PYTHON=$PWD/.venv-tts/bin/python
# Optional: VOXCPM_MODEL=/path/to/VoxCPM2 VOXCPM_DEVICE=cuda THAI_TTS_VOICE="calm Thai male narrator"
```

The model is about 2B parameters (about 8 GB of GPU memory; CPU works but is slow). It cannot run on Vercel
functions, so TTS belongs on a separate render machine. If the variables are absent, the renderer falls back
as described above.

## Isolated pilot

`pnpm pilot:graphic <dir>` renders one graphic story with no database, network, paid API or TikTok call and
writes `report.json` with render time, cost basis, narration source and every QC result. The first run on
2026-10-18 (4 vCPU, FFmpeg 6.1, no TTS available because model downloads were blocked) rendered a caption-only
8 s 1080x1920 clip in about 7.2 s at 0 THB with all checks passing. That proves the pipeline only; no viewer
has seen it, so it says nothing yet about performance on TikTok.
