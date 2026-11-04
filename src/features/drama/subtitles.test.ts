import { describe, expect, it } from "vitest";
import { buildEpisodeSubtitles, wrapLine } from "./subtitles";

describe("wrapLine", () => {
  it("leaves short lines and strips ASS markup", () => {
    expect(wrapLine("สวัสดี")).toBe("สวัสดี");
    expect(wrapLine("a{\\b1}b")).toBe("ab1b");
  });
  it("breaks at a space near the middle", () => {
    expect(wrapLine("ฉันไม่รู้ว่าเกิดอะไรขึ้น แต่เราต้องออกไปจากที่นี่")).toBe("ฉันไม่รู้ว่าเกิดอะไรขึ้น\\Nแต่เราต้องออกไปจากที่นี่");
  });
  it("never starts a line with a Thai combining mark", () => {
    const out = wrapLine("กระจกบานนั้นมันมองตามเรามาตลอดทั้งคืนเลยนะ");
    const second = out.split("\\N")[1];
    expect(second).toBeDefined();
    expect(second[0]).not.toMatch(/[ัิ-ฺ็-๎]/);
  });
});

it("buildEpisodeSubtitles times lines per shot and adds the tag and end card", () => {
  const ass = buildEpisodeSubtitles({ seriesTitle: "บ้านกระจก", episodeNumber: 2, totalEpisodes: 10, episodeTitle: "เงา", finale: false,
    shots: [{ durationSeconds: 8, subtitle: "ใครอยู่ตรงนั้น" }, { durationSeconds: 8, subtitle: "" }] });
  expect(ass).toContain("PlayResX: 720");
  expect(ass).toContain("0:00:00.50,0:00:07.60,Sub");
  expect(ass).toContain("ใครอยู่ตรงนั้น");
  expect(ass).toContain("EP.2/10");
  expect(ass).toContain("ติดตามตอนต่อไป");
  expect(buildEpisodeSubtitles({ seriesTitle: "x", episodeNumber: 10, totalEpisodes: 10, episodeTitle: "y", finale: true, shots: [{ durationSeconds: 8, subtitle: "" }] })).toContain("จบบริบูรณ์");
});
