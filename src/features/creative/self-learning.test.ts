import { describe, expect, it, vi } from "vitest";
import { creativeFixture } from "./fixtures";
import { createCreativeAgent, type CreativeAgentOutput } from "./agent";
import type { CreativeIntelligenceResources } from "./intelligence";
import { adaptiveHistoryOutcomes, planSelfLearningCreative, readCreativeAttribution, sealCreativeAttribution,
  type CreativeLearningHistory } from "./self-learning";
import { assertHumanProductionReview, strategyFingerprint } from "./strategist";
import { creativeScriptDigest } from "./production-gate";
import { createAdaptiveArm, type AdaptiveArm, type AdaptiveOutcome } from "../growth/adaptive-experiments";
import {discoverTrendCandidates} from "../growth-manager/trend-discovery";

// SIMULATED_ONLY: exercises orchestration with a mocked HTTP transport. These
// synthetic observations/output are never evidence of real LLM creativity,
// TikTok performance, production learning, or actual video generation.
const now = new Date("2026-10-13T12:00:00Z");
function setup() {
  const context = creativeFixture("GROWTH"); context.account.id = "pilot-account";
  const resources: CreativeIntelligenceResources = { ownerId: "owner-1", now, optedIn: true, realAccount: false,
    affiliateEligible: false, facts: [], assets: [], trends: [], outcomes: [] };
  return { context, resources };
}
function generatedOutput(): CreativeAgentOutput {
  const hooks = ["ถ้ามีพื้นที่ว่างหนึ่งจุด", "มุมเล็ก ๆ ที่คุณเลือกเอง", "ลองมองโต๊ะจากอีกมุม"];
  return { analysis: { problem: { statement: null, basis: "UNKNOWN", evidenceIds: [] }, sellingPoints: [],
    audience: { segments: ["ผู้สนใจไอเดียจัดโต๊ะ"], basis: "HYPOTHESIS", evidenceIds: [] } },
  concepts: hooks.map((hook, i) => ({ id: `concept-${i}`, topic: `จัดโต๊ะ-${i}`, topicBasis: "HYPOTHESIS" as const,
    format: `freeform-visual-question-${i}`, hookPattern: `open-question-${i}`, angle: `personal-observation-${i}`, durationSeconds: 8 as const,
    concept: { angleType: "POV" as const, title: `SIMULATED_ONLY แนวคิด ${i}`, hook, coreMessage: "ชวนเลือกมุมที่อยากจัดใหม่",
      voiceScript: `${hook} คุณอยากเปลี่ยนตรงไหนก่อน ติดตามไอเดียถัดไป`,
      overlayText: [{ start: 0, end: 2, text: hook }, { start: 5, end: 8, text: "ติดตามไอเดียถัดไป" }],
      scenePlan: [{ start: 0, end: 2, visual: "ฉากโต๊ะสมมติประกอบคำถาม", motion: "แพนช้า" },
        { start: 2, end: 5, visual: "เว้นพื้นที่ให้ผู้ชมจินตนาการ", motion: "เปลี่ยนมุมเล็กน้อย" },
        { start: 5, end: 8, visual: "ปิดด้วยคำถามของผู้ชม", motion: "คงภาพบรรยากาศ" }],
      cta: "ติดตามไอเดียถัดไป", caption: `${hook} คุณจะเลือกมุมไหน`, hashtags: ["#ไอเดียจัดโต๊ะ", "#พื้นที่เล็ก"],
      visualStrategy: "ฉากบรรยากาศสมมติ ไม่ใช้แสดงผลสินค้าหรือเหตุการณ์จริง" },
    claims: [], production: { method: "GENERATIVE_ATMOSPHERE" as const, visualRole: "ATMOSPHERE_ONLY" as const,
      depictsProductOperation: false, evidenceIds: [], missingEvidence: [], reason: "เป็นภาพบรรยากาศประกอบคำถาม ไม่ใช่หลักฐานข้อเท็จจริง" },
    reasons: [`ทดสอบมุมเล่าเรื่อง ${i} โดยไม่อ้างผลลัพธ์ที่ยังไม่พิสูจน์`] })),
  selectedId: "concept-2", selectionReason: "เลือกอีกมุมมองเพื่อเปิดคำถามชวนผู้ชมคิด",
  alternativesReason: "เก็บมุมเปิดอีกสองแบบไว้ทดลองจากผลจริงภายหลัง" };
}
function simulatedProvider(output = generatedOutput()) {
  const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ status: "completed", output: [{ type: "message",
    content: [{ type: "output_text", text: JSON.stringify(output) }] }], usage: { input_tokens: 200, output_tokens: 700 } }),
  { status: 200, headers: { "content-type": "application/json" } }));
  return { transport, provider: createCreativeAgent({ provider: "openai", apiKey: "SIMULATED_ONLY-not-a-real-key", model: "simulated-test-model", transport }) };
}
function arm(index: number, overrides: Partial<Omit<AdaptiveArm, "id">> = {}): AdaptiveArm {
  return createAdaptiveArm({ ownerId: "owner-1", accountId: "pilot-account", mode: "GROWTH", contextKey: "organic-growth",
    hook: `open-question-${index}`, angle: `personal-observation-${index}`, topic: `จัดโต๊ะ-${index}`,
    productionMethod: "GENERATIVE_ATMOSPHERE", introducedAt: "2026-10-01T12:00:00Z", ...overrides });
}
function observations(selectedArm: AdaptiveArm, count = 6, overrides: Partial<AdaptiveOutcome> = {}): AdaptiveOutcome[] {
  return Array.from({ length: count }, (_, i) => {
    const publishedAt = new Date(Date.UTC(2026, 9, 3 + i, 12)).toISOString(), observedAt = new Date(Date.UTC(2026, 9, 4 + i, 12)).toISOString();
    return { evidenceId: `SIMULATED_ONLY:${selectedArm.id}:${i}`, ownerId: selectedArm.ownerId, accountId: selectedArm.accountId,
      mode: selectedArm.mode, contextKey: selectedArm.contextKey, armId: selectedArm.id, videoId: `${selectedArm.id}:video-${i}`,
      source: "SIMULATED", authorized: true, publishedAt, observedAt, window: { startAt: publishedAt, endAt: observedAt, complete: true },
      views: 1000, likes: 100, comments: 5, shares: 5, attributedFollowers: null, followerAttribution: "UNKNOWN", orders: null,
      commissionUsd: null, actualCostUsd: null, salesAttribution: "UNKNOWN", commerceVerified: false, costBasis: "UNKNOWN", ...overrides };
  });
}
function reverseKeys(value: unknown): unknown {
  return Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)])) : value;
}

