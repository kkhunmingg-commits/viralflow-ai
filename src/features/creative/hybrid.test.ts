import { describe, expect, it } from "vitest";
import { runCreativeAgent } from "./agent";
import { copyQualityIssues } from "./copy-quality";
import { chooseHybrid, rankPassingIdeas } from "./hybrid";
import type { LocalOutput } from "./local-agent";
import type { StructuredCreativeProvider } from "./providers";
import { planCreativeStrategy, type CreativeStrategyInput } from "./strategist";

const now = new Date("2026-10-20T08:00:00Z");
const fact = (id: string, topic: string, text: string) => ({ id, text, topic, source: "AUTHORIZED_SOURCE" as const, reference: "https://en.wikipedia.org/wiki/Giraffe",
  verified: true, capturedAt: "2026-10-19T00:00:00Z", role: "OBSERVATION" as const });
const history = { formats: ["QUIZ_REVEAL"], hooks: ["ยีราฟคอยาวได้ยังไง?"], topics: ["ยีราฟ"], lines: ["ยีราฟมีกระดูกคอ 7 ชิ้นเท่ามนุษย์"], stories: [{ topic: "ยีราฟ", format: "QUIZ_REVEAL" }] };
function input(): CreativeStrategyInput {
  return { now, account: { id: "growth-account", mode: "GROWTH", affiliateEligible: null }, assets: [], history,
    facts: [fact("g1", "ยีราฟ", "ยีราฟมีกระดูกคอ 7 ชิ้นเท่ามนุษย์"), fact("m1", "ดวงจันทร์", "ดวงจันทร์หันด้านเดียวเข้าหาโลกเสมอ"),
      fact("b1", "ผึ้ง", "ผึ้งงานบอกทางไปหาอาหารด้วยการเต้น")] };
}
type Idea = LocalOutput["ideas"][number];
const idea = (id: string, renderFormat: Idea["renderFormat"], hook: string, factId: string, cta: string): Idea => ({ id, topic: id, renderFormat,
  formatLabel: renderFormat, hookPattern: "question", angle: "เรื่องแปลกรอบตัว", caption: hook, hashtags: ["#สาระน่ารู้", "#รู้หรือไม่"],
  productionMethod: "ORIGINAL_GRAPHIC_STORY", assetIds: [], whyThisIdea: "หัวข้อใหม่", hook: { text: hook, kicker: "" },
  points: [{ factId, kicker: "" }], cta: { text: cta } });
const plan = (ideas: Idea[], selectedId: string): LocalOutput => ({ audience: "คนชอบเรื่องแปลก", ideas, selectedId, selectionReason: "น่าสนใจ", alternativesReason: "ซ้ำ" });
const fake = (value: LocalOutput): StructuredCreativeProvider => ({ provider: "local-llm", model: "local/qwen3-4b-q4_k_m",
  async generateStructured() { return { raw: {}, output: value, usage: { inputTokens: 1, outputTokens: 1 } } } });
const ideas = (out: LocalOutput) => out.ideas.map(i => ({ id: i.id, topic: i.topic }));

describe("copy quality", () => {
  it("flags a hook that gives the answer, a close that does not fit a Growth clip, and a reworded repeat", () => {
    const echo = copyQualityIssues([{ role: "HOOK", text: "ยีราฟมีกระดูกคอ 7 ชิ้นจริงไหม?" }, { role: "POINT", text: "ยีราฟมีกระดูกคอ 7 ชิ้นเท่ามนุษย์" },
      { role: "CTA", text: "ติดตามไว้" }], "GROWTH", history);
    expect(echo.join(" ")).toContain("พูดซ้ำกับเนื้อหา");
    expect(echo.join(" ")).toContain("แค่เปลี่ยน hook");
    const close = copyQualityIssues([{ role: "HOOK", text: "หมึกยักษ์แปลกตรงไหน?" }, { role: "POINT", text: "เลือดหมึกยักษ์ใช้ทองแดงขนออกซิเจน" },
      { role: "CTA", text: "คลิกลิ้งไปดูวิธีใช้ได้เลย" }], "GROWTH");
    expect(close.join(" ")).toContain("ไม่เข้ากับคลิปปั้นบัญชี");
    expect(copyQualityIssues([{ role: "HOOK", text: "ดาวดวงนี้แปลกมาก" }, { role: "POINT", text: "เลือดหมึกยักษ์ใช้ทองแดงขนออกซิเจน" },
      { role: "CTA", text: "คอมเมนต์มาเลย" }], "GROWTH").join(" ")).toContain("ไม่เกี่ยวกับเรื่องในคลิป");
    expect(copyQualityIssues([{ role: "HOOK", text: "ทำไมเราเห็นดวงจันทร์ด้านเดียว?" }, { role: "POINT", text: "ดวงจันทร์หันด้านเดียวเข้าหาโลกเสมอ" },
      { role: "CTA", text: "เซฟไว้เล่าต่อ" }], "GROWTH", history)).toEqual([]);
  });

  it("holds the rule-based storyteller to the same checks", () => {
    const rule = planCreativeStrategy(input());
    const chosen = rule.concepts.find(c => c.id === rule.selectedConceptId)!;
    expect(copyQualityIssues(chosen.production.story!.beats, "GROWTH", history)).toEqual([]);
  });
});

