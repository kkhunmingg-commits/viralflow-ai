# Gemini Omni API in the existing Video Factory

Checked against Google documentation on 2026-10-12. This integration is distinct from Google Vids Assisted. A successful local mock run is not proof of an actual paid generation, Thai narration quality, or production deployment.

## Official capability and contract

[Omni guide](https://ai.google.dev/gemini-api/docs/omni): `gemini-omni-1.1-flash` accepts text or image plus text and generates video with audio. Portrait output uses `response_format.aspect_ratio: "9:16"`; 720p is the default. Generated videos carry SynthID. English is evaluated; other languages, including Thai, still require actual output review. Safety filters must remain effective.

[Official Interactions reference](https://ai.google.dev/api/interactions-api) and [OpenAPI specification](https://ai.google.dev/static/api/interactions.openapi.json):

- Create: `POST https://generativelanguage.googleapis.com/v1beta/interactions`.
- Retrieve: `GET https://generativelanguage.googleapis.com/v1beta/interactions/{id}`.
- Server authentication: `x-goog-api-key`, never a client-visible key.
- `response_format.duration` is a Google-duration string, e.g. `"8s"`.
- Image input uses `{ type: "image", data: base64, mime_type: "image/jpeg" }` alongside text.
- REST video output belongs to a `model_output` step's video content, with MP4 MIME type and inline base64 data or URI. `output_video` is an SDK convenience field, not the REST contract.
- States include `in_progress`, `completed`, `failed`, `cancelled`, `requires_action`, and `incomplete`. Only a valid completed MP4 proceeds to quality review.
- Usage includes input/output modality token counts and separate thought-token totals. Missing or ambiguous usage must remain unknown, not zero.

[Background execution](https://ai.google.dev/gemini-api/docs/background-execution) and [retention](https://ai.google.dev/gemini-api/docs/interactions-overview): background execution returns an ID for retrieval and requires stored interactions. Paid-tier default retention is 55 days and can be configured in AI Studio. An ID must be durably saved before polling. Do not create a replacement generation when a submit result is ambiguous.

## Billing and an 8-second estimate

[Official pricing](https://ai.google.dev/gemini-api/docs/pricing) lists no free Omni API tier. Standard input costs $1.50 per million tokens, text output including thinking costs $9.00 per million, and video costs $17.50 per million. A 720p second uses 5,792 video tokens. Thus the **video component** of an 8-second clip is:

`8 × 5792 × 17.50 / 1000000 = $0.81088`

Input and text/thought output add to that amount. This is a published-rate estimate, not an actual invoice or a guarantee that every generation has the same bill. Usage-derived cost must be identified separately from a billing receipt.

[Gemini API billing](https://ai.google.dev/gemini-api/docs/billing) is configured for the API key's Google Cloud project through AI Studio. New accounts generally use Prepay, with a minimum $5 credit purchase; existing accounts may use Postpay. Prepay and usage reporting can lag, so an account balance is not an exact per-request cost cap. Google AI Pro/Vids access alone does not establish that this API project has paid billing enabled.

### Free Vids access and subscriber credits

[Google's 2026-09-23 Vids announcement](https://blog.google/products-and-platforms/products/workspace/gemini-omni-in-google-vids/) confirms that anyone with a Google or Workspace account can create Omni 1.1 videos in Google Vids at no cost; paid Google AI plans offer more access. ViralFlow keeps that Assisted option and does not require a paid API call to import an owner-generated MP4.

[Google's developer-benefits announcement](https://blog.google/innovation-and-ai/technology/developers-tools/gdp-premium-ai-pro-ultra/) lists $10/month in Cloud credits for AI Pro and $100/month for AI Ultra, activated through the Google Developer Program. It explicitly permits these credits toward Gemini API usage. Eligible activated credits can offset the API's gross charge, potentially making additional out-of-pocket spend $0 while credits remain. This does **not** make the published API rate zero or prove unlimited API generation. This owner's benefit activation, eligible billing project, balance, and final net charge have not been verified. No credit activation, purchase, or generation is performed by this change.

## ViralFlow safety and operation

The existing router retains three choices: Google Vids Assisted, official Gemini Omni API, and fal.ai. Defaults continue to prohibit automatic paid generation. Gemini submission requires the server gate, the owner's explicit paid permission, nonzero per-clip/day/month budgets, and an atomic reservation. The same logical operation must not buy duplicate work.

The implemented selection is `GEMINI_ONLY`; the owner must separately enable `paidMode`, while the server requires both `VIDEO_PROVIDER_ROUTER_ENABLED=true` and `GEMINI_OMNI_API_ENABLED=true`. Server credentials accept `GEMINI_API_KEY`, then `GOOGLE_API_KEY`, then the existing `GOOGLE_GENAI_API_KEY`. None is exposed to the client. Default mode remains `AUTO`, which preserves Google Vids Assisted. `paidFallback` permits fal only before any generation has been submitted, never as a replacement for an uncertain or failed paid request.

The application reserves a conservative amount around $1.91 for short text prompts (more when an image is supplied), rather than pretending $0.81088 covers every token. That reservation includes bounded output/input allowances and contingency; it is not a provider-enforced invoice cap. Usage cost stays separate from `actual_cost_usd`, and the hold remains reserved while billing is unknown. A detected estimate overrun disables further paid execution for that owner.

The additive Gemini migration installs its own service-only budget readiness marker. Gemini does not depend on the unrelated fal marker. Existing fal execution retains its previous fail-closed guard requirement: the selected environment must have its required `fal_budget_guard_version` available; that function is not supplied by the new Gemini migration.

An accepted request resumes by its stored interaction ID. Unknown submission outcome retains its reservation and requires reconciliation. Polling is bounded and backs off. Provider failures must not silently bypass content safety or enable paid fallback. No downloaded URL may be trusted solely because it appears in provider JSON: validate HTTPS host/path, prohibit redirects carrying credentials, cap size, and inspect the actual MP4.

Completed output enters the existing media/quality/compliance checks. Missing evidence, unsupported media, or unverifiable required visual/Thai-audio checks must remain `REVIEW_REQUIRED` or rejected. Successful creation never grants TikTok publishing permission.

Key presence and a read-only model metadata request establish configuration/access only. Billing status remains unknown unless the authenticated billing service or owner-confirmed AI Studio project plan provides evidence. Never generate a paid clip just to probe billing.

## Validation boundary

Local verification on 2026-10-12: 266 related tests passed across 24 files, including 32 mocked official-adapter cases. The actual application ledger was exercised against prepared SQL in isolated PostgreSQL/PGlite: 40 checks passed, including owner/cross-owner/anonymous permissions, budget contention and duplicate prevention. Typecheck passed; lint has no errors and 8 existing unrelated warnings. Optimized build uses temporary offline Supabase placeholders, so it is compilation evidence rather than Production runtime validation. No paid generation or TikTok calls were made.

- Local mock tests can verify request shape, state transitions, budgets, duplicate prevention, restart recovery, safe download rules, and quality handoff.
- No paid generation, real output quality, latency, or actual billing is certified by those tests.
- This task does not apply migrations to Production, change TikTok configuration, or deploy.
- Before a later authorized real trial, provide the server-only API key, confirm the correct API project's paid plan, apply any required migration in the authorized environment, and explicitly enable paid mode with a budget.

## Readiness evidence for this change

The read-only configuration probe found no configured Gemini API key in the local runtime. Model availability and billing therefore remain **UNKNOWN**; zero generation calls were made. Local transport and durable-state tests cover text/image request formation, paid permission and budget denial, restart recovery, no replacement after an unknown submit, bounded polling, and MP4 handoff. Isolated SQL validation passed **40 checks**, including the additive migration, private-column grants, owner isolation, concurrent budget reservations, and the actual `AtomicBudgetLedger` calling the prepared PostgreSQL functions. Its fixture contains 3 accounts and 21 jobs; paid and TikTok calls are both zero, and no remote migration was applied. Build/test counts and final status are recorded in the delivery report after the last repair and rerun.
