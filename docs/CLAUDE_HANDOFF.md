# ViralFlow AI — Claude handoff

> Machine migration update (2026-10-26): read [MACHINE_MIGRATION.md](MACHINE_MIGRATION.md)
> for the latest LIVE Lite branch, verified remote branch map and remaining private
> asset transfer. The dated implementation/test details below remain historical.

Prepared 2026-10-14 (Asia/Bangkok). Repository:
`https://github.com/kkhunmingg-commits/viralflow-ai`.

**Source handoff is available. Complete asset backup is NOT complete.** Models,
engineering installers, runtime packages and original media remain on the owner's
machine. No independent private storage destination was authorized, so no public
binary upload was attempted. Do not delete the original machine/workspaces.

## 1. Entry point and branch map

Start by cloning `codex/claude-handoff-20261014` and reading this document. It is a
backup/documentation branch based on the latest router source, not a merged release.
The AI LIVE implementation remains on its separate branch.

| System | Branch | Verified source commit |
| --- | --- | --- |
| Viral intelligence, provider router, Growth/Affiliate automation | `codex/google-vids-fal-router` | `9545a003d9f2d5ef7b572b08896724b32ce9ca02` |
| Self-learning intelligence implementation checkpoint | same history | `25373019c3c456c7ffa172a22b05ca432f7c7087` |
| AI LIVE / Local Agent / Presenter / Brain / TTS | `feature/ai-live` | `a7d55301c8080a621a3330804173cf5d56be58eb` |
| POST multi-account and remote isolation proof | `feature/post-multi-account` | `2614eadcc4afca7dbd579adc3a5baa5748e24eef` |
| Compliance media validation/integration | `codex/production-readiness-integration` | `d684eb4680178fcec9985f315595ec673148f994` |
| Compliance original system | `feature/compliance-brain` | `239fe51e8f9cb61da654ba6cc05f439ec8b02a89` |
| Original fal integration | `codex/fal-production-integration` | `57eedc81c522d2a191d9bebe47e85756d663f18a` |
| Content creation/export | `codex/content-generation-export` | `35713835000696556d18e063566c29af14d91fcb` |
| Manual posting/export fallback | `codex/manual-post-export` | `d5185edcebdf485d5d2ca87301ebdb49db3876b3` |
| Review website / Inbox status work | `codex/tiktok-review-website` | `3900b773358f5556a81d664c87ea0c49d38e4a5b` |
| Earlier public UI/homepage checkpoint | `feature/ui-control-center` | `ff85ee94f691facac9ed587f28f07e771d12efe0` |

All other branch tips, remote SHAs and preservation relationships are listed in
[`handoff/BRANCHES.json`](handoff/BRANCHES.json). Thirty pre-existing local branch
tips were checked. Eight historical tips were not reachable from any remote head;
they were preserved under new `codex/backup-local-*-20261014` refs. The local
`codex/backup-content-before-google-3571383` alias was also pushed. No existing
remote branch was force-updated and no branch was merged into main/develop.

Historical local main/develop differ from remote main/develop. **Do not infer the
deployed Production release from a local branch name.** Existing deployment state
was not changed or independently audited during this backup task.

Preserved AI LIVE tags: `ai-live-direct-stream-core-9b29cda` and
`checkpoint/ai-live-local-first-7dfdca5`. The handoff branch's final SHA must be
resolved from remote HEAD; embedding this document's own commit SHA is recursive.

## 2. Workspaces and preservation

Registered worktrees found:

- Main: `C:/Users/luckz/Documents/Codex/2026-09-14/github-plugin-github-openai-curated-remote-4/work/viralflow-ai`
- Review: `C:/Users/luckz/.codex/worktrees/tiktok-review-website/viralflow-ai`
  on `codex/manual-post-export`; working tree was clean.

The existing Documents/Codex project location and managed worktree root were also
searched for additional ViralFlow checkouts. Verification clones were newly made
under the main workspace's private `.handoff-backup/` directory. The inventory
scope does not include arbitrary unreferenced personal folders or other drives.

Changes preserved in this task:

- WAN readiness: `9545a00`, separately committed/pushed on the router branch.
- AI LIVE/local proof helper archive: `e9e286b`, WIP backup on the handoff branch.
- Economy benchmark helper archive: `745db74`, WIP backup on the handoff branch.
- This document, branch/artifact manifests and inventory/security utilities:
  subsequent handoff branch commit.

[`../handoff/local-source/INDEX.json`](../handoff/local-source/INDEX.json) lists 25
previously ignored project-authored helper files plus two proof dependency manifests. Exact bytes are stored with a
`.source` suffix and `-text` Git attributes; they are not runtime integrations.
Their tests were not rerun. Read the archive README before restoring. Historical
benchmark authorization scripts do not authorize new paid calls.

