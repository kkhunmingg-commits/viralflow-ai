# Production readiness integration — 8–9 October 2026

Delivery branch: `codex/production-readiness-integration`. This is an integration verification branch, not a Production release, TikTok approval or permission to enable paid execution.

## Integrated source checkpoints

| Source | Requested checkpoint | Integration |
| --- | --- | --- |
| POST multi-account | `2614eadcc4afca7dbd579adc3a5baa5748e24eef` | Already an ancestor of the Compliance checkpoint; preserved without another merge |
| Compliance Brain | `239fe51e8f9cb61da654ba6cc05f439ec8b02a89` | Integration branch base |
| AI LIVE | `a7d55301c8080a621a3330804173cf5d56be58eb` | Already an ancestor; presenter/stream engine unchanged |
| fal integration | `57eedc81c522d2a191d9bebe47e85756d663f18a` | Two reviewed fal commits cherry-picked as `bec8e72` and `eb7d38e` |

Conflict resolution preserves POST EXPORT/DRAFT/AUTO behavior, SAFE execution boundaries, the two-attempt fal policy, immutable generation policy, atomic budget reservation/settlement, known-request recovery and unknown-submit protection. Shared Compliance runs before generation, again after image upload immediately before generation submission, and on normalized media after generation. A technical quality PASS is not final Compliance approval: export/publishing still re-evaluates current policy and exact media evidence. Missing claims, unsafe voice scripts and policy retirement immediately before submission have new production-path regression tests. No other branch was merged into Production.

The integration proof also exposed misleading read-only status copy. EXPORT is now labelled as file export rather than publication, and deferred analytics/learning events remain waiting rather than claiming observations or learning occurred. The processor and its stored completion states are unchanged. Two presentation regression cases cover these distinctions.

Visual inspection of the mobile screenshots found an account badge compressing the account name into a narrow column. A two-line mobile-only CSS adjustment places the badge on its own grid row; the browser assertion now checks that each name retains at least 140px at 390px viewport width. Desktop styles and account actions are unchanged.

## Database application and preserved behavior

After populated isolated SQL/RLS compatibility tests, the two exact migration payloads were applied through the existing Supabase migration API:

- `20261008121446_compliance_brain_foundation`
- `20261008122111_fal_generation_budget_guards`

Local filenames match these hosted versions. Local and remote both have **30 migration names**. Older, pre-existing hosted timestamps differ from local historical filenames: do not use a generic `db push --include-all` to replay that history. No old history was rewritten.

Read-only hosted verification confirms owner-scoped Compliance SELECT policies, service-only mutation/RPC grants, eight new RLS tables, denied raw decision fields, the fal guard handshake and restrictive fal job mutation policies. Customer aggregates remain four profiles, ten accounts, zero products and zero AUTO runs. No real product claim/evidence or active policy was fabricated. Existing Supabase Cron remains active and SAFE; its original database-only tick is preserved. See [database evidence](compliance-brain/database-integration-preflight.md) for exact checks and limitations. Hosted object inspection is separate from isolated populated owner/cross-owner/anon SQL behavior tests; no hosted fixture users were created in this run.

## No-spend application proof

`src/features/auto/safe-integration-e2e.test.ts` uses the actual production services and execution store. Only external database/storage/provider transports are substituted. It proves:

1. Three category/account runs: Product Radar, category aggregation, assignments, START/account scheduler, actual Creative adapter, shared policy/claim checks, actual fal queue adapter with local response video, real FFmpeg H.264/AAC composition and sampled frames, budget RPC path, final Compliance, actual authorized EXPORT ZIP bytes, deferred analytics/learning and completion. The synthetic LIVE controls and approvals exist only in isolated test memory; no deployed flag or credential is changed.
2. The actual SAFE path stops at the paid video boundary. It produces no successful generation or export until a separate, explicitly reviewed fixture result is inserted at the durable provider-result checkpoint. Restart resumes the production processor, rather than replacing its orchestration.
3. Ten account plans: START/STOP isolation, concurrent claim protection, duplicate prevention and daily-target bounds.
4. Unsafe content is blocked, missing visual coverage remains review-required, and an applied safe rewrite must pass a new check before export.

Synthetic vision verdicts and verified media/label rows are explicit transport fixtures. They establish wiring, not real visual classification, real label accuracy or provider quality. The passing fixture runs end at export: actual analytics ingestion is deferred because nothing was posted. Test accounting amounts are synthetic and not actual spend. **Real paid calls = 0; TikTok publish/upload calls = 0.**

Traceable artifact: `.video-cache/integration-readiness/start-export-report.json`, containing source/normalized-video/ZIP digests, sizes, categories, checks and limitations. Binary media and reports stay Git-ignored; repeatable test source is committed.

## Compliance readiness and remaining release gates

