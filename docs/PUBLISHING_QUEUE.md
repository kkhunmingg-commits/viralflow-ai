# Publishing Queue

The queue is server-managed and owner-isolated. Browser roles can read only their own rows through RLS; they cannot forge queue transitions, consent, attempts, or provider events.

## State model

`DRAFT → REVIEW_REQUIRED → APPROVED → QUEUED → UPLOADING → PROCESSING`

Terminal or controlled side states are `DRAFT_DELIVERED`, `PUBLISHED`, `WAITING_FOR_SLOT`, `RETRYING`, `FAILED`, `CANCELLED`, and `REJECTED`. Status history and consents are append-only ledgers; an attempt row changes only from `STARTED` to its single terminal result. Every queue request has a stable owner-scoped idempotency key; every provider attempt has a deterministic attempt key.

## Consent

Approval stores an immutable SHA-256 snapshot of caption, privacy, comment/duet/stitch choices, commercial-content toggles, and AIGC disclosure. Changing any setting invalidates the snapshot and prevents sending. There is no automatic approval and no silent publish.

## Capacity and overflow

Available slots are calculated as `effective_publish_cap - posts_today - reserved_today`. No value such as 15 or 20 is hardcoded as account capacity. Priority, creation time, and queue ID produce deterministic ordering. Items beyond capacity become `WAITING_FOR_SLOT` and receive a deterministic next-day time; they never bypass Phase 6C or consent.

## Retry and status

Retry is capped by `max_retries` and uses deterministic 60, 300, and 900 second delays only for transient network, rate-limit, or server errors. Terminal policy, permission, consent, and validation failures are not retried. Polling and webhooks map TikTok provider status into the local ledger idempotently.
