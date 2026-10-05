import "server-only";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import ffmpegPath from "ffmpeg-static";
import { FFmpegVideoRenderer } from "./renderer";
import { preparePortraitProductReference } from "@/features/video-benchmark/provider-normalization";
import type { TimedText } from "./types";

const escapeText = (value: string) => value.normalize("NFKC").replace(/[\\':,%\[\]]/g, character => `\\${character}`).replace(/[\r\n]/g, " ").slice(0, 140);

/** Validate stored narration before purchasing footage, using the same probe as the final render. */
export async function validateNarrationAudio(audio: Blob): Promise<void> {
  if (!audio.size || audio.size > 20_000_000) throw new Error("video_voice_unavailable");
  const dir = join(tmpdir(), "viralflow-narration", randomUUID());
  await mkdir(dir, { recursive: true });
  try {
    const path = join(dir, "voice");
    await writeFile(path, new Uint8Array(await audio.arrayBuffer()));
    const media = await new FFmpegVideoRenderer().probe(path);
    if (!media.hasAudio || !Number.isFinite(media.duration) || media.duration <= 0) throw new Error("video_voice_unavailable");
  } catch {
    throw new Error("video_voice_unavailable");
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/** Pad a copy of the owner's product photograph so inherited-aspect providers receive a portrait reference. */
export async function portraitProductReference(image: Blob): Promise<Blob> {
  const dir = join(tmpdir(), "viralflow-product-reference", randomUUID());
  await mkdir(dir, { recursive: true });
  try {
    const input = join(dir, "reference"), output = join(dir, "portrait.jpg");
    await writeFile(input, new Uint8Array(await image.arrayBuffer()));
    await preparePortraitProductReference(input, output);
    return new Blob([new Uint8Array(await readFile(output))], { type: "image/jpeg" });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/** Compose real generated footage; this never creates substitute product images or synthetic voice. */
export async function composeGeneratedVideo(sourcePath: string, outputPath: string, options: {
  durationSeconds: number; resolution: string; overlay: TimedText[]; voicePath?: string; preserveAudio?: boolean;
}) {
  const samePath = process.platform === "win32"
    ? resolve(sourcePath).toLowerCase() === resolve(outputPath).toLowerCase()
    : resolve(sourcePath) === resolve(outputPath);
  if (samePath) throw new Error("video_composition_source_overwrite");
  if (![8, 10].includes(options.durationSeconds)) throw new Error("video_duration_invalid");
  const renderer = new FFmpegVideoRenderer(), source = await renderer.probe(sourcePath);
  if (source.duration < options.durationSeconds - .12) throw new Error("generated_source_too_short");
  if (!options.voicePath && (!options.preserveAudio || !source.hasAudio)) throw new Error("video_voice_unavailable");
  const local = join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  const binary = process.env.FFMPEG_BINARY || (existsSync(local) ? local : ffmpegPath);
  if (!binary) throw new Error("ffmpeg_unavailable");
  const [width, height] = options.resolution === "1080p" ? [1080, 1920] : options.resolution === "480p" ? [480, 854] : [720, 1280];
  const text = options.overlay.filter(item => item.text.trim()).slice(0, 3).map((item, index) =>
    `drawtext=text='${escapeText(item.text)}':fontcolor=white:fontsize=${Math.round(width * .044)}:box=1:boxcolor=black@0.6:boxborderw=16:x=(w-text_w)/2:y=${index === 0 ? "h*0.14" : "h*0.78"}:enable='between(t,${Math.max(0, item.start)},${Math.min(options.durationSeconds, item.end)})'`);
  const filter = [`scale=${width}:${height}:force_original_aspect_ratio=decrease`, `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`, "fps=30", "format=yuv420p", ...text].join(",");
  const args = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", sourcePath,
    ...(options.voicePath ? ["-i", options.voicePath] : []), "-map", "0:v:0",
    ...(options.voicePath ? ["-map", "1:a:0", "-af", "apad"] : options.preserveAudio ? ["-map", "0:a:0?"] : ["-an"]),
    "-t", String(options.durationSeconds), "-vf", filter, "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    ...(options.voicePath || options.preserveAudio ? ["-c:a", "aac", "-b:a", "128k"] : []), "-movflags", "+faststart", outputPath];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    child.stderr.resume();
    let failed: Error | null = null;
    const timer = setTimeout(() => { failed = new Error("video_composition_timeout"); child.kill(); }, 120_000);
    child.on("error", error => { failed = error; });
    child.on("close", code => { clearTimeout(timer); if (failed || code !== 0) reject(failed ?? new Error("video_composition_failed")); else resolve(); });
  });
  return { source, media: await renderer.probe(outputPath) };
}
