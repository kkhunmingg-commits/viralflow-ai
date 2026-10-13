# Viral intelligence: evidence before production

This upgrade extends the existing ViralFlow components on `codex/google-vids-fal-router`. It does not add infrastructure, a database schema, a video provider, or a second scheduler. The customer UI changes are local code and have **not been deployed**.

The new strategist is an inspectable, deterministic evidence/production rubric. It is not a newly trained model or a measured predictor of virality. Its scores describe suitability and evidence completeness; creative quality, factual accuracy and media rights still require human review.

## Reused components and connections

| Existing component | Change / boundary |
| --- | --- |
| Product Radar / Category Intelligence | Existing category observations can propose hypotheses. Product/category momentum proxies do not prove a current TikTok trend. Existing mock fixtures stay mock. |
| Growth Strategy / Account Brain | Existing account mode, opt-in, eligibility and account-specific history remain authoritative. No account ceiling, posting quota or scheduler policy is introduced. |
| Trend intelligence | `growth-manager/topics.ts` validates source, permitted use, provenance, capture time, account/region/audience fit and comparable metric windows. Missing evidence is `UNKNOWN`. |
| Authorized public discovery | `growth-manager/trend-source.ts` reads the fixed official Google Trends Thailand RSS. One bounded GET, no credentials, redirects, private endpoints, article/media fetching or scraping. Source instances cache for ten minutes. |
| Creative Brain | `creative/strategist.ts` proposes three eight-second concepts, production requirements, explicit reasons and a cost-evidence summary before production. `creative/intelligence.ts` combines trend and account learning inputs. |
| Existing persistence / UI | `generateEvidenceStrategyAction` → `generateEvidenceStrategyProject` → existing creative tables and `save_creative_generation`. No new persistence system. |
| Video Factory / Provider Router | A reviewed strategy is checked again at the source/execution boundary. Real-footage editing and real-image motion stay assisted, even when paid-provider flags are enabled. Atmosphere is also assisted until a compatible transport is verified. |
| Analytics / Learning | `analytics/creative-learning.ts` describes owner/account/mode-scoped real associations. No learned rule activates automatically. Missing attributed followers or sales does not become a success score. |

## What is real, unknown or simulated

