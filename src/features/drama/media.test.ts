import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ffmpegBinary } from "@/features/video/ffmpeg-binary";
import { assembleEpisode, lastFrameJpeg } from "./media";

const binary = ffmpegBinary(), dir = mkdtempSync(join(tmpdir(), "drama-media-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
/** A short synthetic clip: Flow's real output is 8 s, with sound; we also cover a silent, landscape clip. */
function clip(name: string, size: string, withAudio: boolean, color: string) {
  const out = join(dir, name);
  execFileSync(binary!, ["-y", "-f", "lavfi", "-i", `color=c=${color}:s=${size}:d=2:r=30`, ...(withAudio ? ["-f", "lavfi", "-i", "sine=f=440:d=2"] : []),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", ...(withAudio ? ["-c:a", "aac", "-shortest"] : []), out], { stdio: "ignore" });
  return new Uint8Array(readFileSync(out));
}
const probe = (bytes: Uint8Array) => {
  const file = join(dir, `probe-${Math.random()}.mp4`);
  writeFileSync(file, bytes);
  try { execFileSync(binary!, ["-i", file], { stdio: "pipe" }); return ""; } catch (error) { return String((error as { stderr?: Buffer }).stderr ?? ""); }
};

describe.skipIf(!binary)("drama media (real ffmpeg)", () => {
  it("takes the last frame as a JPEG", async () => {
    const jpeg = await lastFrameJpeg(clip("a.mp4", "720x1280", true, "red"));
    expect([jpeg[0], jpeg[1], jpeg[2]]).toEqual([0xff, 0xd8, 0xff]);
  }, 60_000);

  it("cuts mixed clips into one vertical episode with Thai subtitles and sound throughout", async () => {
    const shots = [
      { bytes: clip("b.mp4", "720x1280", true, "blue"), durationSeconds: 2, subtitle: "ใครอยู่ตรงนั้น" },
      { bytes: clip("c.mp4", "1280x720", false, "green"), durationSeconds: 2, subtitle: "กระจกบานนั้นมันมองตามเรามาตลอดทั้งคืน" },
      { bytes: clip("d.mp4", "1080x1920", true, "yellow"), durationSeconds: 2, subtitle: "" },
    ];
    const result = await assembleEpisode({ shots, cut: { seriesTitle: "บ้านกระจกผ้าแดง", episodeNumber: 1, totalEpisodes: 10, episodeTitle: "เงาในกระจก", finale: false } });
    expect(result.width).toBe(720);
    expect(result.height).toBe(1280);
    expect(result.durationSeconds).toBeGreaterThan(5.5);
    expect(result.durationSeconds).toBeLessThan(6.6);
    const info = probe(result.bytes);
    expect(info).toMatch(/Video: h264.*720x1280/);
    expect(info).toMatch(/Audio: aac/);
  }, 180_000);
});
