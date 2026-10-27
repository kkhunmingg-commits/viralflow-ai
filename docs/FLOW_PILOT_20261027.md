# Flow pilot continuation — 27 October 2026

Historical checkpoint. See [28 October continuation](FLOW_PILOT_20261028.md) for the subsequently approved/applied Local callback, owner role, rights schema, real product import, Creative Brain project and authenticated Flow UI preparation. The unresolved-state descriptions below reflect the earlier checkpoint, not the latest live state.

Workspace `D:\ViralFlowAI`, branch `codex/flow-drive-d-restore-20261026`, continuing Draft PR #10. No merge or production deployment. The owner explicitly approved the single queue migration below, which has now been applied and verified; other changes remain unapproved.

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

## Initial read-only inspection, before queue installation

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

The existing router migration is `supabase/migrations/20261012050849_video_provider_router.sql`: two tables, owner-scoped SELECT RLS, service-role grants, lease-claim RPC and dashboard RPC. Its dashboard depends on the existing budget table. The initially reviewed proposal has since been approved and installed as recorded below. It alone does not supply a real product, approve a user, or make the branch's newer Creative Brain workflow ready.

The newer evidence-based Creative Brain path also reads `auto_account_discovery`, `media_asset_rights` and `content_evidence`; it requires a real authorized account with unexpired execution permission and reviewed factual/media evidence. Do not bypass those gates or apply all later migrations blindly. The existing rights migration also installs publishing/revocation triggers, while account-discovery migrations involve other growth/account tables. Those dependencies and production effects must be scoped before requesting a write approval. Content Bank is a separate branch feature; its absence is not proof that the existing Video Factory master download requires it.

The owner clarified that ViralFlow must discover the product itself; asking the owner to source/upload it does not meet the request. A dedicated permitted pilot account, the minimum schema changes and the exact user role assignment must be reviewable before any production write. The existing three real sales accounts are not pilot substitutes. Google credit approval remains a separate action-time gate after a usable job, prompt and import path are ready.

## Product discovery continuation

Code inspection found a missing capability, not just missing input: Product Radar currently calls only `MockProductProvider`; `TikTokShopProductProvider` throws a disabled-adapter error, and the Commerce real provider is approval-gated. No live catalog/rating/commission search was exercised. Do not seed mock products or describe an image search as verified TikTok Shop product discovery.

Located `scripts/product-video/product_scout.py` on the existing backup branch `origin/claude/real-product-video-test` at `0faece0`, and restored just that source file, without merging the branch or its models/videos. It searches live Commons image metadata. Added bounded/metadata-only runs, complete license/creator metadata, explicit pending rights/identity review, a strict commercial-license candidate allowlist, rejection of counterfeit/replica/fake titles, and UTF-8 report output for Windows. The counterfeit safeguard follows an actual live search whose first result depicted a counterfeit Casio watch.

A real run for Casio F-91W returned 48 image candidates after filtering and downloaded two previews to `.runtime/real-product-pilot/` on D. These are **image counts**, not 48 products or validated listings. The selected proposal is the Multicherry front-closeup photo under CC BY-SA 4.0; both the visible model and the source page were inspected. The current Casio Thailand F-91W-1 page lists MSRP THB 900 and 21 g weight. MSRP is not a confirmed sale price; affiliate commission, stock and performance remain unknown. Source links and attribution requirements are in `scripts/product-video/README.md`. No fact/rights record was approved on the owner's behalf and no product was inserted into the hosted database.

This scout is an existing repository research tool, **not yet connected to the Product Radar → reviewed Creative Brain → provider job path**. It establishes a usable candidate-source lead, not completion of system discovery or the requested clip. Do not bypass the missing catalog integration, owner review or account permissions with fabricated production records.

Initial hosted migration history ended at `20261011175654 customer_content_export`; several hosted historical version numbers differ from the restored local filenames. Do not run an indiscriminate `supabase db push` or replay old migrations. Only the queue migration below has now been applied; other absent branch features and role assignment remain separate, unresolved requirements.

## Approved queue migration applied

The owner approved **only** `20261012050849_video_provider_router.sql`. Applied the unchanged source in one transaction on verified project `nbtshqmtspgzrfzkqjxx`, with its version/name/source recorded in the existing `supabase_migrations.schema_migrations` history and a PostgREST schema reload notification. All six `(owner_id,id)` foreign-key targets were confirmed beforehand. Source file SHA-256: `f5826a02c65b87339aee0a07c09445a731ba3ab2c475986068e10072d091752a`.

Post-commit catalog checks confirmed both tables, two owner SELECT policies, RLS on both tables, service-only claim/dashboard execution, no anonymous settings read, and no authenticated checkpoint-column read. Real Data API reads returned both tables with zero rows and no errors; the read-only dashboard RPC returned zero queue totals. No provider settings/job, user role, paid service, scheduler or deployment was enabled. Private apply/verification SQL, JSON and screenshots remain under `.runtime/`.

Also fixed `scripts/dev-d.ps1`: assigning `pnpm.cmd` or `npm.cmd` back into the validated `Tool` parameter caused a PowerShell validation error. Resolve the executable into a separate variable instead; actual pnpm and npm wrapper version commands now pass.

The owner completed Google login from the Local browser, but OAuth redirected that tab to production `/auto`. The signed-in UI and Supabase Users UI identify the same owner. Source code correctly requests a same-origin `/auth/callback`. The project's Auth URL Configuration contains only the production callback, so Local's callback is not allowed and falls back to the production Site URL. Prepared the exact `http://localhost:3000/auth/callback` addition without saving it. The production Site URL must stay as configured.

Prepared a separate, private SQL proposal to grant `viralflow_role=developer` to that exact owner, preserving other app metadata. This role unlocks internal routes and Provider/Operations actions, not just a visual menu. The role and Auth redirect changes have **not** been approved or applied. They require explicit approval because they expand authentication/application access; the prior queue approval does not cover them. A fresh Local OAuth login will also obtain updated claims if the owner grants the role.

## Validation and actual acceptance

- Typecheck passed; lint: 0 errors, 9 existing warnings.
- Existing Vitest regression suite: 972 passed, 2 skipped; 112 files passed, 1 skipped.
- Worker tests: 14 passed, including four real-browser checks against local fixture pages and four stream checks against synthetic local MP4s. These do not call Google or establish real generation.
- Next build passed using process-only placeholder configuration with server secret blank and paid/publishing flags off. Two existing dynamic-filesystem tracing warnings remain.
- GitHub Actions Quality gates run 115 passed for commit `b585ff6a996f1491025305bb72a81d0a6e5ab41e`.
- Restored scout safeguards: four Python unit tests passed; real Commons metadata/image download succeeded on D. These tests do not establish product authenticity or complete license compliance.
- Existing provider SQL proof passed 49 checks in isolated PGlite 0.5.12: owner RLS, private-column access, account leases, budget/idempotency and aggregate behavior. It used synthetic fixtures and made zero paid/TikTok calls; no hosted database was changed.

**Real Google generation, real MP4 download, import into the existing ViralFlow job and final owner download: still not verified.** No Generate or paid API call was made. The key and approved queue schema now work against the actual database. Remaining blockers include Local OAuth configuration, provider administrator claims, catalog-to-Creative-Brain integration and related evidence/account schema and approvals. A successful Windows UI runtime does not establish successful control of the authenticated Google Flow page. Do not weaken RLS/admin checks or fabricate evidence/account records to make the pilot appear complete.
