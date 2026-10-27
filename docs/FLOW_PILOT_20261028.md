# Flow pilot — 28 October 2026

Continuation of Draft PR #10 on `codex/flow-drive-d-restore-20261026`, workspace `D:\ViralFlowAI`. This records actual acceptance boundaries; fixtures and a layout preview do not establish Google generation.

## Current real state

- Owner-approved Local OAuth callback and the exact owner's `viralflow_role=developer` were applied. Production Site URL stayed unchanged. Fresh normal Google OAuth returned to Local; authenticated Provider settings were saved as GOOGLE_ONLY, paid mode/fallback/recovery off, all money budgets zero. The local router flag is enabled.
- Normal in-app-browser Google Flow login works. The legacy Labs URL redirects to `https://flow.google.com/`; worker location validation and the assisted launcher now support the canonical domain and reject lookalikes. No cookie/session transfer or Google protection bypass was used. This proves assisted UI control, not a logged-in Playwright worker.
- Created a new, empty Flow project for this pilot. Selected Veo 3.1 Lite, 720p, 9:16, eight seconds, one output. The live UI showed **10 credits** for this request and an account balance of 50 at inspection. These are observations, not a permanently fixed price or quota guarantee.
- Added `/product-radar/discover`: bounded live Commons search for the currently supported Casio F-91W model, with creator/license/source metadata, counterfeit/restricted-license filtering and pending review. This is public model/image discovery, not a verified marketplace feed or an arbitrary-product recommender. No TikTok API, marketplace rating, sales, price, commission or stock was inferred.
- Imported one actual product and its photograph through authenticated Local UI. Stored downloaded image bytes in owner-scoped Supabase Storage with a SHA-256. Unknown commercial metrics display as unknown; they have no synthetic sales snapshots or fabricated opportunity scores.
- Added an explicit offline owner product-selection path. Its assignment and score are zero, market eligibility is false, mode is GROWTH, and the explanation distinguishes editorial selection from a recommendation. It does not modify an account's mode, authorization, affiliate eligibility, scheduler permission or publishing state. It requires the actual owner Developer/Admin session and rejects automatic workers. The existing automatic-account opt-in requirement remains on all other creative paths.
- Created the real Creative Project in Local UI. The evidence rubric (deterministic rules, zero LLM calls) chose **REAL_IMAGE_MOTION**, with narration: “Casio F-91W ดูจุดไหนดี? นาฬิกาดิจิทัล น้ำหนัก 21 กรัม เช็กรายละเอียดก่อนสั่ง”. The owner then explicitly approved this concept and one Generate of at most 10 credits. Confirmed all three creative-review checks in the owner UI; the selected concept became SAFE.
- Created and advanced the original Provider job through Local UI: `9dd0e1ba-7a21-4740-8418-1a9c8653a4ba`, for project `e86d380a-503d-465a-bf13-4793105cc35d`. It is waiting for Google-assisted media, with the original import form present. Exported its real editing brief through the existing service into the ignored worker queue. A local `APPROVED_NOT_SUBMITTED` state records zero Generate clicks and prevents automatic worker generation.

## Approved rights schema and evidence

The owner explicitly approved the unchanged existing `20261018120000_media_rights_evidence_ledger.sql`. Applied only that migration to verified Supabase project `nbtshqmtspgzrfzkqjxx`, in one transaction with exact source stored in the existing migration history and a PostgREST schema reload. Source SHA-256: `b3b9c038dbb6d3fe0d8a72239c0dbfc56654038156db777e90a5d0ed101ae450`.

The migration creates three owner-scoped RLS tables and service-only writes/RPC, guards reviewed/revoked records, checks rights at publishing upload transitions and propagates revocation to derived outputs/queued work. These publishing effects were disclosed in the approval; no publishing was enabled or performed. Hosted verification returned three RLS tables, no anonymous fact reads, no authenticated rights inserts, service RPC access and a recorded migration. The isolated SQL proof passed 47 checks before installation. Do not replay all other local migrations: hosted historical versions differ.

