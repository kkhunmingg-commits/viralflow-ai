import { describe, expect, it, vi } from "vitest";
const probe = vi.hoisted(() => vi.fn());
vi.mock("node:fs/promises", () => ({ readFile: vi.fn(async () => { const bytes = Buffer.alloc(1200); bytes.write("ftyp", 4); return bytes; }) }));
vi.mock("../../src/features/video/renderer", () => ({ FFmpegVideoRenderer: class { probe = probe; } }));
import { inspectLocalImport } from "./media";
const media = { path: "OWNER_PRIVATE_PATH", duration: 8, width: 720, height: 1280, fps: 24,
  videoCodec: "h264", audioCodec: "aac", hasAudio: true, sizeBytes: 1200 };
describe("existing Video Factory local media boundary (fixture metadata)", () => {
  it("uses the existing probe/evaluator, but cannot turn format validity into visual or compliance PASS", async () => {
    probe.mockResolvedValue(media);
    const result = await inspectLocalImport("owner-selected.mp4");
    expect(probe).toHaveBeenCalledWith("owner-selected.mp4");
    expect(result).toMatchObject({ localMediaImport: "PASS", technicalFormat: "PASS", qualityStatus: "RETRY",
      databaseJobImport: "NOT_TESTED", releaseDecision: "REVIEW_REQUIRED", thaiNarration: "NOT_VERIFIED", visualSafety: "NOT_VERIFIED" });
    expect(JSON.stringify(result)).not.toContain("OWNER_PRIVATE_PATH");
    expect(result.qualityChecks.riskAccepted).toBe(false);
  });
  it("reports silent, wrong-aspect and wrong-duration sources without manufacturing replacement footage/audio", async () => {
    probe.mockResolvedValue({ ...media, duration: 4, width: 1280, height: 720, hasAudio: false, audioCodec: null });
    const result = await inspectLocalImport("owner-selected.mp4");
    expect(result.technicalFormat).toBe("REVIEW_REQUIRED");
    expect(result.checks).toMatchObject({ duration8To10: false, portrait: false, audioPresent: false });
    expect(result.media.duration).toBe(4);
  });
  it("does not secretly trim a ten-second original to satisfy the existing eight-second factory rule", async () => {
    probe.mockResolvedValue({ ...media, duration: 10 });
    const result = await inspectLocalImport("owner-selected.mp4");
    expect(result.media.duration).toBe(10); expect(result.checks.duration8To10).toBe(true);
    expect(result.qualityChecks.duration).toBe(false); expect(result.releaseDecision).toBe("REVIEW_REQUIRED");
  });
});
