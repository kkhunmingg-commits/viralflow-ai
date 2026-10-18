# Google Vids Pro — owner-selected file proof

Prepared 2026-10-14. Real-account status: **BLOCKED awaiting owner Google Cloud setup and OAuth consent**. Automated tests use transport fixtures, not Pro quota or real file access. This harness never generates videos, calls Gemini/fal/TikTok, or connects to Supabase.

## Existing integration reused

`GoogleVidsOmniProvider` remains Assisted. Existing router queues and production OAuth remain untouched. Local MP4 checks reuse `assertMp4`, `FFmpegVideoRenderer.probe`, and `DeterministicVideoQualityEvaluator`. A local filesystem import is not the database-backed `completeProviderImport` job/storage flow. Database job import remains NOT_TESTED until an isolated local database/job fixture is explicitly prepared; never point this experiment at Production to make it pass.

## Owner Google Cloud setup

Use an existing Google Cloud project you control. Do not edit the OAuth client used by Production. Create a dedicated **Web application OAuth client** for this local experiment in that project.

1. Enable **Google Drive API** and **Google Picker API**. Do not enable paid video services or change Billing.
2. Configure Google Auth Platform branding/audience. Keep the external app in **Testing**; add the owner's Google AI Pro account as a Test user. Request only `https://www.googleapis.com/auth/drive.file` in Data Access.
3. OAuth client Authorized JavaScript origin: `http://localhost:3020`.
4. OAuth client Authorized redirect URI: `http://localhost:3020/oauth/callback`. Exact URI, no trailing slash. This is independent of ViralFlow's existing Google/Supabase login callback.
5. Create a restricted Picker API key. Website referrers: `http://localhost:3020/*` and `https://docs.google.com/*` (Picker's iframe). Restrict APIs to Google Picker API and Google Drive API. OAuth client, key, and project number must belong to the same project.
6. Get the numeric **Project number**, not the project ID.

Store these **only in the local checkout's ignored `.env.google-vids-local`** (or temporary process environment). No `NEXT_PUBLIC_` variables, passwords, cookies or copied access tokens. Do not paste credentials into chat.

```dotenv
GOOGLE_VIDS_LOCAL_CLIENT_ID=
GOOGLE_VIDS_LOCAL_CLIENT_SECRET=
GOOGLE_VIDS_LOCAL_PICKER_KEY=
GOOGLE_VIDS_LOCAL_PROJECT_NUMBER=
```

The OAuth secret stays server-side. Official Picker requires the restricted key and `drive.file` access token temporarily in browser memory. They are not logged, displayed, placed in localStorage/sessionStorage, or included in a production client bundle. Refresh tokens are not requested or retained. Access tokens expire after at most one hour; shutting down the process clears them. Clearing local memory does not revoke the app grant in Google Account settings.

## Run and consent

From this checkout: `pnpm test:google-vids-local` (Node 24+, existing dependencies). Open `http://localhost:3020` in the browser with the owner's account. Do not screenshot DevTools/network responses or the OAuth callback address.

1. Owner clicks **เชื่อม Google**, selects the Pro account and approves Consent themselves. Stop at this point if permission/setup is missing.
2. Owner opens **เลือกโปรเจกต์เดิม** and selects exactly one existing Vids project. Picker filters `application/vnd.google-apps.vid`. There is no upload/create tab or automatic file enumeration.
3. Server fetches only the selected file's metadata and checks `capabilities.canDownload`. Raw account/file metadata is not written to artifacts.
4. Click **ดาวน์โหลดและตรวจคลิป** once. `files.download?mimeType=video/mp4` uses the selected file and token. Pending operations are polled with `operations.get`, bounded backoff and maximum 12 polls. Immediate completion is not polled. An unknown POST result is not re-submitted.
5. Content is downloaded only from approved Google HTTPS hosts. Unexpected hosts fail clearly, without falling back to cookies, hidden endpoints or arbitrary URLs. Do not add a host without checking the actual official response and ownership.
6. Original bytes are preserved under ignored `.video-cache/google-vids-drive-test/<run>/original.mp4`. A safe `result.json` records media properties/hash/request counts, no secrets, account names, raw IDs, resource keys or signed URLs.

No clip is silently shortened, padded, upscaled or regenerated for this proof. Existing factory quality evaluation may report RETRY (presented as REVIEW_REQUIRED) because actual creative context, visual assessment, Thai narration and compliance are not established. This must not be called final Quality PASS. Existing 10-second footage may pass the experiment's duration check while the existing factory's 8-second rule still requires review.

## Cost and proof boundaries

No new video-generation seconds or paid video requests are made. Record Drive metadata/download/poll/content request counts and MP4 bytes. Actual invoice cost and Pro quota remaining are NOT_VERIFIED until read-only account evidence exists. One ordinary file download should remain within normal no-charge Drive quotas; this is not a promise that all usage or future bulk downloads are free.

Google OAuth, Picker, Project Access and MP4 Download become PASS only after actual owner consent/file execution succeeds. Local tests alone do not change those statuses. Automatic Omni generation via Pro/Ultra remains **NOT_VERIFIED**.

## Official references checked 2026-10-14

- [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Picker setup and same-project requirement](https://developers.google.com/workspace/drive/picker/guides/web-picker-sample)
- [Download Vids as MP4](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
- [Long-running operations and resource keys](https://developers.google.com/workspace/drive/api/guides/long-running-operations)
- [Drive quotas/cost limits](https://developers.google.com/workspace/drive/api/guides/limits)

## Local verification

Run `pnpm test scripts/google-vids-local/drive.test.ts src/features/video-provider/router.test.ts`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`. Real-account results are pending; do not commit local env or downloaded owner videos.

Preparation checks on 2026-10-14: 140 related fixture tests passed, typecheck passed, lint passed with eight pre-existing warnings. Next/Turbopack build passed when invoked directly through Node with temporary nonfunctional local public config; no Production secrets or database were used. The bundled pnpm fallback initially could not launch the Turbopack subprocess correctly, and the isolated clone initially lacked required public app config. Neither failure was addressed by modifying app architecture. Local HTTP checks passed for the page, script, session/origin/host gates and missing-configuration block. Browser showed the setup page with no error/warning logs. None of these are real Google OAuth/Picker/download proofs.
