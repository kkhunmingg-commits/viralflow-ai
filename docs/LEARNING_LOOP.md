# Learning Loop V1

Version: `learning-loop-v1`.

The loop observes outcomes and layers small, auditable adjustments onto Product, Category, Assignment, Creative, Video, and Publishing brains. It does not rewrite their source scores or migrations.

## Signals

Signals may target category, product, hook, angle, scene, CTA, template, provider, variation, or publish timing. Every key includes owner/account context. Each row stores effect `[-1,1]`, confidence, weight, sample size, observed time, and decay.

`decayed_effect = effect × 0.5 ^ (age_days / 14)`

`signal_weight = confidence × decay × min(1, sqrt(sample_size / 20))`

Combined effects are weighted means clamped to `[-1,1]`. A single outlier therefore cannot dominate. Applied adjustments are bounded:

`adjustment = clamp(effect × confidence × decay × 0.20, -0.25, +0.25)`

## Decisions and experiments

`SCALE` can produce `BOOST` or one controlled experiment. `WATCH` preserves or requests more evidence. `STOP` produces a bounded suppression. `INSUFFICIENT_DATA` never changes a brain.

An experiment changes one axis only: hook, scene, CTA, template, or publish timing. It preserves the product and source creative intent, uses a stable idempotency key, and always sets `originality_required = true` so Phase 6C still decides whether output can publish. Re-running the same proposal returns the same logical experiment.

Phase 8 records proposals and evidence only. It does not enable Auto Mode, call a real publishing endpoint, attach a real Shop product, or invoke a paid provider.
