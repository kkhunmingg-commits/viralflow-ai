import { describe, expect, it, vi } from "vitest";
import { createCreativeAgent, runCreativeAgent, creativeAgentOutputSchema, type CreativeAgentOutput } from "./agent";
import { assertHumanProductionReview, type CreativeStrategyInput } from "./strategist";

const now = new Date("2026-10-13T12:00:00Z");
function input(product = true): CreativeStrategyInput {
  return { now, account: { id: "pilot-account", mode: product ? "AFFILIATE" : "GROWTH", affiliateEligible: product },
    ...(product ? { product: { id: "mop", title: "ถังปั่นไม้ถูพื้น", mechanism: "COMPLEX" as const } } : {}), facts: [],
    assets: product ? [{ id: "real-footage", kind: "REAL_FOOTAGE", source: "OWNER", reference: "owner-reviewed-evidence-record",
      rightsConfirmed: true, reviewed: true, productId: "mop", durationSeconds: 8 },
    { id: "real-image", kind: "REAL_IMAGE", source: "OWNER", reference: "owner-reviewed-photo-record", rightsConfirmed: true,
      reviewed: true, productId: "mop" }] : [] };
}
function output(product = true): CreativeAgentOutput {
  const hooks = ["ดูจังหวะนี้ใกล้ ๆ", "สังเกตส่วนนี้ก่อนเลือก", "คุณมองเห็นจุดไหนก่อน"];
  return { analysis: { problem: { statement: null, basis: "UNKNOWN", evidenceIds: [] }, sellingPoints: [],
    audience: { segments: [product ? "ผู้สนใจของใช้ในบ้าน" : "ผู้ชอบไอเดียจัดโต๊ะ"], basis: "HYPOTHESIS", evidenceIds: [] } },
  concepts: hooks.map((hook, i) => ({ id: `idea-${i}`, topic: product ? "การใช้ถังปั่น" : `ไอเดียจัดโต๊ะ-${i}`, topicBasis: "HYPOTHESIS" as const,
    format: ["one-take-real-mechanism", "annotated-photo-closeup", "viewer-question-story"][i],
    hookPattern: ["look-closely", "details-before-choice", "participation-question"][i],
    angle: ["one-step-actual-operation", "visible-design-detail", "curiosity-through-observation"][i], durationSeconds: 8 as const,
    concept: { angleType: product ? i === 1 ? "REVIEW_DISCOVERY" as const : "DEMONSTRATION" as const : "POV" as const,
      title: `${hook} แบบที่ ${i}`, hook, coreMessage: product ? "ดูการทำงานจากภาพจริง" : "เลือกหนึ่งจุดที่คุณอยากจัดใหม่",
      voiceScript: product ? `${hook} ดูช็อตนี้แล้วค่อยตัดสินใจ` : `${hook} เลือกหนึ่งจุดที่อยากจัดใหม่ แล้วติดตามไอเดียถัดไป`,
      overlayText: [{ start: 0, end: 2, text: hook }, { start: 6, end: 8, text: product ? "ดูรายละเอียดก่อนเลือก" : "ติดตามไอเดียถัดไป" }],
      scenePlan: [{ start: 0, end: 2, visual: product ? "เปิดภาพสินค้าจริง" : "เปิดฉากโต๊ะสมมติ", motion: "ค่อย ๆ ขยับมุม" },
        { start: 2, end: 5, visual: product ? "ใช้ภาพต้นทางที่ตรวจแล้ว" : "แสดงพื้นที่ว่างในฉากบรรยากาศสมมติ", motion: "คงความต่อเนื่อง" },
        { start: 5, end: 8, visual: "ปิดด้วยคำถามสั้น", motion: "กลับสู่มุมเปิด" }],
      cta: product ? "ดูรายละเอียดก่อนเลือก" : "ติดตามไอเดียถัดไป", caption: `${hook} ชวนสังเกตหนึ่งจุด`,
      hashtags: ["#ไอเดีย", "#วิดีโอสั้น"], visualStrategy: product ? "ใช้สื่อต้นทางจริงเท่านั้น" : "ฉากสมมติประกอบคำถาม ไม่ใช้ยืนยันผลสินค้า" },
    claims: [], production: { method: product ? i === 1 ? "REAL_IMAGE_MOTION" as const : "REAL_FOOTAGE_EDIT" as const : "GENERATIVE_ATMOSPHERE" as const,
      visualRole: product ? i === 1 ? "STATIC_PRODUCT_DETAIL" as const : "PRODUCT_EVIDENCE" as const : "ATMOSPHERE_ONLY" as const,
      depictsProductOperation: product && i !== 1, evidenceIds: product ? [i === 1 ? "real-image" : "real-footage"] : [],
      missingEvidence: [], reason: product ? "ใช้ภาพจริงเพื่อไม่สร้างแกนหรือกลไกผิด" : "เป็นคำถามทดลอง ภาพบรรยากาศไม่ใช้แทนข้อเท็จจริง" },
    reasons: [`แนวคิดที่ ${i} ทดลองคำถามคนละมุมโดยไม่เพิ่มคำกล่าวอ้าง`] })),
  selectedId: "idea-2", selectionReason: "เลือกคำถามที่ชวนสังเกตจากภาพต้นทางและไม่เพิ่มผลลัพธ์ที่ยังไม่พิสูจน์",
  alternativesReason: "อีกสองแนวคิดใช้จุดเริ่มต่างกัน เก็บไว้ทดลองเมื่อมีผลตอบรับจริง" };
}
function adapter(value: unknown, response: { status?: string; http?: number; refusal?: boolean } = {}) {
  const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ status: response.status ?? "completed",
    output: [{ type: "message", content: response.refusal ? [{ type: "refusal", refusal: "Test refusal" }]
      : [{ type: "output_text", text: JSON.stringify(value) }] }], usage: { input_tokens: 120, output_tokens: 350 } }),
  { status: response.http ?? 200, headers: { "content-type": "application/json" } }));
  const provider = createCreativeAgent({ provider: "openai", apiKey: "unit-test-not-a-real-key", model: "configured-test-model", transport });
  return { provider, transport };
}

