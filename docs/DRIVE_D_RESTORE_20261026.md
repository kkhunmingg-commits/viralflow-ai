# Restore on drive D — 26 October 2026 (Asia/Bangkok)

Workspace: `D:\ViralFlowAI`. The directory was empty before restoration. Project source, installed dependencies, browsers, profiles, downloads, temporary files and build outputs are on D. One initial pnpm status write on C was discovered and corrected as described below; a claim of zero C writes for the whole session would be inaccurate.

Fetched 179 remote branch references and tags from `kkhunmingg-commits/viralflow-ai` with Git's blob filter. File content is fetched on demand; this is not a copy of private media, secrets, models or old local environments. Read migration/handoff documents directly from `origin/codex/machine-migration-20261026`; that documentation branch differs from the feature source and was not merged.

Base: `origin/feat/flow-browser-worker-mvp` at `523fae8b31e5bb7c0cae4b1a11d27c504643cfe9`. Preserved as local `checkpoint/flow-restore-20261026`. Working branch: `codex/flow-drive-d-restore-20261026`. Creative Brain `2870e7b` and provider router `9545a00` are ancestors of this base. AI LIVE branches were fetched and preserved, not checked out or modified. No existing files were removed.

## Implemented and verified

- `scripts/dev-d.ps1` and `enter-drive-d.ps1` configure each command's D-only cache/temp/browser locations. Windows worker refuses a C-based runtime configuration. No persistent user environment or global Git config was written.
- Stable result IDs replace the previous count-plus-last-card selection, which could download an old clip when Flow prepended a new one. Ambiguous new results stop for reconciliation. Existing persisted generation guard remains.
- Explicit owner approval precedes credit-consuming Generate and the existing owner provenance attestation. Manual MP4 recovery and import-only paths never generate a replacement. Recovered/downloaded hashes are checked before import.
- Ordinary Chrome assisted launcher uses a separate profile/download directory on D. No session transfer, CAPTCHA workaround or automation-flag evasion.
- Fixed pre-existing Flow export TypeScript union access; fixed Windows newline/path assumptions in two tests; kept Node worker tests separate from Vitest.
- Build tracing excludes private worker data, selectors, Git metadata and local runtime caches. The first build hit a locked browser session file; build passed after adding exclusions.

Validation: Node 24.18.0; pnpm 11.25.0; frozen pnpm lock install successful (manifest requests 11.19.0; no dependency versions changed). Worker Playwright 1.55.0 installed with a new npm lockfile; Chromium and its support binaries installed below `.runtime/playwright`. Typecheck passed. Vitest: 972 passed, 2 skipped; 112 test files passed, 1 skipped. Worker Node tests: 6 passed. Lint: no errors, 9 existing warnings. Next build passed with isolated public Supabase placeholders, mock providers and paid/publishing flags off; 2 existing dynamic-filesystem tracing warnings remain. These placeholders do not configure a usable authenticated local application.

Inspected 74 generated `.nft.json` manifests: zero references to `.runtime`, `.git`, worker workspace or private selectors. Wrapper dry-run passed and queue remains empty.

Initial cache configuration used `npm_config_*` plus XDG cache variables. pnpm 11 still updated `C:\Users\luckz\AppData\Local\pnpm-state\pnpm-state.json` (56 bytes). No removal was attempted. Added pnpm's own `pnpm_config_cache_dir`, `pnpm_config_state_dir`, `pnpm_config_store_dir` plus XDG state/data variables. Confirmed `pnpm config get cache-dir`, `state-dir` and `pnpm store path` all resolve below `D:\ViralFlowAI\.runtime`. This is the known exception to the owner's D-only requirement, not an unqualified D-only pass.

## Real pilot status

Owner supplied the existing portal `https://viralflow-ai-blond.vercel.app`. No `.env.local`, real product handoff, calibrated selectors or real MP4 was present locally at restoration. Connected Supabase inventory did not identify a ViralFlow-named project; no unrelated project was selected and no database was modified.

Google refused sign-in in the automated Chromium session. The owner confirmed successful login in ordinary Chrome assisted mode. The UI-control tool could not start due to `helper_unknown_error: setup refresh had errors`, so this session cannot inspect/control that signed-in Chrome or export its authenticated creative project. No cookies/passwords were read or copied. Do not claim a completed real pilot until the correct creative brief, Google output, successful server import and final owner download are independently observed.

**Real Google generation / MP4 download / ViralFlow import / final owner download: NOT VERIFIED.** No credit-consuming Generate, paid API, TikTok publishing, production deployment or database migration was initiated. Manual-assisted workflow remains documented in `workers/flow-browser/README.md`.