describe("hybrid creative choice", () => {
  it("uses the model's own pick when it passed, and records that it did", async () => {
    const out = plan([idea("moon", "QUIZ_REVEAL", "ทำไมเห็นดวงจันทร์ด้านเดียว?", "F2", "เซฟไว้เล่าต่อ"),
      idea("bee", "EXPLAINER", "ผึ้งบอกทางกันยังไง?", "F3", "ติดตามไว้ ตอนหน้ามีอีก"),
      idea("giraffe", "NUMBER_SPOTLIGHT", "คอยีราฟมีกี่ชิ้น?", "F1", "คอมเมนต์ทายมา")], "bee");
    const ai = await runCreativeAgent(input(), fake(out));
    const choice = chooseHybrid({ plan: ai.plan, ideas: ideas(out) }, null, planCreativeStrategy(input()), history);
    expect(choice.source).toBe("AI_OWN_PICK");
    expect(choice.plan.selectedConceptId).toBe("bee");
    // The giraffe story is the account's last clip, so it does not pass.
    expect(choice.ranking.map(r => r.id)).not.toContain("giraffe");
  });

  it("picks another passing AI idea when the model's own pick failed", async () => {
    const out = plan([idea("moon", "QUIZ_REVEAL", "ทำไมเห็นดวงจันทร์ด้านเดียว?", "F2", "เซฟไว้เล่าต่อ"),
      idea("bee", "EXPLAINER", "ผึ้งงานบอกทางไปหาอาหารด้วยการเต้น", "F3", "ติดตามไว้"),
      idea("giraffe", "NUMBER_SPOTLIGHT", "คอยีราฟมีกี่ชิ้น?", "F1", "คลิกลิงก์ดูต่อ")], "bee");
    const ai = await runCreativeAgent(input(), fake(out));
    const choice = chooseHybrid({ plan: ai.plan, ideas: ideas(out) }, null, planCreativeStrategy(input()), history);
    expect(choice.source).toBe("AI_RANKED");
    expect(choice.plan.selectedConceptId).toBe("moon");
    expect(choice.plan.warnings.join(" ")).toContain("เลือกไอเดียอื่นของ AI");
  });

  it("falls back to the rule-based plan when no AI idea passed or the model failed, and says why", async () => {
    const rule = planCreativeStrategy(input());
    const failed = chooseHybrid(null, "CREATIVE_LLM_TIMEOUT", rule, history);
    expect(failed.source).toBe("RULE_FALLBACK");
    expect(failed.plan.source).toBe("DETERMINISTIC_EVIDENCE_RUBRIC");
    expect(failed.plan.warnings.join(" ")).toContain("CREATIVE_LLM_TIMEOUT");
    const out = plan([idea("a", "QUIZ_REVEAL", "คลิกเลย", "F1", "คลิกลิงก์"), idea("b", "EXPLAINER", "ซื้อเลย", "F1", "ซื้อเลย"),
      idea("c", "LIST", "ลิสต์", "F1", "ราคาดี")], "a");
    const ai = await runCreativeAgent(input(), fake(out));
    const none = chooseHybrid({ plan: ai.plan, ideas: ideas(out) }, null, rule, history);
    expect(none.source).toBe("RULE_FALLBACK");
    expect(none.fallbackReason).toContain("ไม่มีไอเดียของ AI ที่ผ่านการตรวจ");
    expect(rankPassingIdeas(ai.plan, ideas(out), history)).toEqual([]);
  });
});
