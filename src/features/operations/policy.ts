export type RecoveryClass = "AUTO_RECOVERABLE" | "RECONCILIATION_REQUIRED" | "FINAL_FAILURE";
export type SubjectType = "PUBLISH" | "BUDGET" | "AUTO_RUN" | "GENERATION_JOB" | "WEBHOOK";
export type RecommendedAction = "WAIT" | "RECHECK_STATUS" | "MARK_CONFIRMED" | "MARK_FAILED" | "RELEASE_SAFE_RESERVATION" | "REQUEUE_SAFE_OPERATION" | "ACKNOWLEDGE";

export interface RecoveryDecision {
  classification: RecoveryClass;
  reasonCode: string;
  recommendedAction: RecommendedAction;
}

export function classifyPublish(input: {
  status: string; externalState: string; providerPublishId: string | null;
  leaseExpired: boolean; retryCount: number; maxRetries: number; stale: boolean;
}): RecoveryDecision | null {
  if (input.externalState === "SUBMITTED_UNKNOWN" || input.status === "WAITING_FOR_RECONCILIATION")
    return { classification: "RECONCILIATION_REQUIRED", reasonCode: "PUBLISH_SUBMISSION_UNKNOWN", recommendedAction: input.providerPublishId ? "RECHECK_STATUS" : "ACKNOWLEDGE" };
  if (input.externalState === "SUBMITTING" && input.leaseExpired)
    return { classification: "RECONCILIATION_REQUIRED", reasonCode: "PUBLISH_LEASE_EXPIRED_AFTER_SEND", recommendedAction: "ACKNOWLEDGE" };
  if (input.externalState === "RESERVING" && input.leaseExpired)
    return { classification: "AUTO_RECOVERABLE", reasonCode: "PUBLISH_LEASE_EXPIRED_BEFORE_SEND", recommendedAction: "REQUEUE_SAFE_OPERATION" };
  if (input.status === "RETRYING" && input.externalState === "FAILED_RETRYABLE" && !input.providerPublishId)
    return input.retryCount >= input.maxRetries
      ? { classification: "FINAL_FAILURE", reasonCode: "PUBLISH_RETRY_EXHAUSTED", recommendedAction: "ACKNOWLEDGE" }
      : { classification: "AUTO_RECOVERABLE", reasonCode: "PUBLISH_PRE_SEND_RETRYABLE", recommendedAction: "REQUEUE_SAFE_OPERATION" };
  if (input.status === "FAILED") return { classification: "FINAL_FAILURE", reasonCode: "PUBLISH_FAILED_FINAL", recommendedAction: "ACKNOWLEDGE" };
  if ((input.status === "PROCESSING" || input.status === "UPLOADING") && input.stale)
    return { classification: "RECONCILIATION_REQUIRED", reasonCode: "PUBLISH_PROCESSING_STALE", recommendedAction: input.providerPublishId ? "RECHECK_STATUS" : "ACKNOWLEDGE" };
  return null;
}

export function classifyBudget(input: {
  state: string; providerState: string; expired: boolean; providerRequestId: string | null;
}): RecoveryDecision | null {
  if (input.state !== "RESERVED") return null;
  if (input.providerState === "REQUEST_NOT_SENT" && input.expired)
    return { classification: "AUTO_RECOVERABLE", reasonCode: "BUDGET_EXPIRED_BEFORE_SEND", recommendedAction: "RELEASE_SAFE_RESERVATION" };
  if (input.providerState === "SUBMITTED_UNKNOWN" || (input.providerState === "SUBMITTING" && input.expired))
    return { classification: "RECONCILIATION_REQUIRED", reasonCode: "BUDGET_PROVIDER_OUTCOME_UNKNOWN", recommendedAction: "ACKNOWLEDGE" };
  if (input.providerState === "SUBMITTED" && input.expired)
    return { classification: "RECONCILIATION_REQUIRED", reasonCode: "BUDGET_PROVIDER_PENDING", recommendedAction: input.providerRequestId ? "RECHECK_STATUS" : "ACKNOWLEDGE" };
  return null;
}

export function classifyAutoRun(state: string, stale: boolean): RecoveryDecision | null {
  if (!stale) return null;
  if (["RUNNING", "STARTING", "RETRY_PENDING"].includes(state))
    return { classification: "RECONCILIATION_REQUIRED", reasonCode: "AUTO_RUN_STALE", recommendedAction: "ACKNOWLEDGE" };
  if (state === "FAILED") return { classification: "FINAL_FAILURE", reasonCode: "AUTO_RUN_FAILED", recommendedAction: "ACKNOWLEDGE" };
  return null;
}

export function classifyGenerationJob(input: { status: string; provider: string; stale: boolean; attempts: number; maxAttempts: number }): RecoveryDecision | null {
  if (input.status === "FAILED" || input.attempts >= input.maxAttempts && input.status === "RETRYING")
    return { classification: "FINAL_FAILURE", reasonCode: "GENERATION_JOB_FAILED_FINAL", recommendedAction: "ACKNOWLEDGE" };
  if (!input.stale) return null;
  if (input.status === "PROCESSING" || input.status === "RETRYING")
    return { classification: input.provider === "local" ? "AUTO_RECOVERABLE" : "RECONCILIATION_REQUIRED", reasonCode: "GENERATION_JOB_STALE", recommendedAction: "ACKNOWLEDGE" };
  return null;
}

export interface AlertMetric {
  reconciliation: number; deadLetter: number; providerFailures: number; publishFailures: number;
  schedulerAgeMinutes: number | null; staleAutoRuns: number; budgetBacklog: number; webhookFailures: number;
}

export function evaluateAlertRules(metrics: AlertMetric) {
  const rules: Array<{ code: string; severity: "WARN" | "CRITICAL"; active: boolean }> = [
    { code: "RECONCILIATION_BACKLOG", severity: "CRITICAL", active: metrics.reconciliation >= 5 },
    { code: "DEAD_LETTER_OPEN", severity: "WARN", active: metrics.deadLetter > 0 },
    { code: "PROVIDER_FAILURE_REPEAT", severity: "WARN", active: metrics.providerFailures >= 3 },
    { code: "PUBLISH_FAILURE_REPEAT", severity: "WARN", active: metrics.publishFailures >= 3 },
    { code: "SCHEDULER_NOT_RUNNING", severity: "CRITICAL", active: metrics.schedulerAgeMinutes === null || metrics.schedulerAgeMinutes > 15 },
    { code: "AUTO_RUN_STALE", severity: "WARN", active: metrics.staleAutoRuns > 0 },
    { code: "BUDGET_RESERVATION_BACKLOG", severity: "WARN", active: metrics.budgetBacklog >= 3 },
    { code: "WEBHOOK_FAILURE_SPIKE", severity: "WARN", active: metrics.webhookFailures >= 5 },
  ];
  return rules.filter((rule) => rule.active).map(({ code, severity }) => ({ code, severity }));
}
