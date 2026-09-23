import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logOps } from "@/lib/ops/logger";
import { classifyAutoRun, classifyBudget, classifyGenerationJob, classifyPublish, evaluateAlertRules, type RecoveryDecision, type SubjectType } from "./policy";
import { RECOVERY_BATCH_SIZE, scanOperationalBatches } from "./scan";

type Row = Record<string, unknown>;
const text = (value: unknown) => typeof value === "string" ? value : null;
const number = (value: unknown) => Number(value ?? 0);
const past = (value: unknown, now: Date, minutes: number) => Boolean(value && Date.parse(String(value)) < now.getTime() - minutes * 60_000);

export function recoveryWindowKey(now: Date) {
  return `recovery:${new Date(Math.floor(now.getTime() / 300_000) * 300_000).toISOString()}`;
}

export interface RecoveryIncident {
  ownerId: string;
  subjectType: SubjectType;
  subjectId: string;
  accountId: string | null;
  runId: string | null;
  provider: string | null;
  providerOperationId: string | null;
  decision: RecoveryDecision;
}

function incident(ownerId: string, subjectType: SubjectType, row: Row, decision: RecoveryDecision): RecoveryIncident {
  return {
    ownerId,
    subjectType,
    subjectId: String(row.id),
    accountId: text(row.tiktok_account_id),
    runId: subjectType === "AUTO_RUN" ? String(row.id) : text(row.auto_run_id),
    provider: text(row.provider) ?? (subjectType === "PUBLISH" ? "tiktok" : null),
    providerOperationId: text(row.provider_request_id) ?? text(row.provider_publish_id),
    decision,
  };
}

export function collectRecoveryIncidents(input: {
  publishing: Row[]; budgets: Row[]; runs: Row[]; jobs: Row[]; now: Date;
}) {
  const result: RecoveryIncident[] = [];
  for (const row of input.publishing) {
    const decision = classifyPublish({
      status: String(row.status), externalState: String(row.external_state), providerPublishId: text(row.provider_publish_id),
      leaseExpired: past(row.lease_expires_at, input.now, 0), retryCount: number(row.retry_count), maxRetries: number(row.max_retries),
      stale: past(row.updated_at, input.now, 20),
    });
    if (decision) result.push(incident(String(row.owner_id), "PUBLISH", row, decision));
  }
  for (const row of input.budgets) {
    const decision = classifyBudget({
      state: String(row.state), providerState: String(row.provider_submission_state),
      expired: past(row.expires_at, input.now, 0), providerRequestId: text(row.provider_request_id),
    });
    if (decision) result.push(incident(String(row.owner_id), "BUDGET", row, decision));
  }
  for (const row of input.runs) {
    const decision = classifyAutoRun(String(row.state), past(row.updated_at, input.now, 20));
    if (decision) result.push(incident(String(row.owner_id), "AUTO_RUN", row, decision));
  }
  for (const row of input.jobs) {
    const decision = classifyGenerationJob({
      status: String(row.status), provider: String(row.provider), stale: past(row.started_at ?? row.created_at, input.now, 20),
      attempts: number(row.attempt), maxAttempts: number(row.max_attempts),
    });
    if (decision) result.push(incident(String(row.owner_id), "GENERATION_JOB", row, decision));
  }
  return result;
}

async function mustRpc(admin: SupabaseClient, name: string, params: Row) {
  const { data, error } = await admin.rpc(name, params);
  if (error) throw new Error(`${name}_failed`);
  return data;
}

async function scanCandidates(admin: SupabaseClient, table: string, columns: string, stateColumn: string, states: string[]) {
  return scanOperationalBatches(async (after) => {
    let query = admin.from(table).select(columns).in(stateColumn, states).order("id").limit(RECOVERY_BATCH_SIZE);
    if (after) query = query.gt("id", after);
    const { data, error } = await query;
    if (error) throw new Error(`${table}_scan_failed`);
    return (data ?? []) as unknown as Array<Row & { id: string }>;
  });
}

