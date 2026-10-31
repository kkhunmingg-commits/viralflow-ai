import { describe, expect, it } from "vitest";
import { analyzeLearning, ctaOf, estimateFollows, matchVideos, mergeApiStats, videoIdFromUrl, type LearningClip, type StatsByClip } from "./learning";
import { planBatch, seriesOfTitle } from "./planner";

const clip = (id: string, title: string, extra: Partial<LearningClip> = {}): LearningClip => ({
  id, kind: "GROWTH", title, caption: "ครัวจิ๋ว EP.1 · กะเพราจานจิ๋ว ใครกินได้คำเดียวหมด\nติดตามไว้ พรุ่งนี้ครัวจิ๋วทำเมนูอะไรดี",
  status: "POSTED", readyAt: "2026-10-20T00:00:00Z", postedAt: "2026-10-20T01:00:00Z", createdAt: "2026-10-19T23:00:00Z", postUrl: null, ...extra,
});
const stat = (views: number, follows: number | null = null, likes = views / 20): StatsByClip[string] =>
  ({ views, likes, comments: 0, shares: 0, follows, source: "MANUAL", at: "2026-10-25T00:00:00Z" });

describe("clip learning", () => {
  it("knows each warm-up title's series, old and new", () => {
    expect(seriesOfTitle("แมวบาริสต้า")).toBe("แมวทำงาน");
    expect(seriesOfTitle("ครัวจิ๋ว: ผัดไทยกุ้งสด")).toBe("ครัวจิ๋ว");
    expect(seriesOfTitle("Casio · unboxing")).toBeNull();
  });
  it("tells follow prompts apart from the caption", () => {
    expect(ctaOf("x\nภาค 2 มาพรุ่งนี้ ติดตามไว้รอดูเลย")).toBe("PART_TWO");
    expect(ctaOf("x\nติดตามไว้ ตอนหน้าจะพาไปโลกจิ๋วในอะไรดี")).toBe("SERIES_NEXT");
    expect(ctaOf("ไม่มีคำชวน")).toBeNull();
  });
  it("leans toward the series that brings views and follows, without trusting one lucky clip", () => {
    const clips = [
      clip("a1", "แมวบาริสต้า"), clip("a2", "แมวขายส้มตำ"), clip("a3", "แมวช่างตัดผม"),
      clip("b1", "หั่นมะม่วงแก้ว"), clip("b2", "ตัดเค้กสบู่สีรุ้ง"), clip("b3", "หั่นแตงโมคริสตัล"),
      clip("c1", "หมูกระทะไฟลุก"),
    ];
    const stats: StatsByClip = { a1: stat(20000, 60), a2: stat(15000, 40), a3: stat(18000, 50), b1: stat(800, 0), b2: stat(1200, 1), b3: stat(900, 0), c1: stat(30000, 90) };
    const report = analyzeLearning(clips, stats, seriesOfTitle);
    const cats = report.series.find(s => s.key === "แมวทำงาน")!, cuts = report.series.find(s => s.key === "ตัดแล้วเพลิน")!;
    const street = report.series.find(s => s.key === "สตรีทฟู้ดไทย")!;
    expect(cats.weight).toBeGreaterThan(1.3);
    expect(cuts.weight).toBeLessThan(0.7);
    // One great clip helps, but three good ones count for more.
    expect(street.score).toBeLessThan(cats.score + 0.5);
    expect(report.sampleSize).toBe(7);
    expect(report.withFollows).toBe(7);
  });
  it("marks a series with many thrown-away clips for stricter realism and lowers it", () => {
    const clips = [clip("d1", "แมวบาริสต้า", { status: "DISCARDED" }), clip("d2", "แมวขายส้มตำ", { status: "DISCARDED" }), clip("d3", "แมวช่างตัดผม", { status: "READY" })];
    const report = analyzeLearning(clips, {}, seriesOfTitle);
    expect(report.guide.strictSeries).toEqual(["แมวทำงาน"]);
    expect(report.guide.seriesWeights["แมวทำงาน"]).toBeLessThan(1);
    expect(report.status).toBe("NO_DATA");
  });
  it("pairs TikTok videos with clips by post link, then by caption, never twice", () => {
    const clips = [clip("x", "แมวบาริสต้า", { postUrl: "https://www.tiktok.com/@me/video/7400000000000000001" }),
      clip("y", "หมูกระทะไฟลุก", { caption: "สตรีทฟู้ดไทย EP.2 · เสียงนี้คือเสียงหมูกระทะ ใครหิวยกมือ\nติดตามไว้" })];
    const videos = [
      { id: "7400000000000000001", description: "something else", createTime: 1792500000, views: 10, likes: 1, comments: 0, shares: 0 },
      { id: "7400000000000000002", description: "สตรีทฟู้ดไทย EP.2 · เสียงนี้คือเสียงหมูกระทะ ใครหิวยกมือ 🔥\nติดตามไว้ #fyp", createTime: 1792600000, views: 500, likes: 40, comments: 3, shares: 2 },
      { id: "7400000000000000003", description: "สตรีทฟู้ดไทย EP.2 · เสียงนี้คือเสียงหมูกระทะ ใครหิวยกมือ", createTime: 1792700000, views: 5, likes: 0, comments: 0, shares: 0 },
    ];
    const matched = matchVideos(videos, clips);
    expect(matched.get("x")?.id).toBe("7400000000000000001");
    expect(matched.get("y")?.id).toBe("7400000000000000002");
    expect(videoIdFromUrl("https://vt.tiktok.com/ZS123/")).toBeNull();
    const merged = mergeApiStats({ y: stat(1, 7) }, matched, "2026-10-31T00:00:00Z");
    expect(merged.y).toMatchObject({ views: 500, follows: 7, source: "TIKTOK_API" });
  });
});

