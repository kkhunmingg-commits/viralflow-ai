# Auto Orchestration

The Phase 10 pipeline is checkpointed after safe steps:

`account readiness → effective mode → strategy/product → creative plan → video request → quality → compliance → originality → commerce → publish queue → analytics → learning → next controlled action`

Growth uses the Phase 9 category, hook, angle, CTA, and next-action output. Affiliate uses current commerce readiness, Product Radar, Product Assignment, Product Truth, and Phase 8 winner decisions. `SCALE`, `SCALE_HOOK`, `SCALE_ANGLE`, `SCALE_PRODUCT`, and `SCALE_CREATIVE` may propose one controlled variation only when originality, cost, and account capacity pass.

The scheduler uses deterministic round-robin fairness and hash-distributed publishing minutes. Overflow moves to `WAITING_FOR_SLOT`; it is never bunched into one second and does not use anti-detection timing.

Persistent entities:

- `auto_runs`: mutable run control and aggregate metrics
- `auto_run_steps`: append-only step history
- `auto_account_states`: mutable current state per account/run
- `auto_actions`: append-only bounded decisions and costs
- `auto_failures`: append-only classified errors
- `auto_checkpoints`: append-only recovery evidence

Observability records starts, completions, failures, actions, generation/rejection totals, spend, publish queue status, account blocks, provider errors, and step duration in safe JSON fields. Secrets, tokens, prompts containing credentials, and provider keys must never enter logs.
