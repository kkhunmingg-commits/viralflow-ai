import type { ProviderSettings, ProviderSnapshot, RouteDecision, RouterJob } from "./contracts";
export function routeVideoJob(settings: ProviderSettings, job: RouterJob, snapshot: ProviderSnapshot, now = new Date()): RouteDecision {
  if (["COMPLETED", "REVIEW_REQUIRED", "FAILED"].includes(job.state)) return { action: "DONE", provider: job.provider, reason: "RESULT_ALREADY_EXISTS" };
  // An external handoff or lost submit response is never permission to buy a replacement.
  if (["EXTERNAL_PENDING", "SUBMITTING"].includes(job.submission) || job.state === "RECONCILIATION_REQUIRED") return { action: "RECONCILE", provider: job.provider, reason: "PREVIOUS_RESULT_UNKNOWN" };
  if (job.requestId && job.submission === "ACCEPTED") return { action: "POLL", provider: job.provider, reason: "RESUME_SAME_REQUEST" };
  if (job.nextRetryAt && Date.parse(job.nextRetryAt) > now.getTime()) return { action: "WAIT", provider: job.provider, reason: "BACKOFF", retryAt: job.nextRetryAt };
  if (["fal_ai", "gemini_omni_api"].includes(job.provider ?? "") && job.submission === "CONFIRMED_FAILED") return { action: "WAIT", provider: job.provider, reason: "PAID_RETRY_REQUIRES_NEW_OWNER_DECISION" };
  if (snapshot.productionMethod === "WAIT_FOR_EVIDENCE") return {action:"WAIT",provider:null,reason:"VERIFIED_CREATIVE_EVIDENCE_REQUIRED"};
  if (["REAL_FOOTAGE_EDIT","REAL_IMAGE_MOTION"].includes(snapshot.productionMethod??"")) return {action:"ASSIST",provider:"google_vids_omni",reason:"REAL_MEDIA_EDIT_ONLY_NO_GENERATIVE_PRODUCT"};
  // Existing paid adapters use product-ad prompts/references. Do not reuse them for a non-evidentiary atmosphere plan.
  if (snapshot.productionMethod === "GENERATIVE_ATMOSPHERE") return {action:"ASSIST",provider:"google_vids_omni",reason:"ATMOSPHERE_ASSISTED_TRANSPORT_ONLY"};
  if (settings.mode === "GEMINI_ONLY") {
    if (!settings.paidMode) return { action: "WAIT", provider: "gemini_omni_api", reason: "PAID_MODE_DISABLED" };
    if (snapshot.geminiAvailable) {
      const estimate = snapshot.geminiEstimateUsd;
      if (estimate == null || !Number.isFinite(estimate) || estimate <= 0 || estimate > settings.maxCostUsd || !snapshot.budgetAvailable)
        return { action: "WAIT", provider: "gemini_omni_api", reason: "BUDGET_OR_QUOTE_UNAVAILABLE" };
      return { action: "SUBMIT", provider: "gemini_omni_api", reason: "EXPLICIT_GEMINI_API_APPROVED" };
    }
    if (!settings.paidFallback) return { action: "WAIT", provider: "gemini_omni_api", reason: "GEMINI_UNAVAILABLE" };
    // Fallback is allowed before submission only. Unknown or failed requests above never buy a replacement.
  }
  if (settings.mode !== "FAL_ONLY" && settings.mode !== "GEMINI_ONLY") {
    if (snapshot.google.status === "READY" && snapshot.google.automated) return { action: "SUBMIT", provider: "google_vids_omni", reason: "GOOGLE_PRIMARY_READY" };
    if (snapshot.google.status === "ASSISTED" || (snapshot.google.status === "READY" && !snapshot.google.automated)) return { action: "ASSIST", provider: "google_vids_omni", reason: "GOOGLE_QUOTA_REQUIRES_USER_UI" };
    if (snapshot.google.status === "TRANSIENT_FAILURE" && job.retries < settings.retryLimit) {
      if (!settings.autoRecovery) return { action: "WAIT", provider: "google_vids_omni", reason: "RECOVERY_DISABLED" };
      return { action: "WAIT", provider: "google_vids_omni", reason: "BOUNDED_GOOGLE_RETRY", retryAt: new Date(now.getTime() + Math.min(60_000, 5000 * 2 ** job.retries)).toISOString() };
    }
    if (settings.mode === "GOOGLE_ONLY") return { action: "WAIT", provider: "google_vids_omni", reason: "GOOGLE_ONLY_NO_PAID_CALL" };
    if (!settings.paidFallback) return { action: "WAIT", provider: null, reason: "PAID_FALLBACK_DISABLED" };
  }
  if (!snapshot.falAvailable) return { action: "WAIT", provider: "fal_ai", reason: "FAL_UNAVAILABLE" };
  if (snapshot.estimateUsd === null || !Number.isFinite(snapshot.estimateUsd) || snapshot.estimateUsd<=0 || snapshot.estimateUsd > settings.maxCostUsd || !snapshot.budgetAvailable) return { action: "WAIT", provider: "fal_ai", reason: "BUDGET_OR_QUOTE_UNAVAILABLE" };
  return { action: "SUBMIT", provider: "fal_ai", reason: settings.mode === "FAL_ONLY" ? "EXPLICIT_FAL_ONLY" : "GOOGLE_UNAVAILABLE_PAID_FALLBACK_APPROVED" };
}