## 3. Existing architecture — extend, do not rebuild

ViralFlow is one Next.js/React/TypeScript app with existing authentication,
owner-scoped Supabase data/storage, TikTok account integration and server workers.

POST flow: account discovery/effective mode → adaptive planning and scheduler →
Product Radar/Category Intelligence/assignment → Creative Brain → compliance →
Video Factory/provider router → quality/final compliance → approved publishing or
manual EXPORT → analytics and account-scoped learning.

Accounts and daily frequency are dynamic. Three current accounts and counts used
in fixtures are examples, not architecture limits. Frequency, spacing and capacity
remain under account health, verified performance, platform limits and budgets.

AI LIVE: existing web user/account/product control → signed device registration
and grants → Windows Local Agent → isolated room/Brain/Voice/Presenter → internal
shared-clock H.264/AAC encoder → authorized StreamProvider. Actual TikTok LIVE
transport is not implemented. No OBS/TikTok Studio dependency is introduced.

## 4. Code and documentation locations

On `feature/ai-live`:

- `src/app/(app)/ai-live/`: control room, presenter studio/wizard, local client UI.
- `src/features/ai-live/`: local contracts, licensing, device registry, grants,
  session/action/brain/product/voice policies and runtime bridges.
- `src/app/api/ai-live/`: authenticated control/device/product/update routes.
- `workers/ai-live/local_agent/`: installer-managed agent, security, update,
  encrypted presenter library, model/resource/runtime management.
- `workers/ai-live/`: actual CPU presenter path, Brain/TTS interfaces and runtime,
  A/V encoder, generic streaming, watchdog and benchmark harnesses.
- `workers/ai-live/installer/`: installer/build/delivery source, not bundled models.
- Read `docs/AI_LIVE_ARCHITECTURE.md`, `AI_LIVE_LOCAL_FIRST_RUNTIME.md`,
  `AI_LIVE_DIGITAL_HUMAN.md`, `AI_LIVE_INSTALLATION.md`,
  `AI_LIVE_DIRECT_STREAMING.md` and its recorded proof JSON on that branch.

On `codex/google-vids-fal-router` / this handoff branch:

- `src/features/creative/agent.ts`, `providers.ts`, `self-learning.ts`,
  `intelligence-service.ts`, `services.ts`: real LLM contract, orchestration,
  immutable attribution, scoped evidence and automatic selection.
- `src/features/growth/adaptive-experiments.ts`: bounded contextual exploration,
  evidence filtering, recency and restart/proposal deduplication.
- `src/features/growth-manager/trend-discovery.ts`: separate Google Search,
  authorized TikTok trend and own-account evidence sources.
- `src/features/video-provider/`, `src/features/video/`: existing Google Vids
  assisted/Gemini/fal router, budgets, media processing and quality boundaries.
- `src/features/auto/`, `multi-account/`, `analytics/`, `assignments/`: reuse
  existing scheduler, account logic and analytics rather than creating replacements.
- Read `docs/SELF_LEARNING_VIRAL_INTELLIGENCE.md`, `WAN_READINESS_CHECK.md`,
  `GOOGLE_VIDS_FAL_ROUTER.md`, `MASTER_AUTO_ACCOUNT_LOGIC.md` and readiness docs.

## 5. What is actually proven

- Router and AI LIVE source were independently cloned from GitHub and their locked
  Node dependencies installed offline from the existing package cache.
- Existing scheduler/intelligence/provider regressions, media processing with
  synthetic MP4s and isolated budget/RLS SQL checks passed as recorded below.
- Self-learning simulations can explore new concepts, reject foreign/mock data,
  avoid one-clip conclusions, reverse an old preference with newer evidence and
  retain stable experiment identity across restart.
- The real LLM adapter is wired, but actual creativity was **not** tested: the owner
  deferred configuring the server text key. It does not silently replace real
  generation with templates when a real account lacks configuration.
- AI LIVE has prior real CPU Brain inference proof and a recorded ten-minute
  CPU-presenter/software-encoder/generic-receiver proof. These are development
  proofs, not GPU realtime, neural Thai TTS or actual TikTok LIVE acceptance.
- Presenter Studio can store/select reference images/configuration; a thumbnail is
  not proof that the face speaks or that a selected voice/gesture is implemented.

## 6. What remains unproven / disabled

- `AI_LIVE_REALTIME_VALIDATED=false`; LIVE-1 is not complete. NVIDIA incremental
  backends, quality/lip sync, sustained FPS/latency, VRAM and multi-room capacity
  still require real hardware integration/benchmarking.
