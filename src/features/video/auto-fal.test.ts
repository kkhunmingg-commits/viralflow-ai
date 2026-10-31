import { describe, expect, it, vi } from "vitest";
import type { AtomicBudgetLedger, BudgetReservation, ReserveBudgetInput } from "./budget-ledger";
import { PaidGenerationUncertainError, PaidProviderNotSubmittedError } from "./budget-ledger";
import type { FalWanVideoProvider, FalWanGenerationResult } from "./fal-wan";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server-env", () => ({ serverEnv: { falKey: undefined, falWanProviderState: "PRIMARY_CANDIDATE", videoProductImageAllowedHosts: [] } }));

const reservation: ReserveBudgetInput = { ownerId: "owner", accountId: "account", generationJobId: "job",
  autoRunId: "run", runKey: "run-key-123", logicalOperationKey: "stable-auto-fal-key", provider: "fal",
  model: "fal-ai/wan/v2.2-a14b/image-to-video/turbo", reservedUsd: .1, perVideoCapUsd: .1,
  dailyCapUsd: 1, monthlyCapUsd: 10, runCapUsd: 1, accountCapUsd: 1, providerCapUsd: 1,
  budgetDay: "2026-09-23", budgetMonth: "2026-09-01" };
const result: FalWanGenerationResult = { requestId: "fal-request", videoUrl: "https://example.invalid/video.mp4",
  provider: "fal", model: "fal-ai/wan/v2.2-a14b/image-to-video/turbo", resolution: "720p",
  aspectRatio: "9:16", estimatedCostUsd: .1, actualCostUsd: .1, retryCount: 0,
  sourceDurationSeconds: null, bytes: new Uint8Array([1, 2, 3]), checksum: "a".repeat(64) };

function boundaries() {
  let state: BudgetReservation = { id: "hold", owner_id: "owner", logical_operation_key: reservation.logicalOperationKey,
    reserved_usd: .1, actual_usd: null, state: "RESERVED", provider_submission_state: "REQUEST_NOT_SENT", provider_request_id: null };
  const ledger = {
    reserve: vi.fn(async () => state),
    begin: vi.fn(async () => { if (state.provider_submission_state !== "REQUEST_NOT_SENT") throw new Error("already_submitting");
      state = { ...state, provider_submission_state: "SUBMITTING" }; return state; }),
    submitted: vi.fn(async (_owner: string, _id: string, requestId: string) => {
      state = { ...state, provider_submission_state: "SUBMITTED", provider_request_id: requestId }; return state; }),
    uncertain: vi.fn(async (_owner: string, _id: string, requestId: string | null) => {
      state = { ...state, provider_submission_state: "SUBMITTED_UNKNOWN", provider_request_id: requestId }; return state; }),
    settle: vi.fn(async () => { state = { ...state, state: "SETTLED", actual_usd: .1, provider_submission_state: "CONFIRMED" }; return state; }),
    release: vi.fn(async () => { state = { ...state, state: "RELEASED", provider_submission_state: "FAILED" }; return state; }),
  };
  const provider = { estimateCost: vi.fn(() => .1), retrieve: vi.fn(async () => result),
    generate: vi.fn(async (input: { onSubmitted?: (requestId: string) => Promise<void> }) => {
      await input.onSubmitted?.(result.requestId); return result;
    }) };
  return { ledger: ledger as unknown as AtomicBudgetLedger, provider: provider as unknown as FalWanVideoProvider,
    calls: { ledger, provider }, current: () => state };
}

describe("Auto fal production submission boundary with network mocked", () => {
  it("reuses a pre-submission hold and settles one paid generation once", async () => {
    const { submitAutoFalWithBudget } = await import("./auto-fal-boundary");
    const fake = boundaries();
    await fake.ledger.reserve(reservation); // worker crashed after reserve, before begin
    const input = { ledger: fake.ledger, reservation, provider: fake.provider,
      image: new Blob([new Uint8Array([1])], { type: "image/jpeg" }), prompt: "product",
      beforeSubmit: async () => {} };
    const first = await submitAutoFalWithBudget(input);
    const replay = await submitAutoFalWithBudget(input);
    expect(first.value?.requestId).toBe("fal-request");
    expect(replay.replayed).toBe(true);
    expect(fake.calls.provider.generate).toHaveBeenCalledOnce();
    expect(fake.calls.ledger.settle).toHaveBeenCalledOnce();
    expect(fake.calls.ledger.submitted).toHaveBeenCalledWith("owner", "hold", "fal-request");
    expect(fake.calls.ledger.reserve).toHaveBeenCalledTimes(3);
  });

  it("releases a known pre-submission failure without calling fal", async () => {
    const { submitAutoFalWithBudget } = await import("./auto-fal-boundary");
    const fake = boundaries();
    await expect(submitAutoFalWithBudget({ ledger: fake.ledger, reservation, provider: fake.provider,
      image: new Blob(), prompt: "product", beforeSubmit: async () => { throw new PaidProviderNotSubmittedError("paused"); } }))
      .rejects.toBeInstanceOf(PaidProviderNotSubmittedError);
    expect(fake.calls.provider.generate).not.toHaveBeenCalled();
    expect(fake.calls.ledger.release).toHaveBeenCalledWith("owner", "hold", true);
  });

  it("recovers a known submitted request read-only and settles without a second paid call", async () => {
    const { submitAutoFalWithBudget } = await import("./auto-fal-boundary");
    const fake = boundaries();
    fake.calls.provider.generate.mockImplementationOnce(async input => {
      await input.onSubmitted?.("fal-timeout");
      throw Object.assign(new Error("timeout"), { requestId: "fal-timeout" });
    });
    fake.calls.provider.retrieve.mockResolvedValueOnce({ ...result, requestId: "fal-timeout" });
    const input = { ledger: fake.ledger, reservation, provider: fake.provider,
      image: new Blob(), prompt: "product", beforeSubmit: async () => {} };
    await expect(submitAutoFalWithBudget(input)).rejects.toBeInstanceOf(PaidGenerationUncertainError);
    const recovered = await submitAutoFalWithBudget(input);
    expect(recovered.replayed).toBe(true);
    expect(recovered.value?.requestId).toBe("fal-timeout");
    expect(fake.calls.provider.generate).toHaveBeenCalledOnce();
    expect(fake.calls.provider.retrieve).toHaveBeenCalledWith("fal-timeout");
    expect(fake.calls.ledger.settle).toHaveBeenCalledWith("owner", "hold", .1, "fal-timeout");
    expect(fake.current().state).toBe("SETTLED");
    expect(fake.calls.ledger.release).not.toHaveBeenCalled();
  });

  it("keeps an unknown request held instead of submitting a duplicate", async () => {
    const { submitAutoFalWithBudget } = await import("./auto-fal-boundary");
    const fake = boundaries();
    fake.calls.provider.generate.mockRejectedValueOnce(new Error("connection closed before request ID"));
    const input = { ledger: fake.ledger, reservation, provider: fake.provider,
      image: new Blob(), prompt: "product", beforeSubmit: async () => {} };
    await expect(submitAutoFalWithBudget(input)).rejects.toBeInstanceOf(PaidGenerationUncertainError);
    await expect(submitAutoFalWithBudget(input)).rejects.toBeInstanceOf(PaidGenerationUncertainError);
    expect(fake.calls.provider.generate).toHaveBeenCalledOnce();
    expect(fake.calls.provider.retrieve).not.toHaveBeenCalled();
    expect(fake.current().provider_submission_state).toBe("SUBMITTED_UNKNOWN");
  });
});
