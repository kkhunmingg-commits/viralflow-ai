# Integration holdout and actual local media proof

Verified locally on 8 October 2026. No paid generation, paid inference, TikTok posting, production configuration change or policy activation was performed by these proofs.

## Independent semantic holdout

`src/features/compliance-brain/holdout-corpus.ts` contains 36 sentences absent from the original 93-case `corpus.ts`. They were frozen before evaluation; neither the classifier nor the engine was tuned to these examples. The same engine and an ephemeral signed **test-only** policy authority are used for POST and LIVE.

| Observation | Result |
| --- | --- |
| Unique holdout sentences | 36 |
| POST + LIVE boundary evaluations | 72 |
| Unsupported statements released | 0 / 48 |
| Unsupported statements with a recognized risk category | 4 / 48 |
| Unsupported statements held by grounding only | 44 / 48 |
| Verified benign fixture statements incorrectly held | 0 / 24 |
| Holdout tests including rewrite, expiry, owner and policy checks | 81 passed |

The holdout includes new skincare metaphors, implied age reversal, cellular change, mixed Thai/English language, indirect promises, appended disclaimers, rhetorical questions, instruction text, household/food/electronics claims and evidence-backed cosmetic/package facts. It additionally proves that a safe rewrite is applied and rescanned, a harmful rewrite cannot be approved, expired or another owner's evidence cannot ground a claim, unmet conditions remain held and missing policy cannot authorize a verified fact.

**Interpretation:** the release boundary rejects unsupported language, but this does not establish general semantic understanding. Most novel unsafe examples were held as unknown facts rather than classified into a specific prohibited claim category. An approved claim's truth and approved aliases still require trustworthy evidence and review. The optional local semantic model has not been provisioned or benchmarked here. The selected holdout is too small and too artificial to estimate production false-positive rates or calibrated risk confidence.

Reproduce without network access:

```powershell
pnpm --config.verify-deps-before-run=false test src/features/compliance-brain/holdout.test.ts
pnpm --config.verify-deps-before-run=false exec tsx scripts/verify-compliance-holdout.ts
```

The second command writes case-by-case outcomes and recognition versus grounding counts to `.video-cache/compliance-readiness/semantic-holdout-report.json`.

## Actual local video, audio and frame observations

`scripts/verify-compliance-media.ts` reuses the existing production video probe, frame extractor and visual-verification boundary. It creates a local fictional-product fixture, performs a complete media decode, probes H.264 + AAC, extracts actual JPEG frames at 0.75, 4.00 and 7.25 seconds, decodes actual PCM and verifies that the source hash was not changed by inspection.

Observed fixture: 360 × 640, 15 FPS, 8.000 seconds, H.264 + AAC. Actual audio: 128,000 mono PCM samples at 16 kHz, RMS approximately 0.0883. The first fixture contains a local sine tone and an intentionally unverified burned-in claim. Tone energy is **not** speech understanding, and extracted pixels are **not** OCR or complete visual review.

With no vision provider, the existing visual boundary returned `REVIEW`. The same ComplianceEngine returned `REVIEW_REQUIRED` with `VISUAL_REVIEW_REQUIRED`. No transcript, OCR, cover text, trusted `MEDIA_REVIEW` evidence or completeness assertion was invented. Readiness artifacts include the source MP4, extracted WAV, three JPEG frames, per-file hashes and `report.json`; all remain under the Git-ignored `.video-cache/compliance-readiness/` directory.

```powershell
pnpm --config.verify-deps-before-run=false exec tsx scripts/verify-compliance-media.ts
```

## Experimental actual speech transcription

`scripts/verify-compliance-asr.py` is an opt-in offline inspection proof, not a production scanner or attestation writer. It reuses the existing local `openai/whisper-tiny` model weights from AI LIVE without changing those files or downloading weights. Seven small public tokenizer/config files were downloaded from the official repository at revision `169d4a4341b33bc18d8881c4b69c2e104e1cc0af`; each was checked against its Git blob hash. Existing model bytes matched the official LFS SHA-256. The source manifest and downloads are confined to the ignored proof directory.

The proof creates an English fixture with the local Windows speech engine, muxes it into an MP4, extracts its actual encoded AAC audio and runs CPU float32 transcription with Hugging Face networking disabled. In the observed run, the decoded 8.034-second audio produced the same sentence as its fixed spoken reference in approximately 0.36 seconds after model loading: “This cream restores your skin DNA.” This is deliberately unsupported skincare content.

The TypeScript media proof separately verifies the WAV and MP4 hashes from that observation and feeds its actual transcript into the shared final ComplianceEngine. It remained `REVIEW_REQUIRED`, with `UNKNOWN_FACT` and incomplete visual coverage. It writes no production media attestation, claim, evidence or customer decision.

```powershell
# One explicit public tokenizer preparation, using weights already installed locally:
.\.venv-dev\Scripts\python.exe -B scripts/verify-compliance-asr.py --prepare-tokenizer
# Subsequent inference needs no network:
.\.venv-dev\Scripts\python.exe -B scripts/verify-compliance-asr.py
pnpm --config.verify-deps-before-run=false exec tsx scripts/verify-compliance-media.ts
```

The [official Whisper-tiny repository](https://huggingface.co/openai/whisper-tiny) identifies its Apache-2.0 license and model usage. A single synthesized English fixture is not Thai ASR validation. Recognition can omit or hallucinate words; text accuracy, speech coverage and confidence thresholds still require a representative evaluation. OCR, full visual inference, product identity and misleading visual-effect detection remain unavailable in this proof and cannot produce a visual PASS.

## Official policy and actual product authority

The official [Thailand Shop Content Policy](https://seller-th.tiktok.com/university/essay?knowledge_id=10008418&lang=en), [Health & Beauty guidance](https://seller-th.tiktok.com/university/essay?knowledge_id=10009139&lang=en) and [AIGC guidance](https://seller-th.tiktok.com/university/essay?knowledge_id=6490273266140929&lang=en) were reopened during this integration work. The beauty guidance differentiates evidence-backed exact package/regulatory wording and temporary cosmetic effects from misleading treatment promises or edited result claims. The AIGC guidance requires truthful representation and disallows fabricated effects and authority endorsements. Human interpretation, scope and exceptions still require approval; publication dates are not invented effective dates.

The existing Thailand research candidate remains `HUMAN_REVIEW_PENDING`, unsigned and inactive. Its normalized source-text hashes are audit identifiers, not a signature issued by TikTok. These holdout/media tests use ephemeral test signatures only and do not constitute owner policy approval. No real customer claims or evidence were invented or marked verified. A product description or a local transcript alone cannot populate a verified claim ledger.

## Fal integration guards

Three additional production-path tests use the actual compliance service and fal orchestration with only database/storage/network boundaries substituted. They prove: missing verified claims stop before provider upload/reservation; an unsafe voice script persists `BLOCK` before upload/spend; and policy retirement during image upload prevents the paid generation POST, releases the existing hold and submits no fallback. The focused three-test run passed. No real fal generation was performed.
