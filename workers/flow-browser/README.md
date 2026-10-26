# ViralFlow Flow-to-Library — Browser Pilot

**Status: CODE PROTOTYPE; NOT real-Google verified, NOT deployed, NOT production approved.**
This optional worker does not touch TikTok, Gmail API, Flow private endpoints, or any paid video API. It operates the owner's authorized Chrome page only. Do not use it to evade Google usage limits, bypass CAPTCHA, distribute shared cookies or automate accounts without permission.

## Goal and existing integration

Existing ViralFlow already has Creative Brain, product data, `video_provider_jobs`, signed owner MP4 import and finalization, Video Factory review, and manual download/export. Do not replace any of them. This branch adds:
- **Export Flow Worker (.json)** on an existing Google-assisted provider job.
- One optional Playwright worker that uses that creative prompt to operate the **visible** Google Flow page (after selector calibration), downloads only a new MP4, and submits it back through the **existing authenticated ViralFlow upload form**.
- An idempotent local state record. If a generate click might have reached Google, it **never clicks Generate again automatically**, even after a browser crash. No Telegram or new database tables.

## Start a single owner-operated pilot

Prerequisites: Node 20+, Windows desktop or Linux with visible Chrome desktop, existing ViralFlow staging URL with valid `video_provider_jobs` migration, owner/admin login, a selected real creative project, `VIDEO_PROVIDER_ROUTER_ENABLED=true` in the staging server, Google Flow access on your own account. **Do not enable TikTok publishing.** Do not test on the three sales accounts.

1. Go to ViralFlow `/video-factory/providers`; in the original UI select a reviewed project, queue it, press **ทำงานต่อ**, then **ส่งงานให้ Flow Worker (.json)**. The export is based on the selected product + script. Save the JSON under `workers/flow-browser/workspace/queue/` (never commit it: its short-lived `imageUrl` is a signed URL).
2. Run `cd workers/flow-browser && npm install && npx playwright install chromium && npm test`.
3. Run `npm run login` and sign in interactively to Google Flow and ViralFlow in the same browser profile. Press Enter in the terminal. Never paste your Google password or cookies into ViralFlow.
4. Copy `selectors.example.json` to `selectors.json`. Run `node worker.mjs --inspect` with a visible screen / desktop and use Playwright's inspector to select the live selectors for **prompt**, **generate**, **resultCard** (one per completed video), **download** (inside that *new* result card). Also configure video selection / 9:16, new project and image input if relevant. The Google UI can change: public documentation does not publish durable selectors.
5. `npm run dry-run` to check the handoff. Only after inspecting selectors, run `npm run pilot`. One run processes at most one queued job. It does not schedule an entire day or post anything.
6. Confirm that the resulting `workspace/ready/<jobId>.mp4` is a **new** valid MP4 and the original provider job in ViralFlow now links to a video for review. Download/post by hand through the existing authorized ViralFlow workflow after reviewing truth, AI label, rights, and product details.

When the browser is not authenticated, a CAPTCHA or consent challenge appears, a download fails, or the output cannot be confirmed as **new**, the worker stops rather than bypassing a guard or resubmitting. Check `workspace/state/<jobId>.json`. `GENERATING`/`NEEDS_REVIEW` cannot be retried automatically. Look for the already generated result manually; do not reset state to `NEW` while a Google operation may exist. If the output is recovered manually, save it under `workspace/ready/<jobId>.mp4`, verify it, then explicitly set `state: "DOWNLOADED"` with `path` pointing there to **import only**, without a new generation.

The Chrome profile is in `workspace/chrome-profile`. Treat this folder as highly sensitive and protect the VPS/desktop account. Do not put it in Git, backup shares, logs or support tickets. A VPS needs a real, interactive login session initially (e.g. private virtual desktop); a background headless session is not a substitute for sign-in.

## What this does NOT establish

- It has not yet been exercised against a real owner Google account, Google Flow's current DOM, an output with paid subscriber credits, or a deployed ViralFlow staging site. Selector calibration and the first E2E test are outstanding. It is a **working integration prototype** only after those tests pass, not a guarantee that Google permits all automation.
- It does **not** establish quota eligibility, guaranteed 60 good clips/day, commercial rights for individual product media, unattended 24/7 uptime, or automatic creative publishing.
- The current Google-assisted backend is still named `google_vids_omni`; changing names is deliberately deferred to avoid breaking existing migrations and provider routing. The operator can choose **Flow** for its visible user interface, while paid API routing remains untouched.
- The browser's `imageInput` is optional and supports signed Supabase image links only. When no valid reference is attached, **do not generate a deceptive product demonstration**; generate an atmosphere/context clip, or stop for a corrected reference.
- A manually entered subscription cost still needs allocating over the number of usable outputs. Free/paid credits cannot be interpreted as zero total cost.
- Real TikTok Shop authorization and publishing are outside scope.

## Pilot acceptance

Record: source project ID, selected product and verified source media, generated prompt, browser login, Flow model selected, credits consumed, output duration/resolution, quality result, final video master ID, and successful download back from ViralFlow. The pass condition is at least **one real, owner-reviewed, usable MP4 imported into the correct existing job without invoking TikTok or a paid API**. If the UI fails, keep the existing manual Google import path live.
