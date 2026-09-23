import type { SupabaseClient } from "@supabase/supabase-js";
import { logOps } from "../../lib/ops/logger";

export type BudgetReservationState = "RESERVED" | "SETTLED" | "RELEASED" | "EXPIRED";
export type ProviderSubmissionState = "REQUEST_NOT_SENT" | "SUBMITTING" | "SUBMITTED_UNKNOWN" | "SUBMITTED" | "CONFIRMED" | "FAILED";

export interface BudgetReservation {
  id: string;
  owner_id: string;
  logical_operation_key: string;
  reserved_usd: number;
  actual_usd: number | null;
  state: BudgetReservationState;
  provider_submission_state: ProviderSubmissionState;
  provider_request_id: string | null;
}

export interface ReserveBudgetInput {
  ownerId: string;
  accountId: string;
  generationJobId: string | null;
  autoRunId: string | null;
  runKey: string;
  logicalOperationKey: string;
  provider: string;
  model: string;
  reservedUsd: number;
  perVideoCapUsd: number;
  dailyCapUsd: number;
  monthlyCapUsd: number;
  runCapUsd: number;
  accountCapUsd: number;
  providerCapUsd: number;
  budgetDay: string;
  budgetMonth: string;
  ttlSeconds?: number;
}

function reservation(data: unknown, error: { message: string } | null, code: string) {
  if (error || !data) throw new Error(error?.message ?? code);
  return data as BudgetReservation;
}

export class AtomicBudgetLedger {
  constructor(private readonly admin: SupabaseClient) {}

  async reserve(input: ReserveBudgetInput) {
    const { data, error } = await this.admin.rpc("reserve_generation_budget", {
      p_owner_id: input.ownerId,
      p_tiktok_account_id: input.accountId,
      p_generation_job_id: input.generationJobId,
      p_auto_run_id: input.autoRunId,
      p_run_key: input.runKey,
      p_logical_operation_key: input.logicalOperationKey,
      p_provider: input.provider,
      p_model: input.model,
      p_reserved_usd: input.reservedUsd,
      p_per_video_cap_usd: input.perVideoCapUsd,
      p_daily_cap_usd: input.dailyCapUsd,
      p_monthly_cap_usd: input.monthlyCapUsd,
      p_run_cap_usd: input.runCapUsd,
      p_account_cap_usd: input.accountCapUsd,
      p_provider_cap_usd: input.providerCapUsd,
      p_budget_day: input.budgetDay,
      p_budget_month: input.budgetMonth,
      p_ttl_seconds: input.ttlSeconds ?? 900,
    });
    const result = reservation(data, error, "budget_reservation_failed");
    logOps({ severity: "INFO", component: "budget", operation: "reserve", owner_id: input.ownerId,
      account_id: input.accountId, run_id: input.autoRunId, job_id: input.generationJobId,
      correlation_id: result.id, to_state: result.state });
    return result;
  }

  async begin(ownerId: string, reservationId: string) {
    const { data, error } = await this.admin.rpc("begin_generation_submission", {
      p_owner_id: ownerId, p_reservation_id: reservationId,
    });
    return reservation(data, error, "budget_submission_begin_failed");
  }

  async submitted(ownerId: string, reservationId: string, providerRequestId: string) {
    const { data, error } = await this.admin.rpc("mark_generation_submitted", {
      p_owner_id: ownerId, p_reservation_id: reservationId, p_provider_request_id: providerRequestId,
    });
    return reservation(data, error, "budget_submission_record_failed");
  }

  async uncertain(ownerId: string, reservationId: string, providerRequestId: string | null) {
    const { data, error } = await this.admin.rpc("mark_generation_unknown", {
      p_owner_id: ownerId, p_reservation_id: reservationId, p_provider_request_id: providerRequestId,
    });
    const result = reservation(data, error, "budget_uncertain_record_failed");
    logOps({ severity: "WARN", component: "budget", operation: "provider_unknown", owner_id: ownerId,
      correlation_id: reservationId, provider_job_id: providerRequestId, to_state: result.provider_submission_state, error_category: "PROVIDER" });
    return result;
  }

