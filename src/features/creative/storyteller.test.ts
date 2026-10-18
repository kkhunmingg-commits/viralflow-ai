import { describe, expect, it } from "vitest";
import { claimIssues } from "./claims";
import { EMPTY_HISTORY, planGrowthStory, planProductStory, shortLabel, storyHashtags } from "./storyteller";

const facts = [{ id: "f1", text: "ผนังมีสองชั้น" }, { id: "f2", text: "ตรงกลางไม่มีอากาศ" }, { id: "f3", text: "ผิวด้านในเงา" }];

describe("rule-based storyteller", () => {
  it("picks a richer format when the evidence supports it and labels the choice as rule-based", () => {
    const plan = planGrowthStory("ขวดเก็บความเย็น", facts, EMPTY_HISTORY, "acct")!;
    expect(plan.story.format).toBe("LIST");
    expect(plan.story.beats.map(b => b.role)).toEqual(["HOOK", "POINT", "POINT", "POINT", "CTA"]);
    expect(plan.story.beats.slice(1, 4).map(b => b.kicker)).toEqual(["ข้อ 1", "ข้อ 2", "ข้อ 3"]);
    expect(plan.story.basis).toMatch(/^RULE_BASED_STORYTELLER_V1/);
    expect(plan.factIds).toEqual(["f1", "f2", "f3"]);
  });
  it("rotates format and hook away from what the account used recently", () => {
    const first = planGrowthStory("ขวดเก็บความเย็น", facts, EMPTY_HISTORY, "acct")!;
    const history = { formats: [first.story.format], hooks: [first.story.beats[0].text], topics: [] };
    const second = planGrowthStory("ขวดเก็บความเย็น", facts, history, "acct")!;
    expect(second.story.format).not.toBe(first.story.format);
    const third = planGrowthStory("ขวดเก็บความเย็น", facts, { ...history, formats: [second.story.format, first.story.format], hooks: [second.story.beats[0].text, first.story.beats[0].text] }, "acct")!;
    expect(new Set([first, second, third].map(p => p.story.format)).size).toBe(3);
  });
  it("spotlights a verified number and returns nothing without usable facts", () => {
    const plan = planGrowthStory("น้ำแข็ง", [{ id: "n", text: "น้ำแข็งเบากว่าน้ำราว 9%" }], { formats: ["QUIZ_REVEAL", "EXPLAINER"], hooks: [], topics: [] }, "s")!;
    expect(plan.story.format).toBe("NUMBER_SPOTLIGHT");
    expect(plan.story.beats[0].badge).toBe("9%");
    expect(planGrowthStory("x", [{ id: "l", text: "ข้อเท็จจริงที่ยาวมากเกินกว่าจะอ่านทันบนการ์ดหนึ่งใบแน่นอน" }], EMPTY_HISTORY, "s")).toBeNull();
  });
  it("words product stories from verified selling points and keeps narration in budget", () => {
    const plan = planProductStory("PRODUCT_DETAIL", "ขวดน้ำเก็บความเย็น ฟ้าเย็น 500 มล.", [{ id: "s1", text: "ความจุ 500 มิลลิลิตร" }, { id: "s2", text: "ฝาสีดำมีห่วงหิ้ว" }], EMPTY_HISTORY, "a");
    expect(plan.story.beats.filter(b => b.role === "POINT").map(b => b.text)).toEqual(["ความจุ 500 มิลลิลิตร"]);
    expect(plan.story.beats.map(b => b.text).join("").replace(/\p{M}|\s/gu, "").length).toBeLessThanOrEqual(72);
    expect(shortLabel("ขวดน้ำเก็บความเย็น ฟ้าเย็น 500 มล.", 18)).toBe("ขวดน้ำเก็บความเย็น");
    expect(storyHashtags("LIST", "ขวดเก็บความเย็น", false)).toEqual(["#ขวดเก็บความเย็น", "#รู้ไว้ใช่ว่า", "#สาระน่ารู้"]);
  });
  it("speaks a selling point the account has not used recently before repeating one", () => {
    const points = [{ id: "s1", text: "ความจุ 500 มิลลิลิตร" }, { id: "s2", text: "ฝาสีดำมีห่วงหิ้ว" }];
    const plan = planProductStory("PRODUCT_DETAIL", "ขวดน้ำเก็บความเย็น", points, { ...EMPTY_HISTORY, lines: ["ความจุ 500 มิลลิลิตร"] }, "a");
    expect(plan.factIds[0]).toBe("s2");
    // The cause still opens the explanation; the follow-up is the fact not spoken recently.
    const growth = planGrowthStory("น้ำแข็ง", [{ id: "a", text: "น้ำขยายตัวเมื่อแข็งตัว" }, { id: "b", text: "ปลาอยู่ใต้น้ำแข็งได้" }, { id: "c", text: "น้ำแข็งลอยบนผิวน้ำ" }],
      { formats: ["LIST", "QUIZ_REVEAL", "NUMBER_SPOTLIGHT"], hooks: [], topics: [], lines: ["ปลาอยู่ใต้น้ำแข็งได้"] }, "s")!;
    expect(growth.story.format).toBe("EXPLAINER");
    expect(growth.factIds).toEqual(["a", "c"]);
  });
  it("flags lines that say more than the visuals or evidence show", () => {
    expect(claimIssues(["ดูการทำงานจากวิดีโอจริง"], "REAL_IMAGE", [])[0].code).toBe("DEMONSTRATION_WITHOUT_FOOTAGE");
    expect(claimIssues(["ดูการทำงานจากวิดีโอจริง"], "REAL_FOOTAGE_OPERATION", [])).toEqual([]);
    expect(claimIssues(["ดูจากภาพจริง"], "ORIGINAL_GRAPHIC", [])[0].code).toBe("REAL_MEDIA_CLAIM_ON_GRAPHIC");
    expect(claimIssues(["เก็บเย็นได้ 24 ชั่วโมง"], "REAL_IMAGE", ["ความจุ 500 มิลลิลิตร"])[0].code).toBe("UNSUPPORTED_NUMBER");
    expect(claimIssues(["ความจุ 500 มิลลิลิตร", "3 เรื่องของขวด"], "REAL_IMAGE", ["ความจุ 500 มิลลิลิตร"])).toEqual([]);
  });
});
