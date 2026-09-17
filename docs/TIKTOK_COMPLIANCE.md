# TikTok compliance and publish eligibility

Phase 6C adds a fail-closed evidence layer between an approved Video Factory output and any future publisher. It does not call TikTok, attach products, or publish content. Every publish candidate still requires an explicit owner approval; the database rejects `user_approval_required = false`.

## Content compliance

`runContentComplianceCheck` evaluates the selected Creative Brain script and inherited risk metadata against approved product facts and account capability. It records separate claim, product-truth, AIGC, policy, and overall statuses.

| Check | PASS | REVIEW | REJECT |
|---|---|---|---|
| Product truth | Claims are supported by stored product facts | Scarcity or superlatives need evidence | Unsupported medical, guaranteed result/earnings, fabricated review, or misleading before/after claim |
| CTA | CTA matches mode and capability | Growth content uses an Affiliate-style CTA | Cart/affiliate CTA is used when that capability is unavailable |
| Creative risk | Inherited `SAFE` | Inherited `REVIEW` | Inherited `REJECT` |

The policy matcher reuses Creative Brain risk detection and adds structured issue codes. A check does not certify legal or platform compliance; it determines whether ViralFlow may advance the candidate.

## AIGC and provenance

Each check stores:

- `ai_generated`
- `ai_modified`
- `disclosure_recommended`
- `disclosure_required_if_provider_or_platform_indicates`
- `provenance_available`
- `provider`

ViralFlow never strips, suppresses, or bypasses a provider or platform AI label. AI-generated or AI-modified media receives `DISCLOSE`; a future publisher must honor authoritative provider/platform requirements.

Growth content may use follow, save, comment, share, and other engagement CTAs. It may not claim a cart, shop, discount, or Affiliate capability that the account or approved product facts do not support. Accounts with fewer than 1,000 followers or without ecommerce/cart permission remain `GROWTH` when their requested mode is `AUTO`; missing shop capability does not block safe Growth publishing.

## Account publish health

`calculateAccountPublishHealth` produces `READY`, `LIMITED`, `PAUSED`, `BLOCKED`, or `DISCONNECTED` from local account state. Phase 6C does not claim that this local state is authoritative TikTok state. Future approved adapters may refresh creator info and shop health.

The effective cap is:

```text
EffectivePublishCap = max(0, min(
  user daily target,
  configured account hard limit,
  observed platform cap or 20,
  internal safety limit or 10
))
```

Generation capacity remains independent from publish capacity. A campaign may generate 200 candidates while only the effective account capacity proceeds. `queueOverflowContent` and the live eligibility gate mark excess candidates `QUEUED_NEXT_DAY`; neither raises nor bypasses a cap. Used slots and failures come from the current account daily-stat row rather than a hardcoded value. Paused, disconnected, inactive, or repeatedly failing accounts cannot advance.

## Publish eligibility

`evaluatePublishEligibility` combines compliance, originality, Video Factory quality, account health, creator limit, shop permission, and owner approval.

| Final status | Meaning |
|---|---|
| `READY_FOR_REVIEW` | Every automated gate passed; owner approval is still required |
| `READY_TO_PUBLISH` | Gates passed and owner explicitly approved; no publishing occurs in Phase 6C |
| `QUEUED_NEXT_DAY` | Automated gates passed, but the effective daily publish cap has no remaining slot |
| `HOLD` | Evidence or capability needs review |
| `REGENERATE` | Quality failed or the candidate is too similar |
| `REJECT` | Prohibited compliance result or exact duplicate |
| `ACCOUNT_BLOCKED` | Account is blocked or disconnected |

No successful gate invokes TikTok. Phase 6C only records evidence for a future approved publisher.

## Persistence and security

`content_compliance_checks`, `originality_checks`, and `publish_eligibility_checks` are append-only evidence tables. Authenticated users can select and insert only their own rows; update/delete grants are absent. `account_publish_health` is an owner-scoped mutable cache. Composite owner/account foreign keys prevent forged cross-owner account IDs. Anonymous access has no grants, and RLS is enabled on all four tables.