  async settle(ownerId: string, reservationId: string, actualUsd: number, providerRequestId: string | null) {
    const { data, error } = await this.admin.rpc("settle_generation_budget", {
      p_owner_id: ownerId, p_reservation_id: reservationId, p_actual_usd: actualUsd,
      p_provider_request_id: providerRequestId,
    });
    const result = reservation(data, error, "budget_settlement_failed");
    logOps({ severity: "INFO", component: "budget", operation: "settle", owner_id: ownerId,
      correlation_id: reservationId, provider_job_id: providerRequestId, to_state: result.state });
    return result;
  }

  async release(ownerId: string, reservationId: string, knownNotSubmitted: boolean) {
    const { data, error } = await this.admin.rpc("release_generation_budget", {
      p_owner_id: ownerId, p_reservation_id: reservationId, p_known_not_submitted: knownNotSubmitted,
    });
    return reservation(data, error, "budget_release_failed");
  }
}

export class PaidProviderNotSubmittedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaidProviderNotSubmittedError";
  }
}

export class PaidGenerationUncertainError extends Error {
  constructor(readonly reservationId: string, readonly providerRequestId: string | null, cause: unknown) {
    super("paid_generation_requires_reconciliation", { cause });
    this.name = "PaidGenerationUncertainError";
  }
}

function requestIdFrom(error: unknown) {
  if (typeof error !== "object" || error === null || !("requestId" in error)) return null;
  const value = (error as { requestId?: unknown }).requestId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function executePaidGeneration<T>(input: {
  ledger: AtomicBudgetLedger;
  reservation: ReserveBudgetInput;
  callProvider: (reservation: BudgetReservation) => Promise<{ value: T; providerRequestId: string; actualUsd: number }>;
  recoverSubmitted?: (providerRequestId: string) => Promise<{ value: T; actualUsd: number }>;
}) {
  const hold = await input.ledger.reserve(input.reservation);
  if (hold.state === "SETTLED") return { reservation: hold, value: null as T | null, replayed: true };
  if (hold.state === "RESERVED" && hold.provider_request_id &&
    ["SUBMITTING", "SUBMITTED", "SUBMITTED_UNKNOWN"].includes(hold.provider_submission_state) && input.recoverSubmitted) {
    try {
      // Retrieval is read-only at the provider. Never send a second paid generation request.
      const recovered = await input.recoverSubmitted(hold.provider_request_id);
      const settled = await input.ledger.settle(input.reservation.ownerId, hold.id, recovered.actualUsd, hold.provider_request_id);
      return { reservation: settled, value: recovered.value, replayed: true };
    } catch (error) {
      throw new PaidGenerationUncertainError(hold.id, hold.provider_request_id, error);
    }
  }
  if (hold.state !== "RESERVED" || hold.provider_submission_state !== "REQUEST_NOT_SENT") {
    throw new PaidGenerationUncertainError(hold.id, hold.provider_request_id, new Error("existing_operation_requires_reconciliation"));
  }
  await input.ledger.begin(input.reservation.ownerId, hold.id);
  let result: { value: T; providerRequestId: string; actualUsd: number };
  try {
    result = await input.callProvider(hold);
  } catch (error) {
    if (error instanceof PaidProviderNotSubmittedError) {
      await input.ledger.release(input.reservation.ownerId, hold.id, true);
      throw error;
    }
    const providerRequestId = requestIdFrom(error);
    await input.ledger.uncertain(input.reservation.ownerId, hold.id, providerRequestId);
    throw new PaidGenerationUncertainError(hold.id, providerRequestId, error);
  }
  try {
    await input.ledger.submitted(input.reservation.ownerId, hold.id, result.providerRequestId);
    const settled = await input.ledger.settle(input.reservation.ownerId, hold.id, result.actualUsd, result.providerRequestId);
    return { reservation: settled, value: result.value, replayed: false };
  } catch (error) {
    try {
      await input.ledger.uncertain(input.reservation.ownerId, hold.id, result.providerRequestId);
    } catch {
      // The first RPC may have committed; its durable state remains safe to reconcile.
    }
    throw new PaidGenerationUncertainError(hold.id, result.providerRequestId, error);
  }
}

export function recoverBudgetState(state: BudgetReservationState, providerState: ProviderSubmissionState) {
  if (state !== "RESERVED") return { state, providerState };
  if (providerState === "REQUEST_NOT_SENT") return { state: "EXPIRED" as const, providerState };
  if (providerState === "SUBMITTING") return { state, providerState: "SUBMITTED_UNKNOWN" as const };
  return { state, providerState };
}
