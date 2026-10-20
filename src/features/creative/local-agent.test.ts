import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runCreativeAgent } from "./agent";
import { LocalLLMProvider, groundedShare, localGrammarSchema, localOutputSchema, type LocalOutput } from "./local-agent";
import { knownCreativeGenerationCost } from "./cost";
import type { CreativeStrategyInput } from "./strategist";
import type { StructuredCreativeProvider } from "./providers";

const now = new Date("2026-10-20T08:00:00Z");
const fact = (id: string, topic: string, text: string) => ({ id, text, topic, source: "AUTHORIZED_SOURCE" as const, reference: "https://en.wikipedia.org/wiki/Ice",
  verified: true, capturedAt: "2026-10-19T00:00:00Z", role: "OBSERVATION" as const });
function input(): CreativeStrategyInput {
  return { now, account: { id: "growth-account", mode: "GROWTH", affiliateEligible: null }, assets: [],
    facts: [fact("uuid-ice-1", "น้ำแข็งลอยน้ำ", "น้ำแข็งเบากว่าน้ำราว 9%"), fact("uuid-ice-2", "น้ำแข็งลอยน้ำ", "น้ำขยายตัวเมื่อแข็งตัว"),
      fact("uuid-oct-1", "หมึกยักษ์", "หมึกยักษ์มีหัวใจ 3 ดวง")],
    history: { formats: ["EXPLAINER"], hooks: ["เคยสงสัยไหม น้ำแข็งลอยน้ำ"], topics: ["น้ำแข็งลอยน้ำ"], lines: [], stories: [{ topic: "น้ำแข็งลอยน้ำ", format: "EXPLAINER" }] } };
}
type Point = { factId: string; kicker?: string };
const story = (hook: string, points: Point[], cta: string) => ({ hook: { text: hook, kicker: "" }, cta: { text: cta },
  points: points.map(p => ({ factId: p.factId, kicker: p.kicker ?? "" })) });
const idea = (id: string, over: Partial<LocalOutput["ideas"][number]> = {}): LocalOutput["ideas"][number] => ({ id, topic: "หมึกยักษ์", renderFormat: "NUMBER_SPOTLIGHT",
  formatLabel: "ตัวเลขชวนทึ่ง", hookPattern: "number-surprise", angle: "ร่างกายสัตว์แปลก", caption: "หมึกยักษ์มีหัวใจกี่ดวง", hashtags: ["หมึกยักษ์", "#สาระน่ารู้"],
  productionMethod: "ORIGINAL_GRAPHIC_STORY", assetIds: [], whyThisIdea: "บัญชีนี้ยังไม่เคยเล่าเรื่องสัตว์",
  ...story("หัวใจ 3 ดวงในตัวเดียว?", [{ factId: "F3", kicker: "รู้หรือไม่" }], "ติดตามไว้ มีตอนต่อไป"), ...over });
function fake(value: LocalOutput | LocalOutput[], seen: { prompt?: string; schema?: unknown; prompts?: string[] } = {}): StructuredCreativeProvider {
  const values = Array.isArray(value) ? value : [value];
  return { provider: "local-llm", model: "local/qwen3-4b-q4_k_m", async generateStructured(prompt, format) {
    (seen.prompts ??= []).push(prompt); seen.prompt ??= prompt; seen.schema = format.schema;
    return { raw: { brainstorm: "คิด" }, output: values[Math.min(seen.prompts.length - 1, values.length - 1)], usage: { inputTokens: 900, outputTokens: 700 } } } };
}
const plan = (ideas: LocalOutput["ideas"], selectedId = ideas[0].id): LocalOutput => ({ audience: "คนชอบเรื่องแปลกรอบตัว", ideas, selectedId,
  selectionReason: "หัวข้อใหม่สำหรับบัญชี", alternativesReason: "อีกสองแบบเล่าเรื่องที่เพิ่งเล่าไป" });