- Google Trends RSS is a real, officially documented public export. Preserve [Google attribution](https://support.google.com/trends/answer/4365538?hl=en); [the export documentation](https://support.google.com/trends/answer/3076011?hl=en) includes RSS.
- Google search volume is approximate Google search interest. It is not TikTok views, an audience profile, a hook measurement, a growth rate or evidence that a clip will become viral.
- A current public source topic with unknown account fit can become an explicitly labeled experiment hypothesis. It does not become an account-applicable verified trend.
- Growth comparisons require comparable, equal, non-overlapping observation windows. Lifetime counters, arbitrary momentum scores and search indexes do not substitute for measured growth.
- Product images/uploads are discoverable in existing storage records, but upload presence does not confirm product identity, media rights or mechanism accuracy. The current read adapter marks these assets unreviewed and supplies no invented product facts.
- `readCreativeIntelligence` uses authenticated/RLS clients and owner/account-scoped reads of account permission, analytics, rendered masters, projects, scripts and angles. It checks the historical creative joins and does not attribute a hook edited after rendering to the old result.
- This adapter currently has no verified per-video follower attribution, retention or completion-rate data. Those fields remain `null`/`UNKNOWN`. Sales are usable only with the actual Affiliate entitlement and official Shop analytics source.
- Mock transport and synthetic observations exist in tests only. They are not live TikTok data, production RLS proof, human creative approval or evidence that a video will perform well.

## Latest local proof

Run: **2026-10-13 10:16:02 UTC** using the portable verifier and the owner-provided mop example as an **unverified reference**.

- Official Thailand RSS: `REAL_OBSERVATIONS`, ten source topics from one fixed GET.
- Account-applicable TikTok trend status: `UNKNOWN`; no account audience evidence was supplied.
- Paid generation calls: **0**. TikTok calls: **0**. Environment loading, database access, real account access and Production changes: **none**.
- Functional gates pass. **Human creative/factual/media review remains `PENDING` for every concept.**
- No video or speech was generated. The proposed eight-second timing has not been validated against a real voice track or final render.
- Artifacts are ignored local files: `.video-benchmark/viral-intelligence-20261013/manifest.json` and `CREATIVE_REVIEW.md`. The packet contains all six full scripts/storyboards and evidence requirements. No binary reference is committed.

### A. Complex spin-mop mechanism

The example clip's actual product identity, filming/generation origin, PDP, claims and media rights remain unverified. A filename or visually plausible demonstration is not proof of the product's mechanics. Failed generated clips are not product facts.

| Concept | Hook / proposed script | Eight-second storyboard | Intended production and evidence |
| --- | --- | --- | --- |
| Demonstrate one real movement — provisional selection | “จุดนี้ทำงานอย่างไร? ดูการทำงานจากวิดีโอจริง ดูรายละเอียดสินค้าก่อนตัดสินใจ” | 0–2s show the actual hand/pivot; 2–5s continuous real demonstration; 5–8s retain the observable result. | Edit permitted footage of the actual product; verify the hand, shaft and pivot. No generated mechanism. |
| Inspect the real product image | “ก่อนเลือก ดูส่วนนี้ก่อน สังเกตรายละเอียดจากภาพสินค้าจริง ดูรายละเอียดสินค้าก่อนตัดสินใจ” | 0–2s full real image labeled as still; 2–5s crop an existing detail; 5–8s return to the whole image. | Real image motion/editing. Do not present a pan/zoom as a functional demonstration. |
| Evidence-bound comparison | “เทียบให้เห็น ไม่ต้องเดา พิจารณาเฉพาะสิ่งที่เห็น อย่าเพิ่งสรุปผลที่ยังไม่ได้ทดสอบ ดูรายละเอียดสินค้าก่อนตัดสินใจ” | 0–2s name the comparison conditions; 2–5s real comparable footage; 5–8s state only the supported scope. | Actual same-condition comparison and approved factual evidence; no generated before/after or superiority claim. |

All three currently return `WAIT_FOR_EVIDENCE`. The provisional first concept follows the mechanism constraint; it is **not** an approved or production-ready winning ad. No actual Affiliate account or entitlement is asserted by this local scenario.

### B. Growth account without commerce

The current source topic selected for the local packet was **กัมบะโอซาก้า**. Selection follows source order as a discovery seed; it is not a calculated TikTok popularity ranking. Account audience, rights to team footage/logos and factual story evidence are unknown.

| Concept | Hook / proposed script | Eight-second storyboard | Current decision |
| --- | --- | --- | --- |
| POV/open question — provisional selection | “ถ้าเป็นคุณ จะสังเกตอะไร? ลองเสนอสิ่งที่อยากรู้ เป็นคำถามเพื่อทดลอง ไม่ใช่ข้อสรุป คอมเมนต์ประเด็นที่อยากรู้ต่อ” | 0–2s pose one exploratory question; 2–5s original illustrative atmosphere; 5–8s invite questions without a sales CTA. | `REVIEW_REQUIRED`, assisted atmosphere only. No product demonstration, real event reconstruction, team footage or testimonial. |
| One evidence-backed observation | “เรื่องนี้สังเกตจากอะไร? พิจารณาเฉพาะสิ่งที่เห็น อย่าเพิ่งสรุปผลที่ยังไม่ได้ทดสอบ ติดตามเพื่อดูเรื่องถัดไป” | 0–2s one question; 2–5s permitted visual plus a sourced fact; 5–8s explain its limit and invite following. | `WAIT_FOR_EVIDENCE`: sourced fact and permitted visual absent. |
| Short factual story | “เริ่มจากสิ่งที่เห็นจริง พิจารณาเฉพาะสิ่งที่เห็น อย่าเพิ่งสรุปผลที่ยังไม่ได้ทดสอบ บันทึกไว้ แล้วติดตามตอนต่อไป” | 0–2s supported observation; 2–5s one factual point; 5–8s name the unanswered question and invite saving. | `WAIT_FOR_EVIDENCE`: no factual story or cleared original material. |

The question concept ranks above the factual concepts because it does not require an invented factual claim or missing product footage. This is a production/evidence decision, not approval of its creative appeal or follower-growth potential.

## Cost boundary

Target: **no more than 5 THB per usable final clip**, including every paid attempt, failed clip, retry and charged stage. Verified actual costs are grouped by final output, so several charged stages do not count as several usable clips.

This run produced no clip and has no verified invoice, usable output or measured local/human production cost. Cost estimate, actual usable cost and target attainment remain **`UNKNOWN`**. The target has **not been demonstrated or achieved** by this proof. No assumption of free Google quota or zero total editing cost is used.

## Local use and human approval

1. Use a separately configured Local/isolated database, then open an existing Creative Studio project locally and choose **วางแนวคิดจากหลักฐาน**. Do not point this trial at the owner's Production database. The authenticated server action reads the public source, joins existing owner-scoped data and stores three draft concepts in existing tables. This run verifies the database adapters with in-memory clients; it does not claim an authenticated database/browser UI trial.
2. Inspect method, reasons, missing evidence, script and storyboard. Current raw catalog/uploads are unreviewed, so product concepts wait rather than silently treating them as proof.
3. Once trusted, reviewed factual/media records satisfy the evidence gate, a human must affirm creative quality, factual accuracy and media rights. The stored review is bound to owner, account/product, selected concept, plan fingerprint and script digest.
4. Selecting a draft does not grant production approval. Video Factory/provider execution rechecks the stored review; changing the script invalidates the approval.
5. Real footage and real image motion use editing instructions. Atmosphere handoff omits product identity and forbids its use as factual evidence. These paths stay Google Vids **Assisted**, with quota `UNKNOWN`; no paid fallback is purchased for them.
6. Existing accepted provider requests retain their original request ID on recovery; changing the strategy does not authorize buying a duplicate. Existing legacy provider and scheduler paths remain intact.

Real-account AUTO creative generation now uses this zero-provider planner through the existing service-role atomic save. It waits at the existing project for evidence/human review instead of skipping the item or generating duplicate drafts. A reviewed strategy waits for the existing assisted production route rather than falling through to legacy paid fal generation. Mock-account tests retain their explicit legacy fixture path. No scheduler, account capacity or posting quota is replaced.

No Google browser/session/cookie sharing or unsupported automation is enabled. Google Vids remains assisted; Gemini Omni API, WAN and fal.ai remain available existing alternatives under their original gates. This upgrade makes no paid-generation request and changes no Production flags.

## Reproduce the proof

The default run is offline and does not load `.env` files or use a database. Optional reference paths must be absolute local paths; the default is the ignored `benchmark-assets/owner-mechanism-reference.mp4`.

```powershell
pnpm --config.verify-deps-before-run=false exec tsx scripts/verify-viral-intelligence.ts
pnpm --config.verify-deps-before-run=false exec tsx scripts/verify-viral-intelligence.ts --live-trends --reference="C:/path/to/owner-reference.mp4"
```

Only the fixed, read-only public RSS request is permitted in live-source mode. Reference hashing establishes file identity, not factual/visual quality. Relevant unit/integration checks cover evidence filtering, conflicting analytics, missing metrics, cost accounting, review binding and no-spend provider routing; the final verification totals are recorded in the delivery report.

## Remaining real inputs / approvals

Owner direction review on **2026-10-13**: accepted the A/B approaches for further creative refinement, explicitly requiring evidence checks before production. This accepts the direction only; it does not approve every script, product claim, media right, paid generation or posting. Exact production reviews remain pending.

- The actual product/PDP and permitted media that accurately demonstrate its physical operation.
- Human evaluation of the six proposed concepts, script accuracy, rights, actual timing and visual output.
- Authorized real account outcome data and per-video attribution before recommending what to scale.
- Verified billing and usable-output review before claiming the 5 THB target.
- Any permission or supported integration needed to move Google Vids beyond assisted mode; no shared subscription/session entitlement is assumed.

No Production deployment, database mutation/migration, TikTok posting, paid generation or alteration of the three existing selling accounts occurs in this proof.

## Verification on 2026-10-13

- Relevant regression suite: **476 passed, 1 skipped** (48 files; the skipped test requires a separate database environment).
- Full `tsc --noEmit`: passed. Full lint: **0 errors, 9 pre-existing warnings** including the ignored earlier benchmark script.
- Local optimized production build: passed with process-only fake Supabase public settings and paid/posting disabled; no `.env.local` edit or deployment.
- Live fixed public RSS proof: **10 actual observations**, account applicability `UNKNOWN`, six draft concepts, human review **PENDING**, paid generation/TikTok calls **0**.
- Mock/in-memory tests prove contracts, isolation, no-spend routing and recovery only. They do not certify creative appeal, product correctness, virality, live RLS, actual account permissions, a finished clip, or the 5 THB target.
- Reviewed product/PDP/rights ingestion is still missing from existing records: uploads remain unverified and the live reader supplies no approved claims. This is a real production blocker, not a successful evidence integration claim.
