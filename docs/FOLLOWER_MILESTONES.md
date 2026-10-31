# Follower Milestones

Follower milestones are configurable internal triggers. The example configuration is 100, 500, 1,000, and 5,000 followers. None is encoded as universal TikTok Shop eligibility.

When a threshold is crossed, Phase 9 appends a milestone and emits `RECHECK_COMMERCE`. The check must use authoritative Phase 7C creator-commerce facts:

- Shop authorization status
- Affiliate eligibility
- ecommerce permission
- cart permission
- product attachment permission
- region and account validity

Recheck status is `PENDING`, `READY`, `BLOCKED`, or `REAUTH_REQUIRED`. Only `READY` permits `TRANSITION_ELIGIBLE`; it does not perform the transition automatically.

Fixture I reaches 1,000 followers but remains `COMMERCE_RECHECK` because commerce facts are unavailable. Fixture J becomes eligible only because all authoritative facts pass. Fixture K has enough followers but remains blocked because authorization is revoked. Fixture L continues normal Growth publishing without Shop.
