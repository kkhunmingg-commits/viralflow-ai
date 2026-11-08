import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ffmpegBinary } from "@/features/video/ffmpeg-binary";
import { assembleEpisode, checkShot, lastFrameJpeg } from "./media";

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

/** A clip from any lavfi source (moving test pattern, black, a still colour). */
function source(name: string, input: string, seconds: number) {
  const out = join(dir, name);
  execFileSync(binary!, ["-y", "-f", "lavfi", "-i", `${input}:d=${seconds}:r=24`, "-c:v", "libx264", "-pix_fmt", "yuv420p", out], { stdio: "ignore" });
  return new Uint8Array(readFileSync(out));
}

describe.skipIf(!binary)("checkShot (real ffmpeg)", () => {
  it("passes a normal moving shot", async () => {
    expect(await checkShot(source("ok.mp4", "testsrc2=s=360x640", 8))).toEqual({ ok: true, durationSeconds: 8 });
  }, 60_000);
  it("rejects black, frozen, too short and broken files", async () => {
    expect(await checkShot(source("black.mp4", "color=c=black:s=360x640", 8))).toMatchObject({ ok: false, reason: "จอดำเกือบทั้งช็อต" });
    expect(await checkShot(source("frozen.mp4", "color=c=0x406080:s=360x640", 8))).toMatchObject({ ok: false, reason: "ภาพค้างทั้งช็อต" });
    expect(await checkShot(source("short.mp4", "testsrc2=s=360x640", 2))).toMatchObject({ ok: false });
    expect(await checkShot(new Uint8Array(5000))).toMatchObject({ ok: false, reason: "ไฟล์วิดีโอเสีย" });
  }, 90_000);
});

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

describe("isDecodeFailure", () => {
  it("blames the file only when ffmpeg read it and refused it", async () => {
    const { isDecodeFailure } = await import("./media");
    expect(isDecodeFailure(new Error("FFMPEG_FAILED(183): in.mp4: Invalid data found when processing input"))).toBe(true);
    expect(isDecodeFailure(new Error("FFMPEG_FAILED(1): moov atom not found"))).toBe(true);
    expect(isDecodeFailure(new Error("FFMPEG_FAILED(null): "))).toBe(false);
    expect(isDecodeFailure(new Error("FFMPEG_TIMEOUT"))).toBe(false);
    expect(isDecodeFailure(Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" }))).toBe(false);
    expect(isDecodeFailure(new Error("FFMPEG_UNAVAILABLE"))).toBe(false);
  });
});
