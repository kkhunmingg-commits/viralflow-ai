# Auto Recovery

The database is the durable source of truth. On process restart, the orchestrator loads the newest append-only checkpoint, current account state, and stable idempotency keys. Completed steps are not repeated; interrupted work resumes from the next safe boundary.

Failures are classified as `TRANSIENT`, `PERMISSION`, `BUDGET`, `PROVIDER`, `COMPLIANCE`, `ACCOUNT`, `PUBLISH`, `ANALYTICS`, or `UNKNOWN`. Network, timeout, and analytics failures may retry up to three times. Provider and publish failures may retry up to two times. Permission, budget, compliance, account, and unknown failures do not retry automatically. There is no infinite retry path.

Recovery behavior:

- application restart: load the highest checkpoint version
- network failure: bounded exponential retry state
- provider timeout: `RETRY_PENDING`, then `FAILED` after the provider limit
- expired token: fail closed with a reauthorization blocker
- interrupted publishing: reuse the existing publishing idempotency key and never create a second send
- delayed analytics: append evidence and update the next action without mutating historical evidence

`STOP` is terminal for the current run. `PAUSE` preserves checkpoints and `RESUME` continues without duplicating completed steps.
