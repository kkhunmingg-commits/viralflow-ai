import { describe, expect, it } from "vitest";
import { accountsFor, clipsToAdd, flowAccountViews, nextFlowAccount, remainingCapacity } from "./capacity";
import { bangkokDate, bangkokDayRange, bangkokLocalToIso } from "./contracts";
import { planBatch, type FarmProduct } from "./planner";

const row = (id: string, priority: number, extra: Partial<Parameters<typeof flowAccountViews>[0][number]> = {}) => ({
  id, tiktok_account_id: null as string | null, label: id, priority, clips_per_day_estimate: 5, active: true, exhausted_on: null, clips_today: 0, clips_today_on: null,
  last_used_at: null, created_at: `2026-10-0${priority}T00:00:00Z`, ...extra,
});

describe("Flow account capacity", () => {
  it("drains accounts in the owner's order and adds up what is left today", () => {
    const views = flowAccountViews([row("b", 2), row("a", 1, { clips_today: 3, clips_today_on: "2026-10-28" }), row("c", 3, { exhausted_on: "2026-10-28" })], "2026-10-28");
    expect(views.map(v => v.id)).toEqual(["a", "b", "c"]);
    expect(remainingCapacity(views)).toBe(2 + 5);
    expect(nextFlowAccount(views)?.id).toBe("a");
  });
  it("gives a TikTok account its own Google accounts first, then shared ones, never another account's", () => {
    const views = flowAccountViews([row("shared", 1), row("mine2", 2, { tiktok_account_id: "t1" }), row("mine1", 1, { tiktok_account_id: "t1" }),
      row("theirs", 1, { tiktok_account_id: "t2" })], "2026-10-28");
    expect(accountsFor(views, "t1").map(v => v.id)).toEqual(["mine1", "mine2", "shared"]);
  });
  it("forgets yesterday's usage and yesterday's empty credits", () => {
    const [view] = flowAccountViews([row("a", 1, { clips_today: 5, clips_today_on: "2026-10-27", exhausted_on: "2026-10-27" })], "2026-10-28");
    expect(view).toMatchObject({ clipsToday: 0, exhaustedToday: false, remainingEstimate: 5 });
  });
  it("tops today's clips up to the target and never past the batch limit", () => {
    expect(clipsToAdd(15, 0, 30)).toBe(15);
    expect(clipsToAdd(15, 12, 30)).toBe(3);
    expect(clipsToAdd(15, 20, 30)).toBe(0);
    expect(clipsToAdd(99, 0, 30)).toBe(30);
  });
});

describe("Bangkok day", () => {
  it("counts the day in Thai time", () => {
    expect(bangkokDate("2026-10-27T18:30:00Z")).toBe("2026-10-28");
    expect(bangkokDayRange("2026-10-28")).toEqual({ start: "2026-10-27T17:00:00.000Z", end: "2026-10-28T17:00:00.000Z" });
    expect(bangkokLocalToIso("2026-10-28T19:30")).toBe("2026-10-28T12:30:00.000Z");
  });
});

describe("one-click batch plan", () => {
  const product: FarmProduct = { id: "p1", title: "Casio F-91W", categoryKey: "watch", imagePath: "owner/x/products/p1/a.jpg", imageAssetId: "m1",
    facts: [{ id: "f1", text: "น้ำหนัก 21 กรัม" }] };
  it("makes product ads from the found products, varying the set and the hand action", () => {
    const clips = planBatch({ mode: "AFFILIATE", count: 3, products: [product] });
    expect(clips.every(c => c.kind === "AFFILIATE" && c.referenceImagePath === product.imagePath)).toBe(true);
    expect(new Set(clips.map(c => c.prompt)).size).toBe(3);
    expect(clips[0].prompt).toContain("reference image");
    expect(clips[0].caption).toContain("น้ำหนัก 21 กรัม");
  });
  it("falls back to warm-up clips without a product, with no product, claim or on-screen text", () => {
    const clips = planBatch({ mode: "AFFILIATE", count: 4, products: [] });
    expect(clips.every(c => c.kind === "GROWTH" && c.productId === null && c.referenceImagePath === null)).toBe(true);
    expect(new Set(clips.map(c => c.title)).size).toBe(4);
    expect(clips[0].prompt).toMatch(/9:16/);
    expect(clips[0].prompt).toMatch(/AVOID: on-screen text/);
  });
});
