# Viral Flow AI — Website review resubmission

This release changes public website content, documentation and exact public-route access only. It is based on production commit `ff85ee94f691facac9ed587f28f07e771d12efe0`; it does not integrate POST, AI LIVE or Compliance branches.

## Portal values — owner verifies, no configuration changes in this task

| Field | Value |
| --- | --- |
| Registered app / website name | Viral Flow AI |
| Website URL | https://viralflow-ai-blond.vercel.app/ |
| Privacy Policy URL | https://viralflow-ai-blond.vercel.app/privacy |
| Terms of Service URL | https://viralflow-ai-blond.vercel.app/terms |
| Web OAuth Redirect URI (keep as-is) | https://viralflow-ai-blond.vercel.app/auth/tiktok/callback |
| Public reviewer instructions | https://viralflow-ai-blond.vercel.app/review-guide |

- Confirm ownership for the website and legal URLs in **URL properties**. The existing verification file is retained unchanged and is explicitly public; compare its content with the Portal challenge before clicking Verify. Serving the file successfully is not proof that TikTok has verified ownership.
- Keep existing Login Kit / Content Posting API and existing `user.info.basic` / `video.publish` integration unchanged. Review the Portal's selected products/scopes for consistency; do not add draft upload or TikTok LIVE to this website submission.
- Confirm the app icon and name match the submitted demo and website.
- Provide a fresh recording on the production domain showing real login, TikTok authorization, account selection, video preparation, review/consent, private Sandbox posting and the final result. Do not use a mock UI or call upload completion publish completion.
- Put any working test-account credentials only in the private App Review fields, never here or on the public website. Verify the test account can log in before submission.

## Access limitation requiring owner attention

The owner confirmed `kkhunmingg@gmail.com` as the official public Support/Contact address. It is linked directly from the homepage and both legal documents.

The owner states that the project is currently primarily for personal use and is not selling memberships. The website states this truthfully. TikTok's App Review Guidelines disallow apps intended for private or personal use; this is a review-eligibility blocker separate from the three website feedback items. Do not disguise the purpose or invent a public membership offering to pass review.

In this baseline, the existing Sandbox test route is owner/account-allowlisted and there is no customer video submission button. The public reviewer guide does not claim otherwise. A generic reviewer login will not automatically gain access to another owner's TikTok account or this posting test. Do not bypass that authorization or enable public posting for review.

Before marking **READY TO RESUBMIT**, verify a supported reviewer access plan and the latest demo. If the complete UI flow is not available in the production baseline, report it as a blocker for owner decision; this website-only change does not implement a new posting flow.

## Mandatory checks

- Cookie-free `/`, `/privacy`, `/terms`, `/product-guide`, `/support`, `/review-guide` return HTTP 200 without redirects.
- Legal documents have the exact name in H1, metadata and service references.
- Header and footer legal links work; Login opens `/login` when unauthenticated.
- Contact destination is real and confirmed by the owner, including a private deletion-request channel. A working mail link does not prove that the inbox receives messages.
- Real UI screenshots contain no personal data and carry accurate captions; no fabricated job results.
- Desktop and mobile have no overflow and no console errors.
- Ownership status, reviewer credentials and demo consistency are verified, not inferred from a Ready deployment.

Official sources checked 9 October 2026:

- [App Review Guidelines](https://developers.tiktok.com/docs/en/app-review-guidelines)
- [Content Sharing Guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines)
- [Register Your App](https://developers.tiktok.com/docs/en/getting-started-create-an-app)
