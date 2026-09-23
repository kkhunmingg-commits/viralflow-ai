import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { falAutoModeAvailability } from "@/features/video/provider-routing";
import { serverEnv } from "@/lib/server-env";
import type { ExecutionClaim, ExecutionStage, ExecutionStore, StageOutcome } from "./processor";

function must<T>(data: T | null, error: { message: string } | null, code: string): T {
  if (error || data === null) throw new Error(error?.message ?? code);
  return data;
}

export class SupabaseExecutionStore implements ExecutionStore {
  constructor(private readonly admin: SupabaseClient, private readonly ownerId: string) {}

  async runnableAccounts(runId: string) {
    const { data: run, error: runError } = await this.admin.from("auto_runs").select("state")
      .eq("owner_id", this.ownerId).eq("id", runId).maybeSingle();
    if (runError) throw new Error("auto_execution_run_read_failed");
    if (run?.state !== "RUNNING") return [];
    const { data, error } = await this.admin.from("auto_account_states").select("tiktok_account_id")
      .eq("owner_id", this.ownerId).eq("auto_run_id", runId)
      .in("state", ["STARTING", "RUNNING", "RETRY_PENDING", "WAITING_FOR_PROVIDER", "WAITING_FOR_DATA", "WAITING_FOR_SLOT", "WAITING_FOR_APPROVAL"])
      .order("priority", { ascending: false }).order("tiktok_account_id").limit(20);
    if (error) throw new Error("auto_execution_account_read_failed");
    return (data ?? []).map((row) => row.tiktok_account_id);
  }

  private async providerReady(accountId: string) {
    const { data, error } = await this.admin.from("tiktok_accounts").select("is_mock")
      .eq("owner_id", this.ownerId).eq("id", accountId).maybeSingle();
    if (error || !data) throw new Error("auto_execution_account_not_found");
    if (data.is_mock) return process.env.NODE_ENV === "development";
    return falAutoModeAvailability({ keyPresent: Boolean(serverEnv.falKey), state: serverEnv.falWanProviderState }).providerAvailable;
  }

  async claim(runId: string, accountId: string, workerId: string) {
    const providerReady = await this.providerReady(accountId);
    const { data, error } = await this.admin.rpc("claim_auto_execution_step", {
      p_owner_id: this.ownerId, p_run_id: runId, p_account_id: accountId, p_worker_id: workerId,
      p_lease_seconds: 900, p_provider_ready: providerReady,
    });
    if (error) throw new Error("auto_execution_claim_failed");
    if (!data) return null;
    const claim = data as ExecutionClaim;
    if (claim.ownerId !== this.ownerId || claim.runId !== runId || claim.accountId !== accountId) {
      throw new Error("auto_execution_owner_mismatch");
    }
    return claim;
  }

  async finish(claim: ExecutionClaim, outcome: StageOutcome, nextStep: ExecutionStage | "COMPLETE", nextItemIndex: number) {
    const { data, error } = await this.admin.rpc("finish_auto_execution_step", {
      p_owner_id: this.ownerId, p_run_id: claim.runId, p_account_id: claim.accountId,
      p_lease_token: claim.leaseToken, p_step: claim.step, p_kind: outcome.kind,
      p_evidence: outcome.evidence ?? {}, p_next_step: nextStep, p_next_item_index: nextItemIndex,
      p_wait_state: outcome.kind === "WAIT" ? outcome.state : null,
      p_reason: outcome.kind === "WAIT" || outcome.kind === "RECONCILE" || outcome.kind === "SKIP_ITEM" ? outcome.reason : null,
    });
    must(data as boolean | null, error, "auto_execution_finish_failed");
  }

  async fail(claim: ExecutionClaim, failure: { type: string; retryable: boolean; reason: string; nextState: string }) {
    const { data, error } = await this.admin.rpc("fail_auto_execution_step", {
      p_owner_id: this.ownerId, p_run_id: claim.runId, p_account_id: claim.accountId,
      p_lease_token: claim.leaseToken, p_step: claim.step, p_failure_type: failure.type,
      p_retryable: failure.retryable, p_reason: failure.reason, p_next_state: failure.nextState,
    });
    must(data as boolean | null, error, "auto_execution_failure_record_failed");
  }
}