describe("actual LLM creative strategy adapter with mocked network only", () => {
  it("uses official Responses strict task schema, bounded tokens and no model self-ratings", async () => {
    const stub = adapter(output());
    const result = await runCreativeAgent(input(), stub.provider, { maxOutputTokens: 4000, learningEvidence: { arms: [{ hook: "participation-question" }] } });
    expect(stub.transport).toHaveBeenCalledTimes(1);
    const [url, request] = stub.transport.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({ model: "configured-test-model", store: false, max_output_tokens: 4000,
      text: { format: { type: "json_schema", name: "creative_agent_strategy", strict: true } } });
    expect(body.text.format.schema.properties.concepts.items.properties.concept.properties).not.toHaveProperty("modelSignals");
    expect(JSON.parse(body.input).empiricalLearning.arms[0].hook).toBe("participation-question");
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 350 });
    expect(result.plan.source).toBe("LLM_EVIDENCE_STRATEGY");
    expect(result.paidVideoCalls).toBe(0); expect(result.postingCalls).toBe(0);
  });
  it("uses LLM-selected topic/format and alternative rather than fixed rubric ordering", async () => {
    const generated = output(); generated.concepts[2].format = "unexpected-offscreen-question-and-real-reveal";
    const result = await runCreativeAgent(input(), adapter(generated).provider);
    expect(result.plan.selectedConceptId).toBe("idea-2");
    expect(result.output.concepts[2].format).toBe("unexpected-offscreen-question-and-real-reveal");
    expect(result.output.concepts[2].hookPattern).toBe("participation-question");
    expect(result.plan.concepts.every(c => c.score === 0 && c.confidence === null)).toBe(true);
    expect(result.plan.predictedVirality).toBe("UNKNOWN");
    expect(result.plan.concepts[2].reasons).toContain(generated.selectionReason);
  });
  it("allows more than three concepts and free-form labels without angle diversity quotas", async () => {
    const generated = output(false), fourth = structuredClone(generated.concepts[0]);
    fourth.id = "new-idea"; fourth.format = "tiny-mystery-reveal"; fourth.hookPattern = "new-open-loop"; fourth.angle = "small-space-observation";
    fourth.concept.hook = "หนึ่งช่องว่างที่คุณอาจมองข้าม"; fourth.concept.voiceScript = "หนึ่งช่องว่างที่คุณอาจมองข้าม คุณอยากเปลี่ยนจุดนี้อย่างไร";
    generated.concepts.push(fourth); generated.selectedId = fourth.id;
    const result = await runCreativeAgent(input(false), adapter(generated).provider);
    expect(result.plan.concepts).toHaveLength(4);
    expect(result.plan.selectedConceptId).toBe("new-idea");
    expect(result.output.concepts.every(c => c.concept.angleType === "POV")).toBe(true);
  });
  it("fails clearly without a real configured LLM and never falls back to mock templates", async () => {
    expect(() => createCreativeAgent({ provider: "mock", model: "mock" })).toThrow("CREATIVE_LLM_NOT_CONFIGURED");
    expect(() => createCreativeAgent({ provider: "openai", model: "configured-test-model" })).toThrow("CREATIVE_LLM_NOT_CONFIGURED");
    const mock = { provider: "mock", model: "unit-mock", generateStructured: vi.fn() };
    await expect(runCreativeAgent(input(), mock)).rejects.toThrow("CREATIVE_LLM_NOT_CONFIGURED");
    expect(mock.generateStructured).not.toHaveBeenCalled();
  });
  it.each([{ status: "incomplete" }, { refusal: true }, { http: 403 }])("does not silently retry or use templates after %j", async response => {
    const stub = adapter(output(), response);
    await expect(runCreativeAgent(input(), stub.provider)).rejects.toThrow();
    expect(stub.transport).toHaveBeenCalledTimes(1);
  });
  it("holds mechanics for real footage and refuses generative reconstruction even if LLM chose it", async () => {
    const generated = output(); generated.concepts[2].production.method = "GENERATIVE_ATMOSPHERE";
    const result = await runCreativeAgent(input(), adapter(generated).provider);
    expect(result.plan.selectedConceptId).toBe("idea-2");
    expect(result.plan.concepts[2].status).toBe("WAIT_FOR_EVIDENCE");
    expect(result.plan.concepts[2].production.method).toBe("WAIT_FOR_EVIDENCE");
  });
  it("does not turn unreviewed/wrong-product/short footage into verified operation proof", async () => {
    const resources = input(); resources.assets[0].durationSeconds = 5; resources.assets[1].reviewed = false;
    const result = await runCreativeAgent(resources, adapter(output()).provider);
    expect(result.plan.concepts.every(c => !c.production.ready)).toBe(true);
  });
  it("does not call a static image a working mechanism", async () => {
    const generated = output(); generated.concepts[1].production.depictsProductOperation = true;
    const result = await runCreativeAgent(input(), adapter(generated).provider);
    expect(result.plan.concepts[1].status).toBe("WAIT_FOR_EVIDENCE");
  });
  it("keeps novel Growth ideas hypotheses and permits atmosphere only as non-evidentiary content", async () => {
    const result = await runCreativeAgent(input(false), adapter(output(false)).provider);
    expect(result.plan.topic).toBe("ไอเดียจัดโต๊ะ-2");
    expect(result.plan.trendStatus).toBe("UNKNOWN");
    expect(result.plan.concepts.every(c => c.production.method === "GENERATIVE_ATMOSPHERE" && c.status === "REVIEW_REQUIRED")).toBe(true);
    expect(result.plan.humanReviewRequired).toBe(true);
  });
  it("accepts original graphic stories only for Growth, as graphics, with a cited fact and readable cards", async () => {
    const growthInput = { ...input(false), facts: [{ id: "fact-1", text: "วางของใช้บ่อยไว้ใกล้มือ", source: "AUTHORIZED_SOURCE" as const,
      reference: "authorized-source-record", verified: true, capturedAt: "2026-10-13T10:00:00Z", topic: "ไอเดียจัดโต๊ะ-2", role: "OBSERVATION" as const }] };
    const graphic = (mutate: (c: CreativeAgentOutput["concepts"][number]) => void = () => {}) => {
      const generated = output(false), c = generated.concepts[2];
      c.production = { ...c.production, method: "ORIGINAL_GRAPHIC_STORY", visualRole: "ORIGINAL_GRAPHIC", depictsProductOperation: false, evidenceIds: ["fact-1"] };
      c.claims = [{ text: "วางของใช้บ่อยไว้ใกล้มือ", evidenceIds: ["fact-1"] }] as typeof c.claims;
      c.concept = { ...c.concept, hook: "รู้ไหม เรื่องนี้มีเหตุผล", voiceScript: "วางของใช้บ่อยไว้ใกล้มือ", cta: "ติดตามไว้" };
      mutate(c); return generated;
    };
    const ok = await runCreativeAgent(growthInput, adapter(graphic()).provider);
    expect(ok.plan.concepts[2].production.missingEvidence).toEqual([]);
    expect(ok.plan.concepts[2].production.method).toBe("ORIGINAL_GRAPHIC_STORY");
    for (const bad of [graphic(c => { c.production.visualRole = "PRODUCT_EVIDENCE"; }), graphic(c => { c.claims = []; }),
      graphic(c => { c.concept.voiceScript = "ข้อความยาวมากเกินกว่าจะอ่านทันบนการ์ดหนึ่งใบในเวลาสั้นๆ"; })]) {
      expect((await runCreativeAgent(growthInput, adapter(bad).provider)).plan.concepts[2].status).toBe("WAIT_FOR_EVIDENCE");
    }
  });
  it("does not treat an LLM assertion as verified trend evidence", async () => {
    const generated = output(false); generated.concepts[2].topicBasis = "OBSERVED";
    const result = await runCreativeAgent(input(false), adapter(generated).provider);
    expect(result.plan.trendStatus).toBe("UNKNOWN");
    expect(result.plan.concepts[2].status).toBe("WAIT_FOR_EVIDENCE");
  });
  it("rejects fabricated evidence IDs without buying a replacement text result", async () => {
    const generated = output(); generated.analysis.problem = { statement: "ใช้งานรวดเร็วขึ้น", basis: "VERIFIED", evidenceIds: ["invented-proof"] };
    const stub = adapter(generated);
    await expect(runCreativeAgent(input(), stub.provider)).rejects.toThrow("CREATIVE_LLM_EVIDENCE_INVALID");
    expect(stub.transport).toHaveBeenCalledTimes(1);
  });
  it("rejects an ad claim with unverified support and never grants human approval itself", async () => {
    const generated = output(); generated.concepts[2].claims = [{ text: "ผลดีขึ้นแน่นอน", evidenceIds: ["missing-claim"] }];
    const result = await runCreativeAgent(input(), adapter(generated).provider);
    expect(result.plan.concepts[2].status).toBe("REJECTED");
    expect(() => assertHumanProductionReview(result.plan)).toThrow("HUMAN_CREATIVE_REVIEW_REQUIRED");
  });
  it("keeps internal missing-evidence diagnostics out of spoken copy", async () => {
    const generated = output(); generated.concepts[2].concept.voiceScript = "รอหลักฐานก่อนผลิต ระบบยังไม่มีหลักฐาน";
    const result = await runCreativeAgent(input(), adapter(generated).provider);
    expect(result.plan.concepts[2].status).toBe("REJECTED");
  });
  it("retains sunk failed generation cost after switching to real-footage editing", async () => {
    const resources = input();
    resources.costs = [{ id: "failed-generation", outputId: "failed-clip", method: "GENERATIVE_ATMOSPHERE",
      actualCostThb: 8, billingVerified: true, usable: false },
    { id: "edited-result", outputId: "final-clip", method: "REAL_FOOTAGE_EDIT", actualCostThb: 2, billingVerified: true, usable: true }];
    const result = await runCreativeAgent(resources, adapter(output()).provider);
    expect(result.plan.concepts[2].cost).toMatchObject({ totalActualThb: 10, usableOutputs: 1, costPerUsableThb: 10, targetMet: false });
  });
  it("rejects commerce CTAs in Growth and unsupported medical promises", async () => {
    const generated = output(false); generated.concepts[0].concept.cta = "สั่งซื้อเลย";
    generated.concepts[1].concept.voiceScript = "รักษาโรคหายขาดแน่นอน";
    const result = await runCreativeAgent(input(false), adapter(generated).provider);
    expect(result.plan.concepts[0].status).toBe("REJECTED"); expect(result.plan.concepts[1].status).toBe("REJECTED");
  });
  it("rejects duplicate IDs/identical scripts and malformed duration instead of padding templates", async () => {
    const duplicate = output(); duplicate.concepts[1].id = duplicate.concepts[0].id;
    await expect(runCreativeAgent(input(), adapter(duplicate).provider)).rejects.toThrow("CREATIVE_LLM_SELECTION_INVALID");
    const repeated = output(); repeated.concepts[1].concept.hook = repeated.concepts[0].concept.hook;
    repeated.concepts[1].concept.voiceScript = repeated.concepts[0].concept.voiceScript;
    await expect(runCreativeAgent(input(), adapter(repeated).provider)).rejects.toThrow("CREATIVE_LLM_DUPLICATE_IDEAS");
    expect(creativeAgentOutputSchema.safeParse({ ...output(), concepts: [] }).success).toBe(false);
  });
});
