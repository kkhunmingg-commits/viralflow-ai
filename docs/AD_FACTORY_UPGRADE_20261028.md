# Intelligent Ad Factory upgrade — 28 October 2026

Continuation of Draft PR #10 on `codex/flow-drive-d-restore-20261026`. This round turns the Video Factory from "move a product photo and call it an advert" into a pipeline that decides **what to sell, to whom, with which story**, plans real shots, edits them, and **rejects boring clips**. No Flow Generate was clicked, no paid service was added, nothing was published, merged or deployed.

## 1. Root cause of the rejected clip

Clip: `workers/flow-browser/workspace/manual-downloads/Casio_watch_camera_push-in_20261028015602.mp4` (owner-supplied Flow output, 10 credits spent).

Measured with FFprobe/FFmpeg (the new critic reproduces these numbers):

| Signal | Value | Meaning |
|---|---|---|
| Format | H.264 + AAC, 720×1280, 24 fps, 8.0 s | Technically a valid file |
| Integrated loudness | **−63.4 LUFS** | Effectively silent; no narration, no music |
| Scene changes (score > 0.28) | **0** | One continuous shot |
| Distinct looks in 32 sampled frames (dHash) | **2** | The same framing for 8 s |
| Longest near-identical run | 4 s+ | Padding, not story |
| Watch face | AI-redrawn; seconds read `08 → 011 → 0H` | Product reconstructed by the model, not the real photo |

Root cause, traced back through every stage:

| Stage | What happened | Module | Fix in this round |
|---|---|---|---|
| Product selection | One Commons-scouted product; no market data at all. The system had no way to say "this is a trial, not a recommendation". | `products/` | `products/intelligence.ts`: separate Opportunity / Creative Potential / Data Confidence / Eligibility, `UNKNOWN` instead of 0, `SINGLE_PRODUCT_TRIAL` mode. |
| Creative decision | `.env.local` has `CREATIVE_AI_PROVIDER=evidence-rubric`; no local model file (`LOCAL_LLM_MODEL_PATH`) and no API key exist on this machine, and the offline-product path deliberately forbids a provider. So the deterministic rubric produced one format (`REAL_IMAGE_MOTION`) with no audience insight and no alternatives. | `creative/services.ts`, `creative/strategist.ts` | `creative/ad-director.ts` + `category-insight.ts`: consumer insight (HYPOTHESIS vs EVIDENCED), ≥3 different concept formats per category, a 10-criterion critic; uses the local LLM when configured (INTELLIGENT mode) and says plainly when it is not. |
| Flow prompt | One generic "navy/cyan background" prompt for every product (`flow-background-prompt.ts`). The clip that came back was a camera push-in on an AI-drawn watch instead. | `video/flow-background-prompt.ts` | `video/flow-prompt-compiler.ts`: compiles only storyboard **context** scenes into sectioned Flow prompts (scene, composition, cinematography, lighting, motion, framing, atmosphere, audio, timing, reference, negative list that forbids the product, logos, digits, hands, mechanisms). Product scenes never go to Flow. |
| Shot planning | No storyboard: a single paragraph. | — | `creative/storyboard.ts`: structured scenes with role, layout, camera, real asset id, palette, narration, on-screen text, sound cue, transition, evidence ids; adaptive 8–24 s; validator blocks single-move edits, invented figures, uncleared media, cart CTA without rights. |
| Editing | `flow-photo-composer.ts` put one photo in a fixed position for 8 s. | `video/flow-photo-composer.ts` (kept unchanged for the original job) | `video/storyboard-composer.ts`: multi-shot editor (kinetic hook, product reveal with shadow and rise, macro detail/pan, spec badge, checklist, hero light sweep, end card), xfade transitions, animated Thai type and vector motion graphics in TikTok safe zones, background-only colour grading (product pixels are never recoloured), disclosure + licence credit, music bed with ducking under narration, loudness set to −14 LUFS. |
| Quality gate | `quality.ts` only checks codec/size/duration and defers semantics to a vision model that does not exist, so a silent single shot could look "technically fine". | `video/quality.ts` | `video/creative-critic.ts`: `TECHNICAL_PASS` is separate from `CREATIVE_PASS`; hook, structure, benefit, padding, audio presence, duplication and honesty are machine-checked; semantic checks stay `UNKNOWN` → human review; failures go back to storyboard/editor, never to an automatic re-generate, and record the cost. |

