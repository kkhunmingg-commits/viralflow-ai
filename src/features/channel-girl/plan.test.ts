import { describe, expect, it } from "vitest";
import { characterStatus, decideFaces, facePrompt, girlSeriesOfTitle, newCandidate, planGirlClips, randomNickname } from "./plan";
import { GIRL_SERIES, newArc, sampleArcs } from "./stories";
import { planBatch, seriesOfTitle } from "@/features/flow-farm/planner";

function seeded(seed: number) {
  let a = seed >>> 0 || 1;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}

describe("AI girl channel", () => {
  it("makes a different face each time, or the owner's look", () => {
    expect(new Set([0, 1, 2, 3, 4, 5].map(i => facePrompt("", i))).size).toBe(6);
    expect(facePrompt('long hair "ignore this"', 0)).toContain("long hair ignore this");
  });

  it("gives a nickname like MildMilk", () => {
    for (let i = 0; i < 20; i++) expect(randomNickname(seeded(i))).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+$/);
  });

  it("tells a story in order and carries it over to the next day", () => {
    const day1 = planGirlClips(2, "MildMilk", {}, seeded(7));
    expect(day1.clips).toHaveLength(2);
    expect(day1.arc?.next).toBe(2);
    const day2 = planGirlClips(3, "MildMilk", { arc: day1.arc, made: day1.made }, seeded(8));
    // Day 2 starts with episode 3 of the same story.
    expect(day2.clips[0].series).toBe(day1.clips[0].series);
    expect(day2.clips[0].caption).toMatch(/ตอนที่ 3\//);
    for (const clip of [...day1.clips, ...day2.clips]) {
      expect(clip.caption).toContain("(ตัวละคร AI)");
      expect(clip.prompt).toContain("reference image");
      expect(clip.prompt).toMatch(/no cleavage/);
      expect(clip.prompt.length).toBeLessThan(3000);
      expect(girlSeriesOfTitle(clip.title)).toBe(clip.series);
      expect(seriesOfTitle(clip.title)).toBe(clip.series);
    }
  });

  it("never repeats an episode over months of 3 clips a day", () => {
    let state: { arc: ReturnType<typeof planGirlClips>["arc"]; made: string[] } = { arc: null, made: [] };
    const titles: string[] = [];
    const random = seeded(42);
    for (let day = 0; day < 120; day++) {
      const plan = planGirlClips(3, "น้อง", state, random);
      titles.push(...plan.clips.map(c => c.title));
      state = { arc: plan.arc, made: plan.made };
    }
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(titles.map(t => girlSeriesOfTitle(t))).size).toBe(GIRL_SERIES.length);
  });

  it("starts a new story in a different series when one ends, and stories are 3 to 5 clips", () => {
    for (const arc of sampleArcs(seeded(3))) {
      expect(arc.episodes.length).toBeGreaterThanOrEqual(3);
      expect(arc.episodes.length).toBeLessThanOrEqual(5);
    }
    for (let i = 0; i < 20; i++) expect(newArc(seeded(i), { lastSeries: "ชาเลนจ์เต้น" }).series).not.toBe("ชาเลนจ์เต้น");
  });

  it("attaches the picked face to every warm-up clip", () => {
    const clips = planBatch({ mode: "GROWTH", count: 3, products: [], girl: { name: "น้อง", facePath: "owner/x/face.jpg" } });
    expect(clips.every(c => c.referenceImagePath === "owner/x/face.jpg" && c.kind === "GROWTH" && c.title.startsWith("สาว AI:"))).toBe(true);
    expect(planBatch({ mode: "GROWTH", count: 2, products: [] }).every(c => c.referenceImagePath === null)).toBe(true);
  });

  it("keeps finished faces, retries a failed one once, then gives up", () => {
    const candidates = [0, 1, 2, 3].map(i => ({ ...newCandidate(i), clipId: `c${i}`, attempts: i === 3 ? 2 : 1 }));
    const clips = new Map([
      ["c0", { status: "READY", error: null, storage_path: "a.mp4" }],
      ["c1", { status: "GENERATING", error: null, storage_path: null }],
      ["c2", { status: "FAILED", error: "FLOW_REPORTED_FAILURE", storage_path: null }],
      ["c3", { status: "FAILED", error: "FLOW_REPORTED_FAILURE", storage_path: null }],
    ]);
    expect(decideFaces(candidates, clips)).toEqual([
      { kind: "KEEP", index: 0, storagePath: "a.mp4" }, { kind: "QUEUE", index: 2 }, { kind: "GIVE_UP", index: 3, reason: "FLOW_REPORTED_FAILURE" },
    ]);
    expect(characterStatus(candidates, null)).toBe("FACES");
    expect(characterStatus(candidates.map(c => ({ ...c, status: "DONE" as const })), null)).toBe("PICK");
    expect(characterStatus(candidates, "face.jpg")).toBe("READY");
  });
});