describe("local creative LLM", () => {
  it("keeps the model's own hook and close, speaks chosen facts in their own words and maps short ids back", async () => {
    const seen: { prompt?: string; schema?: unknown } = {};
    const quiz = idea("b", { topic: "น้ำแข็ง", renderFormat: "QUIZ_REVEAL", ...story("ทำไมน้ำแข็งไม่จม?", [{ factId: "F1", kicker: "เฉลย" }], "เซฟไว้ดูอีกที") });
    const result = await runCreativeAgent(input(), fake(plan([idea("a"), quiz, idea("c", { formatLabel: "อีกมุม", ...story("สัตว์ที่มีหัวใจเยอะ", [{ factId: "F3" }], "คอมเมนต์สัตว์ที่อยากรู้") })]), seen));
    expect(seen.prompt).toContain("F1");
    expect(seen.prompt).not.toContain("uuid-ice-1");
    expect(seen.prompt).toContain("เคยสงสัยไหม น้ำแข็งลอยน้ำ");
    const a = result.plan.concepts.find(c => c.id === "a")!, b = result.plan.concepts.find(c => c.id === "b")!;
    expect(a.status).toBe("REVIEW_REQUIRED");
    expect(a.production.story?.beats.map(x => x.text)).toEqual(["หัวใจ 3 ดวงในตัวเดียว?", "หมึกยักษ์มีหัวใจ 3 ดวง", "ติดตามไว้ มีตอนต่อไป"]);
    expect(a.production.story?.basis).toMatch(/^LOCAL_LLM_STORY_V1/);
    expect(a.production.evidenceIds).toContain("uuid-oct-1");
    // The model reworded the topic; the cited fact puts it back on the documented one.
    expect(result.output.concepts.find(c => c.id === "b")!.topic).toBe("น้ำแข็งลอยน้ำ");
    // The ice topic was the account's last clip while octopus facts are still untold, so it waits its turn.
    expect(b.status).toBe("REJECTED");
    expect(b.reasons.join(" ")).toContain("เพิ่งทำไปในคลิปล่าสุด");
    expect(result.plan.selectedConceptId).toBe("a");
    expect(result.plan.warnings.join(" ")).toContain("โมเดลภาษาที่รันบนเครื่องนี้");
  });

  it("rejects hooks that invent numbers, ideas that mix topics and number clips without a number", async () => {
    const invented = idea("x", story("หมึกยักษ์มีหัวใจ 5 ดวง?", [{ factId: "F3" }], "ติดตามไว้"));
    const mixed = idea("y", { renderFormat: "EXPLAINER", ...story("เรื่องแปลกสองเรื่อง", [{ factId: "F3" }, { factId: "F2" }], "เซฟไว้") });
    const noNumber = idea("z", { topic: "น้ำแข็ง", ...story("น้ำกลายเป็นน้ำแข็ง", [{ factId: "F2" }], "คอมเมนต์เลย") });
    const result = await runCreativeAgent(input(), fake(plan([invented, mixed, noNumber])));
    for (const c of result.plan.concepts) expect(c.status).toBe("REJECTED");
    expect(result.plan.concepts[0].reasons.join(" ")).toContain("UNSUPPORTED_NUMBER");
    expect(result.plan.concepts[1].reasons.join(" ")).toContain("หัวข้อเดียวกัน");
    expect(result.plan.concepts[2].reasons.join(" ")).toContain("ต้องมีตัวเลข");
  });

  it("rejects a growth story that sells and a list without three points", async () => {
    const sells = idea("s", story("หัวใจ 3 ดวง", [{ factId: "F3" }], "กดตะกร้าเลย"));
    const list = idea("l", { renderFormat: "LIST", ...story("2 เรื่องของน้ำแข็ง", [{ factId: "F1" }, { factId: "F2" }], "เซฟไว้") });
    const result = await runCreativeAgent(input(), fake(plan([sells, list, idea("ok")], "ok")));
    expect(result.plan.concepts.find(c => c.id === "s")!.status).toBe("REJECTED");
    expect(result.plan.concepts.find(c => c.id === "l")!.reasons.join(" ")).toContain("สามข้อ");
    expect(result.plan.concepts.find(c => c.id === "ok")!.status).toBe("REVIEW_REQUIRED");
  });

  it("gives the model its reviewer's notes once when no idea passes, and keeps the revised plan", async () => {
    const bad = idea("x", story("หมึกยักษ์มีหัวใจ 5 ดวง?", [{ factId: "F3" }], "ติดตามไว้"));
    const variant = (id: string, hook: string) => ({ ...bad, id, hook: { text: hook, kicker: "" } });
    const seen: { prompts?: string[] } = {};
    const result = await runCreativeAgent(input(), fake([plan([bad, variant("x2", "หมึกยักษ์มีหัวใจ 4 ดวง?"), variant("x3", "หัวใจ 7 ดวง?")], "x"), plan([idea("fixed"), bad, variant("x2", "หมึกยักษ์มีหัวใจ 4 ดวง?")], "fixed")], seen));
    expect(seen.prompts).toHaveLength(2);
    expect(seen.prompts![1]).toContain("ผลตรวจ");
    expect(result.plan.selectedConceptId).toBe("fixed");
    expect(result.plan.concepts.find(c => c.id === "fixed")!.status).toBe("REVIEW_REQUIRED");
    expect(result.plan.warnings.join(" ")).toContain("แก้แผนเองหนึ่งรอบ");
  });

  it("drops trailing points that would not fit the clip and says so", async () => {
    const long = idea("t", { renderFormat: "EXPLAINER", topic: "น้ำแข็งลอยน้ำ", ...story("ทำไมน้ำแข็งลอยได้ทั้งที่เป็นน้ำแท้ๆ?", [{ factId: "F1" }, { factId: "F2" }], "ติดตามไว้ มีตอนต่อไปอีกเยอะ") });
    const result = await runCreativeAgent(input(), fake(plan([long, idea("a"), idea("b", story("สัตว์ที่มีหัวใจเยอะ", [{ factId: "F3" }], "เซฟไว้"))], "t")));
    const story0 = result.plan.concepts.find(c => c.id === "t")!.production.story!;
    expect(story0.beats.map(b => b.role)).toEqual(["HOOK", "POINT", "CTA"]);
    expect(story0.basis).toContain("ตัดจังหวะท้าย");
  });

  it("lets the model pick only one of its own idea slots and only facts it was given", () => {
    const schema = localGrammarSchema("GROWTH", ["F1", "F2"]) as unknown as { properties: { selectedId: { enum: string[] };
      ideas: { items: { properties: { id: { enum: string[] }; points: { items: { properties: { factId: { enum: string[] } } } } } } } } };
    expect(schema.properties.selectedId.enum).toEqual(schema.properties.ideas.items.properties.id.enum);
    expect(schema.properties.ideas.items.properties.points.items.properties.factId.enum).toEqual(["F1", "F2"]);
  });

  it("asks the model for a schema it can fill and prices tokens at zero with machine time kept separate", () => {
    const schema = z.toJSONSchema(localOutputSchema("GROWTH")) as unknown as { properties: { ideas: { items: { properties: { renderFormat: { enum: string[] } } } } } };
    expect(schema.properties.ideas.items.properties.renderFormat.enum).toEqual(["EXPLAINER", "QUIZ_REVEAL", "LIST", "NUMBER_SPOTLIGHT"]);
    expect(knownCreativeGenerationCost("local/qwen3-4b-q4_k_m", 900, 700)).toBe(0);
    expect(knownCreativeGenerationCost("unpriced-remote-model", 900, 700)).toBeNull();
    expect(() => new LocalLLMProvider(["python3"], "gpt-5.4-nano")).toThrow("CREATIVE_LLM_NOT_CONFIGURED");
  });

  it("measures how much of a beat comes from its facts", () => {
    expect(groundedShare("เพราะน้ำแข็งเบากว่าน้ำราว 9%", ["น้ำแข็งเบากว่าน้ำราว 9%"])).toBe(1);
    expect(groundedShare("หมึกยักษ์จำหน้าคนได้นานหลายปี", ["หมึกยักษ์มีหัวใจ 3 ดวง"])).toBeLessThan(.6);
  });
});