describe("SIMULATED_ONLY LLM-to-adaptive orchestration", () => {
  it("cold starts with automatic bounded exploration and never asks an owner to choose a topic", async () => {
    const { context, resources } = setup(), stub = simulatedProvider();
    const result = await planSelfLearningCreative(context, resources, stub.provider,
      { cycleKey: "cold-start", availableSlots: 1, environment: "SIMULATED" });
    expect(result.contextSource).toBe("SIMULATED"); expect(result.decision.source).toBe("SIMULATED");
    expect(result.decision.status).toBe("EXPLORE");
    expect(result.arms.find(a => a.arm.id === result.decision.selectedArmId)?.conceptId).toBe(result.plan.selectedConceptId);
    expect(result.plan.topic).toBe(result.output.concepts.find(c => c.id === result.plan.selectedConceptId)?.topic);
    expect(result.plan.fingerprint).toBe(strategyFingerprint(result.plan));
    expect(result.plan.humanReviewRequired).toBe(true);
    expect(result.decision.executionAuthorized).toBe(false); expect(result.decision.rulesActivated).toBe(false);
    expect(result.paidVideoCalls).toBe(0); expect(result.postingCalls).toBe(0); expect(result.videoGenerated).toBe(false);
    expect(stub.transport.mock.calls.every(([url]) => url === "https://api.openai.com/v1/responses")).toBe(true);
  });
  it("passes scoped empirical assessments to the LLM before producing new candidates", async () => {
    const { context, resources } = setup(), stub = simulatedProvider();
    const own = arm(0), foreign = arm(0, { ownerId: "another-owner", accountId: "sales-account", contextKey: "other-context" });
    const result = await planSelfLearningCreative(context, resources, stub.provider,
      { cycleKey: "historical-context", availableSlots: 1, environment: "SIMULATED", historicalArms: [own, foreign],
        outcomes: [...observations(own), ...observations(foreign, 6, { attributedFollowers: 999, followerAttribution: "VIDEO" })] });
    const body = JSON.parse(String(stub.transport.mock.calls[0][1]?.body)), empirical = JSON.parse(body.input).empiricalLearning;
    expect(empirical.source).toBe("SIMULATED");
    expect(empirical.historicalArms.map((a: AdaptiveArm) => a.id)).toEqual([own.id]);
    expect(empirical.assessments).toHaveLength(1);
    expect(empirical.assessments[0]).toMatchObject({ armId: own.id, distinctVideos: 6, reward: .11 });
    expect(empirical.preferredArmId).toBe(own.id);
    expect(result.decision.evidenceIds.every(id => id.includes(own.id))).toBe(true);
    expect(result.decision.evidenceIds.some(id => id.includes(foreign.id))).toBe(false);
    expect(result.plan.concepts.every(c => c.score === 0 && c.confidence === null && Object.values(c.rubric).every(v => v === 0))).toBe(true);
  });
  it("uses explicit engagement objective when own per-video followers are unknown, despite foreign follower data", async () => {
    const { context, resources } = setup(), stub = simulatedProvider();
    const own = arm(0), foreign = arm(0, { accountId: "different-account" });
    const result = await planSelfLearningCreative(context, resources, stub.provider,
      { cycleKey: "unknown-followers", availableSlots: 1, environment: "SIMULATED", historicalArms: [own, foreign],
        outcomes: [...observations(own), ...observations(foreign, 6, { followerAttribution: "VIDEO", attributedFollowers: 500 })] });
    expect(result.decision.objective).toBe("ENGAGEMENT_PER_VIEW");
    expect(result.decision.assessments.find(a => a.armId === own.id)?.metrics.followersPer1000Views).toBeNull();
    const empirical = JSON.parse(JSON.parse(String(stub.transport.mock.calls[0][1]?.body)).input).empiricalLearning;
    expect(empirical.objective).toBe("ENGAGEMENT_PER_VIEW");
  });
  it("keeps attributed-follower objective only when accepted own evidence supports it", async () => {
    const { context, resources } = setup(), own = arm(0);
    const result = await planSelfLearningCreative(context, resources, simulatedProvider().provider,
      { cycleKey: "known-followers", availableSlots: 1, environment: "SIMULATED", historicalArms: [own],
        outcomes: observations(own, 6, { attributedFollowers: 12, followerAttribution: "VIDEO" }) });
    expect(result.decision.objective).toBe("ATTRIBUTED_FOLLOWERS_PER_1000_VIEWS");
    expect(result.decision.assessments.find(a => a.armId === own.id)?.metrics.followersPer1000Views).toBe(12);
  });
  it("binds the actual eligible adaptive choice rather than an ineligible LLM preference", async () => {
    const { context, resources } = setup(), output = generatedOutput();
    output.concepts[1].concept.voiceScript = "รักษาโรคหายขาดแน่นอน";
    output.concepts[2].production.method = "WAIT_FOR_EVIDENCE"; output.concepts[2].production.missingEvidence = ["ต้องจัดหาวิดีโอต้นทางจริง"];
    const result = await planSelfLearningCreative(context, resources, simulatedProvider(output).provider,
      { cycleKey: "only-eligible-candidate", availableSlots: 1, environment: "SIMULATED" });
    expect(result.output.selectedId).toBe("concept-2"); expect(result.plan.selectedConceptId).toBe("concept-0");
    expect(result.arms).toHaveLength(1); expect(result.decision.selectedArmId).toBe(result.arms[0].arm.id);
    expect(result.plan.fingerprint).toBe(strategyFingerprint(result.plan));
    expect(() => assertHumanProductionReview(result.plan)).toThrow("HUMAN_CREATIVE_REVIEW_REQUIRED");
    expect(assertHumanProductionReview(result.plan, { fingerprint: result.plan.fingerprint, conceptId: result.plan.selectedConceptId,
      reviewedBy: "owner-1", creativeApproved: true, factualAccuracyApproved: true, mediaRightsApproved: true }).id).toBe("concept-0");
  });
  it("does not make rejected or missing-evidence drafts eligible for an experiment", async () => {
    const { context, resources } = setup(), output = generatedOutput();
    for (const candidate of output.concepts) { candidate.production.method = "WAIT_FOR_EVIDENCE"; candidate.production.missingEvidence = ["หลักฐานต้นทางที่ยังขาด"]; }
    output.concepts[1].concept.voiceScript = "รักษาโรคหายขาดแน่นอน";
    const result = await planSelfLearningCreative(context, resources, simulatedProvider(output).provider,
      { cycleKey: "nothing-eligible", availableSlots: 1, environment: "SIMULATED" });
    expect(result.arms).toEqual([]); expect(result.decision.status).toBe("WAIT"); expect(result.decision.selectedArmId).toBeNull();
    expect(result.decision.executionAuthorized).toBe(false);
    expect(result.plan.concepts.every(c => !c.production.ready)).toBe(true);
  });
  it("rejects real-account automation without opt-in before any LLM request", async () => {
    const { context, resources } = setup(), stub = simulatedProvider(); resources.realAccount = true; resources.optedIn = false;
    await expect(planSelfLearningCreative(context, resources, stub.provider, { cycleKey: "no-consent", availableSlots: 1, environment: "REAL" }))
      .rejects.toThrow("CREATIVE_ACCOUNT_AUTOMATION_NOT_AUTHORIZED");
    expect(stub.transport).not.toHaveBeenCalled();
  });
  it("does not spend on new content when planner capacity is unavailable",async()=>{
    const {context,resources}=setup(),stub=simulatedProvider();
    await expect(planSelfLearningCreative(context,resources,stub.provider,{cycleKey:"no-capacity",availableSlots:0,environment:"SIMULATED"}))
      .rejects.toThrow("CREATIVE_PLANNER_CAPACITY_REQUIRED");
    expect(stub.transport).not.toHaveBeenCalled();
  });
  it("does not call the LLM again for an already persisted experimental cycle",async()=>{
    const {context,resources}=setup(),stub=simulatedProvider(),cycleKey="resumable-cycle";
    const first=await planSelfLearningCreative(context,resources,stub.provider,{cycleKey,availableSlots:1,environment:"SIMULATED"});
    await expect(planSelfLearningCreative(context,resources,stub.provider,{cycleKey,availableSlots:1,environment:"SIMULATED",ledger:[first.decision.proposal!]}))
      .rejects.toThrow("CREATIVE_EXPERIMENT_ALREADY_PROPOSED");
    expect(stub.transport).toHaveBeenCalledTimes(1);
  });
  it("rejects another account's precomputed discovery report before an LLM request",async()=>{
    const {context,resources}=setup(),stub=simulatedProvider();
    const discovery=await discoverTrendCandidates([],{accountId:"other-account"},now);
    await expect(planSelfLearningCreative(context,resources,stub.provider,{cycleKey:"wrong-discovery",availableSlots:1,environment:"SIMULATED",discovery}))
      .rejects.toThrow("CREATIVE_TREND_ACCOUNT_MISMATCH");
    expect(stub.transport).not.toHaveBeenCalled();
  });
});

