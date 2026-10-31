# Google Vids / fal video routing

## Release scope and actual readiness

Branch `codex/google-vids-fal-router` continues production website/content-export HEAD
`35713835000696556d18e063566c29af14d91fcb`. The requested benchmark branch
`feature/video-provider-benchmark` / `fd405830e299cebbc346b2cebafc342b837412ee`
is already an ancestor. Backup: `codex/backup-content-before-google-3571383`.
No large branch merges, production deployment, env edits, paid generation or TikTok calls.

Implemented: owner/account queue, primary assisted Google import, explicit-budget fal
fallback, real master/crop processing, quality gate, durable request recovery, billed
cost reconciliation and a Thai **admin/developer-only** dashboard at
`/video-factory/providers`. Existing Product Radar/Creative Brain source data and
publishing approval/compliance/originality gates are reused. There is no new TikTok
publishing action here. `VIDEO_PROVIDER_ROUTER_ENABLED` defaults to false.

## Verified Google boundary — 12 October 2026

- [Google Vids Gemini Omni announcement](https://blog.google/products-and-platforms/products/workspace/gemini-omni-in-google-vids/)
- [Google Vids video generation](https://support.google.com/docs/answer/16143507?hl=en)
- [Account-specific Vids limits](https://support.google.com/docs/answer/15609411?hl=en)
- [Workspace developer product catalog](https://developers.google.com/workspace/products)
- [Gemini Omni paid API](https://ai.google.dev/gemini-api/docs/omni)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Google Terms](https://policies.google.com/terms?hl=en_gl)

Gemini Omni has an official API, but its API billing is separate from Google Vids
account quota. It is **not** implemented or represented as quota-backed Vids here.
No documented official API to consume the user's Vids quota was verified. Browser
automation/extension was evaluated but not selected: no verified approved automated
quota protocol or authorized account session was available. No cookie extraction,
hidden endpoints, login bypass or CAPTCHA automation.

`google_vids_omni` therefore reports `automated=false`. Google availability is
**owner reported**, not a live quota/auth health probe. Usage/remaining quota stay
unknown. A role-authorized owner obtains the current real product photograph and
selected creative brief, opens `vids.new`, generates 9:16 ~8 seconds, checks Thai
speech when supported, and imports MP4 into the same durable job. Imported provenance
is **owner attested**, not verified as a Google API response. Existing numeric master
cost field is 0 when unquoted; metadata explicitly says UNKNOWN_ACCOUNT_QUOTA. This
is not a claim of free subscription usage. Native Thai quality has not been tested.

## Routing and safeguards

- AUTO selects Google first. Today that means Assisted Mode. A future verified
  automation capability is represented in the pure contract tests only, not a live
  adapter. When the owner marks Google quota/login/service unavailable, AUTO can
  select fal only with explicit paid consent and positive ordered budgets.
- GOOGLE ONLY never buys a fal replacement; FAL ONLY also requires approved caps.
- Paid fallback off, caps $0, automatic recovery off by default. Fixed priority:
  Google then fal. Bounded Google retries 0–3; 5/10/20-second backoff, 60s ceiling.
- Stable owner/project/script identity, one live lease per owner/account, three
  jobs per dispatcher call. No duplicate job for double-clicks.
- Reserve using existing atomic owner-wide day/month/run/account/provider budgets
  **before** submit. Verify the existing `fal-generation-budget-guards-v1` RPC.
  Server-role read-only inspection confirmed the guard/reserve RPCs exist remotely;
  no remote DDL/data changes were performed.
- Persist full endpoint/input snapshot and budget hold before one queue POST. A
  lost submit response stays unresolved; no new provider purchase. A known request
  recovered from the budget ledger is restored and observed without POST.
- Poll at least 15 seconds apart, max 120 polls / 30 minutes per observation window.
  Timeout parks for review. An explicit owner observation can extend read-only
  polling of the **same** request ID. It never submits another job.
- Opening the Google brief marks EXTERNAL_PENDING; importing a real MP4 resolves
  it. A separate owner confirmation that no external job was submitted/pending is
  required before routing another provider. That is owner attestation, not proof
  from Google.
- Available automatic recovery processes the queue while the protected dashboard
  is visible (20s, at most 120 ticks per mounted page). `processProviderQueue` is
  also an authenticated-server dispatcher interface. **No unattended cron has been
  connected/activated**, and the existing Supabase Cron remains unchanged/SAFE.

## fal implementation and costs

Reuses reviewed queue HTTP transport, model schemas, host allowlist/signature
validation, atomic budget ledger and real media composer from the existing fal code.

- [LTX 0.98 distilled](https://fal.ai/models/fal-ai/ltxv-13b-098-distilled/image-to-video/api): 193 frames/24fps,
  portrait 720p, requires a real owner narration file (validated **before** spending).
- [LTX 2.3 Fast](https://fal.ai/models/fal-ai/ltx-2.3/image-to-video/fast/api): portrait 1080p/8 seconds,
  native audio requested. Candidate default, **not** a benchmark quality winner.
- [Wan 2.6 Flash](https://fal.ai/models/wan/v2.6/image-to-video/flash/api): 10s trimmed to 8s,
  native audio requested. Pads an actual owner product photograph to portrait before
  submitting to its inherited-aspect endpoint.
- [Pricing](https://fal.ai/docs/platform-apis/v1/models/pricing): authenticated read-only
  quote; reject missing/ambiguous unit/currency. Reserve the greater of the live
  unit quote and reviewed audio-on catalog ceiling, with 10% buffer. This remains an
  **estimate**, not a contractual guarantee against provider pricing changes.
- [Billing events](https://fal.ai/docs/platform-apis/v1/models/billing-events): filter
  exact endpoint/request ID and bounded date window. Require complete matching USD
  cost_total records. Missing billing permission/event/completeness is UNKNOWN, not
  zero. The key needs the documented billing permissions; do not rotate or expose
  it to the client. Reconcile only a verified amount into the existing ledger and
  `actual_cost_usd`; a missing receipt leaves the conservative reservation held.
  Unexpected over-reservation billing is recorded and disables further paid routing
  until owner review rather than discarding the charge.

No new paid video, balance proof, real latency/usable-rate or model comparison was
performed. Key configured is not equivalent to generation/billing permission or
adequate balance. A read-only dashboard provider test can check pricing access.

## Master, variations and quality

Validate actual MP4 bytes, bounded size, 9:16, source duration and real audio. Produce
1080×1920/8s/H.264/AAC, extract three actual frames and retain hashes. No implicit paid
vision call. Unverified visual product fidelity/text/CTA/Thai narration remains
REVIEW/RETRY; cannot approve or publish through existing strict gates.

Routed masters cannot be replaced by the legacy template retry action. Their crop
variations use the actual master footage/audio; no mock image/tone generation. Crop
variation similarity is conservatively 1 and visual quality RETRY: these are real
files, **not proof of distinct compliant content**. Originality/approval still needs
evaluation. Other legacy dev/template paths remain unchanged.

## Database, access and activation

Additive migration `20261012050849_video_provider_router.sql` is prepared but **not
applied remotely**. Two new tables, owner RLS, composite owner foreign keys, unique
creative identity, private checkpoint/request/lease columns and service-only lease/
aggregate functions. Ordinary users cannot read diagnostic payloads or write budgets.
Every Server Action independently checks server-issued `app_metadata.viralflow_role`
(admin/developer), session and mutation rate limit. Public/browser clients never get
service credentials or FAL_KEY. Signed uploads are limited to the selected owner's
private job path; bytes are validated server-side before finalization.

Before activation: review the PR and additive migration, apply it on a test environment,
verify actual admin settings/owned media in-browser, then enable the server flag there.
Do not enable production paid routing until explicit owner limits/permission and a
small authorized real provider/billing/quality test are validated. Use an actual Google
account and actual Google output to validate Assisted Mode end-to-end. Full unattended
15–20 clips/day across 3 accounts is **unproven**, although the isolated queue tests
admit 21 jobs over 3 accounts and enforce isolation. Google automation, actual quota,
verified quality and an unattended dispatcher remain constraints.

## Verification

`pnpm test src/features/video-provider` tests routing, quotes, billed events, lost
response, duplicate submit, restart, account/budget isolation and actual local media.
Local synthetic test patterns/sine waves prove codecs/timing only, not Google/fal
output or lip-sync/Thai quality. `scripts/verify-video-provider-sql.mjs` uses isolated
PGlite with the actual migration and existing budget SQL: 3 accounts/21 queued jobs,
owner/cross-user/anon RLS, column privacy, lease/fencing, duplicate identity and atomic
budget accounting. This is not a remote RLS/provider throughput claim. No production
test users/rows were created. Run typecheck, lint, full tests and production build.

Verified in this branch: **575 tests passed, 1 existing remote E2E test skipped**;
typecheck passed; lint 0 errors / 8 existing warnings; production build passed with
temporary public compilation-only values because this checkout lacks the public
Supabase build variables. No `.env.local` modification. Isolated SQL: **31 checks**
passed. Read-only remote inspection confirmed the six referenced tables have the
required `(owner_id,id)` unique identity and scheduler execution is still **SAFE**.
No real Google/fal generation, production migration/deployment or daily throughput
validation is included in these results.