Prompt words such as "cinematic" or "premium" were not used as a fix anywhere.

## 2. Before / After (actual files)

All After videos are **SYNTHETIC_PREVIEW** edits: real, owner-approved Casio photograph (CC BY-SA 4.0, Multicherry) + the two approved facts (`นาฬิกาดิจิทัล`, `น้ำหนัก 21 กรัม`), with local graphics. Context scenes planned for Flow were rendered as local graphics because no new Generate was approved; the composer reports that substitution and the on-screen disclosure reflects what was actually rendered.

| | Before (Flow, rejected) | After 1 — Curiosity (critic's pick) | After 2 — Product detail | After 3 — Lifestyle "simplicity" |
|---|---|---|---|---|
| Technical | **TECHNICAL_FAIL** (−63.4 LUFS) | TECHNICAL_PASS | TECHNICAL_PASS | TECHNICAL_PASS |
| Creative | **CREATIVE_FAIL** (no hook, 0 cuts, padding, silent, AI-redrawn product) | CREATIVE_PASS | CREATIVE_PASS | CREATIVE_PASS |
| Decision | REVISE_STORYBOARD_OR_EDIT (10 credits recorded as failure cost) | READY_FOR_OWNER_REVIEW | READY_FOR_OWNER_REVIEW | READY_FOR_OWNER_REVIEW |
| Scenes | 1 | Macro tease → reveal + 21 g → digital callout → end card | Macro → detail pan + 21 g → callout → end card | Kinetic hook → reveal + 21 g → end card |
| Cost | 10 Flow credits | 0 credits (local FFmpeg) | 0 | 0 |

Files are written under ignored `.runtime/ad-factory/<run>/` (`AFTER_*.mp4`, `BEFORE_vs_AFTER.mp4`, `report.json`). Reproduce with:

```powershell
. .\scripts\enter-drive-d.ps1
node --import ./scripts/pilot/server-only-shim.mjs --import tsx scripts/pilot/ad-factory-run.ts
```

`CREATIVE_PASS` here means the machine checks passed; semantic product/text accuracy remains `UNKNOWN` (no vision model) and needs the owner's review.

## 3. Multi-category proof (not Casio-only)

`ad-factory-run.ts` also ranks a clearly labelled **SYNTHETIC_TEST_DATA** set (serum, kitchen organiser, earbuds, snack) and plans ads for three of them. Result: different formats and scene structures per category (home → problem→solution with a Flow context scene; beauty → product detail, ASMR marked infeasible without real footage/audio; gadget → product detail), an out-of-stock product with high demand is ranked out, and a product without cleared media is ineligible. Unit tests assert the same.

## 4. Learning loop

`analytics/ad-learning.ts` links imported real results (owner report import / API sources only) to product, concept format, hook, provider, quality verdict and cost. It ignores posts younger than 48 h, withholds lift until a format has ≥ 5 posts with enough views, shrinks small samples toward the account baseline, and includes failed clips in cost per usable clip. `directorLearning()` feeds only sufficient evidence back into the director; `learnOpportunityWeights()` moves product-ranking weights only with ≥ 20 samples. No simulated views, sales or win rates are stored.

## 5. Thai dashboard (existing pages)

- **Creative Studio → project**: new "AI Creative Director" panel — product reasoning and scores (with UNKNOWN), data confidence, eligibility, audience hypotheses vs evidenced differentiators, do-not-claim list, all concepts with critic scores and reasons, storyboard table, the exact Flow prompts and credit estimate (approval required). Read-only, zero cost.
- **Video Factory → master**: new "AI Video Quality Critic" panel with a button to run the critic on the stored MP4; shows Technical/Visual/Creative/Semantic separately. It stores the verdict in `quality_explanation_json.creativeCritic` and does not change quality status, approval or publishing.

No schema change, no Telegram, no separate dashboard.

## 6. Status labels

| Item | Status |
|---|---|
| Product intelligence, director, storyboard, Flow compiler, critic, learning | Unit-tested (16 new tests); full suite 999 passed / 2 skipped |
| Multi-shot editor | Real local FFmpeg renders (test fixture + real Casio photo) |
| Director view on the real project `e86d380a…` | Verified read-only against hosted data via `scripts/pilot/ad-director-view.ts` |
| Creative Studio / Video Factory panels | Typecheck + lint; **not visually verified in a browser** — the in-app browser was denied for localhost again (same blocker as the Flow pilot doc) |
| After videos | SYNTHETIC_PREVIEW (real photo, no Flow context clips) |
| Real Flow generation of the new context scenes | **Not done** — needs owner approval (1 generation ≈ 10 credits observed) |
| Import of an After video into Video Factory + download | **Not done** — the only open provider job (`9dd0e1ba…`) is reserved for the original Flow result; importing a local edit there would misreport provenance |
| INTELLIGENT_LLM mode on this machine | Not active: no local GGUF model or key exists; code path is tested with a stub provider |
| Production ready | No |

## 7. Owner decisions needed

1. Approve (or not) **one** Flow generation for a storyboard context scene, using the compiled prompt shown in Creative Studio. Nothing is generated until then.
2. Choose how a local storyboard edit should enter Video Factory: a new local-composer master for project `e86d380a…`, or keep the original job for a real Flow result only.
3. Optional: provide a local model (e.g. Qwen3-4B GGUF, Apache-2.0) and set `CREATIVE_AI_PROVIDER=hybrid` with `LOCAL_LLM_PYTHON`/`LOCAL_LLM_MODEL_PATH` on drive D to switch the director to INTELLIGENT mode at zero per-token cost.

## 8. Owner feedback round: Flow-native production (28 Oct, later)

What happened after the first round:

- The owner approved one Flow generation. I clicked Generate **once** (Veo 3.1 Lite, 9:16, 720p, 8 s, x1, 10 credits shown) after verifying that the project was empty. The context clip (a desk with coffee, no product) was composed with the real Casio photo. The critic passed it, but the **owner rejected it as a cut-and-paste look**. It was **not** imported into job `9dd0e1ba`.
- The owner supplied an approved reference made in Flow: one continuous photoreal take in which hands lift a product and point to it inside a styled set (lamp, tulips, soft light), with no cards or burned-in text and an audible track at about −15 LUFS.

Changes:

- `creative/owner-taste.ts` stores approved and rejected looks as data, with the reason in Thai and the source file, plus the measured benchmark from the reference. Rejected looks: pasted photo card, gradient kinetic-type slide, static macro push-in, silent track. Approved look: hands in a styled set.
- `creative/flow-native.ts`, the **Flow-native Shot Director**, is now the default production. It ranks set × hand action × camera options from a category set library, using the real product photo as Flow's reference (ingredient) image. Every prompt pins product fidelity: shape, colours, logo, printed text, and display digits that must not move. Narration comes only from verified facts. Recently used sets and actions are avoided. Ads of 16 or 24 s get several distinct takes, and each take is one generation that the owner must approve.
- `video/creative-critic.ts` handles a `FLOW_NATIVE_TAKE` as one take by design. It has no cut or text-card requirements. It checks a continuous take, natural motion, audio, no burned-in text, AI disclosure and duplication. Product fidelity and set/hands meaning stay UNKNOWN until a vision model or the owner checks them. An `ownerTaste` check fails any clip that carries a rejected look. `storyboard-composer.ts` now reports its looks (`styleTags`), so its pasted-card edits fail on owner taste. The local multi-shot edit is kept only as a zero-credit fallback.
- In Creative Studio the Flow-native plan is shown first: the chosen set, hand action, camera and audio, the fidelity risk, the full Flow prompt, and settings with the credit estimate. The panel was verified in Chrome on the real project (logged in as the owner).

Machine signals do not separate a good take from a bad one. The reference and the rejected Casio clip have similar motion and look statistics. The difference is semantic: hands, set and product fidelity. So the critic routes those checks to human review rather than claiming a pass.
