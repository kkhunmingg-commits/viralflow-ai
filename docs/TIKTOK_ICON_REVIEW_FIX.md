# TikTok App Icon review correction — 2026-10-16

## Verified production target before editing

- Website: https://viralflow-ai-blond.vercel.app/
- Vercel team/project: luckzazero-5815s-projects / viralflow-ai.
- Project ID: prj_8ydS6Gl7lQN3sdtHPa4tMlzCM1lC.
- Production deployment observed in the logged-in Vercel dashboard: viralflow-39g4ipuj6-luckzazero-5815s-projects.vercel.app; deployment details HgFkZUvB6RVS7HyagvHGV5XytPZC.
- Production source: codex/content-generation-export at 35713835000696556d18e063566c29af14d91fcb. The earlier codex/tiktok-review-website branch is not the current Production baseline.
- Anonymous public HTTP: homepage, Privacy, Terms, Reviewer Guide all 200, no redirects. Homepage used a CSS V. favicon.ico, icon.png and apple-icon.png were 404.

## Original artwork verification

The current Basic Info icon was read from the existing TikTok app, without changing its configuration. Its downloaded PNG and the owner-provided ViralFlow_AI_icon_1024x1024.png are byte-identical: SHA-256 c50a95595c7ca1e2591cbd2b32ae6b7f7424c0b7ce9ad8b8b82c8001ef625cc9. The unmodified source is public/brand/viral-flow-ai-app-icon.png. All six favicon sizes retain the same resized source pixels (opaque alpha added for ICO compatibility).

## Scope

Branding only: reuse the owner's exact VF original, replace the CSS V marks in homepage, public-document header, login and sidebar, add favicon/PNG/Apple assets and app-name/icon metadata. No OAuth, scopes, secrets, redirects, database, posting or LIVE changes.

## Completed local verification

- Relevant public website and anonymous-route tests: 2 files, 10 tests passed.
- Standalone TypeScript check passed. Lint: 0 errors; 8 pre-existing warnings in unrelated video benchmark/test files.
- Next production build passed. Build/start used nonfunctional local public auth settings, not Production credentials; no database or API integration was exercised.
- Cookie-free HTTP requests: /, /privacy, /terms, /review-guide, /login and all original/derived icon assets returned 200 without redirects. The served original hash matches Basic Info.
- Browser navigation: homepage -> Privacy -> Terms -> Reviewer Guide passed; VF image loaded on every checked page.
- Desktop (1280px) and mobile (390px) homepage visually checked: correct VF, no horizontal overflow, no captured console errors. Icon links include the version query and Next content hash to avoid old icon URLs.
- Screenshots and HTTP evidence are local ignored artifacts, not deployed content.
- These checks used a fresh local origin and cookie-free HTTP, not a claimed Incognito Production test. Production browser/private-window checks remain pending deployment approval.

## Deployment approval gate

This branch must not be deployed to Production until the owner explicitly approves. A successful local build/preview is not Production verification. Before deploying, recheck that Production has not changed from the baseline; if it has, apply only this branding commit to the new verified Production baseline.

After owner approval, verify the actual production domain with anonymous requests and a clean browser session. Check all public pages, logo and icon image responses, exact artwork/source hash, browser-tab icon and navigation, desktop/mobile and console errors. Check the new content-versioned icon links rather than relying on an old pinned tab. Do not clear the owner's login cookies or purge unrelated caches. A fresh/private browser window avoids persistent favicon caches; old tabs may need to be closed and reopened.

## Owner TikTok Portal steps after successful Production verification

1. Open the existing app's Production / Basic Info and confirm the existing VF icon matches public/brand/viral-flow-ai-app-icon.png. Re-upload that exact original only if the Portal currently holds another image.
2. Keep Website URL https://viralflow-ai-blond.vercel.app/ and existing Privacy/Terms URLs. Do not change the OAuth callback, products, scopes or credentials.
3. Open the production homepage in a private window and confirm its VF header and browser icon match Basic Info.
4. Owner reviews the saved draft and submits only when satisfied. This change does not itself submit a TikTok review or guarantee approval.