| Area | Verified state | Still required |
| --- | --- | --- |
| Policy authority | Official Thailand sources, version/source fingerprints, strict Ed25519 signature validation, guarded activation/update/rollback tests | Research candidate remains unsigned and HUMAN_REVIEW_PENDING; administrator review, protected signer, trusted server public keys and approved pack provisioning |
| Product Claim Ledger | Owner/product scope, exact approved claims, evidence hashes, jurisdiction, channel, expiry and conditions; unsupported facts cannot pass | Real label/documents and controlled evidence/claim verification; hosted products and verified claims are currently empty |
| Semantics | New frozen 36-sentence holdout, 72 POST/LIVE evaluations, 48/48 unsupported statements held and 24/24 verified benign statements permitted | 44 unsupported evaluations were held by grounding alone; this is not full semantic understanding or calibrated production accuracy |
| Actual media | Local MP4 full decode, actual JPEGs and PCM, byte hashes, one experimental offline ASR observation from encoded speech | OCR, complete visual coverage and representative Thai speech validation; missing coverage returns REVIEW_REQUIRED |
| Learning | Audit first, bounded private aggregates, shadow candidates, tested update/rollback boundaries | New learned candidates never enforce policy automatically; production evaluation/administrator workflow remains necessary |
| Production providers | Real adapters use shared production execution path; no duplicate charged submission in contract tests | TikTok Production approval, applicable consent/readiness and separately authorized real generation/posting validation |
| AI LIVE | Existing non-GPU/stream/installer and shared private-pipe Compliance tests preserved | Existing hardware/presenter validation and official TikTok LIVE transport boundary remain unchanged |

See [official policy research](compliance-brain/official-tiktok-th-policy-research.md), [policy operations](compliance-brain/policy-pack-operations.md) and [holdout/media evidence](compliance-brain/integration-holdout-media-proof.md). Test signatures never become runtime authority. No visual PASS, policy activation or Production readiness certification is inferred from synthetic fixtures.

## Verification

- Full TypeScript regression: **1,296 passed, 2 skipped across 129 files** (9 October, 00:42 Asia/Bangkok; 59.37 seconds). After matching the fixture's `generation_jobs.completed_at` to the actual RPC's timestamp default, the focused EXPORT/presentation suite passed **13/13** (00:46). The two skipped suites require separately provisioned database conditions; no skipped remote run is reported as a PASS.
- Typecheck passed. Lint passed with **0 errors and 7 existing unused-parameter warnings** in `fal-wan.test.ts`. Final optimized production build passed after the browser/CSS verification; the build uses temporary process-only fixture settings and is not a deployment. Next's build skips type validation by repository configuration, so typecheck is run separately.
- Python integration regression: 46 tests passed with the existing project runtime: private Compliance transport (7), non-GPU foundation (10), direct streaming including local TLS/RTMP (12), installer/update/rollback (17). Running the system Python first exposed missing dependencies; rerunning with the project's existing runtime passed without installing packages or changing worker code.
- Isolated PostgreSQL: all 30 migration files parse/apply; 25 populated integration checks plus 86 scheduler checks, 70 Compliance SQL/RLS checks, 92 full POST SQL checks and the fal budget RPC suite pass. PGlite uses PostgreSQL 18.3 with contract-only auth/storage/cron prerequisites; actual hosted PostgreSQL 17.6 objects and active SAFE Cron are checked separately.
- Browser E2E uses the real Next application and cookie-auth path with isolated loopback Auth/PostgREST/Storage URL transports and the synthetic rows from the production-path domain test. **PASS** for 3 and 10 accounts on desktop 1440px, tablet 820px and mobile 390px, plus the original three account-scoped EXPORT results on desktop/mobile: **16 screenshots, 0 overflow, 0 console errors, 0 external browser requests**. There were 198 fixture-boundary requests, including 14 authenticated-user checks and 12 account-scoped master metric reads. This is not hosted authentication, hosted Storage authorization or TikTok acceptance.
- Original domain timestamps remain frozen on 8 October; browser time is the actual 9 October Bangkok date. Today's counters correctly show zero and do not replay yesterday's completed progress. The seven-day results show exactly one persisted EXPORT clip with a download action per original account. No timestamps or achievements were fabricated to make today's dashboard nonzero.
- Latest hosted read-only check (9 October, approximately 00:44 Bangkok) again confirmed active every-minute Cron with its original database command, enabled **SAFE** execution and **60 succeeded runs** in the preceding hour. Generation jobs, reservations and publishing queue rows remain **0**.

Reproduce:

```powershell
pnpm --config.verify-deps-before-run=false test
pnpm --config.verify-deps-before-run=false typecheck
pnpm --config.verify-deps-before-run=false lint
node scripts/verify-compliance-integration-sql.mjs
node scripts/verify-compliance-brain-sql.mjs
node scripts/verify-post-multi-account-sql.mjs
node scripts/test-fal-budget-sql.mjs node_modules/@electric-sql/pglite/dist/index.js
```

Build/test servers use temporary process-only fixture configuration with paid generation, publishing, analytics transport and recovery disabled. No `.env.local` write, Production deployment, TikTok configuration change or customer data mutation was performed. Integration migration DDL was the only authorized remote database mutation.

Local proof artifacts (Git-ignored):

- `.video-cache/integration-readiness/start-export-report.json`: actual source/normalized media and export ZIP hashes.
- `.video-benchmark/production-readiness-browser/browser-result.json`: browser case results and screenshot paths. Its input `domain-fixture.json` SHA-256 is `fc822554a2aa95d59cc0e493642b019b4c64a30b8af9b3167649e78e9f0cc9f8`.
- `.video-cache/compliance-readiness/report.json`: actual media decode/frame/audio checks, separate from synthetic classifier attestation.

Repeat browser verification with the installed tooling paths (no dependency download):

```powershell
node scripts/verify-readiness-browser.mjs --playwright-module <installed-playwright-index.mjs> --python <project-python.exe> --browser <installed-chrome.exe>
```
