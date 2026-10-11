# Manual posting fallback

Released independently from the production website baseline `3900b773358f5556a81d664c87ea0c49d38e4a5b`. No integration-branch merge, database migration, scheduler activation, TikTok scope/config/flag change or paid execution.

`/post` is authenticated and reachable from Home. Two truthful sources:
- Local MP4: stays in browser memory, preview and explicit rights/review acknowledgements required. ZIP contains video.mp4, caption.txt, package.json. User review is NOT an automated compliance PASS. No upload/provider/posting call. No persisted local media or keys.
- Existing owned master videos: authenticated RLS client, exact owner/account/product/script association, current quality/content/originality checks, MIME and SHA-256 checks, private Storage download. Latest checks must not predate media/script changes. Fal visual review must be PASS. Hidden accounts cannot download. No TikTok approval dependency; no TikTok adapter loaded.

ZIP packaging reuses the integration EXPORT format with browser-compatible Uint8Array (fixed entry names, CRC32, UTF-8, 50 MB media cap). The route never fetches a caller-controlled URL. Metadata is projected, without provider names, tokens, raw diagnostics or technical IDs. Server download is private/no-store.

Downloading is not publishing. No published metrics are invented. AI disclosure and manual TikTok publication remain the user's responsibility.

At pre-release inspection the remote DB had 0 master videos, 0 video media assets and 0 EXPORT outputs; SAFE scheduler mode was retained. The local-file path provides a usable alternative immediately. This release does not claim automated video generation is ready or enable paid generation.

Validation: package extraction/byte preservation, confirmation gating, media/caption limits, quality/content freshness, owner isolation/storage checks, authenticated route, no external calls; typecheck/lint/build; browser local-file download and empty-state desktop/mobile.

Release checks: 50 tests in 8 suites PASS; TypeScript PASS; lint 0 errors (8 pre-existing warnings); production build PASS using public frontend configuration only in temporary process env. Real authenticated browser local MP4 -> preview -> acknowledgements -> ZIP download PASS. Python zipfile CRC and byte-for-byte fixture comparison PASS. Local browser console errors 0. Responsive checks at 390px and 1440px had no horizontal overflow. Stored server positive/negative paths tested with fixtures; no remote ready videos existed, so no fabricated stored-video E2E claim.
