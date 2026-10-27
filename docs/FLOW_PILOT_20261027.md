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

The owner authorized reading the existing Supabase key and saving it to the private environment file. Browser-origin access initially required separate explicit approval; after that approval, the API Keys page could be inspected. The existing secret remained masked in the readable page and the browser clipboard returned no key. No replacement key was created or rotated. The owner was asked to copy the existing key directly to the local file.

Local Next.js served `/login` successfully (HTTP 200). This is a real local app with verified public configuration, not proof that the database queue, server credentials or real product inputs are ready.

## Validation and actual acceptance

- Typecheck passed; lint: 0 errors, 9 existing warnings.
- Existing Vitest regression suite: 972 passed, 2 skipped; 112 files passed, 1 skipped.
- Worker tests: 14 passed, including four real-browser checks against local fixture pages and four stream checks against synthetic local MP4s. These do not call Google or establish real generation.
- Next build passed using process-only placeholder configuration with server secret blank and paid/publishing flags off. Two existing dynamic-filesystem tracing warnings remain.

**Real Google generation, real MP4 download, import into the existing ViralFlow job and final owner download: still not verified.** No Generate or paid API call was made. Real product/Creative Brain selection remains dependent on authorized access to the existing database and a usable owner browser session. Any missing migration or role must be reviewed explicitly; do not weaken RLS/admin checks or apply production migrations to make the pilot appear complete.
