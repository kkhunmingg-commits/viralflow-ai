# Creative Brain

Phase 5B turns an eligible daily product assignment into five structured concepts for an eight-second TikTok video. It stays separate from rendering and publishing: this phase creates, scores, reviews, and stores creative plans only.

## Architecture

The flow is:

1. `CREATE CREATIVE` receives an account/product pair from Recommendations, resolves its active daily assignment, and reuses the existing project when retried.
2. `buildCreativeContext()` selects only the assignment reason, account mode, product and category signals, affinity, commercial fields, confidence, and recent creative signals.
3. The configured `AIProvider` generates exactly five concepts. `MockAIProvider` is the development and test default; `OpenAIProvider` is an optional production adapter.
4. Zod validates the complete response. A failed schema or diversity check gets one repair attempt with the validation reason and the original context.
5. Deterministic rules score every concept and classify policy risk.
6. `save_creative_generation()` stores the generation audit record, five angles, and five scripts atomically, then moves the project to `READY`.

The project lifecycle is `DRAFT → GENERATING → READY → SELECTED`. Generation failures move the project to `FAILED`; a ready, selected, or failed project can be regenerated. Generation audit rows are append-only.

## Mode strategy

Growth mode emphasizes scroll stopping, curiosity, completion, shares, comments, saves, follow intent, and niche consistency. Its deterministic mock concepts use POV, must-have, problem/solution, demonstration, and comparison angles. CTAs ask viewers to follow, save, comment, share, or watch again; sales and commission are not the primary objective.

Affiliate mode emphasizes product clicks, CTR, purchase confidence, orders, GMV, commission economics, honest benefit demonstrations, and useful price comparisons. Its deterministic mock concepts use problem/solution, price shock, demonstration, comparison, and review/discovery. Cart, product-detail, specification, and current-price CTAs appear only where the supplied context supports them.

## Prompt and provider contract

The prompt version is `creative-brain-v1`. Prompt templates live in `src/features/creative/prompts.ts`; UI components do not contain model instructions.

`AIProvider.generate(prompt, repair)` returns raw provider data, an untrusted structured output, and input/output token counts. Business logic validates and scores the output independently of the provider. `CREATIVE_AI_PROVIDER=mock` requires no key and never makes a paid request. `CREATIVE_AI_PROVIDER=openai` requires `OPENAI_API_KEY`; `CREATIVE_AI_MODEL` defaults to the economical `gpt-5.4-nano`. The OpenAI adapter uses the Responses API, strict JSON Schema structured output, and `store: false`.

## Structured creative schema

Every response contains exactly five concepts. Each concept includes:

- one supported angle type: `PROMOTION`, `PRICE_SHOCK`, `PROBLEM_SOLUTION`, `MUST_HAVE`, `REVIEW_DISCOVERY`, `POV`, `DEMONSTRATION`, `COMPARISON`, or `URGENCY`;
- title, hook, core message, voice script, CTA, caption, hashtags, and visual strategy;
- timed overlay text between 0 and 8 seconds;
- three to five contiguous scenes that start at 0 and end at 8 seconds;
- bounded model signals for hook strength, novelty, and visual feasibility.

The voice script is limited to 180 characters, hook and CTA to 100 characters, caption to 300 characters, and every hashtag must begin with `#`. Empty hooks, invalid timing, gaps, scenes beyond eight seconds, malformed overlays, and incomplete five-concept results fail validation.

The default timeline is:

| Time | Purpose |
|---|---|
| 0–2 seconds | Hook and scroll stop |
| 2–5 seconds | Product, benefit, proof, or demonstration |
| 5–8 seconds | CTA or payoff |

## CreativeConceptScore

The score version is `creative-concept-v1`. The deterministic base score is:

```text
Base = 0.20 HookStrength
     + 0.20 ModeFit
     + 0.15 AccountProductFit
     + 0.10 CategoryFit
     + 0.10 Clarity
     + 0.10 EightSecondFeasibility
     + 0.08 VisualFeasibility
     + 0.07 CTAFit

CreativeConceptScore = clamp(Base - PolicyPenalty - DuplicationPenalty, 0, 100)
```

`CategoryFit` uses Category Momentum in Growth mode and Commercial Opportunity in Affiliate mode. Mode fit is 100 for a mode-appropriate CTA and 55 (Growth) or 50 (Affiliate) otherwise. CTA fit is 100 for an appropriate CTA and 60 (Growth) or 40 (Affiliate) otherwise. Clarity is 100 when the core message is at most 120 characters and 70 otherwise. Eight-second feasibility is 100 only when the scene plan covers 0 through 8 seconds. Model hook and visual signals are bounded by the Zod schema, while the remaining inputs come from deterministic context or rules.

Policy penalty is 100 for `REJECT`, 20 for `REVIEW`, and 0 for `SAFE`. Duplication penalty is `max(0, highestPriorSimilarity - 0.45) × 60`. Confidence is the geometric mean of product and category confidence: `sqrt(ProductConfidence × CategoryConfidence)`, clamped by their validated 0–1 source values and stored to four decimal places.

Novelty is enforced through the batch diversity gate rather than accepted as an AI self-score in the weighted total.

## Diversity

Concept similarity is Jaccard similarity over normalized tokens from angle type, hook, CTA, and scene visuals. A five-concept batch passes only when:

- maximum pair similarity is below `0.72`;
- at least 3 distinct angle types exist;
- at least 4 distinct hooks exist;
- at least 3 distinct CTAs exist;
- at least 4 distinct scene structures exist.

A failing batch is replaced once through the structured repair prompt. A second failure aborts persistence and records a failed generation.

## Risk checks

Risk classification runs after schema validation and does not rely on the provider's self-assessment.

- `REJECT`: unsupported medical or guaranteed outcome claims, guaranteed earnings, misleading before/after guarantees, or fabricated customer reviews.
- `REVIEW`: unsupported superlatives, absolute claims, or scarcity/urgency statements that do not appear in context.
- `SAFE`: no configured pattern is detected.

Rejected scripts are stored as `REJECTED` for audit but cannot be selected in the UI. These checks are a baseline product guardrail and can be expanded with platform policy services in a later authorized phase.

## Cost and audit history

Each `creative_generations` row stores provider, model, prompt version, input tokens, output tokens, estimated USD cost, raw response, validated output, status, error, and timestamp. The cost helper uses per-million-token rates:

```text
EstimatedCost = InputTokens / 1,000,000 × InputRate
              + OutputTokens / 1,000,000 × OutputRate
```

`gpt-5.4-nano` is configured at `$0.20` input and `$1.25` output per one million tokens. The deterministic mock rate is zero. Unknown future models report zero until an explicit audited rate is added, avoiding an invented cost.

## Mock fixtures and expected behavior

- Growth Beauty produces five engagement-oriented concepts with Growth CTAs and passes the diversity gate.
- Affiliate Home produces purchase-confidence, benefit, price, and cart/detail concepts.
- Affiliate Gadget includes demonstration and comparison structures with specification/product CTAs.
- A low-data product with a blocked assignment cannot create a Creative Project or start generation.

The mock provider is deterministic so tests and browser verification never consume paid API calls. Enabling the real provider later requires only environment configuration; no business rule or persistence code changes are required.

