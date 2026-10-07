import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/server-env";
import type { StageOutcome } from "./processor";

export type PostAutomationExecutionMode = "SAFE" | "LIVE";

/** Both independent server controls must opt in before an external provider can run. */
export async function getPostAutomationExecutionMode(client: SupabaseClient): Promise<PostAutomationExecutionMode> {
  if (serverEnv.postAutomationExecutionMode !== "LIVE") return "SAFE";
  try {
    const result = await client.rpc("get_post_automation_execution_mode");
    return !result.error && result.data === "LIVE" ? "LIVE" : "SAFE";
  } catch {
    return "SAFE";
  }
}

export function safeExecutionBoundary(blockedBoundary: string): StageOutcome {
  return { kind: "WAIT", state: "WAITING_FOR_PROVIDER", reason: "SAFE_EXECUTION_BOUNDARY",
    evidence: { executionMode: "SAFE", blockedBoundary } };
}
