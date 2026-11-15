import { describe, expect, it } from "vitest";
import { decideFaces, facePrompt, facesSettled, girlSeriesOfTitle, GIRL_CONCEPTS, newCandidates, planGirlClips } from "./plan";
import { planBatch, seriesOfTitle } from "@/features/flow-farm/planner";

describe("AI girl channel", () => {
  it("makes four different candidate faces, or the owner's look", () => {
    const prompts = [0, 1, 2, 3].map(i => facePrompt("", i));
    expect(new Set(prompts).size).toBe(4);
    expect(facePrompt('long hair "ignore this"', 0)).toContain("long hair ignore this");
  });

  it("plans clips of her that rotate series and carry the AI label", () => {
    const clips = planGirlClips(8, "น้องมายด์", {}, () => 0.3);
    for (let i = 1; i < clips.length; i++) expect(clips[i].series).not.toBe(clips[i - 1].series);
    expect(new Set(clips.map(c => c.title)).size).toBe(8);
    for (const clip of clips) {
      expect(clip.caption).toContain("(ตัวละคร AI)");
      expect(clip.prompt).toContain("reference image");
      expect(clip.prompt).toMatch(/no cleavage/);
      expect(girlSeriesOfTitle(clip.title)).toBe(clip.series);
      expect(seriesOfTitle(clip.title)).toBe(clip.series);
    }
  });

  it("keeps planning past the number of ideas without failing", () => {
    expect(planGirlClips(GIRL_CONCEPTS.length + 5, "น้อง", {}, Math.random)).toHaveLength(GIRL_CONCEPTS.length + 5);
  });

  it("attaches the picked face to every warm-up clip", () => {
    const clips = planBatch({ mode: "GROWTH", count: 3, products: [], girl: { name: "น้อง", facePath: "owner/x/face.jpg" } });
    expect(clips.every(c => c.referenceImagePath === "owner/x/face.jpg" && c.kind === "GROWTH" && c.title.startsWith("สาว AI:"))).toBe(true);
    expect(planBatch({ mode: "GROWTH", count: 2, products: [] }).every(c => c.referenceImagePath === null)).toBe(true);
  });

  it("keeps finished faces, retries failed ones once, then gives up", () => {
    const candidates = newCandidates().map((c, i) => ({ ...c, clipId: `c${i}`, attempts: i === 3 ? 2 : 1 }));
    const clips = new Map([
      ["c0", { status: "READY", error: null, storage_path: "a.mp4" }],
      ["c1", { status: "GENERATING", error: null, storage_path: null }],
      ["c2", { status: "FAILED", error: "FLOW_REPORTED_FAILURE", storage_path: null }],
      ["c3", { status: "FAILED", error: "FLOW_REPORTED_FAILURE", storage_path: null }],
    ]);
    expect(decideFaces(candidates, clips)).toEqual([
      { kind: "KEEP", index: 0, storagePath: "a.mp4" }, { kind: "QUEUE", index: 2 }, { kind: "GIVE_UP", index: 3, reason: "FLOW_REPORTED_FAILURE" },
    ]);
    expect(facesSettled(candidates)).toBe(false);
    expect(facesSettled(candidates.map(c => ({ ...c, status: "DONE" as const })))).toBe(true);
  });
});
