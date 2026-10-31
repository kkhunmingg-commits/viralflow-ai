import { describe, expect, it } from "vitest";
import { calculateWinner, defaultBaseline } from "../analytics/scoring";
import { learningDecision } from "../analytics/learning";
import { evaluateSafetyGates, planAccount, stableAutoKey } from "./engine";
import { executionStages, processAutoAccount, processAutoCycle, type ExecutionClaim, type ExecutionPorts, type ExecutionStore, type ExecutionStage, type StageOutcome } from "./processor";

class MemoryStore implements ExecutionStore {
  runState = "RUNNING";
  accountState = "RUNNING";
  step: ExecutionStage | "COMPLETE" = "FIND_OPPORTUNITY";
  itemIndex = 1;
  checkpoint: Record<string, unknown> = { itemIndex: 1 };
  lease: string | null = null;
  history: string[] = [];
  finishCrashAt: ExecutionStage | null = null;
  constructor(readonly dailyTarget = 1) {}
  async runnableAccounts() { return this.runState === "RUNNING" && this.accountState === "RUNNING" ? ["account-a"] : []; }
  async claim(runId: string, accountId: string, workerId: string) {
    if (this.runState !== "RUNNING" || this.accountState !== "RUNNING" || this.lease || this.step === "COMPLETE") return null;
    this.lease = stableAutoKey(runId, accountId, this.itemIndex, this.step, workerId, "lease");
    return { ownerId: "owner-a", runId, accountId, mode: "GROWTH", itemIndex: this.itemIndex, dailyTarget: this.dailyTarget,
      step: this.step, attempt: 1, leaseToken: this.lease, checkpoint: structuredClone(this.checkpoint),
      operationKey: stableAutoKey(runId, accountId, this.itemIndex, this.step) } as ExecutionClaim;
  }
  async finish(claim: ExecutionClaim, outcome: StageOutcome, nextStep: ExecutionStage | "COMPLETE", nextItemIndex: number) {
    if (this.lease !== claim.leaseToken) throw new Error("lease_lost");
    if (this.finishCrashAt === claim.step) { this.finishCrashAt = null; throw new Error("simulated_worker_crash"); }
    this.history.push(`${claim.itemIndex}:${claim.step}:${outcome.kind}`);
    this.checkpoint = nextItemIndex > this.itemIndex ? { itemIndex: nextItemIndex } : { ...this.checkpoint, ...outcome.evidence };
    this.itemIndex = nextItemIndex;
    this.step = nextStep;
    this.lease = null;
    if (nextStep === "COMPLETE") this.runState = this.accountState = "COMPLETED";
    else if (outcome.kind === "WAIT") this.accountState = outcome.state;
    else if (outcome.kind === "RECONCILE") this.accountState = "WAITING_FOR_RECONCILIATION";
  }
  async fail(claim: ExecutionClaim, failure: { nextState: string }) { this.accountState = failure.nextState; this.lease = null; this.history.push(`${claim.step}:FAILED`); }
  restart() { this.lease = null; }
  resume() { this.runState = this.accountState = "RUNNING"; }
}

function mockPorts(overrides: Partial<ExecutionPorts> = {}) {
  const effects = new Map<string, string>();
  const calls: string[] = [];
  let providerCalls = 0;
  const done = (step: ExecutionStage, field: string) => async (claim: ExecutionClaim): Promise<StageOutcome> => {
    calls.push(step);
    if (step === "GENERATE_VIDEO") providerCalls++;
    const prior = effects.get(claim.operationKey);
    const value = prior ?? `${field}-${claim.itemIndex}`;
    effects.set(claim.operationKey, value);
    return { kind: "ADVANCE", evidence: { [field]: value } };
  };
  const ports: ExecutionPorts = {
    FIND_OPPORTUNITY: done("FIND_OPPORTUNITY", "assignmentId"),
    CREATE_CREATIVE: done("CREATE_CREATIVE", "projectId"),
    GENERATE_VIDEO: done("GENERATE_VIDEO", "videoId"),
    QUALITY_CHECK: async (claim) => { calls.push("QUALITY_CHECK"); expect(claim.checkpoint.videoId).toBeTruthy(); return { kind: "ADVANCE", evidence: { qualityScore: 92 } }; },
    COMPLIANCE_CHECK: async () => { calls.push("COMPLIANCE_CHECK"); const gate = evaluateSafetyGates({ mode: "GROWTH", quality: true, compliance: true, productTruth: true, aigc: true, originality: true, crossAccountUnique: true, accountHealth: true, commerceReady: false, publishCapacity: true, consent: true }); expect(gate.passed).toBe(true); return { kind: "ADVANCE", evidence: { eligibilityStatus: "READY_TO_PUBLISH" } }; },
    QUEUE_PUBLISH: done("QUEUE_PUBLISH", "queueId"),
    PUBLISH: done("PUBLISH", "externalVideoId"),
    COLLECT_ANALYTICS: async () => { calls.push("COLLECT_ANALYTICS"); const winner = calculateWinner({ id: "video-1", accountId: "account-a", mode: "GROWTH", ageHours: 24, sourceConfidence: .95, commerceAvailable: false, baseline: defaultBaseline(), views: 5000, likes: 700, comments: 90, shares: 180, favorites: 210, clicks: null, orders: null, gmv: null, commission: null }); return { kind: "ADVANCE", evidence: { winnerDecision: winner.decision, winnerScoreId: "winner-1" } }; },
    LEARN: async (claim) => { calls.push("LEARN"); expect(claim.checkpoint.winnerScoreId).toBe("winner-1"); return { kind: "ADVANCE", evidence: { learningDecision: learningDecision({ decision: "SCALE" } as never) } }; },
    ...overrides,
  };
  return { ports, calls, effects, get providerCalls() { return providerCalls; } };
}

