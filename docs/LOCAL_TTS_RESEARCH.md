# Local Thai speech: verified candidates and current blocker

Reviewed on **2026-10-06** from the model owners' repositories, model cards and license files. The production default remains **`LOCAL_TTS_MODEL_PENDING`**. Customer API keys and external AI calls are not required by the local speech contract. **No real Thai TTS audio was generated in this proof.**

The machine-readable research manifest is `workers/ai-live/local-tts-candidates.json`. It is deliberately separate from the signed installer catalog: a researched candidate, a permissive license, or downloaded weights is not production acceptance.

## Commercial rights checked separately for code and weights

| Candidate | Implementation | Pretrained weights | Thai | Decision |
| --- | --- | --- | --- | --- |
| OpenBMB VoxCPM2 | Apache-2.0 | Apache-2.0 | Officially supported | License-compatible; hardware, runtime audit and quality pending |
| Piper `th_TH-tsync2-medium` | Current runtime GPL-3.0 | Voice card: CC BY-NC-SA 3.0 dataset | Yes | **NOT_SHIPPABLE** |
| ThonburianTTS | Upstream F5 code MIT; wrappers need separate audit | CC BY-NC-SA 4.0 | Yes | **NOT_SHIPPABLE** |
| Wayu-Paxa-TTS-Edge | Apache-2.0 | CC BY-NC 4.0 | Yes | **NOT_SHIPPABLE** |
| F5-TTS pretrained base | MIT | CC BY-NC 4.0 | No approved Thai base | **NOT_SHIPPABLE** |
| VIZINTZOR/F5-TTS-THAI | Upstream F5 code MIT | CC BY 4.0 label, unresolved upstream NC base rights | Yes | **NOT_SHIPPABLE** until base rights are established |
| SiangTTS VoxCPM2 Thai LoRA | Apache-2.0 | CC BY-SA 4.0 | Yes | Commercially permitted under share-alike; installer distribution review pending |
| Qwen3-TTS 0.6B Base | Apache-2.0 | Apache-2.0 | Not in official supported languages | No approved Thai provider |
| Chatterbox Multilingual V3 | MIT | MIT | Not in official supported languages | No approved Thai provider |
| Fish Audio S2 Pro | Fish Audio Research License | Fish Audio Research License | `th` listed | **NOT_SHIPPABLE** without a separate commercial agreement |

The Piper repository's general MIT header does not supersede the individual Thai voice card. A permissive TTS implementation does not remove an NC checkpoint restriction. SiangTTS's share-alike license is different from NC: the current permissive-license installer policy has not accepted its redistribution obligations.

Official evidence:

