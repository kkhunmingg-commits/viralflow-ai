import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeOpsLog, redactOpsText } from "../../lib/ops/logger";
import { classifyAutoRun, classifyBudget, classifyGenerationJob, classifyPublish, evaluateAlertRules } from "./policy";

const migration = readFileSync("supabase/migrations/20260923150000_phase_11c_recovery_observability.sql", "utf8");

describe("Phase 11C recovery safety", () => {
  it("separates expired pre-send leases from uncertain external submissions", () => {
    expect(classifyPublish({ status: "UPLOADING", externalState: "RESERVING", providerPublishId: null, leaseExpired: true, retryCount: 0, maxRetries: 3, stale: true })?.classification).toBe("AUTO_RECOVERABLE");
    expect(classifyPublish({ status: "UPLOADING", externalState: "SUBMITTING", providerPublishId: null, leaseExpired: true, retryCount: 0, maxRetries: 3, stale: true })?.classification).toBe("RECONCILIATION_REQUIRED");
    expect(classifyPublish({ status: "WAITING_FOR_RECONCILIATION", externalState: "SUBMITTED_UNKNOWN", providerPublishId: null, leaseExpired: false, retryCount: 1, maxRetries: 3, stale: false })?.recommendedAction).toBe("ACKNOWLEDGE");
  });

  it("blocks unsafe retry and classifies exhausted work as dead letter", () => {
    const failed = classifyPublish({ status: "RETRYING", externalState: "FAILED_RETRYABLE", providerPublishId: null, leaseExpired: false, retryCount: 3, maxRetries: 3, stale: false });
    expect(failed?.classification).toBe("FINAL_FAILURE");
    expect(classifyGenerationJob({ status: "RETRYING", provider: "fal", stale: true, attempts: 2, maxAttempts: 2 })?.classification).toBe("FINAL_FAILURE");
    expect(migration).toContain("v_queue.external_state<>'FAILED_RETRYABLE' or v_queue.provider_publish_id is not null");
    expect(migration).toContain("unsafe_requeue_blocked");
  });

  it("releases only unsent budget automatically and keeps unknown submissions held", () => {
    expect(classifyBudget({ state: "RESERVED", providerState: "REQUEST_NOT_SENT", expired: true, providerRequestId: null })?.classification).toBe("AUTO_RECOVERABLE");
    expect(classifyBudget({ state: "RESERVED", providerState: "SUBMITTED_UNKNOWN", expired: true, providerRequestId: null })?.classification).toBe("RECONCILIATION_REQUIRED");
    expect(migration).toContain("v_incident.classification<>'AUTO_RECOVERABLE'");
    expect(migration).toContain("release_generation_budget(p_owner_id,v_incident.subject_id,false)");
  });

  it("identifies stale Auto runs and deduplicates scheduler windows", () => {
    expect(classifyAutoRun("RUNNING", true)?.classification).toBe("RECONCILIATION_REQUIRED");
    expect(readFileSync("src/features/operations/recovery.ts", "utf8")).toContain("Math.floor(now.getTime() / 300_000) * 300_000");
    expect(migration).toContain("window_key text not null unique");
  });

  it("requires owner auth, owner-scoped access, audit and idempotency for actions", () => {
    expect(migration).toContain("if p_actor_id<>p_owner_id then raise exception 'operator_owner_mismatch'");
    expect(migration).toContain("where owner_id=p_owner_id and id=p_incident_id for update");
    expect(migration).toContain("unique(owner_id,idempotency_key)");
    expect(migration).toContain("idempotency_key_conflict");
    expect(migration).toContain("operations_actions_owner_read");
    expect(readFileSync("src/app/(app)/operations/actions.ts", "utf8")).toContain("auth.getUser()");
    expect(readFileSync("src/app/api/operations/health/route.ts", "utf8")).toContain("status: 401");
  });

  it("deduplicates alerts by owner, rule, and subject", () => {
    const alerts = evaluateAlertRules({ reconciliation: 5, deadLetter: 1, providerFailures: 3, publishFailures: 3, schedulerAgeMinutes: 16, staleAutoRuns: 1, budgetBacklog: 3, webhookFailures: 5 });
    expect(alerts).toHaveLength(8);
    expect(migration).toContain("unique(owner_id,rule_code,subject_key)");
    expect(readFileSync("src/features/operations/recovery.ts", "utf8")).toContain('state: "RESOLVED", resolved_at: now.toISOString()');
  });
});

describe("structured operational logs", () => {
  it("redacts known token forms and rejects secrets in structured identifiers", () => {
    expect(redactOpsText("Bearer abc123456789 sb_secret_abcdefghijklmnop fal_abcdefghijklmnop client_secret=secret")).not.toMatch(/abc123456789|sb_secret_|fal_abcdefghijklmnop|client_secret=secret/);
    const record = makeOpsLog({ severity: "WARN", component: "operations", operation: "recover", correlation_id: "sb_secret_abcdefghijklmnop", error_category: "RECOVERY" });
    expect(record.correlation_id).toBe("[REDACTED]");
    expect(makeOpsLog({ severity: "INFO", component: "operations", operation: "test", provider_job_id: "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.signature" }).provider_job_id).toBe("[REDACTED]");
    expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