- Current local neural TTS is pending RAM/dependency/Thai-quality acceptance; old
  operating-system-voice proofs are not current neural TTS proof. Voice cloning
  and advanced gesture bindings are not ready customer features.
- No official TikTok LIVE transport/eligibility/credential routing or real platform
  comment/product-pinning integration is proven. Content Posting approval is not
  evidence of LIVE transport readiness.
- Installer source and engineering executables exist; signed customer distribution,
  release keys, model catalog and activation are not a completed customer release.
- Real audience learning, per-video follower attribution, retention and verified
  Affiliate ROI need actual permitted sources. Missing data stays UNKNOWN.
- Global TikTok trend access is not configured; Google Search interest is not a
  TikTok trend score. Normalized report/Business-reader interfaces are gated.
- Five THB per usable clip is a target, not an achieved price guarantee. Failed
  mechanical demonstrations and retries must count; actual billing may be unknown.
- Google Vids stays assisted. Do not infer unlimited/free API generation from a
  consumer subscription or assume an unverified Omni endpoint is production ready.
- Real product/claim evidence remains unavailable for the compliance validation
  exercise. Do not invent PDP evidence or mark unscannable required visuals PASS.

## 7. Suggested next work for the owner's chosen Claude model

1. Read the relevant branch and existing tests; reproduce local setup first.
2. For LIVE: finish the actual TTS path and GPU incremental adapter integration,
   then benchmark one room before making any hardware/realtime claim.
3. Finish signed installer/model delivery and measured machine readiness. Do not
   remove safety gates to make Start appear functional.
4. Only connect official LIVE/comment/commerce transport after real access is
   supplied and the owner authorizes the actual test.
5. For intelligence: once authorized/configured, test the real text LLM and review
   actual scripts; then collect permitted Pilot observations with immutable
   attribution and comparable exposure windows. Do not use sales accounts as pilots.
6. For video: respect the owner's pause. Revisit cheap usable production through
   genuine evidence/editing for complex mechanics, not repeated paid guessing.

No new feature work, paid generation, model downloads, LIVE broadcast or Production
activation is authorized merely by this handoff document.

## 8. Local-only files and backup blockers

At initial inventory, 6,648 nontracked files totalled 12,233,687,369 bytes, excluding
rebuildable caches/dependency directories. Twenty-five helper sources were then
archived, along with two dependency manifests; this initial count is not the remaining unique unbacked source count.

| Local group | Location under main workspace | Status / recovery |
| --- | --- | --- |
| Presenter, Brain, TTS models and downloaded runtime/components | `.ai-live-dev/` | PENDING BACKUP; pinned source/hash where known; license review before redistribution |
| Unsigned installer EXEs and expanded agent runtime | `workers/ai-live/installer/.dist/` | PENDING BACKUP; rebuild using AI LIVE installer sources or private verified transfer |
| Benchmark videos, frames, original reports/manifests | `.video-benchmark/`, `.video-cache/`, `benchmark-assets/` | PENDING BACKUP; may contain private/owner/licensed media, no public upload |
| Original owner recordings referenced in prior work | owner Downloads folder | PENDING BACKUP; exact locations/hashes only in private external-media manifest |
| Python/Node build environments, caches | `.venv-dev/`, `node_modules/`, `.next/`, installer `.build/.venv` | Rebuildable; not a backup of unique source |
| Environment, sessions, deployment bindings | `.env*`, `.vercel/`, Supabase CLI temp state | Intentionally excluded; provision separately through owner-approved secure channels |

[`handoff/ARTIFACTS.json`](handoff/ARTIFACTS.json) contains 21 curated model/installer
records with real absolute paths, byte sizes, SHA-256, pinned sources/versions when
known, license caveats and restore methods. A manifest is **not a copy of the files**.

Complete private local records in the main workspace:

- `.handoff-backup/inventory-main.json`: 7,221 initial project-file hashes/metadata;
  secret/session files and rebuildable caches excluded, archived helper links added.
- `.handoff-backup/inventory-review-worktree.json`: review worktree inventory.
- `.handoff-backup/external-owner-media.json`: two owner-provided MP4 hashes/paths.
- `.handoff-backup/pre-handoff-all-refs.bundle`: local reachable-ref safeguard.

No independent authorized private destination exists in this task. Ask the owner
for one before claiming complete asset backup; copy/verify privately, not to public
GitHub. A local bundle or same-disk copy is not disaster recovery. Unknown origins
or licenses stay UNKNOWN, not silently authorized for redistribution.

