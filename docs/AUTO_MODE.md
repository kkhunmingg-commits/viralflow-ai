# Full Auto Mode

Version: `full-auto-mode-v1`. Phase 10 coordinates existing Product Radar, assignment, Creative Brain, Video Factory, compliance, originality, publishing, analytics, and Growth learning. It does not replace their scoring models.

## States and controls

Runs support `IDLE`, `STARTING`, `RUNNING`, `PAUSED`, `WAITING_FOR_DATA`, `WAITING_FOR_APPROVAL`, `WAITING_FOR_SLOT`, `WAITING_FOR_PROVIDER`, `RETRY_PENDING`, `BLOCKED`, `COMPLETED`, `FAILED`, and `STOPPED`. `START`, `PAUSE`, `RESUME`, and `STOP` are idempotent. A partial unique index permits one active run per owner; stable keys prevent duplicate runs, steps, actions, generation requests, and publishing requests.

Production behavior remains approval-aware. Auto Mode may prepare work up to `READY_FOR_PUBLISH` or `WAITING_FOR_APPROVAL`, but consent remains a mandatory gate. Real TikTok publishing, paid providers, and production deployment remain disabled.

## Account planning

`GROWTH` consumes the Phase 9 strategy and does not require Shop. `AFFILIATE` requires authoritative commerce readiness. `AUTO` resolves dynamically and falls back to Growth when commerce evidence is incomplete. Generation capacity is separate from publish capacity.

Budgets are checked before generation at per-video, run, account, provider, daily, and monthly levels. Any exceeded limit fails closed. A missing executable provider becomes `WAITING_FOR_PROVIDER`; no generated video is fabricated.

Every publish candidate must pass Quality, Compliance, Product Truth for Affiliate, AIGC, Originality, cross-account duplication, Account Health, Commerce for Affiliate, Publish Cap, and Consent.

## Simulations

The deterministic 10-account day mixes Growth, Affiliate, AUTO, commerce-blocked, provider-unavailable, publish-limited, approval-waiting, stale-analytics, and account-blocked states. The three-account pilot plans 60 candidates as 3 reusable masters plus 57 controlled variations, with five publish slots per account, zero external calls, and zero paid-provider cost.
