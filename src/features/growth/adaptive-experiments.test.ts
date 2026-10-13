import { describe, expect, it } from "vitest";
import { createAdaptiveArm, decideAdaptiveExperiment, type AdaptiveArm, type AdaptiveExperimentInput, type AdaptiveOutcome } from "./adaptive-experiments";

const now = new Date("2026-10-25T12:00:00Z");
const context = { ownerId: "owner", accountId: "pilot", mode: "GROWTH" as const, contextKey: "TH:original-household", environment: "SIMULATED" as const,
  optedIn: true, affiliateEligible: false };
const arm = (hook: string, overrides: Partial<Parameters<typeof createAdaptiveArm>[0]> = {}) => createAdaptiveArm({ ownerId: context.ownerId,
  accountId: context.accountId, mode: context.mode, contextKey: context.contextKey, hook, angle: "explain one useful idea", topic: "home care",
  productionMethod: "owner footage with editing", introducedAt: "2026-09-01T00:00:00Z", ...overrides });
const a = arm("start with a practical question"), b = arm("show the problem before explaining");
function rows(candidate: AdaptiveArm, count = 6, followers = 5, first = "2026-10-15T00:00:00Z"): AdaptiveOutcome[] {
  return Array.from({ length: count }, (_, n) => {
    const publishedAt = new Date(Date.parse(first) + n * 86_400_000).toISOString(), endAt = new Date(Date.parse(publishedAt) + 86_400_000).toISOString();
    return { evidenceId: `${candidate.id}:e${first}:${n}`, videoId: `${candidate.id}:v${first}:${n}`, ownerId: candidate.ownerId, accountId: candidate.accountId,
      mode: candidate.mode, contextKey: candidate.contextKey, armId: candidate.id, source: "SIMULATED", authorized: true, publishedAt, observedAt: endAt,
      window: { startAt: publishedAt, endAt, complete: true }, views: 1000, likes: 50, comments: 10, shares: 10,
      attributedFollowers: followers, followerAttribution: "VIDEO", orders: null, commissionUsd: null, actualCostUsd: null,
      salesAttribution: "UNKNOWN", commerceVerified: false, costBasis: "UNKNOWN" };
  });
}
const input = (overrides: Partial<AdaptiveExperimentInput> = {}): AdaptiveExperimentInput => ({ context, cycleKey: "planner-2026-10-25:slot-0",
  now, observationWindowHours: 24, availableSlots: 1, arms: [a, b], outcomes: [], ledger: [], ...overrides });
const exploit = () => .99;