The selected photograph is [Multicherry's front closeup](https://commons.wikimedia.org/?curid=138663809), under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The owner separately confirmed this exact photograph, the digital-watch/21 g facts from [Casio Thailand](https://www.casio.com/th/watches/casio/product.F-91W-1/) and the credit/adaptation terms. A real screenshot of the source license was stored with a checksum, the rights record was separately approved, and the two cited facts were saved. No operation/demo attestation was made.

The browser screenshot bytes were JPEG despite an initial `.png` filename. The existing proof validator rejected that upload. Corrected the extension to `.jpg` without changing the bytes, then used the existing evidence service functions to record the explicitly approved information. The refreshed rights UI showed the actual proof hash, usable rights and both facts. No file-signature validation was weakened.

## Preserve the product while using Flow

The reviewed real-image method forbids generating/reconstructing the product. Its original Google editing brief remains unchanged. For this assisted pilot, Flow is prepared to create **only an abstract navy/cyan background and the selected Thai narration**; the actual photograph is composited separately with deterministic captions, an AI disclosure, creator/source/license credit and adaptation notice. The caption also retains the full credit within its 300-character limit.

`composeFlowPhoto` checks the original photograph's checksum, portrait background/audio/duration, D paths and source/output separation. It preserves the supplied photo visually through ordinary scaling rather than asking an AI model to recreate it. The read-only developer CLI additionally loads the original owner/project, validates the current reviewed concept and exact script digest, rechecks rights, and downloads the referenced source. It performs no database writes or generation:

```powershell
. .\scripts\enter-drive-d.ps1
node --import ./scripts/pilot/server-only-shim.mjs --import tsx scripts/pilot/compose-flow-photo.ts <owner-uuid> <project-uuid> D:\path\flow-background.mp4 D:\path\finished-product.mp4
```

Use the completed product edit for the original provider queue's normal import, not the raw background. The private `LAYOUT_PREVIEW_NOT_FLOW.mp4` is a synthetic layout preview only and must never be imported or reported as a real Flow result. No Generate was clicked to create that preview.

The provider finalizer now supplies the required media `model`, rechecks reviewed real-media rights before processing and records source usages with assisted-provider composition provenance. Existing legacy imports retain their prior behavior. Automatic visual approval remains closed without real verification; no paid vision call is introduced.

## Verification / remaining action

- Typecheck and targeted lint passed including the compositor/CLI. A new compositor lint warning was corrected before the checkpoint.
- Latest full regression suite: **983 passed, 2 skipped**, across 116 passing files and one skipped file. This includes rights revocation before import and both new compositor tests (real local encoding/audio plus an actual source-color pixel check; synthetic fixtures only).
- Worker core/media tests: 11 passed. Four local-browser portal checks passed on a separate run. One earlier combined run timed out a 500 ms fixture locator while the build was running; no Google generation was involved.
- Next build passed with public placeholder configuration, server secret blank and paid/publishing flags off. Two existing dynamic-filesystem trace warnings remain. Checked 75 build trace manifests: zero private runtime/environment/worker-profile references.
- Actual hosted rows before the approved Generate: one product, one product photograph, one Creative Project with three concepts/scripts and its selected concept reviewed, one approved rights record, two facts, and one original provider/generation job. No real MP4/master has yet been created.

**Browser permission blocker after an interrupted turn:** reopening the prepared Flow project was rejected by the browser origin gate for `https://flow.google.com`, reporting declined authority. Subsequently observation of `http://localhost:3000` was also rejected. Do not retry those origins, change browser surfaces, copy sessions or use raw network/CDP to circumvent that denial. The owner has been asked to allow both browser origins. This gate is separate from the already granted creative/10-credit approval; do not ask for that approval again.

**Pending once browser authority is restored:** record a durable pre-click GENERATING checkpoint, click Generate once, observe that result, download to D, compose the reviewed real photograph, inspect actual audio/video, import into the same job and verify owner preview/download in ViralFlow. No Generate click was made before this permission blocker. If a later result is uncertain, reconcile that same project; never click Generate again automatically.

Private proposal/apply SQL, source evidence, layout preview, selected-script manifest and prepared Flow prompt remain under ignored `.runtime/`. No credentials are in this document or Git. No production deployment or PR merge was performed.
