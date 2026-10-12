# Real Growth Pilot — 12 October 2026

Baseline: `e2e67b23a37ec29eb30c993b658be0bce69cd72f`. This folder is an execution handoff and observed evidence, not a new planner or a claim of end-to-end success.

## Actual observations

- The authenticated ViralFlow Accounts page shows **one connected account, `luckzazero`**. The owner explicitly chose the existing connected account for this Pilot. No other account's private analytics were read. Its age, followers, health, statistics grants and public-posting eligibility have not been verified.
- TikTok Developer Portal shows **Production: In review**, with Login Kit and Content Posting API; selected scopes are `user.info.basic`, `video.publish`, `video.upload`. `user.info.stats` and `video.list` are absent from the reviewed scope list. No Portal setting was changed.
- [TikTok Creative Center](https://ads.tiktok.com/creative/creativeCenter/trends/hashtag?region=TH&period=7), Thailand / Last 7 days, exposes three hashtag rows publicly. Detailed analytics redirects to Login. These are observed aggregate signals, not account recommendations or follower-growth predictions.
- [Google Trends](https://trends.google.com/trending?geo=TH), Thailand / Past 24 hours, showed `ลิเวอร์พูล พบ แมนซิตี`: **200K+**, **1,000%**, **Active**, started approximately **20 hours** earlier; page update displayed **12/10/26 17:56**. These are bucketed Google search interest and growth against Google's baseline, **not TikTok views**. A CSV download could not be confirmed; no successful download is claimed. The official UI offers CSV and RSS; no private endpoint was used.
- Google Vids exposes **Create AI videos / Omni** after Login with the owner's selected Google account. This confirms UI access only; remaining quota, actual generation, Thai narration and MP4 import must be verified separately. No subscription upgrade or paid API was used.
- The existing Vid was renamed **Viral Flow AI — Growth Pilot 01 — บอลโค้ง**, set to **Portrait 9:16**, and Google showed **Saved to Drive**. The AI-video panel did not stay open through automation, so the owner was asked to open that panel manually. No Generate request was submitted and no MP4 exists from this attempt. Local screenshot proof is kept outside Git at `.video-cache/real-growth-pilot/google-vids-prepared.png`.

## Topic selected by the assistant

**ทำไมลูกฟุตบอลหมุนแล้วโค้ง?** — an original short science explainer related to the observed football-interest cluster. This is a hypothesis for a first experiment, not a claim that this precise topic is already trending on TikTok or will gain followers.

The factual statement is supported by [NASA: Bending a Soccer Ball](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/bending-a-soccer-ball/): spin changes airflow and produces an aerodynamic force that can deflect the ball. Use a generic unbranded ball and an illustrative animation. Do not use match footage, team logos, player likenesses, copyrighted music, or fabricate a real match event. Audience demographics, account-topic fit and follower conversion remain **UNKNOWN** until Pilot observations exist.

The visible Creative Center alternatives were a game/weapon hashtag, a Shop dance campaign, and an anime hashtag. They were not selected because rights, campaign timing, account fit and audience details were not established. No numeric topic scores were invented.

## First real clip: short owner handoff

1. Use the existing Google Vids document the owner opened. Choose **Portrait 9:16**, **Create AI videos → Create**, duration **8 seconds** if offered. Paste `first-clip-prompt.txt`. Generate **one** clip only using existing included quota; stop at any charge or upgrade prompt. Do not start fal fallback. This experiment size is not an architecture account/clip limit.
2. Insert the generated result into the Vid before closing the tab, preview the entire clip, then export/download MP4. If Thai narration is missing or incorrect, add a real Thai voice recording through the existing audio workflow; do not call a paid TTS service or claim narration passed without listening.
3. Return the actual MP4's local path. Reuse `FFmpegVideoRenderer.probe()` to check duration, dimensions, codecs and audio, and decode the video locally to detect broken media. Inspect actual frames and listen to the Thai speech. File validity alone is not visual, semantic or voice validation; unverified checks stay **REVIEW_REQUIRED**.
4. Use the existing local-only MP4 preparation/export component with **luckzazero only**. It requires playback, owner review and rights confirmation. Label AI-generated content as required. It performs no storage upload, paid generation or TikTok call. Do not mark a queue item PUBLISHED based on a local export or an owner report.
5. Public API posting is not verified while Production is In review. After explicit owner approval for this specific clip, use manual public posting in TikTok on luckzazero, confirm the active account, and record the resulting real post URL. Never turn SELF_ONLY Sandbox success into a claim of public-posting approval.
6. Collect permitted official observations for this account after posting; missing grants or unavailable data remain UNKNOWN. Do not attribute net account follower changes to an individual clip without attribution evidence. Reuse the existing planner once real, mature observations and allowed time windows are available; do not increase frequency from a single result.

## Official analytics permission steps — not performed

The local supported-grant catalog previously dropped `user.info.stats` from token exchange/refresh responses. This was corrected to preserve a genuine returned grant. OAuth requested scopes and Portal configuration are unchanged; this fix does not manufacture permission or make the Pilot's current grant known.

1. Review Display API scope availability in the existing TikTok app. `follower_count` requires [user.info.stats](https://developers.tiktok.com/docs/en/tiktok-api-v2-get-user-info); [List Videos](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-list) requires `video.list`.
2. Request the necessary products/scopes through TikTok's official review process when the owner permits it. Do not recall or alter the currently reviewed Production version in this task.
3. Once the app is permitted to request them, extend the existing OAuth request intentionally, reconnect only the selected Pilot through Login Kit, and let the owner grant consent on TikTok. The current OAuth helper requests basic/publish and optional upload only: repeatedly reconnecting without a scope change cannot grant stats/video.list.
4. Verify the returned grants server-side and match `open_id` to the same account. Keep tokens server-side. Then use the existing stats and analytics read adapters. Watch time, retention, completion and per-clip followers remain UNKNOWN unless an authorized source actually supplies them.

## Execution boundaries still open

- The existing Growth SQL is locally validated but not applied to Production. No Pilot allowlist was activated here. Respect the no-Production-DB instruction; a real persistent planning/analytics loop needs a separately authorized activation or an existing local isolated environment.
- Public trend observations in this handoff are not wired into the server's existing Shop/category topic ledger. Do not insert them as `tiktok_shop` or `TIKTOK_DISPLAY` evidence, or manufacture confidence/momentum. The current worker therefore must still wait when its authorized topic ledger is empty.
- Assisted Growth uses the existing local export path. The provider-job handoff/finalizer is product-ad oriented and requires a real product/reference image; do not fabricate a product record to make a non-product Growth clip pass it.
- No real MP4 quality result, public post, account statistics sync or full autonomous run has been demonstrated by merely preparing this folder.

No Production database/config/env/deployment changes, new infrastructure, paid request, or TikTok post are authorized by this handoff.

## References

- [Google Trends export / RSS and field meanings](https://support.google.com/trends/answer/3076011?hl=en)
- [Google Vids generation, portrait and duration controls](https://support.google.com/docs/answer/16143507)
- [TikTok Direct Post restrictions and consent](https://developers.tiktok.com/docs/en/content-sharing-guidelines)

Observed data is dated. Recheck sources before generation/posting if the Pilot resumes on a later day.

## Checks for this delivery

Continuation: the real Create panel and prompt textbox became visible through Google's command search. Keyboard control and clipboard input failed; the prompt was not successfully inserted and Generate was not submitted. The owner then instructed stopping browser retries and using one manual generation. The handoff now targets 8 seconds with shorter Thai narration. This is a manual quality experiment, not automatic Google Vids integration. No new engine, queue or infrastructure was added.

- Relevant existing Growth, provider-router, manual-export and TikTok tests: **162 passed** (including two new grant-preservation regressions). These are unit/integration checks, not proof that the real Pilot generated or published a clip.
- Typecheck passed; lint passed with **0 errors / 8 pre-existing warnings**.
- Build without configuration failed on missing public Supabase settings. An **offline build then passed** using temporary process-only public placeholders and `https://build-only.invalid`; those values were restored afterward. No env file was edited. This does not verify a live database or produce a deployable Production configuration.
- No Production deployment/database mutation, paid provider call or TikTok publish/upload call was performed. Other untracked installer work was left untouched.
