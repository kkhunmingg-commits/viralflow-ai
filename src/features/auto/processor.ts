import { classifyFailure, stableAutoKey } from "./engine";
import type { AutoState, EffectiveAutoMode } from "./types";

export const executionStages = [
  "FIND_OPPORTUNITY", "CREATE_CREATIVE", "GENERATE_VIDEO", "QUALITY_CHECK",
  "COMPLIANCE_CHECK", "QUEUE_PUBLISH", "PUBLISH", "COLLECT_ANALYTICS", "LEARN",
] as const;
export type ExecutionStage = (typeof executionStages)[number];

export interface ExecutionClaim {
  ownerId: string;
  runId: string;
  accountId: string;
  mode: EffectiveAutoMode;
  itemIndex: number;
  dailyTarget: number;
  attempt: number;
  step: ExecutionStage;
  leaseToken: string;
  checkpoint: Record<string, unknown>;
  operationKey: string;
}

export type StageOutcome =
  | { kind: "ADVANCE"; evidence: Record<string, unknown> }
  | { kind: "WAIT"; state: Extract<AutoState, "WAITING_FOR_PROVIDER" | "WAITING_FOR_APPROVAL" | "WAITING_FOR_SLOT" | "WAITING_FOR_DATA" | "BLOCKED">; reason: string; evidence?: Record<string, unknown> }
  | { kind: "RECONCILE"; reason: string; evidence?: Record<string, unknown> }
  | { kind: "SKIP_ITEM"; reason: string; evidence?: Record<string, unknown> };

export interface ExecutionStore {
  runnableAccounts(runId: string): Promise<string[]>;
  claim(runId: string, accountId: string, workerId: string): Promise<ExecutionClaim | null>;
  finish(claim: ExecutionClaim, outcome: StageOutcome, nextStep: ExecutionStage | "COMPLETE", nextItemIndex: number): Promise<void>;
  fail(claim: ExecutionClaim, failure: { type: string; retryable: boolean; reason: string; nextState: AutoState }): Promise<void>;
}

export type ExecutionPorts = Record<ExecutionStage, (claim: ExecutionClaim) => Promise<StageOutcome>>;

export function nextExecutionPosition(claim: ExecutionClaim, outcome: StageOutcome) {
  if (outcome.kind === "WAIT" || outcome.kind === "RECONCILE") return { step: claim.step, itemIndex: claim.itemIndex };
  if (outcome.kind === "SKIP_ITEM" || claim.step === "LEARN") {
    const nextItemIndex = claim.itemIndex + 1;
    return nextItemIndex > claim.dailyTarget
      ? { step: "COMPLETE" as const, itemIndex: nextItemIndex }
      : { step: "FIND_OPPORTUNITY" as const, itemIndex: nextItemIndex };
  }
  const next = executionStages[executionStages.indexOf(claim.step) + 1];
  return { step: next, itemIndex: claim.itemIndex };
}

export async function processAutoAccount(store: ExecutionStore, ports: ExecutionPorts, runId: string, accountId: string, workerId: string) {
  const claim = await store.claim(runId, accountId, workerId);
  if (!claim) return { status: "NOT_CLAIMED" as const };
  let outcome: StageOutcome;
  try {
    outcome = await ports[claim.step](claim);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "auto_step_failed";
    const reconciliation = reason.includes("reconciliation") || reason.includes("SUBMITTED_UNKNOWN");
    const classification = classifyFailure(reason);
    await store.fail(claim, {
      type: classification.type,
      retryable: classification.retryable && !reconciliation && claim.attempt < classification.maxRetries,
      reason: reconciliation ? "RECONCILIATION_REQUIRED" : classification.type,
      nextState: reconciliation ? "WAITING_FOR_RECONCILIATION" : classification.retryable && claim.attempt < classification.maxRetries ? "RETRY_PENDING" : "BLOCKED",
    });
    return { status: reconciliation ? "RECONCILE" as const : "FAILED" as const, step: claim.step };
  }
  const position = nextExecutionPosition(claim, outcome);
  await store.finish(claim, outcome, position.step, position.itemIndex);
  return { status: outcome.kind, step: claim.step, nextStep: position.step };
}

export async function processAutoCycle(store: ExecutionStore, ports: ExecutionPorts, runId: string, workerId: string, maxSteps = 12) {
  const results: Array<Awaited<ReturnType<typeof processAutoAccount>>> = [];
  for (let step = 0; step < maxSteps; step++) {
    const accounts = await store.runnableAccounts(runId);
    if (!accounts.length) break;
    let advanced = false;
    for (const accountId of accounts) {
      const result = await processAutoAccount(store, ports, runId, accountId, workerId);
      results.push(result);
      if (result.status === "ADVANCE" || result.status === "SKIP_ITEM") advanced = true;
    }
    if (!advanced) break;
  }
  return { results, operationKey: stableAutoKey(runId, workerId, "auto-cycle") };
}