describe("automatic follower estimate", () => {
  const api = (views: number, postedAt: string, follows: number | null = null): StatsByClip[string] =>
    ({ views, likes: 0, comments: 0, shares: 0, follows, source: "TIKTOK_API", at: "2026-10-31T00:00:00Z", postedAt });
  it("shares each follower rise among the clips fresh at the time, by views, and keeps typed numbers", () => {
    const stats: StatsByClip = { a: api(9000, "2026-10-30T01:00:00Z"), b: api(1000, "2026-10-30T02:00:00Z"),
      old: api(50000, "2026-10-20T00:00:00Z"), typed: api(500, "2026-10-30T01:30:00Z", 3) };
    const out = estimateFollows(stats, [{ at: "2026-10-30T00:00:00Z", count: 100 }, { at: "2026-10-30T12:00:00Z", count: 200 },
      { at: "2026-10-30T13:00:00Z", count: 190 }]);
    expect(out.a).toMatchObject({ follows: 90, followsEstimated: true });
    expect(out.b.follows).toBe(10);
    expect(out.old.follows).toBe(0);
    expect(out.typed).toMatchObject({ follows: 3 });
    expect(out.typed.followsEstimated).toBeUndefined();
  });
  it("needs two snapshots before it counts follows at all", () => {
    const report = analyzeLearning([clip("a", "แมวบาริสต้า")], { a: api(100, "2026-10-30T01:00:00Z") }, seriesOfTitle, [{ at: "2026-10-30T00:00:00Z", count: 5 }]);
    expect(report.withFollows).toBe(0);
  });
});

describe("learning-guided warm-up batch", () => {
  const guide = { seriesWeights: { "แมวทำงาน": 3, "ตัดแล้วเพลิน": 0.25, "ครัวจิ๋ว": 1, "สตรีทฟู้ดไทย": 1, "โลกจิ๋ว": 1 },
    ctaWeights: { PART_TWO: 3 }, episodes: { "แมวทำงาน": 4 }, recentTitles: ["แมวบาริสต้า"], strictSeries: ["ครัวจิ๋ว"] };
  it("makes more of what works, numbers the episodes, and never repeats a series back to back", () => {
    let cats = 0, cuts = 0;
    for (let offset = 0; offset < 20; offset++) {
      const clips = planBatch({ mode: "GROWTH", count: 6, products: [], offset, now: new Date("2026-08-10T05:00:00Z"), learning: guide });
      const series = clips.map(c => seriesOfTitle(c.title));
      for (let i = 1; i < series.length; i++) expect(series[i]).not.toBe(series[i - 1]);
      expect(new Set(clips.map(c => c.title)).size).toBe(6);
      expect(clips.some(c => c.title === "แมวบาริสต้า")).toBe(false);
      cats += series.filter(s => s === "แมวทำงาน").length; cuts += series.filter(s => s === "ตัดแล้วเพลิน").length;
      const cat = clips.find(c => seriesOfTitle(c.title) === "แมวทำงาน");
      if (cat) expect(cat.caption).toMatch(/^แมวทำงาน EP\.5 · /);
      const kitchen = clips.find(c => seriesOfTitle(c.title) === "ครัวจิ๋ว");
      if (kitchen) expect(kitchen.prompt).toContain("EXTRA CARE");
    }
    expect(cats).toBeGreaterThan(cuts * 2);
  });
  it("always asks Flow for smooth, realistic motion and keeps every caption a follow prompt", () => {
    const clips = planBatch({ mode: "GROWTH", count: 5, products: [], offset: 3 });
    expect(clips.every(c => c.prompt.includes("REALISM:") && c.caption.includes("ติดตาม"))).toBe(true);
    expect(clips.every(c => c.prompt.length < 12000 && c.caption.length < 2200)).toBe(true);
  });
});
