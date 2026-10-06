import { describe, expect, it, vi } from "vitest";
import { accountReadyForGeneration } from "./services";
import { planAccount } from "./engine";

vi.mock("@/lib/server-env", () => ({ serverEnv: {} }));

describe("generation health follows the selected posting transport", () => {
  it("plans EXPORT for a disconnected account without requiring TikTok authorization", () => {
    const accountHealthy = accountReadyForGeneration({ account_status: "disconnected", authorization_status: "revoked" }, "EXPORT");
    const plan = planAccount({ id: "account-a", requestedMode: "GROWTH", commerceReady: false, providerAvailable: true,
      providerBudgetAvailable: true, analyticsFresh: true, accountHealthy, consent: false, deferConsentUntilPublish: true,
      publishRemaining: 3, desiredCandidates: 1, desiredPosts: 1, priority: 50 });
    expect(plan.state).toBe("RUNNING");
    expect(plan.blockers).toEqual([]);
  });
  it("still blocks known restricted or suspended account health for EXPORT", () => {
    for (const account_status of ["restricted", "suspended", "paused"])
      expect(accountReadyForGeneration({ account_status, authorization_status: "authorized" }, "EXPORT")).toBe(false);
    expect(accountReadyForGeneration({ account_status: "unknown", authorization_status: "revoked" }, "EXPORT")).toBe(true);
  });
  it("keeps AUTO and DRAFT authorization requirements unchanged", () => {
    for (const mode of ["AUTO", "DRAFT"] as const) {
      expect(accountReadyForGeneration({ account_status: "disconnected", authorization_status: "revoked" }, mode)).toBe(false);
      expect(accountReadyForGeneration({ account_status: "active", authorization_status: "revoked" }, mode)).toBe(false);
      expect(accountReadyForGeneration({ account_status: "active", authorization_status: "authorized" }, mode)).toBe(true);
    }
  });
});
