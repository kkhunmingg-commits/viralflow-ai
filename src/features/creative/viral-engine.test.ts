import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { planBatch, type FarmProduct } from "@/features/flow-farm/planner";
import { VIRAL_ANGLES, viralVoice } from "./viral-engine";
import { summarizePool } from "@/features/flow-farm/pool";

// Lucky, 8 Nov: "the program is called Viral, but the clips are chill". Every auto promo clip now aims for viral reach.
describe("viral promo clips", () => {
  const warm = planBatch({ mode: "GROWTH", count: 10, products: [], offset: 2, now: new Date("2026-08-10T05:00:00Z") });
  it("gives every warm-up clip the viral direction, a retention angle and an energetic voice", () => {
    for (const clip of warm) {
      expect(clip.prompt).toContain("VIRAL DIRECTION");
      expect(clip.prompt).toContain("ESCALATION");
      expect(clip.prompt).toContain("RETENTION ANGLE");
      expect(clip.prompt).toContain("PLATFORM SAFE");
      expect(clip.prompt).not.toMatch(/warm, natural Thai voice|lively, playful Thai voice/);
      expect(clip.prompt.length).toBeLessThan(12000);
    }
    // Neighbouring clips use different tricks.
    const angles = warm.map(c => VIRAL_ANGLES.find(a => c.caption.startsWith(a.captionHook))?.id);
    expect(angles.every(Boolean)).toBe(true);
    for (let i = 1; i < angles.length; i++) expect(angles[i]).not.toBe(angles[i - 1]);
  });
  it("prefers the high-energy ideas", () => {
    let hot = 0, total = 0;
    for (let offset = 0; offset < 8; offset++) {
      const clips = planBatch({ mode: "GROWTH", count: 8, products: [], offset, now: new Date("2026-08-10T05:00:00Z") });
      hot += clips.filter(c => /แมวเชฟ|ไรเดอร์|พนักงานส่งของ|คาหนังคาเขา|แข่งกับแมว|ไข่เจียวยักษ์|ดึงสูง|พริกท้าดวล|ข้าวโพดคั่ว|น้ำผึ้ง|พายุในแก้ว|ไฟดับทีละดวง|โดรนจิ๋ว|ทะเลหมอกพุ่ง|เปลี่ยนโหมด/.test(c.title)).length;
      total += clips.length;
    }
    expect(hot / total).toBeGreaterThan(0.25);
  });
  it("keeps the caption's first line unique per clip (the learning loop matches posts by it) and asks a real question", () => {
    const firsts = warm.map(c => c.caption.split("\n")[0]);
    expect(new Set(firsts).size).toBe(warm.length);
    expect(warm.every(c => / EP\.\d+ · /.test(c.caption.split("\n")[0]) && c.caption.includes("ติดตาม"))).toBe(true);
    // Never trades a reward for engagement, never hints at lottery or gambling.
    for (const c of warm) expect(c.caption).not.toMatch(/แจก|รางวัล|ฟรี|หวย|เลขเด็ด/);
  });
  it("keeps the voice line short enough for one take", () => {
    expect(viralVoice(VIRAL_ANGLES[0], "ก".repeat(200)).length).toBeLessThanOrEqual(70);
  });
  it("makes product ads energetic but honest: no results, rankings, prices or reviews", () => {
    const product: FarmProduct = { id: "p1", title: "Casio F-91W", categoryKey: "watch", imagePath: "a.jpg", imageAssetId: "m1", facts: [{ id: "f1", text: "น้ำหนัก 21 กรัม" }] };
    const ads = planBatch({ mode: "AFFILIATE", count: 3, products: [product] });
    for (const ad of ads) {
      expect(ad.prompt).toContain("VIRAL AD DIRECTION");
      expect(ad.prompt).toContain("HONEST: the product only does what");
      expect(ad.prompt).toContain("reference image");
      expect(ad.caption).toContain("น้ำหนัก 21 กรัม");
      expect(ad.caption).not.toMatch(/ขายดี|อันดับ|ดีที่สุด|ลดราคา|รีวิว|การันตี/);
    }
    expect(new Set(ads.map(a => a.caption.split("\n")[0])).size).toBe(3);
  });
});

// Lucky, 8 Nov: one pool of Google accounts for all three modes, with what each has left today.
describe("shared Google account pool", () => {
  const row = (id: string, extra: Partial<Parameters<typeof summarizePool>[0][number]> = {}) => ({ flow_account_id: id, label: id, purpose: "CLIP" as const,
    tiktok_account_id: null, active: true, exhausted_today: false, per_day: 5, used_today: 0, left_today: 5, drama_reserved: 0, free_today: 5,
    drama_waiting: 1, episode_shots: 4, open_clip: true, ...extra });
  it("counts only signed-in accounts and separates what drama keeps", () => {
    const pool = summarizePool([row("a", { used_today: 2, left_today: 3, free_today: 3 }), row("r", { purpose: "REPAIR", open_clip: false }), row("new")],
      { a: { state: "READY", note: null, checkedAt: "" }, r: { state: "READY", note: null, checkedAt: "" } });
    expect(pool.usable).toBe(2);
    expect(pool.leftToday).toBe(8);
    expect(pool.openClips).toBe(3);
    expect(pool.keptForDrama).toBe(5);
    expect(pool.accounts.find(a => a.id === "new")?.loginState).toBe("PENDING");
    expect(pool.accounts[0].id).toBe("r");
  });
});
