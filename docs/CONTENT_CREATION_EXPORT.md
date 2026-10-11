# Customer creation and manual export — 12 October 2026

Production base: `d5185ed`; this release selectively reuses the reviewed fal queue/model and atomic budget primitives. No integration branch, AI LIVE core, policy pack activation, TikTok scope/approval changes or scheduler activation is included.

## Customer workflow

Home → account / AUTO, GROWTH or AFFILIATE → Create → explicit per-clip budget approval → real creative thought → image/reference → Thai voice → vertical AI footage → local H.264/AAC composition → owner review → private ZIP download → manual TikTok posting.

- GROWTH does not require a product. Account interests, optional topic and real recent concept titles are creative context; no fabricated trends, followers or performance.
- AUTO uses a selected actual product only when account commerce facts permit; otherwise GROWTH.
- AFFILIATE uses an owner-selected product and actual stored photograph. The new intake writes the existing products/media_assets tables. Owner-provided price/photo are identified as owner supplied, not verified efficacy evidence. Missing analytics are marked UNKNOWN in provenance, never invented sales evidence.
- Offline Affiliate preparation is independent of cart entitlement. It cannot assert cart availability and cannot publish. The unchanged TikTok publishing boundary still enforces all permissions.
- A paid generation is never a visual compliance PASS. Final output always requires explicit owner review. ZIP says `automatedVisualCompliance: NOT_VERIFIED`; high-risk text issues stop further spending.

## Runtime and safety

`CONTENT_EXPORT_ENABLED` defaults false. `CONTENT_EXPORT_ALLOWED_OWNER_IDS` defaults empty. FAL_KEY is server-only; approved owners only can submit. Each click requires a budget of $0.30–$1.00, with $5/day and $30/month maximum liabilities per owner. These limits are specific to explicitly requested file creation; existing AUTO account settings and SAFE Cron remain unchanged.

Every paid step has a persistent generation job, atomic reservation and provider request identity. Quotes are checked read-only before reservation. Amounts remain conservative estimates unless actual token usage supplies a bill; the UI labels them accordingly. Submitted-unknown liabilities block a new start for that account. A crash resumes known request IDs without a new paid POST. No automatic paid retry. Leases fence concurrent tabs; one active export job per account. Read polls stop after 120 attempts /30 minutes and retain unresolved holds. Stop prevents future submissions; already accepted provider work can still cost money.

The browser advances existing jobs with authenticated same-origin POST every eight seconds. Closing the page pauses further work; reopening resumes. This is not an unattended daily scheduler, and does not claim that the legacy SAFE Cron now creates or posts videos.

Credentials, model/queue identifiers and raw errors never enter customer responses. Private checkpoint columns are inaccessible to authenticated/anon roles. Downloads recheck owner/account, review state, private path, MIME/MP4 signature and checksum. Server fetches permit only reviewed fal media hosts and do not follow redirects. Product photos use owned private Storage; no arbitrary URL fetch.

## Verified official contracts

- [Supported LLM gateway](https://fal.ai/models/openrouter/router/api); deprecated `fal-ai/any-llm` is not used. Fixed selected low-cost model, bounded tokens, no web-search/tools.
- [Portrait image creation](https://fal.ai/models/fal-ai/flux/schnell/api), safety checker on.
- [Thai narration](https://fal.ai/models/fal-ai/minimax/speech-02-hd/api), Thai language boost and URL output.
- [8-second video candidate](https://fal.ai/models/fal-ai/ltxv-13b-098-distilled/image-to-video/api),193 frames/24fps/720p/9:16. This is a trial candidate, not a benchmark-certified winner.

Read-only authenticated quotes on 12 October: router units $0.01, image megapixels $0.003, narration per1,000 characters $0.10, video seconds $0.02. Initial reserves are $0.05+$0.01+$0.02+$0.17=$0.25, not an actual invoice. Prices are rechecked at runtime. No paid clip or TikTok call was executed for this release.

## Validation

Transport-boundary E2E covers all three modes, explicit review/export, resumption, lost-submit protection, cross-owner rejection, Stop and kill switch. A separate actual local-media test proves8-second720×1280H.264/AAC composition from generated test-pattern video and sine audio; it is not a fal quality or Thai voice benchmark. Isolated PostgreSQL checks migration/RLS/column privacy/concurrent claim/recovery/account isolation. Real AI output quality will be evaluated after the owner funds billing and deliberately starts a clip.
