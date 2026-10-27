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
2. On Windows use the drive-D commands below for installation and every run. Dependencies, temporary files, browser binaries, sessions and downloads must stay on D.
3. Run the login command below and sign in interactively to Google Flow and ViralFlow. Press Enter in the terminal. Never paste your Google password or cookies into ViralFlow. If Google refuses an automated browser, use ordinary Chrome assisted mode below; do not transfer sessions or change automation flags to evade the refusal.
4. Copy `selectors.example.json` to `selectors.json`. Run the inspector using the drive-D wrapper and calibrate **prompt**, **generate**, **resultCard**, **download**, and **resultIdAttribute** (the stable, unique attribute on each result card). IDs must survive reordering/rerendering; indexes/counts are insufficient. Configure Flow to generate a single output. Missing/duplicate IDs or multiple new results stop the run. Also configure video selection / 9:16 and image input if relevant.
5. Run dry-run, then pilot only after calibration. An interactive owner must type `generate <jobId>` after reviewing the visible model, credits, settings and prompt, and `import <jobId>` after reviewing the MP4 and its Google provenance. One run processes at most one queued job. It does not schedule an entire day or post anything.
6. Confirm that the resulting `workspace/ready/<jobId>.mp4` is a **new** valid MP4 and the original provider job in ViralFlow now links to a video for review. Download/post by hand through the existing authorized ViralFlow workflow after reviewing truth, AI label, rights, and product details.

When the browser is not authenticated, a CAPTCHA or consent challenge appears, a download fails, or the output cannot be confirmed as **new**, the worker stops rather than bypassing a guard or resubmitting. Check `workspace/state/<jobId>.json`. `GENERATING`/`NEEDS_REVIEW` cannot be retried automatically. Look for the already generated result manually; do not reset state to `NEW` while a Google operation may exist. Recover a manually verified MP4 using `--recover-mp4 <jobId> <path-on-D>` below, then use `--import-only`. Recovery takes the same worker lock, records its hash, and does not overwrite an existing output. Import checks the recorded hash and never requires Google selectors or clicks Generate.

## Drive-D commands (Windows PowerShell)

Run from `D:\ViralFlowAI`. Every wrapper invocation configures its own process and children; no global settings on C are changed.

```powershell
.\scripts\dev-d.ps1 pnpm install --frozen-lockfile
.\scripts\dev-d.ps1 npm ci --prefix workers/flow-browser --ignore-scripts
.\scripts\dev-d.ps1 node workers/flow-browser/node_modules/playwright/cli.js install chromium
.\scripts\dev-d.ps1 node --test workers/flow-browser/core.test.mjs
.\scripts\dev-d.ps1 node --test workers/flow-browser/media.test.mjs
.\scripts\dev-d.ps1 node --test workers/flow-browser/portal.browser-test.mjs
$env:FLOW_PORTAL_URL='https://viralflow-ai-blond.vercel.app'
.\scripts\dev-d.ps1 node workers/flow-browser/worker.mjs --login
.\scripts\dev-d.ps1 node workers/flow-browser/worker.mjs --inspect
.\scripts\dev-d.ps1 node workers/flow-browser/worker.mjs --dry-run
.\scripts\dev-d.ps1 node workers/flow-browser/worker.mjs --preflight
.\scripts\dev-d.ps1 node workers/flow-browser/worker.mjs --once
```

If Google rejects the automated browser:

```powershell
.\scripts\flow-assisted-d.ps1
# Local testing uses the same D-only ordinary Chrome profile:
.\scripts\flow-assisted-d.ps1 -PortalUrl http://localhost:3000
```

This launches ordinary installed Chrome with a separate D-only profile and download directory, without automation/debugging flags. The owner operates both websites. Set Chrome's save dialog to `D:\ViralFlowAI\workers\flow-browser\workspace\manual-downloads`. In ViralFlow keep Google-only mode and paid features off, select an existing reviewed product/creative project, and obtain its Google brief. Use that brief and cleared reference media in Flow, review settings/credits, generate once, save the MP4 on D, and upload through the existing MP4 import form in the same ViralFlow job. Review the final video and download it from ViralFlow. This path needs no deployed worker-export button and uses no TikTok API.

For an exported JSON job already in `workspace/queue`, an MP4 can alternatively be recovered into local state:

```powershell
.\scripts\dev-d.ps1 node workers/flow-browser/worker.mjs --recover-mp4 <jobId> D:\path\verified.mp4
.\scripts\dev-d.ps1 node workers/flow-browser/worker.mjs --import-only
```

Type `recover <jobId>` only after checking the file belongs to that job and account. The worker now probes the actual video stream using the project's bundled FFprobe (or `FFPROBE_BINARY`), verifies a positive duration and 9:16 display dimensions, and records metadata with the checksum. A header-only or audio-only MP4 is rejected. This does not establish product truth, media rights, full decoding or quality; those still require the existing server validation and owner review. Failed files remain on D for inspection and never trigger another Generate automatically.

Before any Generate, the worker visits the authenticated original ViralFlow job and verifies that its existing MP4 import form is available. `--preflight` performs this check alone, without visiting Flow or spending credits. A portal that redirects to login, lacks the worker UI, or already contains an imported master cannot lead to a new Generate. `--import-only` does not require Flow selectors. Ordinary Chrome assisted mode still needs the owner to operate the websites when automated sign-in or the desktop UI tool is unavailable.

The media and browser tests use local synthetic fixtures only. Passing them is not evidence of a real Google video.

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
