import { describe, expect, it } from "vitest";
import { categoryPlaybook } from "./category-insight";
import { shoppingMoment, speakable, trendCaption, trendFormatsFor, trendNarration, TREND_FORMATS } from "./trend-playbook";
import { planBatch } from "@/features/flow-farm/planner";

const serum = { title: "เซรั่มวิตามินซี", categoryKey: "beauty", facts: [{ text: "ขาวขึ้นใน 7 วัน" }, { text: "ขนาด 30 มล." }] };

describe("trend playbook", () => {
  it("finds the Thai shopping moment by Bangkok date", () => {
    expect(shoppingMoment(new Date("2026-11-10T20:00:00Z"))?.key).toBe("DOUBLE_11"); // 11 Nov in Bangkok
    expect(shoppingMoment(new Date("2026-10-27T05:00:00Z"))?.key).toBe("PAYDAY");
    expect(shoppingMoment(new Date("2026-11-20T05:00:00Z"))?.key).toBe("COOL_SEASON");
    expect(shoppingMoment(new Date("2026-04-12T05:00:00Z"))?.key).toBe("SONGKRAN");
    expect(shoppingMoment(new Date("2026-03-10T05:00:00Z"))).toBeNull();
  });
  it("never speaks or captions a forbidden claim, and keeps the line short enough for one take", () => {
    const line = trendNarration(serum, TREND_FORMATS.PRODUCT_DETAIL!, 2);
    expect(line).not.toContain("ขาวขึ้น"); expect(line).toContain("30 มล.");
    const { caption, hashtags } = trendCaption(serum, TREND_FORMATS.ASMR_SENSORY!, 0, new Date("2026-11-10T20:00:00Z"));
    expect(caption).not.toContain("ขาวขึ้น"); expect(caption).toContain("11.11"); expect(hashtags).toContain("#1111");
    expect(speakable("ก ".repeat(60)).length).toBeLessThanOrEqual(70);
  });
  it("gives every category several formats and leaves out comparison", () => {
    for (const key of ["watch", "beauty", "home", "gadget", "snack", "อื่น ๆ"]) {
      const formats = trendFormatsFor(categoryPlaybook(key));
      expect(formats.length).toBeGreaterThanOrEqual(4); expect(formats.some(f => f.format === "COMPARISON")).toBe(false);
    }
  });
  it("rotates formats within a product's batch and opens the warm-up batch with the season", () => {
    const product = { id: "p", ...serum, imagePath: "a.jpg", imageAssetId: "m", facts: [{ id: "f", text: "ขนาด 30 มล." }] };
    const clips = planBatch({ mode: "AFFILIATE", count: 3, products: [product], now: new Date("2026-03-10T05:00:00Z") });
    expect(new Set(clips.map(c => c.title.split(" · ")[1])).size).toBe(3);
    expect(clips.every(c => c.prompt.includes("HOOK (first second"))).toBe(true);
    const warm = planBatch({ mode: "GROWTH", count: 5, products: [], now: new Date("2026-11-20T05:00:00Z") });
    expect(warm[0].title).toBe("แมวขายโกโก้ร้อนหน้าหนาว"); expect(warm[0].prompt).toMatch(/0–1 s HOOK[\s\S]*3–5 s TWIST[\s\S]*6–8 s PAYOFF/); expect(warm[0].caption).toContain("ติดตามไว้"); expect(warm.some(c => c.hashtags.includes("#ฝนตก"))).toBe(false);
  });
});
