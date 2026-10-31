import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { composeGeneratedVideo } from "@/features/video/media-composition";
import ffmpeg from "ffmpeg-static";
describe("real local composition boundary", () => {
  it("produces an eight-second portrait H.264/AAC file from video and audio, no paid API", async () => {
    const dir = await mkdtemp(join(tmpdir(), "viralflow-compose-test-"));
    const run = (args: string[]) => new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpeg!, args, { windowsHide: true, stdio: "ignore" });
      child.on("error", reject); child.on("close", code => code === 0 ? resolve() : reject(new Error("fixture media failed")));
    });
    try {
      const source = join(dir, "source.mp4"), voice = join(dir, "voice.wav"), output = join(dir, "result.mp4");
      // A test pattern and sine wave prove codecs/timing only; never a fal or speech claim.
      await run(["-y", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=24:duration=8.1", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", source]);
      await run(["-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=32000:duration=6.5", voice]);
      const result = await composeGeneratedVideo(source, output, { durationSeconds: 8, resolution: "720p", overlay: [], voicePath: voice });
      expect(result.media.width).toBe(720); expect(result.media.height).toBe(1280); expect(result.media.duration).toBeCloseTo(8, 1);
      expect(result.media.videoCodec).toBe("h264"); expect(result.media.audioCodec).toBe("aac"); expect(result.media.hasAudio).toBe(true);
      expect(result.source.path).toBe(source);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 120_000);
});
