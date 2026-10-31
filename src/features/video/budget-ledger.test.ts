import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  executePaidGeneration,
  PaidGenerationUncertainError,
  PaidProviderNotSubmittedError,
  recoverBudgetState,
  type AtomicBudgetLedger,
  type BudgetReservation,
  type ReserveBudgetInput,
} from "./budget-ledger";

const migration = readFileSync("supabase/migrations/20260923143000_phase_11b_exactly_once_atomic_budget.sql", "utf8");
const request: ReserveBudgetInput = {
  ownerId: "owner", accountId: "account", generationJobId: null, autoRunId: null,
  runKey: "run-key-123", logicalOperationKey: "operation-key-123", provider: "fal", model: "wan",
  reservedUsd: 0.1, perVideoCapUsd: 0.1, dailyCapUsd: 1, monthlyCapUsd: 10,
  runCapUsd: 0.5, accountCapUsd: 1, providerCapUsd: 1,
  budgetDay: "2026-09-23", budgetMonth: "2026-09-01",
};

function row(patch: Partial<BudgetReservation> = {}): BudgetReservation {
  return { id: "reservation", owner_id: "owner", logical_operation_key: request.logicalOperationKey, reserved_usd: 0.1, actual_usd: null, state: "RESERVED", provider_submission_state: "REQUEST_NOT_SENT", provider_request_id: null, ...patch };
}

function ledger(overrides: Partial<Record<keyof AtomicBudgetLedger, unknown>> = {}) {
  return {
    reserve: vi.fn(async () => row()),
    begin: vi.fn(async () => row({ provider_submission_state: "SUBMITTING" })),
    submitted: vi.fn(async () => row({ provider_submission_state: "SUBMITTED", provider_request_id: "provider-1" })),
    uncertain: vi.fn(async () => row({ provider_submission_state: "SUBMITTED_UNKNOWN" })),
    settle: vi.fn(async () => row({ state: "SETTLED", provider_submission_state: "CONFIRMED", actual_usd: 0.1 })),
    release: vi.fn(async () => row({ state: "RELEASED", provider_submission_state: "FAILED" })),
    ...overrides,
  } as unknown as AtomicBudgetLedger;
}

describe("Phase 11B atomic paid generation", () => {
  it("serializes concurrent reservations by owner before checking every cap", () => {
    expect(migration).toContain("pg_advisory_xact_lock(hashtextextended(p_owner_id::text,0))");
    for (const cap of ["per_video_budget_exceeded", "daily_budget_exceeded", "monthly_budget_exceeded", "run_budget_exceeded", "account_budget_exceeded", "provider_budget_exceeded"]) expect(migration).toContain(cap);
    expect(migration).toContain("unique(owner_id,logical_operation_key)");
  });

  it("settles one provider call exactly once", async () => {
    const store = ledger();
    const callProvider = vi.fn(async () => ({ value: "video", providerRequestId: "provider-1", actualUsd: 0.1 }));
    const result = await executePaidGeneration({ ledger: store, reservation: request, callProvider });
    expect(result).toMatchObject({ value: "video", replayed: false, reservation: { state: "SETTLED" } });
    expect(callProvider).toHaveBeenCalledOnce();
    expect(store.settle).toHaveBeenCalledOnce();
  });

  it("holds uncertain provider submissions and never retries automatically", async () => {
    const store = ledger();
    const failure = Object.assign(new Error("timeout"), { requestId: "provider-timeout" });
    const callProvider = vi.fn(async () => { throw failure; });
    await expect(executePaidGeneration({ ledger: store, reservation: request, callProvider })).rejects.toBeInstanceOf(PaidGenerationUncertainError);
    expect(callProvider).toHaveBeenCalledOnce();
    expect(store.uncertain).toHaveBeenCalledWith("owner", "reservation", "provider-timeout");
    expect(store.release).not.toHaveBeenCalled();
  });

  it("stays fail-closed when persistence fails after provider acceptance", async () => {
    const store = ledger({
      submitted: vi.fn(async () => { throw new Error("database unavailable"); }),
      uncertain: vi.fn(async () => { throw new Error("database still unavailable"); }),
    });
    const callProvider = vi.fn(async () => ({ value: "video", providerRequestId: "provider-accepted", actualUsd: 0.1 }));
    await expect(executePaidGeneration({ ledger: store, reservation: request, callProvider })).rejects.toMatchObject({
      name: "PaidGenerationUncertainError", providerRequestId: "provider-accepted",
    });
    expect(callProvider).toHaveBeenCalledOnce();
    expect(store.settle).not.toHaveBeenCalled();
  });

  it("releases only an explicitly known pre-submission failure", async () => {
    const store = ledger();
    await expect(executePaidGeneration({ ledger: store, reservation: request, callProvider: async () => { throw new PaidProviderNotSubmittedError("rejected before send"); } })).rejects.toBeInstanceOf(PaidProviderNotSubmittedError);
    expect(store.release).toHaveBeenCalledWith("owner", "reservation", true);
    expect(store.uncertain).not.toHaveBeenCalled();
  });

  it("does not call the provider when the operation already settled", async () => {
    const store = ledger({ reserve: vi.fn(async () => row({ state: "SETTLED", provider_submission_state: "CONFIRMED", actual_usd: 0.1 })) });
    const callProvider = vi.fn();
    const result = await executePaidGeneration({ ledger: store, reservation: request, callProvider });
    expect(result.replayed).toBe(true);
    expect(callProvider).not.toHaveBeenCalled();
  });

  it("recovers stale holds without releasing a potentially charged request", () => {
    expect(recoverBudgetState("RESERVED", "REQUEST_NOT_SENT")).toEqual({ state: "EXPIRED", providerState: "REQUEST_NOT_SENT" });
    expect(recoverBudgetState("RESERVED", "SUBMITTING")).toEqual({ state: "RESERVED", providerState: "SUBMITTED_UNKNOWN" });
    expect(migration).toContain("provider_charge_must_be_reconciled");
    expect(migration).toContain("actual_usd <= reserved_usd");
  });

  it("keeps the ledger owner-readable and service-write-only", () => {
    expect(migration).toContain("alter table public.generation_budget_reservations enable row level security");
    expect(migration).toContain("revoke all on table public.generation_budget_reservations from public,anon,authenticated");
    expect(migration).not.toContain("grant insert on table public.generation_budget_reservations to authenticated");
  });
});