## 9. Clone, setup, build and test

```powershell
git clone --branch codex/claude-handoff-20261014 https://github.com/kkhunmingg-commits/viralflow-ai.git viralflow-handoff
cd viralflow-handoff
git fetch origin
git worktree add ../viralflow-live origin/feature/ai-live
```

Use Node >=24. The project declares pnpm 11.19.0; this backup verified the frozen
lock with the available pnpm 11.25.0 cache runtime. Preserve the lockfile.

```powershell
pnpm install --frozen-lockfile
# --offline worked in this machine's existing populated pnpm cache.
node scripts/verify-handoff-sources.mjs
pnpm typecheck
pnpm lint
pnpm test -- src/features/creative src/features/growth src/features/growth-manager src/features/analytics src/features/auto src/features/video-provider
```

For offline build-only validation, use process-only placeholders and mock flags:

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL='https://local-build.invalid'
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='sb_publishable_local_build_placeholder_00000000'
$env:APP_ENV='development'
$env:TIKTOK_PROVIDER='mock'
$env:TIKTOK_PUBLISHING_PROVIDER='mock'
$env:TIKTOK_PUBLISHING_REAL_MODE='false'
$env:TIKTOK_SHOP_REAL_MODE='false'
$env:CREATIVE_AI_PROVIDER='mock'
$env:VIDEO_PROVIDER_ROUTER_ENABLED='false'
$env:GEMINI_OMNI_API_ENABLED='false'
pnpm build
```

These values do not create a usable authenticated app, database or storage service.
For runtime work use an isolated local database/storage and `.env.example` as a
template; obtain real secrets through the owner, never chat/Git. Do not copy the
owner's `.env.local` or Production credentials to a new workspace automatically.

AI LIVE tests, inside its separate worktree:

```powershell
pnpm install --frozen-lockfile
pnpm test -- src/features/ai-live src/app/api/ai-live 'src/app/(app)/ai-live'
pnpm typecheck
pnpm lint
# Use the same isolated process-only build configuration, then pnpm build.
python -m unittest discover -s workers/ai-live/tests
```

The Python proof used the already provisioned Python 3.10 development environment,
not a newly packaged customer runtime. Worker HTTP requirements, local agent
requirements and installer build requirements are separate files on AI LIVE.
Inspect them and the model/license docs before installing anything. Real CPU-model
and voice opt-ins were explicitly disabled. Do not blindly run archived benchmark
helpers or download multi-GB models as part of basic setup.

## 10. Verification and safety rules

| Independently restored source | Verification on 2026-10-14 |
| --- | --- |
| Router `9545a00` | 384 relevant tests PASS, 1 opt-in DB test skipped; typecheck/build PASS; lint 0 errors, 8 pre-existing warnings |
| AI LIVE `a7d5530` | 200 focused TypeScript tests PASS; typecheck/build PASS; lint 0 errors, 8 pre-existing warnings |
| AI LIVE worker | 404 total tests: 400 PASS, 4 skipped (real-model/voice/artifact prerequisites); no GPU/broadcast proof |
| WAN pending SQL change | Existing isolated PGlite test PASS, 49 checks; no remote migration applied |
| Archived helpers | Byte-preservation/secret review only; execution/functionality not rerun, WIP |

Fresh clone builds warned that a parent pnpm workspace was ignored because these
clones are nested separate Git repositories; both builds passed. No config was
changed to merge their roots. Typechecking ran separately because Next build skips
its duplicate checker by existing project configuration.

Staged backup content and all local Git blob objects were scanned in memory for
exact configured secret values and limited recognizable credential patterns. No
confirmed secret match was found. An unreachable object contained a private-key
header string but no complete PEM payload; it is not evidence of an exposed usable
private key. No credential rotation was performed or inferred from a masked prefix.
This scan is not a certification of every historical secret format or media privacy.

No paid API, video generation, TikTok posting/LIVE, deployment, Production database
change, reset, clean, force push or destructive worktree cleanup was performed.

Before modifying Next.js, obey `AGENTS.md` and read installed Next docs. Keep user
authorization/account opt-in, signed device/entitlement grants, budget reservations,
idempotency and recovery gates. Never promote mock evidence to real results, enable
learned compliance rules without approval, share sessions/cookies, or merge entire
system branches just to make missing functions appear available. Reuse the existing
architecture and report genuine blockers.

**READY FOR CLAUDE SOURCE REVIEW: YES. COMPLETE BACKUP / LOSSLESS MACHINE RETIREMENT: NO.**
Original models/media/installers and private configuration still require authorized
private transfer or verified re-download/rebuild before retiring this computer.
