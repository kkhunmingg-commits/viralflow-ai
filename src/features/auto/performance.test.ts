import { describe, expect, it } from "vitest";
import { planAccount } from "./engine";
import { fairSchedule } from "./scheduler";

describe("pilot-scale account scheduling", () => {
  it.each([15, 20])("schedules 10 accounts with %i candidates each fairly and deterministically", (perAccount) => {
    const plans = Array.from({ length: 10 }, (_, index) => planAccount({
      id: `account-${index.toString().padStart(2, "0")}`,
      requestedMode: index % 2 === 0 ? "GROWTH" : "AFFILIATE",
      commerceReady: true,
      providerAvailable: true,
      analyticsFresh: true,
      accountHealthy: true,
      consent: true,
      publishRemaining: 5,
      desiredCandidates: perAccount,
      desiredPosts: 2,
      priority: 50,
      affiliateDecision: "SCALE",
    }));
    const queue = fairSchedule(plans);
    expect(queue).toHaveLength(10 * perAccount);
    expect(queue.slice(0, 10).map((row) => row.accountId)).toEqual(plans.map((row) => row.accountId));
    expect(queue.at(-1)).toEqual({ accountId: "account-09", candidate: perAccount });
    expect(fairSchedule(plans.toReversed())).toEqual(queue);
    expect(new Set(queue.map((row) => `${row.accountId}:${row.candidate}`)).size).toBe(queue.length);
  });
});
