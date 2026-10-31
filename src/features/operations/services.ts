import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { TikTokPublishingService } from "@/features/publishing/services";
import { logOps, redactOpsText } from "@/lib/ops/logger";
import { operationalPage, operationalWindow } from "../../lib/pagination";
import { summarizeSchedulerHealth } from "./scheduler-health";

export const manualActionSchema = z.object({
  incidentId: z.uuid(),
  action: z.enum(["ACKNOWLEDGE", "RECHECK_STATUS", "MARK_CONFIRMED", "MARK_FAILED", "RELEASE_SAFE_RESERVATION", "REQUEUE_SAFE_OPERATION", "RESOLVE"]),
  idempotencyKey: z.uuid(),
  evidence: z.string().trim().max(240).optional(),
  externalId: z.string().trim().max(64).optional(),
});

export type ManualActionInput = z.infer<typeof manualActionSchema>;

export async function listOwnerOperations(client: SupabaseClient, ownerId: string, page = 1) {
  const { from, to } = operationalWindow(page);
  const incidents = await client.from("operations_incidents").select("*").eq("owner_id", ownerId)
    .order("last_seen_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
  if (incidents.error) throw new Error("operations_read_failed");
  const incidentPage = operationalPage(incidents.data ?? [], page);
  const incidentIds = incidentPage.items.map((item) => item.id);
  const publishIds = incidentPage.items.filter((item) => item.subject_type === "PUBLISH").map((item) => item.subject_id);
  const [alerts, accounts, events, publishAttempts] = await Promise.all([
    client.from("operations_alerts").select("*").eq("owner_id", ownerId).eq("state", "OPEN").order("last_seen_at", { ascending: false }).limit(50),
    client.from("tiktok_accounts").select("id,display_name,username").eq("owner_id", ownerId),
    incidentIds.length ? client.from("operations_action_events").select("incident_id,action,created_at,outcome").eq("owner_id", ownerId).in("incident_id", incidentIds).order("created_at", { ascending: false }).limit(500) : Promise.resolve({ data: [], error: null }),
    publishIds.length ? client.from("publish_attempts").select("publishing_queue_id,started_at,status").eq("owner_id", ownerId).in("publishing_queue_id", publishIds).order("started_at", { ascending: false }).limit(500) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [alerts, accounts, events, publishAttempts]) if (result.error) throw new Error("operations_read_failed");
  const accountNames = new Map((accounts.data ?? []).map((item) => [item.id, item.display_name || item.username || "Account"]));
  const lastAction = new Map<string, { action: string; created_at: string }>();
  for (const item of events.data ?? []) if (!lastAction.has(item.incident_id)) lastAction.set(item.incident_id, item);
  const lastPublishAttempt = new Map<string, { started_at: string; status: string }>();
  for (const item of publishAttempts.data ?? []) if (!lastPublishAttempt.has(item.publishing_queue_id)) lastPublishAttempt.set(item.publishing_queue_id, item);
  return {
    incidents: incidentPage.items.map((item) => ({
      ...item, account_name: item.tiktok_account_id ? accountNames.get(item.tiktok_account_id) ?? "Account" : "—",
      last_action: lastAction.get(item.id) ?? null,
      last_publish_attempt: item.subject_type === "PUBLISH" ? lastPublishAttempt.get(item.subject_id) ?? null : null,
    })),
    alerts: alerts.data ?? [],
    page,
    hasMore: incidentPage.hasMore,
  };
}

export async function ownerOperationsHealth(admin: SupabaseClient, ownerId: string, now = new Date()) {
  const [scheduler, lastSuccess, lastFailure, reconciliation, deadLetter, failedOperations, budgets, publishing, runs, jobs, recentAttempts] = await Promise.all([
    admin.from("operations_scheduler_runs").select("state,started_at,completed_at,error_code").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("operations_scheduler_runs").select("state,started_at,completed_at,summary_json").eq("state", "COMPLETED").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("operations_scheduler_runs").select("state,started_at,completed_at").eq("state", "FAILED").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("operations_incidents").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).neq("lifecycle", "RESOLVED").eq("classification", "RECONCILIATION_REQUIRED"),
    admin.from("operations_incidents").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).neq("lifecycle", "RESOLVED").eq("classification", "FINAL_FAILURE"),
    admin.from("operations_incidents").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).neq("lifecycle", "RESOLVED").like("reason_code", "%FAILED%"),
    admin.from("generation_budget_reservations").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).eq("state", "RESERVED"),
    admin.from("publishing_queue").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).in("external_state", ["RESERVING", "SUBMITTING"]),
    admin.from("auto_runs").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).in("state", ["STARTING", "RUNNING", "RETRY_PENDING"]).lt("updated_at", new Date(now.getTime() - 20 * 60_000).toISOString()),
    admin.from("generation_jobs").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).in("status", ["PROCESSING", "RETRYING"]).lt("started_at", new Date(now.getTime() - 20 * 60_000).toISOString()),
    admin.from("publish_attempts").select("error_code,created_at").eq("owner_id", ownerId).in("status", ["FAILED", "RETRYABLE"]).order("created_at", { ascending: false }).limit(5),
  ]);
  for (const result of [scheduler, lastSuccess, lastFailure, reconciliation, deadLetter, failedOperations, budgets, publishing, runs, jobs, recentAttempts]) if (result.error) throw new Error("operations_health_read_failed");
  return {
    scheduler: summarizeSchedulerHealth(scheduler.data, lastSuccess.data, lastFailure.data, now),
    stale_jobs: (jobs.count ?? 0) + (runs.count ?? 0),
    reconciliation: reconciliation.count ?? 0,
    dead_letter: deadLetter.count ?? 0,
    failed_operations: failedOperations.count ?? 0,
    pending_leases: publishing.count ?? 0,
    pending_budget_reservations: budgets.count ?? 0,
    recent_provider_errors: (recentAttempts.data ?? []).map((item) => ({ code: redactOpsText(item.error_code), at: item.created_at })),
  };
}

export async function applyOwnerOperationsAction(admin: SupabaseClient, ownerId: string, raw: ManualActionInput) {
  const input = manualActionSchema.parse(raw);
  const requiresEvidence = ["MARK_CONFIRMED", "MARK_FAILED", "RELEASE_SAFE_RESERVATION", "RESOLVE"].includes(input.action);
  if (requiresEvidence && (!input.evidence || input.evidence.length < 12)) throw new Error("evidence_required");
  if (input.action === "MARK_CONFIRMED" && !input.externalId) throw new Error("provider_id_required");
  const evidenceHash = input.evidence ? createHash("sha256").update(input.evidence).digest("hex") : null;
  const { data, error } = await admin.rpc("apply_operations_manual_action", {
    p_owner_id: ownerId, p_actor_id: ownerId, p_incident_id: input.incidentId,
    p_action: input.action, p_idempotency_key: input.idempotencyKey,
    p_evidence_hash: evidenceHash, p_external_id: input.externalId ?? null,
  });
  if (error || !data) throw new Error("operations_action_rejected");
  logOps({ severity: "INFO", component: "operations", operation: input.action,
    owner_id: ownerId, correlation_id: input.idempotencyKey, publish_id: data.subject_type === "PUBLISH" ? data.subject_id : null,
    job_id: data.subject_type === "BUDGET" ? data.subject_id : null, to_state: data.lifecycle });
  if (input.action === "RECHECK_STATUS") {
    await new TikTokPublishingService(admin).fetchPublishStatus(ownerId, String(data.subject_id));
  }
  return data;
}
