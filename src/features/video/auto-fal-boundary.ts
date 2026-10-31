import { executePaidGeneration, PaidProviderNotSubmittedError, type AtomicBudgetLedger, type ReserveBudgetInput } from "./budget-ledger";
import { FalWanProviderError, type FalWanGenerationResult, type FalWanVideoProvider } from "./fal-wan";

type FalBoundary = Pick<FalWanVideoProvider, "estimateCost" | "generate" | "retrieve">;

export async function submitAutoFalWithBudget(input: { ledger: AtomicBudgetLedger; reservation: ReserveBudgetInput;
  provider: FalBoundary; image: Blob; prompt: string; beforeSubmit: () => Promise<void> }) {
  return executePaidGeneration<FalWanGenerationResult>({ ledger: input.ledger, reservation: input.reservation,
    recoverSubmitted: async requestId => {
      const value = await input.provider.retrieve(requestId);
      return { value, actualUsd: value.actualCostUsd };
    },
    callProvider: async hold => {
      try {
        await input.beforeSubmit();
        const value = await input.provider.generate({ image: input.image, prompt: input.prompt,
          maxCostUsd: input.reservation.reservedUsd, resolution: "720p", aspectRatio: "9:16",
          onSubmitted: async requestId => { await input.ledger.submitted(input.reservation.ownerId, hold.id, requestId); } });
        return { value, providerRequestId: value.requestId, actualUsd: value.actualCostUsd };
      } catch (error) {
        if (error instanceof FalWanProviderError && !error.requestId && error.actualCostUsd === 0) {
          throw new PaidProviderNotSubmittedError(error.code);
        }
        throw error;
      }
    } });
}
