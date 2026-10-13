# Self-learning creative intelligence

Status on 2026-10-13: local implementation and synthetic scenario validation.
The owner deferred configuring the text LLM key. **No real LLM creativity trial,
audience-learning trial, paid video generation or TikTok posting was performed.**
No Production deployment, migration or customer-account access is part of this change.

## Existing workflow, extended

Product Radar / Category Intelligence / Adaptive Planner
→ existing assignment and Creative Project
→ authorized trend + same-account performance reads
→ real LLM creative reasoning
→ evidence/production gates
→ adaptive experiment selection
→ existing creative save RPC + automatic script selection
→ factual/media review
→ existing Video Factory, provider router and publishing consent gates.

The ordinary real-account creative path now requires the configured LLM. Missing
configuration parks AUTO at `WAITING_FOR_PROVIDER`; it cannot substitute template
copy or count a mock as a real creative result. Mock remains explicit for isolated
test accounts. Existing deterministic planning is retained as an evidence
diagnostic, not the new production creative decision maker.

## What the LLM decides

Through the existing OpenAI Responses adapter, a strict task schema asks for at
least three freely invented ideas, the topic, hook, spoken Thai script, storyboard,
format, semantic hook pattern/angle, proposed production method, cited evidence,
selection and explanation. It does not ask the owner to choose, ask for viral
probability or use model self-ratings to rank creativity. Semantic feature labels
are retained when deliberately repeating a prior pattern; new labels remain valid.

The adapter uses server credentials only, `store:false`, a request timeout, an
output-token bound and no automatic repair/retry. The existing project's conditional
`GENERATING` claim precedes text spending. Usage must be reported; unknown prices
cannot be treated as free. Token-based USD estimates are not actual billing.
An interrupted/failed text generation is held for review rather than bought again
automatically; this prevents duplicate spending but is not automatic recovery of a
lost provider response.

Configuration for a later authorized text trial: `CREATIVE_AI_PROVIDER=openai`,
`OPENAI_API_KEY` and a supported `CREATIVE_AI_MODEL` in server runtime only. Do not
put keys in public variables or source. This does not enable paid video execution.

## What remains rules

- Scope, authorization, freshness, deduplication and reliable evidence checks.
- Product identity, rights, claim and policy gates; complex operation requires real
  reviewed footage. Generated atmosphere cannot prove product functionality.
- Bounded exploration/exploitation, statistical evidence thresholds and recency
  decay. These are learning safeguards, not creative scores or posting quotas.
- Scheduler capacity, budget, health, platform limits and publication consent.
- Factual/media/quality review before production. AI selection is not approval.

The contextual experiment selector uses semantic hook, angle, topic and production
method arms per owner/account/mode/product context. Its default evidence threshold
is six distinct videos spanning three days and three effective decayed samples;
these values can be configured and never determine the required number of posts.
The comparison window is actual post-publication exposure, normally 24±1 hours.
Unknown publication timestamps and older cumulative counters do not masquerade as
comparable 24-hour results. Weighted medians and decay avoid changing a preference
because of one outlier, and allow recent evidence to reverse an old preference.
New and weak patterns remain eligible for exploration. Existing growth allocation,
pattern learning and single-axis experiment helpers are reused.

Growth uses attributed followers when genuinely available; otherwise this adapter
explicitly names an **engagement proxy objective**. It does not infer video followers
from account deltas. Affiliate ROI requires verified per-video commerce and actual
costs. Missing commerce, retention and attribution stay UNKNOWN. No learned policy
rule is activated by these proposals and no causal/viral guarantee is made.

## Trends and attribution

- Google Search: existing official Thailand RSS; observations/hypotheses, not TikTok
  audience, views or proof of virality.
- TikTok population trends: normalized permitted Creative Center reports or a
  separately authorized Business integration reader. No reader/grant is configured
  in this repo, so this source is UNKNOWN. Login Kit/video scopes do not authorize
  a global trend source. No private endpoint or scraping is added.
- Own-account performance: authorized official snapshots with immutable creative
  provenance. It never becomes a population-wide trend.

The coordinator binds a report to one account and source domain, refreshes its
candidate fingerprint, bounds reads and fails with UNKNOWN when a source is absent.

Hook/angle/topic/format/method and experimental choice are stored in existing
generation/angle JSON, with canonical hashes tied to the script/plan. Edited scripts
or mismatched attribution are excluded; historical copy is not reconstructed after
an edit. Duplicate observations of one video remain one sample. Proposal identity
is stable across restarts. Current source reads are bounded to the latest 200
snapshots in 30 days, so absent/partial coverage is not total account performance.

All actual production attempts (including rejects, retries and failed generations
before switching methods) count toward usable-clip cost. The 5 THB goal is not met
until actual bills and accepted-output counts establish it. This change makes no
claim that local editing or any provider is free.

## Evidence of local behavior

Tests explicitly label synthetic model responses and observations SIMULATED_ONLY.
They cover cold start, missing data, automatic choice, scope/source isolation, one
outlier, sustained results, recency reversal, new and previously weak patterns,
verified-vs-unknown Affiliate ROI, real exposure-window comparability, immutable
attribution, duplicate/restart protection, missing LLM configuration, consent,
conditional generation claim, saving selection and the unchanged paid-video gate.
They prove orchestration and learning logic, **not human creative quality or real
audience learning**. Test files are retained as reproducible local evidence.

Final local verification: 295 relevant tests passed, one opt-in database integration
test was skipped; TypeScript and optimized app build passed. Repository lint had
zero errors and nine pre-existing warnings outside these changes; changed-file
lint passed. No SQL migration was introduced or applied by this change.

## Required before a real Pilot

1. Configure/authorize the server text LLM and evaluate actual ideas/scripts.
2. Confirm the participating account's one-time automation consent and actual
   analytics permissions, without enrolling other sales accounts.
3. Supply reviewed product/claim/media evidence for Affiliate; no existing catalog
   image is automatically treated as a rights-cleared product proof.
4. Collect genuine comparable-window video metrics tied to immutable creatives.
   Per-video followers, retention and Shop sales need their actual permitted source.
5. Approve the existing assisted production/manual-public-posting or official
   publishing path, and separately authorize any paid video budget.

Omni, Google Vids Assisted, WAN/fal and Gemini provider/router paths are retained.
This work does not turn assisted creation or unapproved TikTok posting into Full Auto.

## Primary documentation checked

- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
- [Configured nano model pricing](https://developers.openai.com/api/docs/models/gpt-5.4-nano)
- [TikTok Creative Center trends](https://ads.tiktok.com/resources/help/article/how-to-use-trends?lang=en)
- [TikTok Business discovery documentation](https://business-api.tiktok.com/portal/docs?id=1825119032526849)
- [Official TikTok Business SDK](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/CreativeManagementApi.md)
- [TikTok Display API](https://developers.tiktok.com/docs/en/display-api-get-started)
- [TikTok Research eligibility](https://developers.tiktok.com/docs/en/research-api-faq)