describe("Phase 11F Auto Execution Processor", () => {
  it("advances the entire mocked Growth pipeline from one operator START", async () => {
    const plan = planAccount({ id: "account-a", requestedMode: "GROWTH", commerceReady: false, providerAvailable: true,
      providerBudgetAvailable: true, analyticsFresh: true, accountHealthy: true, consent: false,
      deferConsentUntilPublish: true, publishRemaining: 1, desiredCandidates: 1, desiredPosts: 1, priority: 1 });
    expect(plan.state).toBe("RUNNING");
    const store = new MemoryStore(), mock = mockPorts();
    const result = await processAutoCycle(store, mock.ports, "run-a", "worker-a");
    expect(result.results).toHaveLength(executionStages.length);
    expect(store.runState).toBe("COMPLETED");
    expect(mock.calls).toEqual([...executionStages]);
    expect(store.history.at(-1)).toBe("1:LEARN:ADVANCE");
  });

  it("restarts after a creative/checkpoint crash without duplicating the creative side effect", async () => {
    const store = new MemoryStore(), mock = mockPorts();
    await processAutoAccount(store, mock.ports, "run-a", "account-a", "worker-a");
    store.finishCrashAt = "CREATE_CREATIVE";
    await expect(processAutoAccount(store, mock.ports, "run-a", "account-a", "worker-a")).rejects.toThrow("simulated_worker_crash");
    store.restart();
    await processAutoCycle(store, mock.ports, "run-a", "worker-b");
    expect(store.runState).toBe("COMPLETED");
    expect(mock.calls.filter((step) => step === "CREATE_CREATIVE")).toHaveLength(2);
    expect(mock.effects.size).toBe(5);
    expect(store.history.filter((entry) => entry.includes("CREATE_CREATIVE:ADVANCE"))).toHaveLength(1);
  });

  it("claims a logical step only once across competing workers", async () => {
    const store = new MemoryStore(), mock = mockPorts();
    const claims = await Promise.all([
      store.claim("run-a", "account-a", "worker-a"),
      store.claim("run-a", "account-a", "worker-b"),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims[0]?.operationKey).toBe(stableAutoKey("run-a", "account-a", 1, "FIND_OPPORTUNITY"));
    store.restart();
    await processAutoCycle(store, mock.ports, "run-a", "worker-c");
    expect(store.runState).toBe("COMPLETED");
  });

  it("halts at PAUSE and STOP, then resumes from the saved step", async () => {
    const store = new MemoryStore(), mock = mockPorts();
    await processAutoAccount(store, mock.ports, "run-a", "account-a", "worker-a");
    store.runState = store.accountState = "PAUSED";
    expect((await processAutoCycle(store, mock.ports, "run-a", "worker-b")).results).toHaveLength(0);
    store.resume();
    await processAutoCycle(store, mock.ports, "run-a", "worker-c");
    expect(store.runState).toBe("COMPLETED");
    expect(mock.calls.filter((step) => step === "FIND_OPPORTUNITY")).toHaveLength(1);
    store.runState = store.accountState = "STOPPED";
    expect((await processAutoCycle(store, mock.ports, "run-a", "worker-d")).results).toHaveLength(0);
  });

  it("waits for provider readiness without repeating earlier stages", async () => {
    const store = new MemoryStore(); let ready = false;
    const mock = mockPorts({ GENERATE_VIDEO: async (claim) => ready
      ? { kind: "ADVANCE", evidence: { videoId: `video-${claim.itemIndex}` } }
      : { kind: "WAIT", state: "WAITING_FOR_PROVIDER", reason: "PROVIDER_UNAVAILABLE" } });
    await processAutoCycle(store, mock.ports, "run-a", "worker-a");
    expect(store.accountState).toBe("WAITING_FOR_PROVIDER");
    ready = true; store.resume();
    await processAutoCycle(store, mock.ports, "run-a", "worker-b");
    expect(store.runState).toBe("COMPLETED");
    expect(mock.calls.filter((step) => step === "CREATE_CREATIVE")).toHaveLength(1);
  });

  it("holds unknown publication for reconciliation and never submits a second time", async () => {
    const store = new MemoryStore(); let submissions = 0;
    const mock = mockPorts({ PUBLISH: async () => { submissions++; return { kind: "RECONCILE", reason: "RECONCILIATION_REQUIRED" }; } });
    await processAutoCycle(store, mock.ports, "run-a", "worker-a");
    expect(store.accountState).toBe("WAITING_FOR_RECONCILIATION");
    await processAutoCycle(store, mock.ports, "run-a", "worker-b");
    expect(submissions).toBe(1);
  });

  it("skips rejected compliance and blocks generation before spending when budget is exhausted", async () => {
    const rejected = new MemoryStore(), rejectPorts = mockPorts({ COMPLIANCE_CHECK: async () => ({ kind: "SKIP_ITEM", reason: "COMPLIANCE_REJECTED" }) });
    await processAutoCycle(rejected, rejectPorts.ports, "run-a", "worker-a");
    expect(rejected.runState).toBe("COMPLETED");
    expect(rejectPorts.calls).not.toContain("PUBLISH");
    const budget = new MemoryStore();
    const budgetPorts = mockPorts({ GENERATE_VIDEO: async () => ({ kind: "WAIT", state: "BLOCKED", reason: "BUDGET_EXCEEDED" }) });
    await processAutoCycle(budget, budgetPorts.ports, "run-b", "worker-b");
    expect(budget.accountState).toBe("BLOCKED");
    expect(budgetPorts.providerCalls).toBe(0);
  });
});
