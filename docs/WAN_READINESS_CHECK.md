# WAN / fal readiness — 2026-10-13

Scope: read-only account metadata, local fixes and isolated tests. Omni work is paused. No paid generation, funds added, remote migration, deployment, TikTok call or real-account automation.

## Observed configuration and credential handling

- Existing branch: `codex/google-vids-fal-router`, starting commit `15b0d85`.
- FAL_KEY exists in local runtime. Authenticated official pricing GET returned HTTP 200 for both WAN endpoints. This establishes pricing access, not successful generation or sufficient balance.
- Billing events GET returned HTTP 403. Balance remains UNKNOWN; [official authentication docs](https://fal.ai/docs/api-reference/platform-apis/authentication) require BILLING permission for this surface. Do not broaden a generation key just to make a test pass.
- `.env.local` is untracked. All 2,292 local Git blobs were scanned in memory, including unreachable objects: zero exact matches for the current key and zero recognizable fal UUID/secret credential patterns. Tracked files also had zero matches. This is a local scan, not an assertion about external copies or every historic credential format.
- Any old key exposed in an image must be revoked/replaced by the owner before paid testing. Rotation was not performed or assumed complete. No key value was printed, saved, committed or sent to a browser.
- Local router execution and legacy automatic WAN approval are both OFF. No settings were enabled.

## Existing implementations and prices

| Path | Actual existing model | Read-only official quote | Trial consequence |
|---|---|---|---|
| Legacy AUTO WAN adapter | `fal-ai/wan/v2.2-a14b/image-to-video/turbo` | $0.10/video at 720p | Provider defines duration; silent output needs real audio for factory quality checks. AUTO stays unapproved. |
| Existing selectable router WAN | `wan/v2.6/image-to-video/flash` | $0.05/second at 720p | Router requests native audio and 10 seconds, then locally trims to 8 seconds. Approximate generation $0.50; reserve $0.55 including 10% margin. |

Sources: [WAN 2.2 catalog](https://fal.ai/models/fal-ai/wan/v2.2-a14b/image-to-video/turbo), [WAN 2.6 catalog/schema](https://fal.ai/models/wan/v2.6/image-to-video/flash/api), and authenticated pricing GET. Actual invoice, success rate, Thai narration and output quality remain untested. The router defaults to LTX, so an authorized WAN trial must explicitly select the existing WAN option. No setting was changed by this check.

## Local fixes and boundaries

- Added the missing `fal_budget_guard_version` migration. It checks the existing reserve/begin/submit/unknown/settle/release RPC dependencies, exposes execution only to service_role and retains the existing fail-closed runtime check. No new budget system and no remote SQL application.
- Added WAN 2.6's official 1,500-character prompt check before any metadata or paid request; an invalid prompt is rejected without silently truncating creative content.
- Actual application ledger plus prepared SQL passes owner/anon permissions, budget contention, one-time begin, ambiguous submission retention, duplicate operation recovery and missing-RPC rejection in isolated PostgreSQL/PGlite.
- Existing private `video-assets` storage is owner-scoped with signed references. Its live service is not verified here: there is no local Supabase URL, server storage credential or Docker runtime configured. No Production storage was accessed.
- Local media tools exist. Real synthetic test MP4s exercise audio, portrait conversion, 10-to-8-second trim, frame extraction and persisted master metadata through the existing storage test adapter. These are processing tests, not WAN-generated quality evidence or a real Storage server proof.
- Unverified visual/Thai-audio quality remains REVIEW_REQUIRED; no automatic publishing approval is granted.

## Readiness decision

Verification: 261 relevant tests passed; WAN pricing/local media subset rerun passed (14 tests); isolated SQL proof passed 49 checks. Typecheck and optimized offline build passed. Full lint had no errors, with 8 pre-existing unrelated warnings after the new readiness script's warning was corrected; targeted changed-file lint passed cleanly. Offline build used temporary process-only Supabase placeholders, not Production credentials.

The adapter can be exercised independently with a local image and local output after authorization, without TikTok or Production DB. Full app/Video Factory end-to-end additionally needs an isolated database/storage environment with the existing migrations applied, a separate test owner/creative/reference asset, and a configured per-clip/day/month budget. Do not point this trial at the current remote Production database or selling accounts.

Owner prerequisites: replace any exposed key, confirm funds in fal's dashboard (no top-up was performed), approve the exact one-clip spend cap, and supply/confirm licensed source imagery. Keep automatic execution and posting OFF. Stop before any paid generation until explicit approval.