describe("SIMULATED_ONLY immutable creative attribution", () => {
  async function provenance() {
    const { context, resources } = setup();
    const result = await planSelfLearningCreative(context, resources, simulatedProvider().provider,
      { cycleKey: "attribution-roundtrip", availableSlots: 1, environment: "SIMULATED" });
    const chosen = result.plan.concepts.find(c => c.id === result.plan.selectedConceptId)!;
    const idea = result.output.concepts.find(c => c.id === chosen.id)!;
    const scriptDigest = creativeScriptDigest({ hook_text: chosen.concept.hook, voice_script: chosen.concept.voiceScript,
      cta_text: chosen.concept.cta, caption: chosen.concept.caption, scene_plan_json: chosen.concept.scenePlan, overlay_text_json: chosen.concept.overlayText });
    const attribution = sealCreativeAttribution({ ownerId: "owner-1", arm: result.arms.find(a => a.conceptId === chosen.id)!.arm,
      spokenHook: chosen.concept.hook, format: idea.format, conceptId: chosen.id, planFingerprint: result.plan.fingerprint,
      scriptDigest, decision: result.decision.proposal, createdAt: now.toISOString() });
    const metadata = { creativeAttribution: attribution, productionStrategy: { plan: result.plan, conceptId: chosen.id, scriptDigest } };
    return { metadata, attribution };
  }
  it("roundtrips through JSONB object reordering without changing identity", async () => {
    const { metadata, attribution } = await provenance();
    const reordered = JSON.parse(JSON.stringify(reverseKeys(metadata)));
    expect(readCreativeAttribution(reordered, { ownerId: "owner-1", accountId: "pilot-account", mode: "GROWTH" })).toEqual(attribution);
  });
  it("rejects tampered attribution, plan, owner, account or mode", async () => {
    const { metadata } = await provenance();
    const scope = { ownerId: "owner-1", accountId: "pilot-account", mode: "GROWTH" };
    const changedHook = structuredClone(metadata); changedHook.creativeAttribution.spokenHook = "แทนที่คำพูดเดิม";
    expect(readCreativeAttribution(changedHook, scope)).toBeNull();
    const changedPlan = structuredClone(metadata); changedPlan.productionStrategy.plan.concepts[0].concept.voiceScript = "ข้อความใหม่";
    expect(readCreativeAttribution(changedPlan, scope)).toBeNull();
    expect(readCreativeAttribution(metadata, { ...scope, ownerId: "another-owner" })).toBeNull();
    expect(readCreativeAttribution(metadata, { ...scope, accountId: "sales-account" })).toBeNull();
    expect(readCreativeAttribution(metadata, { ...scope, mode: "AFFILIATE" })).toBeNull();
  });
  it("preserves unknown followers, ROI and publication windows rather than fabricating reward evidence", async () => {
    const { attribution } = await provenance();
    const history: CreativeLearningHistory[] = [{ attribution, evidenceId: "SIMULATED_ONLY:history-1", videoId: "clip-1", source: "MOCK",
      publishedAt: null, observedAt: now.toISOString(), metrics: { views: 100, likes: 5, comments: 1, shares: 1,
        favorites: null, clicks: null, orders: null, gmv: null, commission: null } }];
    const row = adaptiveHistoryOutcomes(history)[0];
    expect(row.source).toBe("SIMULATED"); expect(row.authorized).toBe(false); expect(row.window).toBeNull();
    expect(row.attributedFollowers).toBeNull(); expect(row.followerAttribution).toBe("UNKNOWN");
    expect(row.commissionUsd).toBeNull(); expect(row.actualCostUsd).toBeNull(); expect(row.salesAttribution).toBe("UNKNOWN");
  });
});
