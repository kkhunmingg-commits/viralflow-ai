import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logOps } from "@/lib/ops/logger";
import { createAutoExecutionPorts, type AutoExecutionBoundaries } from "./execution-ports";
import { SupabaseExecutionStore } from "./execution-store";
import { processAutoCycle } from "./processor";
import { falAutoModeAvailability } from "@/features/video/provider-routing";
import { serverEnv } from "@/lib/server-env";

export async function runAutoExecutionCycle(admin: SupabaseClient, ownerId: string, runId: string,
  maxSteps = 12, boundaries: AutoExecutionBoundaries = {}) {
  const store = new SupabaseExecutionStore(admin, ownerId);
  const result = await processAutoCycle(store, createAutoExecutionPorts(admin, boundaries), runId, randomUUID(), maxSteps);
  logOps({ severity: "INFO", component: "auto", operation: "execution_cycle", owner_id: ownerId,
    run_id: runId, correlation_id: result.operationKey, to_state: String(result.results.at(-1)?.status ?? "IDLE") });
  return result;
}

export async function runPendingAutoExecution(admin: SupabaseClient, limit = 3) {
  const providerReady = falAutoModeAvailability({ keyPresent: Boolean(serverEnv.falKey), state: serverEnv.falWanProviderState }).providerAvailable;
  const states = ["STARTING", "RUNNING", "RETRY_PENDING", "WAITING_FOR_DATA", "WAITING_FOR_SLOT", "WAITING_FOR_APPROVAL", ...(providerReady || process.env.NODE_ENV === "development" ? ["WAITING_FOR_PROVIDER"] : [])];
  const { data, error } = await admin.from("auto_account_states").select("auto_run_id,owner_id")
    .in("state", states).order("updated_at").limit(limit * 5);
  if (error) throw new Error("auto_execution_scan_failed");
  const results = [];
  const seen = new Set<string>();
  for (const row of data ?? []) {
    if (seen.has(row.auto_run_id)) continue;
    seen.add(row.auto_run_id);
    results.push(await runAutoExecutionCycle(admin, row.owner_id, row.auto_run_id, 2));
    if (results.length >= limit) break;
  }
  return { runs: results.length, steps: results.reduce((sum, result) => sum + result.results.length, 0) };
}
