# Flow pilot continuation — 27 October 2026

Workspace `D:\ViralFlowAI`, branch `codex/flow-drive-d-restore-20261026`, continuing Draft PR #10. No merge, production deployment or database migration was performed.

## Completed

- Located the Windows sandbox failure in the dated sandbox log: the helper could not open `D:\ViralFlowAI\.git` to apply its deny ACL (`os error 5`). The directory owner was `Luck\CodexSandboxOffline` from the initial repository setup. After explicit owner authorization, changed only the directory owner to `Luck\luckz`; verified the DACL was unchanged. The prior security descriptor and result are private under `.runtime/`. Sandboxed commands and the UI runtime start successfully afterward. No recursive ownership change, permission grant, sandbox disable or file-content change was made.
- Added a read-only portal preflight before a Generate click. Login redirects, absent original jobs/import forms and already-imported masters cannot lead to another generation. `--preflight` checks this path without visiting Flow or spending credits.
- Probe actual MP4 video streams using bundled FFprobe before recovery/import; require positive duration and 9:16 display dimensions, account for rotation, and retain metadata with the checksum. Reject corrupt/header-only, audio-only and landscape outputs. Probe results do not establish product accuracy, rights, complete decoding or owner quality acceptance.
- Check the latest saved checksum immediately before import, including a file downloaded during the current run.
- Permit HTTP loopback URLs in the ordinary Chrome assisted launcher for Local testing, while retaining HTTPS for remote portals.
- Exclude local browser profiles, queue files and selectors from Vercel CLI uploads as well as server traces. Exclude private `.env` files from server traces.

## Existing services verified

Vercel project `viralflow-ai` resolves to `prj_8ydS6Gl7lQN3sdtHPa4tMlzCM1lC`. Existing production deployment `dpl_4KykxAufez8MQ5y4TvJroLCE8fr3` was created via CLI, without Git-source metadata. Its source tree contains Creative Brain, Video Factory and Content Export, but no `video-provider` or `content-bank` feature directory. The new Flow worker/provider UI is therefore not established on that production snapshot; no production deployment was attempted.

The existing Vercel public configuration identifies Supabase project `nbtshqmtspgzrfzkqjxx`. The signed-in dashboard confirms project `viralflow-ai` under organization `ViralFlow`. The connected Supabase MCP account does not have access to that project; no unrelated database was used. Vercel stores the server key as a sensitive variable whose value is not returned. Public values were placed in the ignored local environment file; paid providers, recovery jobs and publishing remain disabled locally. No key was added to Git or printed in reports.

The owner explicitly authorized reading the existing Supabase key and saving it to `D:\ViralFlowAI\.env.local`. Completed this using the dashboard's existing Copy API key action and the Windows system clipboard, after the browser clipboard API returned no key. Validated the key format and the exact project URL in memory, replaced only `SUPABASE_SECRET_KEY`, and cleared the clipboard. No replacement key was created or rotated; no secret was printed or committed. Read-only Data API queries with the saved key succeeded.

Local Next.js served `/login` successfully (HTTP 200). This and the server-key check establish connectivity, not a working owner session or a completed pilot.

## Read-only inspection of the actual database

The verified project returned zero rows for `products`, `creative_projects`, `scripts`, `creative_angles`, `media_assets`, `generation_jobs`, and `master_videos`. There is no existing real product, cleared reference image, selected Creative Brain script or render to resume. The local worker queue also contains no exported job. Do not substitute a fixture or invent product facts/rights.

Data API reads returned `PGRST205` for the provider, rights/evidence and bank tables. A separate dashboard SQL query wrapped in `BEGIN TRANSACTION READ ONLY` confirmed the following against the PostgreSQL catalog, so these are absent tables rather than just a stale REST cache:

| Relation | Present |
| --- | --- |
| `products`, `media_assets`, `creative_projects` | Yes, empty |
| `generation_budget_reservations` | Yes |
| `video_provider_settings`, `video_provider_jobs` | No |
| `auto_account_discovery` | No |
| `media_asset_rights`, `content_evidence` | No |
| `content_bank_items` | No |

The same read-only query counted **zero** users with `raw_app_meta_data.viralflow_role` equal to `admin` or `developer`. The branch's provider page and server actions require that claim. Possession of the server key does not grant an owner browser session that role. No user metadata or privileges were changed, and no session was copied.

The reviewed existing router migration is `supabase/migrations/20261012050849_video_provider_router.sql`: two tables, owner-scoped SELECT RLS, service-role grants, lease-claim RPC and dashboard RPC. Its dashboard depends on the existing budget table. This is a concrete source file to review before any production application; it has **not** been applied. It alone does not supply a real product, approve a user, or make the branch's newer Creative Brain workflow ready.

The newer evidence-based Creative Brain path also reads `auto_account_discovery`, `media_asset_rights` and `content_evidence`; it requires a real authorized account with unexpired execution permission and reviewed factual/media evidence. Do not bypass those gates or apply all later migrations blindly. The existing rights migration also installs publishing/revocation triggers, while account-discovery migrations involve other growth/account tables. Those dependencies and production effects must be scoped before requesting a write approval. Content Bank is a separate branch feature; its absence is not proof that the existing Video Factory master download requires it.

Next required owner input is the real pilot product and the D-drive path to its source media, including whether the owner created the media or has permission to use it. A dedicated permitted pilot account, the minimum schema changes and the exact user role assignment must then be reviewable before any production write. The existing three real sales accounts are not pilot substitutes. Google credit approval remains a separate action-time gate after a usable job, prompt and import path are ready.

## Validation and actual acceptance

- Typecheck passed; lint: 0 errors, 9 existing warnings.
- Existing Vitest regression suite: 972 passed, 2 skipped; 112 files passed, 1 skipped.
- Worker tests: 14 passed, including four real-browser checks against local fixture pages and four stream checks against synthetic local MP4s. These do not call Google or establish real generation.
- Next build passed using process-only placeholder configuration with server secret blank and paid/publishing flags off. Two existing dynamic-filesystem tracing warnings remain.
- GitHub Actions Quality gates run 115 passed for commit `b585ff6a996f1491025305bb72a81d0a6e5ab41e`.

**Real Google generation, real MP4 download, import into the existing ViralFlow job and final owner download: still not verified.** No Generate or paid API call was made. The existing key is now configured and real database reads work; the remaining blockers are missing real inputs, absent branch schema, and no provider administrator claim. A successful Windows UI runtime does not establish successful control of the authenticated Google Flow page. Any missing migration or role must be reviewed explicitly; do not weaken RLS/admin checks or apply production migrations to make the pilot appear complete.
