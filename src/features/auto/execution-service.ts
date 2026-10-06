import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logOps } from "@/lib/ops/logger";
import { createAutoExecutionPorts, type AutoExecutionBoundaries } from "./execution-ports";
import { SupabaseExecutionStore } from "./execution-store";
import { processAutoCycle } from "./processor";
import { falAutoModeAvailability } from "@/features/video/provider-routing";
import { serverEnv } from "@/lib/server-env";
import { tickAccountPostSchedules } from "./account-schedule";

export async function runAutoExecutionCycle(admin: SupabaseClient, ownerId: string, runId: string,
  maxSteps = 12, boundaries: AutoExecutionBoundaries = {}) {
  const store = new SupabaseExecutionStore(admin, ownerId);
  const result = await processAutoCycle(store, createAutoExecutionPorts(admin, boundaries), runId, randomUUID(), maxSteps);
  logOps({ severity: "INFO", component: "auto", operation: "execution_cycle", owner_id: ownerId,
    run_id: runId, correlation_id: result.operationKey, to_state: String(result.results.at(-1)?.status ?? "IDLE") });
  return result;
}

export async function runPendingAutoExecution(admin: SupabaseClient, limit = 3) {
  const batchLimit = Math.min(3, Math.max(1, Math.floor(limit)));
  await tickAccountPostSchedules(admin, 10);
  const providerReady = falAutoModeAvailability({ keyPresent: Boolean(serverEnv.falKey), state: serverEnv.falWanProviderState }).providerAvailable;
  const states = ["STARTING", "RUNNING", "RETRY_PENDING", "WAITING_FOR_DATA", "WAITING_FOR_SLOT", "WAITING_FOR_APPROVAL", ...(providerReady || process.env.NODE_ENV === "development" ? ["WAITING_FOR_PROVIDER"] : [])];
  const { data, error } = await admin.from("auto_account_states").select("auto_run_id,owner_id")
    .in("state", states).order("last_execution_scan_at", { ascending: true, nullsFirst: true }).order("tiktok_account_id").limit(batchLimit * 5);
  if (error) throw new Error("auto_execution_scan_failed");
  const candidates: Array<{ ownerId: string; runId: string }> = [];
  const seen = new Set<string>();
  for (const row of data ?? []) {
    if (seen.has(row.auto_run_id)) continue;
    seen.add(row.auto_run_id);
    candidates.push({ ownerId: row.owner_id, runId: row.auto_run_id });
    if (candidates.length >= batchLimit) break;
  }
  // The existing endpoint's bounded batch can work on distinct accounts at once.
  // One provider/account failure must not abort the remaining accounts.
  const settled = await Promise.allSettled(candidates.map(async ({ ownerId, runId }) => {
    // Persist fairness across endpoint restarts, including accounts waiting on a gate.
    const scanned = await admin.from("auto_account_states").update({ last_execution_scan_at: new Date().toISOString() })
      .eq("owner_id", ownerId).eq("auto_run_id", runId);
    if (scanned.error) throw new Error("auto_execution_scan_record_failed");
    return runAutoExecutionCycle(admin, ownerId, runId, 2);
  }));
  const results = settled.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  for (let index = 0; index < settled.length; index++) {
    if (settled[index].status === "rejected") logOps({ severity: "ERROR", component: "auto", operation: "execution_cycle_failed",
      owner_id: candidates[index].ownerId, run_id: candidates[index].runId, error_code: "AUTO_ACCOUNT_CYCLE_FAILED" });
  }
  return { runs: results.length, failedRuns: settled.length - results.length, steps: results.reduce((sum, result) => sum + result.results.length, 0) };
}
