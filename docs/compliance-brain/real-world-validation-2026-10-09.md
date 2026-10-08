# Compliance validation — 9 October 2026

Status: **LOCAL_OBSERVATIONS_READY / OWNER_REVIEW_AND_REAL_EVIDENCE_REQUIRED**.
This is a no-paid-API integration proof, not production advertising clearance.
The owner confirmed that no real product/PDP/evidence/video is available. Real
products tested: **0**. No policy activation, remote writes, TikTok posts,
production deployment or paid generation were performed.

## Current official policy draft

`tiktok-th-policy-draft-2026-10-09.json` is a valid PolicyPackPayload wrapped as an
unsigned, unapproved draft. Six official Thailand-applicable sources and nine
reviewable obligations reuse the existing policy lifecycle. Source hashes cover
normalized article text retrieved for this run, not publisher HTML, paraphrases,
search snippets or image interpretations. Full local research snapshots are in
`.video-cache/compliance-real-world/policy-source-snapshots.json`, excluded from Git.

| Official article | Displayed publication date | Effective date |
| --- | --- | --- |
| [Content Policy](https://seller-th.tiktok.com/university/essay?knowledge_id=10008418&lang=en) | 2026-03-16 | UNKNOWN |
| [Health & Beauty](https://seller-th.tiktok.com/university/essay?knowledge_id=10009139&lang=en) | 2026-09-14 | UNKNOWN |
| [AIGC](https://seller-th.tiktok.com/university/essay?knowledge_id=6490273266140929&lang=en) | 2026-08-27 | UNKNOWN |
| [Misleading Content](https://seller-th.tiktok.com/university/essay?knowledge_id=4881274146408193&lang=en) | 2025-12-04 | UNKNOWN |
| [Restricted Categories](https://seller-th.tiktok.com/university/essay?knowledge_id=10015351&lang=en) | 2026-07-31 | UNKNOWN |
| [Prohibited/Unsupported Products](https://seller-th.tiktok.com/university/essay?knowledge_id=1531423806867201&lang=en) | 2026-05-08 | UNKNOWN |

An available article is not proof of a publisher's separately stated effective
date. Owner acknowledgement of unknown dates, source/rule review, regression
validation and a trusted Ed25519 signature remain mandatory. Ephemeral test
signatures are never trusted by production. No signature was fabricated. Policy
rollback/admin approval/learned-rule shadow controls remain unchanged and tested.

Interpretation requiring particular care:

- Cosmetic coverage and temporary appearance effects need accurate product
  context/evidence; the draft does not ban every use of timing or comparisons.
- Packaging/regulator evidence must support the exact proposition and conditions;
  a label OCR result, an unrelated registration or a disclaimer is insufficient.
- AI representations must preserve the real product and cannot fabricate effects
  or professional authority. Unlabelled images cannot establish this.
- Restricted category approval is separate from permission to advertise a claim;
  approval does not make prohibited products acceptable.

## Claim Ledger and owner evidence

The existing `loadProductLedger` reads owner/product-scoped persisted claims and
PDP/label/document/study evidence. Verified flags, jurisdiction, expiry, channel,
conditions, referenced evidence hashes and matching product ownership are still
required. No OCR/ASR output or fixture is inserted as verified product evidence.
No product facts or equivalent claim aliases are generated from unsupported copy.

The current remote database has zero products, claims and evidence. Its five
Compliance tables have RLS enabled; anon SELECT and authenticated INSERT/UPDATE
are denied. Isolated database tests exercise actual table/trigger/policy behavior
including expired/unverified/cross-owner references. This is not a new remote
authenticated E2E run with customer records.

Owner must supply 1–3 real skincare PDPs, original packaging images, exact claim
support documents with applicability/expiry/conditions, and original videos with
consent/rights to inspect. A trusted reviewer must associate those documents with
the actual owner/product and approve claims before AUTO can rely on them.

## Actual local media inspection

Added a bounded subprocess reading the exact MP4 bytes used at the existing
`checkFinalMedia` production boundary. OCR and actual AAC-derived transcripts are
appended to reviewed content and re-evaluated by the existing authority at
POST_GENERATION and FINAL_PUBLISH. Intended scripts never substitute for actual
transcripts. Wrong asset hashes, decoder failure, missing tools, unsupported
duration, resource contention or incomplete coverage cannot authorize EXPORT.
Existing AUTO/export and publishing gates recheck policy, caption and exact media;
LIVEs' signed-context Speech Gate remains separate and intact.

Tools used locally:

- [Tesseract.js 7.0.0](https://github.com/naptha/tesseract.js) +
  [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast), Apache-2.0.
  Language data is pinned to revision `87416418657359cb625c412a48b6e1d6d41c29bd`
  and checked against fixed SHA-256 hashes. Bootstrap is explicit; inference does
  not download languages. Dependency postinstall is disabled.
- [OpenCV](https://github.com/opencv/opencv/blob/4.x/LICENSE), Apache-2.0: actual
  contrast/sharpness measurements and central-divider comparison-layout clues.
  A clue is not semantic detection of before/after manipulation, faces or efficacy.
- Existing offline Whisper-tiny CPU weights/tokenizer, checked by their local
  provenance manifest. Actual extracted audio is transcribed without paid APIs.
  Silence, failure and ASR output cannot mint complete media coverage.
- Existing internal FFmpeg/ffprobe decoders, local files only. No new encoder,
  scheduler, TikTok or presenter behavior was changed.

Server-only opt-in settings (not set in Vercel or `.env.local` by this work):

| Setting | Purpose |
| --- | --- |
| `COMPLIANCE_LOCAL_MEDIA_ENABLED=true` | Add the local observation/review layer |
| `COMPLIANCE_OCR_DATA_PATH` | Absolute directory of the two pinned traineddata files |
| `COMPLIANCE_FFMPEG_PATH` / `COMPLIANCE_FFPROBE_PATH` | Managed local binaries |
| `COMPLIANCE_MEDIA_PYTHON` | Optional managed Python with existing OpenCV/ASR dependencies |

Only selected path/runtime variables are passed to the subprocess, never FAL,
Supabase, OAuth or other credentials. No shell interpolation, URL image loading,
customer diagnostics endpoint or automatic evidence writes exist. One scan per
process; no waiting work queue. Maximum 100 MB, 30 seconds, 4096px source dimensions,
60 sampled frames, bounded subprocess output/time and temporary input cleanup.

This scanner is deliberately **not an automatic visual PASS provider**. Enabling
it holds full-media clearance for review, including otherwise safe text. With it
disabled the existing exact-hash, owner/product-bound human attestation is still
required; no fake fallback attestation is created. Hosting needs managed local
dependencies before opt-in; this run did not provision a production scan worker.
Sampling at 2fps can miss brief overlays. Product identity, edited skin results,
professional-avatar authenticity, unknown visual claims and complete Thai speech
coverage remain REVIEW_REQUIRED/manual checks, not claimed detections.

## Frozen holdout results

`real-world-holdout.json` was created before evaluation; semantic rules were not
tuned to these cases. Twenty new Thai/English propositions cover scripts/captions
in POST/LIVE channels, including indirect skincare promises and benign makeup/
assembly comparisons with explicitly synthetic reviewed evidence.

| Measurement | Result |
| --- | --- |
| Text evaluations | 80 |
| Unsupported/high-risk evaluations held | 48/48 |
| High-risk evaluations with recognized semantic categories | 28/48 |
| Held by absent grounding rather than specific semantic recognition | 20/48 |
| Supported benign text held | 0/32 |
| Selected fixture text false-positive rate | 0% |
| Actual encoded MP4s decoded/scanned | 8 |
| Unverified videos released | 0/8 |
| English overlays read exactly (normalized whitespace/punctuation) | 4/4 |
| Thai overlay character error rate | 3.23%, 3.70% on two clips |
| Speech-only encoded clip | Actual transcript detects the acne-cure proposition |
| Unlabelled split-panel clip | Layout candidate observed; meaning unverified |
| Real product/evidence validation | 0 / 0 |
| Paid provider / TikTok posting calls | 0 / 0 |

False-positive rate describes this small selected text fixture set, not production
accuracy. The eight full-media review holds are intentional coverage holds, not
claimed semantic false positives. English ASR changed written-out numbers to
digits; its transcript CER is 14.29% for this one synthesized clip, not an ASR
accuracy benchmark. Thai OCR confidence was high despite missed marks, so confidence
alone is never trusted. Thai glyph-space compaction adds a second reading while
retaining raw OCR; missing characters are not guessed.

Machine-readable observations, frame timestamps, hashes, decoded frames and
latencies: `.video-cache/compliance-real-world/validation-report.json` and
`inspections/`. Source MP4s: `videos/`. Large media/models stay outside Git.

## Verification and boundaries

- Full TypeScript suite: 1,333 passed, 2 skipped. New scoped cases additionally
  rerun after expanding caption coverage.
- SQL: 30-migration populated integration proof, 25 Compliance compatibility
  checks, 86 account/scheduler checks; standalone Compliance SQL/RLS: 70 checks.
- Pixel scanner: three local Python tests. LIVE Python/Node Speech Gate: seven
  existing transport tests passed; no paid or TikTok networking.
- Typecheck and production build pass. Lint passes with seven existing warnings
  in `fal-wan.test.ts`, zero errors; no unrelated warning refactor.
- Remote read-only check: Cron active, execution mode SAFE, active Policy Packs 0.
  No migration was needed and no production configuration changed.

Reproduce in the prepared local environment:

```text
python scripts/prepare-compliance-ocr.py
python scripts/create-compliance-holdout-media.py
node node_modules/tsx/dist/cli.mjs scripts/verify-compliance-real-world.ts
node scripts/verify-compliance-integration-sql.mjs
node scripts/verify-compliance-brain-sql.mjs
```

The first command fetches public OCR data only; the other media commands are local.
Python uses the existing development environment, not a newly required customer
setup. The optional ASR tokenizer preparation reuses `verify-compliance-asr.py`.
Rebuilding the policy draft needs freshly reviewed official source snapshots:
`node node_modules/tsx/dist/cli.mjs scripts/build-compliance-th-draft.ts`.

Remaining production gates: owner-reviewed/signed policy with acknowledged dates,
real product/evidence acceptance, manual/full visual review and a provisioned local
scan runtime. These results do not guarantee protection from account suspension.
