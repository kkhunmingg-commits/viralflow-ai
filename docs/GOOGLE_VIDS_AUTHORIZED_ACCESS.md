# Google Vids authorized access boundary

Verified from official public documentation on **2026-10-13**. This is a research
record, not proof of this owner's entitlement, available quota, commercial rights
for a particular asset, successful generation, or permission to resell access.
No account was accessed, no session/cookie was extracted, and no generation or
paid request was made for this check.

## Decision for ViralFlow

Keep the existing `google_vids_omni` adapter **Assisted** and first in the current
AUTO route. Prepare the evidence-backed creative brief; the authorized Google
account holder creates/edits in Vids and exports the finished project to MP4.
Import into the existing Video Factory job and preserve its human/quality gates.
Do not advertise unattended Vids generation, unlimited customer access, or zero
total cost. Keep Gemini API and fal paid generation disabled for this upgrade.

## What the official sources establish

| Question | Finding | Official source |
| --- | --- | --- |
| Can Vids generate/edit short vertical clips? | The UI supports text/reference-image generation, uploaded-video editing and extension; portrait 9:16, 24 fps and 3–10-second creation are documented. An eligible account is still required. | [Vids generation help](https://support.google.com/docs/answer/16143507?hl=en) |
| Is a subscription a limitless pool? | The current availability table lists AI Pro: 500 video seconds/month; Ultra 5x: 2,500; Ultra 20x: 10,000. These are plan-specific published limits, not measured account quota. The generation help also describes a general clip-count limit; confirm the actual account UI when planning. Never hardcode these as permanent product/account limits. | [Vids feature availability](https://support.google.com/docs/answer/15609411?hl=en) |
| Is family quota multiplied per family member? | Generation help explicitly says Pro/Ultra family sharing uses a shared monthly limit. This does not establish a separate full allowance per member. | [Vids generation help](https://support.google.com/docs/answer/16143507?hl=en) |
| Can the final project leave Vids? | Google's help documents exporting/downloading the completed Vids project as MP4 and uploading to other channels the user owns/manages. | [Get started and sharing options](https://support.google.com/docs/answer/15082958?hl=en), [Publishing a finished Vids video](https://support.google.com/a/users/answer/15599399?hl=en) |
| Does Google document a Vids generation API? | No Vids generation/quota API was verified in the current Workspace developer catalog or the cited Vids help. Absence from the reviewed catalog is not proof that no future/private agreement exists. | [Workspace developer products](https://developers.google.com/workspace/products) |
| Is official MP4 retrieval possible? | Drive documents Vids-to-MP4 download using `files.download` and long-running operations. `files.export`/`exportLinks` are explicitly unsupported for Vids. This only retrieves an existing project; it does not create/generate one or expose a subscription-quota generation API. | [Drive export formats](https://developers.google.com/workspace/drive/api/guides/ref-export-formats), [files.download](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/download) |
| Is Gemini Omni API a documented alternative? | Yes: `gemini-omni-1.1-flash` through Interactions, including text/image/video inputs and video output. This is a separate API path, not a documented bridge to the account's Vids allowance. | [Gemini Omni API](https://ai.google.dev/gemini-api/docs/omni) |
| Does Pro/Ultra make Omni API generation free? | The API pricing page marks Omni free tier unavailable. Published standard pricing is $17.50/million video-output tokens and 5,792 tokens/second at 720p: **$0.81088 for 8 seconds of video output alone**, plus input/text output and applicable charges. No subscription-credit offset was established. | [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Where is API billing checked? | API paid access is tied to the API project's billing account/tier and, where applicable, positive prepaid balance. It must be checked separately; a Vids subscription screen is insufficient. This task does not activate or purchase API billing. | [Gemini API billing](https://ai.google.dev/gemini-api/docs/billing) |

## Family sharing and automation are separate permissions

Google One documents sharing eligible benefits with up to five family members.
The family joining rules require individual Google accounts, the same country as
the manager, one family group at a time, and limits on changing groups. These are
Google's family rules, not a ViralFlow account ceiling.
[Family sharing](https://support.google.com/googleone/answer/9004015?hl=en),
[Family joining requirements](https://support.google.com/families/answer/6317858?hl=en).

Google One Additional Terms, modified 2026-10-01, describe sharing selected benefits
through the family group and prohibit selling/transferring AI credits. This does
not itself decide every output-licensing question; it also does not authorize a
central Ultra account, credit resale, shared login/cookies, or unlimited customer
generation. Obtain explicit provider confirmation before considering any such
access arrangement. [Google One terms](https://one.google.com/terms-of-service).

Google's general terms restrict reverse engineering and automated access that
violates machine-readable instructions. They do not establish a blanket permission
for every extension or browser workflow. Before implementing any app/extension
generation integration, verify the exact intended flow, applicable product terms,
OAuth permissions, account security and provider authorization. Do not use hidden
generation endpoints, copy cookies, bypass sign-in/CAPTCHA, or assume that a
visible UI or family entitlement proves an authorized backend protocol.
[Google terms](https://policies.google.com/terms?hl=en).

The supplied PD Vids Lab screenshot is a third-party claim. It is not official
evidence of API availability, commercial resale permission, shared Ultra rights,
quota accounting, or a proven Full Auto integration. No PD app/session was accessed.

## Output-use caveat

The generation help contains a statement limiting generated images/videos to use
inside Vids, while the separate official sharing instructions document finished
project MP4 export. Use the documented finished-project export workflow; do not
infer an unrestricted right to extract/resell standalone generated assets or a
commercial permission for all media. If the intended advertising use or asset
license remains ambiguous, record `REVIEW_REQUIRED` and confirm with Google and the
asset rightsholder. No commercial licensing conclusion was fabricated in this task.
[Generation help](https://support.google.com/docs/answer/16143507?hl=en),
[Vids publishing guidance](https://support.google.com/a/users/answer/15599399?hl=en).

## Reused implementation and actual gaps

- `src/features/video-provider/google-vids.ts` already reports `automated=false`,
  `OWNER_REPORTED` health, unknown used/remaining quota and rejects API submit.
- `router.ts` already selects the Assisted handoff before paid fal in AUTO;
  `GOOGLE_ONLY` does not purchase a replacement. Gemini has its explicit paid mode.
- `contracts.ts` defaults paid consent/fallback off and budgets to zero.
- `service.ts`/`finalize.ts` already reuse durable jobs and imported MP4 provenance,
  marking Vids import owner-attested rather than a verified API response.
- A Google handoff with an unknown result must still be reconciled before a paid
  substitute. No new queue/provider/architecture is needed for this upgrade.
- Remaining gaps: actual account entitlement/quota verification, authorized
  unattended generation transport, genuine Vids output/Thai narration quality,
  evidence of commercial use rights as needed, and owner-reviewed usable cost.
  Drive download is a possible future OAuth-authorized retrieval improvement,
  **not implemented here** and not evidence of automatic generation.

## Cost and acceptance reporting

Show Vids account quota and unquoted subscription cost as **UNKNOWN**, not $0.
For a measured usable-cost report include attributable subscription allocation,
local editing/audio costs when applicable, generation retries and rejected outputs.
If no output passes human review, usable cost is undefined, not zero. A target of
5 THB/usable clip remains a target until real costs and accepted outputs establish
it. Neither unit tests nor a subscription/credit screenshot establish visual
fidelity, creativity, performance, unlimited access or an achieved usable cost.