describe("contextual adaptive creative experiments", () => {
  it("uses stable semantic feature identities while admitting arbitrary LLM candidate formats", () => {
    expect(arm(` ${a.hook} `, { introducedAt: "2026-10-01T00:00:00Z" }).id).toBe(a.id);
    expect(arm("a new freeform pattern, never present in a catalogue").id).not.toBe(a.id);
    expect(arm(a.hook, { ownerId: "other" }).id).not.toBe(a.id);
    expect(arm(a.hook, { mode: "AFFILIATE" }).id).not.toBe(a.id);
    expect(() => arm("")).toThrow("ARM_INVALID");
  });
  it("cold-starts only an opted-in planner-approved slot and promises neither virality nor execution", () => {
    const result = decideAdaptiveExperiment(input(), () => .2);
    expect(result.status).toBe("EXPLORE"); expect([a.id, b.id]).toContain(result.selectedArmId);
    expect(result).toMatchObject({ preferredArmId: null, viralOutcome: "UNKNOWN", rulesActivated: false, executionAuthorized: false, humanReviewRequired: true });
    expect(decideAdaptiveExperiment(input({ availableSlots: 0 }), exploit).proposal).toBeNull();
    expect(decideAdaptiveExperiment(input({ context: { ...context, optedIn: false } }), exploit).proposal).toBeNull();
  });
  it("requires distinct videos, completed comparable windows and a multi-day credible sample", () => {
    const repeated = rows(a, 1).flatMap(row => Array.from({ length: 12 }, (_, n) => ({ ...row, evidenceId: `update-${n}`,
      observedAt: new Date(Date.parse(row.observedAt) + n * 3_600_000).toISOString(), attributedFollowers: 1000 })));
    expect(decideAdaptiveExperiment(input({ outcomes: repeated }), exploit).assessments.find(row => row.armId === a.id)).toMatchObject({ distinctVideos: 1, reward: null });
    const sameDay = rows(a).map((row, n) => ({ ...row, publishedAt: `2026-10-20T0${n}:00:00Z`, observedAt: `2026-10-21T0${n}:00:00Z`,
      window: { startAt: `2026-10-20T0${n}:00:00Z`, endAt: `2026-10-21T0${n}:00:00Z`, complete: true } }));
    expect(decideAdaptiveExperiment(input({ outcomes: sameDay }), exploit).preferredArmId).toBeNull();
    const mature = decideAdaptiveExperiment(input({ outcomes: [...rows(a, 6, 10), ...rows(b, 6, 2)] }), exploit);
    expect(mature).toMatchObject({ status: "EXPLOIT", selectedArmId: a.id, preferredArmId: a.id });
    expect(mature.assessments.find(row => row.armId === a.id)).toMatchObject({ objectiveSamples: 6, reward: 10, eligibleForExploitation: true });
  });
  it("does not select a winner from one exceptional clip", () => {
    const outcomes = [...rows(a, 6, 3), ...rows(b, 6, 2)]; outcomes.at(-1)!.attributedFollowers = 1000;
    expect(decideAdaptiveExperiment(input({ outcomes }), exploit).preferredArmId).toBe(a.id);
  });
  it("leaves missing follower attribution unknown instead of substituting views or account follower deltas", () => {
    const outcomes = rows(a).map(row => ({ ...row, followerAttribution: "ACCOUNT_DELTA" as const, attributedFollowers: 100 }));
    const result = decideAdaptiveExperiment(input({ outcomes }), exploit);
    expect(result.preferredArmId).toBeNull();
    expect(result.assessments.find(row => row.armId === a.id)).toMatchObject({ reason: "OBJECTIVE_UNKNOWN", reward: null,
      metrics: { followersPer1000Views: null, commissionRoi: null } });
    expect(decideAdaptiveExperiment(input({ outcomes, objective: "ENGAGEMENT_PER_VIEW" }), exploit).preferredArmId).toBe(a.id);
    expect(decideAdaptiveExperiment(input({ outcomes: rows(a).map(row => ({ ...row, shares: null })), objective: "ENGAGEMENT_PER_VIEW" }), exploit).preferredArmId).toBeNull();
  });
  it("does not invent publication timestamps or infer equal windows from cumulative snapshots", () => {
    const unknown = rows(a).map(row => ({ ...row, publishedAt: null, window: null }));
    const mismatched = rows(b).map(row => ({ ...row, window: { ...row.window!, endAt: row.publishedAt! } }));
    const result = decideAdaptiveExperiment(input({ outcomes: [...unknown, ...mismatched] }), exploit);
    expect(result.evidenceIds).toEqual([]); expect(result.preferredArmId).toBeNull();
    expect(result.excludedEvidence.map(row => row.reason)).toContain("PUBLICATION_OR_OBSERVATION_WINDOW_UNKNOWN");
    expect(result.excludedEvidence.map(row => row.reason)).toContain("INCOMPARABLE_EXPOSURE_WINDOW");
  });
  it("accepts explicitly bounded real exposure tolerance without relabeling older lifetime counts", () => {
    const source = rows(a), within = source.map(row => ({ ...row, observedAt: new Date(Date.parse(row.observedAt) + 45 * 60_000).toISOString(),
      window: { ...row.window!, endAt: new Date(Date.parse(row.window!.endAt) + 45 * 60_000).toISOString() } }));
    expect(decideAdaptiveExperiment(input({ outcomes: within }), exploit).preferredArmId).toBe(a.id);
    const beyond = within.map(row => ({ ...row, observedAt: new Date(Date.parse(row.observedAt) + 45 * 60_000).toISOString(),
      window: { ...row.window!, endAt: new Date(Date.parse(row.window!.endAt) + 45 * 60_000).toISOString() } }));
    expect(decideAdaptiveExperiment(input({ outcomes: beyond }), exploit).evidenceIds).toEqual([]);
    expect(decideAdaptiveExperiment(input({ outcomes: within, policy: { windowToleranceHours: 0 } }), exploit).evidenceIds).toEqual([]);
  });
  it("isolates owner, account, context, objective mode, source and REAL versus SIMULATED evidence", () => {
    const real = { ...context, environment: "REAL" as const };
    expect(decideAdaptiveExperiment(input({ context: real, outcomes: rows(a) })).evidenceIds).toEqual([]);
    const outcomes = rows(a).map(row => ({ ...row, source: "TIKTOK_DISPLAY" as const }));
    const result = decideAdaptiveExperiment(input({ context: real, outcomes: [...outcomes,
      ...outcomes.map(row => ({ ...row, ownerId: "other-owner", attributedFollowers: 1000 })),
      ...outcomes.map(row => ({ ...row, accountId: "sales-account" })), ...outcomes.map(row => ({ ...row, contextKey: "different audience" }))] }));
    expect(result.evidenceIds).toHaveLength(6);
    expect(result.assessments.find(row => row.armId === a.id)?.reward).toBe(5);
    expect(() => decideAdaptiveExperiment(input({ context: real }), exploit)).toThrow("SIMULATION_RNG_REAL_CONTEXT");
  });
  it("requires verified video-attributed commerce and actual nonzero spend for Affiliate ROI", () => {
    const affiliate = { ...context, mode: "AFFILIATE" as const, affiliateEligible: true }, candidate = arm("demonstrate the product", { mode: "AFFILIATE" });
    const outcomes = rows(candidate).map(row => ({ ...row, orders: 2, commissionUsd: .4, actualCostUsd: .1,
      salesAttribution: "VIDEO" as const, commerceVerified: true, costBasis: "ACTUAL" as const }));
    const measured = decideAdaptiveExperiment(input({ context: affiliate, arms: [candidate], outcomes }), exploit).assessments[0];
    expect(measured.reward).toBeCloseTo(3); expect(measured.metrics.commissionRoi).toBeCloseTo(3);
    for (const bad of [{ costBasis: "ESTIMATED" as const }, { actualCostUsd: 0 }, { commissionUsd: null }, { salesAttribution: "ACCOUNT" as const }, { commerceVerified: false }]) {
      expect(decideAdaptiveExperiment(input({ context: affiliate, arms: [candidate], outcomes: outcomes.map(row => ({ ...row, ...bad })) }), exploit).assessments[0].reward).toBeNull();
    }
    expect(decideAdaptiveExperiment(input({ context: { ...affiliate, affiliateEligible: false }, arms: [candidate], outcomes }), exploit).proposal).toBeNull();
    const real = { ...affiliate, environment: "REAL" as const };
    expect(decideAdaptiveExperiment(input({ context: real, arms: [candidate], outcomes: outcomes.map(row => ({ ...row, source: "TIKTOK_DISPLAY" })) })).assessments[0].reward).toBeNull();
    expect(decideAdaptiveExperiment(input({ context: real, arms: [candidate], outcomes: outcomes.map(row => ({ ...row, source: "TIKTOK_SHOP_ANALYTICS" })) })).assessments[0].reward).toBeCloseTo(3);
  });
  it("recent comparable evidence can reverse an old preferred pattern without sticky learned rules", () => {
    const old = [...rows(a, 8, 10, "2026-10-01T00:00:00Z"), ...rows(b, 8, 2, "2026-10-01T00:00:00Z")];
    expect(decideAdaptiveExperiment(input({ now: new Date("2026-10-10T00:00:00Z"), outcomes: old }), exploit).preferredArmId).toBe(a.id);
    const updated = [...old, ...rows(a, 7, 1, "2026-10-17T00:00:00Z"), ...rows(b, 7, 12, "2026-10-17T00:00:00Z")];
    const result = decideAdaptiveExperiment(input({ outcomes: updated }), exploit);
    expect(result.preferredArmId).toBe(b.id); expect(result.rulesActivated).toBe(false);
  });
  it("resamples a previously weak arm and admits new arms without a hardcoded account or candidate ceiling", () => {
    const outcomes = [...rows(a, 6, 10), ...rows(b, 6, 1)];
    const result = decideAdaptiveExperiment(input({ outcomes }), () => 0);
    expect(result).toMatchObject({ status: "EXPLORE", preferredArmId: a.id, selectedArmId: b.id });
    expect(result.controlledExperiment?.changedAxis).toBe("hook");
    expect(result.controlledExperiment?.originalityRequired).toBe(true);
    const candidates = Array.from({ length: 75 }, (_, n) => arm(`new pattern ${n}`));
    const many = decideAdaptiveExperiment(input({ arms: [a, b, ...candidates], outcomes, availableSlots: 200 }), () => .15);
    expect(many.assessments).toHaveLength(77); expect(many.status).toBe("EXPLORE");
    expect(candidates.map(row => row.id)).toContain(many.selectedArmId);
  });
  it("derives reproducible restart decisions and never creates a second proposal for a persisted cycle", () => {
    const initial = decideAdaptiveExperiment(input()), replay = decideAdaptiveExperiment(input());
    expect(replay).toEqual(initial);
    const resumed = decideAdaptiveExperiment(input({ ledger: [initial.proposal!], outcomes: rows(b, 6, 100) }), () => .99);
    expect(resumed).toMatchObject({ status: "ALREADY_PROPOSED", selectedArmId: initial.selectedArmId, proposal: null });
    const conflict = { ...initial.proposal!, selectedArmId: initial.selectedArmId === a.id ? b.id : a.id };
    expect(decideAdaptiveExperiment(input({ ledger: [initial.proposal!, conflict] }), exploit).status).toBe("REVIEW_REQUIRED");
    expect(decideAdaptiveExperiment(input({ cycleKey: "planner-next-day:slot-0", ledger: [initial.proposal!] })).proposal?.decisionId).not.toBe(initial.decisionId);
  });
  it("quarantines immutable evidence and video assignment conflicts while harmless duplicate snapshots remain one sample", () => {
    const valid = rows(a), duplicate = { ...valid[0], observedAt: "2026-10-16T07:00:00+07:00" };
    expect(decideAdaptiveExperiment(input({ outcomes: [...valid, duplicate] }), exploit).assessments.find(row => row.armId === a.id)?.distinctVideos).toBe(6);
    const contradictory = { ...valid[0], attributedFollowers: 999 };
    const conflict = decideAdaptiveExperiment(input({ outcomes: [...valid, contradictory] }), exploit);
    expect(conflict.assessments.find(row => row.armId === a.id)?.distinctVideos).toBe(5);
    expect(conflict.preferredArmId).toBeNull();
    expect(conflict.excludedEvidence.map(row => row.reason)).toContain("IMMUTABLE_EVIDENCE_OR_VIDEO_ASSIGNMENT_CONFLICT");
  });
});
