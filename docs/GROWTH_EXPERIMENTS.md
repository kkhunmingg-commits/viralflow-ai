# Growth Experiments

Controlled experiments change one meaningful axis where practical while preserving topic/product and intent. Supported axes are category, hook, angle, opening, scene, CTA, voice style, template, variation type, and publish timing.

Default allocation is configurable per account through `exploit_ratio`; the database permits 50–95% exploitation. Exploration receives the remainder. The engine never permanently locks an account to one category.

Each experiment stores hypothesis, control, variant, changed axis, lifecycle, timing, and a stable idempotency key. `originality_required` is always true. Re-running the same proposal returns the same logical experiment and cannot create an accidental duplicate.

Results are append-only and can be `CONTROL_WINS`, `VARIANT_WINS`, `NO_DIFFERENCE`, or `INSUFFICIENT_DATA`. A result stores both scores, confidence, sample size, and evidence hash. Delayed analytics appends a new result rather than editing earlier evidence.

Growth recommendations allow follow, save, comment, and engagement prompts. Fake cart, fake discount, Affiliate CTA, and Shop claims remain blocked without authoritative commerce eligibility.