export async function runRecoveryCycle(admin: SupabaseClient, now = new Date()) {
  const windowKey = recoveryWindowKey(now);
  const claimed = await mustRpc(admin, "claim_operations_scheduler_window", { p_window_key: windowKey });
  if (claimed !== true) return { claimed: false, windowKey, incidents: 0, alerts: 0 };
  let incidentCount = 0;
  let alertCount = 0;
  try {
    const [publishRecovery, budgetRecovery] = await Promise.all([
      mustRpc(admin, "recover_publish_operations", { p_now: now.toISOString() }),
      mustRpc(admin, "recover_generation_budget_reservations", { p_now: now.toISOString() }),
    ]);
    const [publishing, budgets, runs, jobs, webhookFailures, openAlerts] = await Promise.all([
      scanCandidates(admin, "publishing_queue", "id,owner_id,tiktok_account_id,provider_publish_id,status,external_state,lease_expires_at,retry_count,max_retries,updated_at", "status", ["UPLOADING", "PROCESSING", "WAITING_FOR_RECONCILIATION", "RETRYING", "FAILED"]),
      scanCandidates(admin, "generation_budget_reservations", "id,owner_id,tiktok_account_id,auto_run_id,provider,provider_request_id,state,provider_submission_state,expires_at", "state", ["RESERVED"]),
      scanCandidates(admin, "auto_runs", "id,owner_id,state,updated_at", "state", ["STARTING", "RUNNING", "RETRY_PENDING", "FAILED"]),
      scanCandidates(admin, "generation_jobs", "id,owner_id,status,provider,attempt,max_attempts,started_at,created_at", "status", ["PROCESSING", "RETRYING", "FAILED"]),
      admin.from("operations_webhook_failures").select("failure_count").gte("minute_bucket", new Date(now.getTime() - 15 * 60_000).toISOString()).limit(20),
      admin.from("operations_alerts").select("owner_id,rule_code").eq("state", "OPEN").limit(200),
    ]);
    if (webhookFailures.error || openAlerts.error) throw new Error("operations_scan_failed");
    if ((openAlerts.data?.length ?? 0) >= 200) throw new Error("operations_alert_scan_limit_reached");
    const recentWebhookFailures = (webhookFailures.data ?? []).reduce((sum, item) => sum + item.failure_count, 0);
    if (recentWebhookFailures >= 5) logOps({ severity: "WARN", component: "operations", operation: "webhook_failure_spike", error_category: "WEBHOOK", error_code: "WEBHOOK_FAILURE_SPIKE" });
    const incidents = collectRecoveryIncidents({ publishing, budgets, runs, jobs, now });
    const ownerMetrics = new Map<string, { reconciliation: number; deadLetter: number; providerFailures: number; publishFailures: number; staleAutoRuns: number; budgetBacklog: number }>();
    for (const item of incidents) {
      await mustRpc(admin, "upsert_operations_incident", {
        p_owner_id: item.ownerId, p_subject_type: item.subjectType, p_subject_id: item.subjectId,
        p_account_id: item.accountId, p_run_id: item.runId, p_provider: item.provider,
        p_provider_operation_id: item.providerOperationId, p_classification: item.decision.classification,
        p_reason_code: item.decision.reasonCode, p_recommended_action: item.decision.recommendedAction,
      });
      incidentCount++;
      const metrics = ownerMetrics.get(item.ownerId) ?? { reconciliation: 0, deadLetter: 0, providerFailures: 0, publishFailures: 0, staleAutoRuns: 0, budgetBacklog: 0 };
      if (item.decision.classification === "RECONCILIATION_REQUIRED") metrics.reconciliation++;
      if (item.decision.classification === "FINAL_FAILURE") metrics.deadLetter++;
      if (item.subjectType === "GENERATION_JOB" && item.decision.classification === "FINAL_FAILURE") metrics.providerFailures++;
      if (item.subjectType === "PUBLISH" && item.decision.classification === "FINAL_FAILURE") metrics.publishFailures++;
      if (item.subjectType === "AUTO_RUN") metrics.staleAutoRuns++;
      if (item.subjectType === "BUDGET") metrics.budgetBacklog++;
      ownerMetrics.set(item.ownerId, metrics);
    }
    for (const alert of openAlerts.data ?? []) if (!ownerMetrics.has(alert.owner_id)) {
      ownerMetrics.set(alert.owner_id, { reconciliation: 0, deadLetter: 0, providerFailures: 0, publishFailures: 0, staleAutoRuns: 0, budgetBacklog: 0 });
    }
    for (const [ownerId, metrics] of ownerMetrics) {
      const rules = evaluateAlertRules({ ...metrics, schedulerAgeMinutes: 0, webhookFailures: recentWebhookFailures });
      for (const rule of rules) {
        await mustRpc(admin, "upsert_operations_alert", {
          p_owner_id: ownerId, p_rule_code: rule.code, p_subject_key: "owner-operations",
          p_severity: rule.severity,
        });
        alertCount++;
      }
      for (const existing of (openAlerts.data ?? []).filter((item) => item.owner_id === ownerId && !rules.some((rule) => rule.code === item.rule_code))) {
        const { error } = await admin.from("operations_alerts").update({ state: "RESOLVED", resolved_at: now.toISOString() })
          .eq("owner_id", ownerId).eq("rule_code", existing.rule_code).eq("state", "OPEN");
        if (error) throw new Error("operations_alert_resolve_failed");
      }
    }
    await mustRpc(admin, "finish_operations_scheduler_window", {
      p_window_key: windowKey, p_success: true,
      p_summary: { incidents: incidentCount, alerts: alertCount, publishRecovery, budgetRecovery }, p_error_code: null,
    });
    logOps({ severity: "INFO", component: "operations", operation: "recovery_cycle", correlation_id: windowKey, to_state: "COMPLETED" });
    return { claimed: true, windowKey, incidents: incidentCount, alerts: alertCount };
  } catch (error) {
    logOps({ severity: "ERROR", component: "operations", operation: "recovery_cycle", correlation_id: windowKey, to_state: "FAILED", error_category: "RECOVERY", error_code: "RECOVERY_CYCLE_FAILED" });
    await mustRpc(admin, "finish_operations_scheduler_window", {
      p_window_key: windowKey, p_success: false, p_summary: { incidents: incidentCount, alerts: alertCount }, p_error_code: "RECOVERY_CYCLE_FAILED",
    });
    throw error;
  }
}