- VoxCPM2: [owner repository](https://github.com/OpenBMB/VoxCPM), [weights and language card](https://huggingface.co/openbmb/VoxCPM2), [Apache license](https://github.com/OpenBMB/VoxCPM/blob/main/LICENSE).
- Piper: [Thai voice card with explicit NC restriction](https://huggingface.co/rhasspy/piper-voices/blob/main/th/th_TH/tsync2/medium/MODEL_CARD), [current engine repository](https://github.com/OHF-Voice/piper1-gpl).
- ThonburianTTS: [owner model card and model license](https://huggingface.co/biodatlab/ThonburianTTS).
- Wayu: [weights and NC license](https://huggingface.co/wayu-ai/wayu-paxa-tts-edge), [implementation Apache license](https://github.com/wayu-research/wayu-tts-inference/blob/main/LICENSE).
- F5: [implementation MIT license](https://github.com/SWivid/F5-TTS/blob/main/LICENSE), [pretrained weights NC license](https://huggingface.co/SWivid/F5-TTS), [Thai fine-tune's declared base](https://huggingface.co/VIZINTZOR/F5-TTS-THAI).
- SiangTTS: [model card](https://huggingface.co/dubbing-ai/SiangTTS-VoxCPM2-Thai-LoRA), [adapter license and training-data lineage](https://huggingface.co/dubbing-ai/SiangTTS-VoxCPM2-Thai-LoRA/blob/main/LICENSE).
- Qwen speech: [official weights card and supported languages](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base), [implementation Apache license](https://github.com/QwenLM/Qwen3-TTS/blob/main/LICENSE).
- Chatterbox: [owner weights card and languages](https://huggingface.co/ResembleAI/chatterbox), [implementation MIT license](https://github.com/resemble-ai/chatterbox/blob/master/LICENSE).
- Fish: [weights card with separate commercial-license requirement](https://huggingface.co/fishaudio/s2-pro), [current implementation research license](https://github.com/fishaudio/fish-speech/blob/main/LICENSE).

## Actual verification and CPU preflight

VoxCPM2 was downloaded from official revision **`32279effe8c19989596f05d353d1447f51d9e915`** into the ignored local proof folder. Eight upstream files were hashed from their actual bytes. The official Apache license from the exact `voxcpm==2.0.3` wheel was subsequently copied alongside the model as `LICENSE.txt`. These are development evidence, not a signed installed release.

| Verified artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `model.safetensors` | 4,580,080,592 | `f7f964cfa9da23653baec6e6f7750719977ad944ed9f95fe52fe3a620506891d` |
| `audiovae.pth` | 376,951,122 | `94b5d51e107e0507d4acc976cfdadb64edd6fd06d1f751dadbf2fd1594274bf1` |
| `LICENSE.txt` | 11,298 | `4f10acc209addacfad28293315c74c4cd648f771ee1263a748f1781d1e0265e4` |

The complete small-file hashes are in the research JSON. Other candidates were not downloaded; their hashes are **null**, never placeholders.

The real local preflight report is `benchmarks/local-tts-cpu-preflight.json`. After the Brain proof was stopped, the TTS preflight measured total RAM **16,863,055,872 bytes**, available RAM **4,647,927,808 bytes**, and verified upstream artifacts **4,960,730,347 bytes**. The model loader and activations need additional memory. The adapter's conservative CPU policy requires **8 GiB available**; it rejected loading with **`LOCAL_TTS_CPU_MEMORY_PENDING`**. The 27,774,976-byte sampled process peak belongs to preflight validation, **not TTS inference**.

The current official implementation exposes CPU device selection, even though the quick-start advertises CUDA. [Local constructor](https://github.com/OpenBMB/VoxCPM/blob/main/src/voxcpm/core.py) and [device resolution](https://github.com/OpenBMB/VoxCPM/blob/main/src/voxcpm/model/utils.py) were inspected; CPU support is not a measured claim of real-time speed.

**No PCM samples, first-audio latency, real-time factor, Thai pronunciation scores, streaming proof, interruption proof, stability result or GPU measurements exist for this TTS run.** Their report fields are null or pending. No NC model, paid endpoint, cloud denoiser or OS voice was substituted.

## Contract, voice rights and production gates

`local_tts.py` outputs the existing mono PCM16 / 16 kHz `voice.SpeechChunk` format. Preprocessing is independent of the model: Thai/Arabic numerals, prices, quantities, percentages, acronym/SKU spelling, account pronunciation dictionaries and bounded sentence chunks. The provider has bounded memory caches isolated by account/presenter/room context. Interrupt/cancel invalidates pending output; the current official adapter releases compute between native model chunks, not an unproven hard preemption guarantee.

The production factory resolves fixed model paths through `LocalModelManager`. It requires signed, hash-covered artifacts, packaged notices, identified owner audio ratings and explicit release acceptance; a real warmup must then succeed. Research artifacts alone cannot produce a ready badge.

`voice_packs.py` binds consent and speaker identity, recording provenance, allowed synthesis/cloning/training usage and account/presenter assignments. PCM, metadata and consent evidence are AES-GCM encrypted with a random key protected by existing current-user Windows DPAPI. References decrypt into memory; owner/account/presenter mismatch, revocation, expiry or missing rights rejects use. Recorded voice packs report `runtime_ready=false`: evidence storage is not a completed voice-cloning engine. Cloning remains disabled in the VoxCPM adapter because its public reference interface uses a file path and no plaintext recording export is permitted.

`tts_benchmark.py` measures actual output clips from a verified commercial model: first audio, elapsed/audio duration, RTF, process RAM, available device VRAM, PCM chunks, interruption, cancellation and observed session length. Pronunciation, naturalness and consistency are null until an identified owner rates the exact audio hashes. Short repeated samples never claim full LIVE stability; production requires a measured soak and presenter/encoder contention verification.

## Own-model training preparation

Prepared configuration: `workers/ai-live/tts-training/voxcpm2-own-lora.yaml`. Prepared rights and dependency gates: `workers/ai-live/tts-training/rights-plan.json`.

The proposed base is the verified Apache-2.0 VoxCPM2 checkpoint, with its included Apache-2.0 **AudioVAE V2** (`audiovae.pth`, hash above). No external NC vocoder or NC pretrained F5 checkpoint is allowed. The owner's [official LoRA config](https://github.com/OpenBMB/VoxCPM/blob/main/conf/voxcpm_v2/voxcpm_finetune_lora.yaml) and [training entry point](https://github.com/OpenBMB/VoxCPM/blob/main/scripts/train_voxcpm_finetune.py) were inspected. The local recipe reduces batch/workers for preparation; it is not a trained checkpoint or a GPU memory result.

Training requires independently reviewed commercial rights, explicit training permission, permission to distribute derived voice weights, speaker identity, recording provenance, account/presenter binding and an encrypted in-memory dataset loader. The path-based upstream audio loader remains disabled in the plan. No training dataset or dedicated GPU was supplied and no training was run.

The architecture/base/vocoder license audit is recorded. **The complete runtime/native dependency audit is still a release blocker**: exact wheels and each imported transitive/native codec license must be pinned, reviewed, hashed and packaged with LICENSE/NOTICE. The rights plan lists concrete license paths and rejects unknown or NC dependencies. `pip install voxcpm` has a broad dependency graph; its optional cloud denoiser and web services are not enabled by the adapter. Inspect [official dependency manifest](https://github.com/OpenBMB/VoxCPM/blob/main/pyproject.toml) and the exact installed wheel notices before any signed commercial package.

The available CPU preflight evidence supports keeping TTS pending. Production approval still needs suitable available memory/GPU, fully audited packaged runtime, real Thai audio with owner ratings, and a complete LIVE streaming/interruption soak. The customer supplies no AI API key.
