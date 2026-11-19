import "server-only";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpegBinary } from "@/features/video/ffmpeg-binary";
import { buildEpisodeSubtitles, type EpisodeCut } from "./subtitles";

/** Free post-production on the server: no Flow credits are used for anything here. */
const WIDTH = 720, HEIGHT = 1280, FPS = 24;

function run(args: string[], cwd: string, timeoutMs = 240_000) {
  const binary = ffmpegBinary();
  if (!binary) throw new Error("FFMPEG_UNAVAILABLE");
  return new Promise<string>((resolve, reject) => {
    const child = spawn(binary, args, { cwd, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] }), errors: Buffer[] = [];
    let failed: Error | null = null;
    const timer = setTimeout(() => { failed = new Error("FFMPEG_TIMEOUT"); child.kill(); }, timeoutMs);
    child.stderr.on("data", data => errors.push(Buffer.from(data)));
    child.on("error", error => { failed = error; });
    child.on("close", code => {
      clearTimeout(timer);
      const stderr = Buffer.concat(errors).toString();
      if (failed || code !== 0) reject(failed ?? new Error(`FFMPEG_FAILED(${code}): ${stderr.slice(-300)}`)); else resolve(stderr);
    });
  });
}

async function workspace<T>(work: (dir: string) => Promise<T>) {
  const dir = await mkdtemp(join(tmpdir(), "vf-drama-"));
  try { return await work(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

/** The last frame of a shot as a JPEG: the next shot starts from it, and episode 1's first one becomes the key still. */
export function lastFrameJpeg(mp4: Uint8Array) {
  return workspace(async dir => {
    await writeFile(join(dir, "in.mp4"), mp4);
    try { await run(["-nostdin", "-hide_banner", "-loglevel", "error", "-sseof", "-0.3", "-i", "in.mp4", "-frames:v", "1", "-q:v", "3", "-y", "last.jpg"], dir, 60_000); }
    catch { await run(["-nostdin", "-hide_banner", "-loglevel", "error", "-i", "in.mp4", "-vf", "reverse", "-frames:v", "1", "-q:v", "3", "-y", "last.jpg"], dir, 60_000); }
    const bytes = await readFile(join(dir, "last.jpg"));
    if (bytes.length < 1000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("FRAME_EXTRACT_FAILED");
    return bytes;
  });
}

/** ffmpeg read the file and said it is not a usable video, as opposed to the server being unable to run the check at all. */
const DECODE_FAILURE = /Invalid data found|moov atom not found|Error opening input|does not contain any stream|could not find codec|corrupt/i;
export function isDecodeFailure(error: unknown) {
  return error instanceof Error && /^FFMPEG_FAILED\(\d+\)/.test(error.message) && DECODE_FAILURE.test(error.message);
}
/** Thrown when the server itself could not check a shot: the take is kept and checked again later, no credits are spent. */
export const SHOT_CHECK_UNAVAILABLE = "SHOT_CHECK_UNAVAILABLE";

export type ShotCheck = { ok: true; durationSeconds: number } | { ok: false; reason: string };
/** Seconds covered by detector events: each start pairs with the next end; an open start runs to the end of the clip. */
function covered(log: string, startKey: string, endKey: string, duration: number) {
  const escape = (key: string) => key.replace(/[.]/g, "\\.");
  const events = [...log.matchAll(new RegExp(`(${escape(startKey)}|${escape(endKey)}):\\s*(-?[\\d.]+)`, "g"))];
  let total = 0, open: number | null = null;
  for (const [, key, value] of events) {
    if (key === startKey) open = Number(value);
    else if (open !== null) { total += Number(value) - open; open = null; }
  }
  if (open !== null) total += Math.max(0, duration - open);
  return total;
}
/**
 * The server's check of every shot before it goes into an episode: a real video, long enough, not (mostly) black and
 * not a frozen picture. Only clear defects fail, so a quiet, still scene is not remade for nothing. Whether the scene
 * shows what the prompt asked for is not judged here (that would need a paid vision model).
 */
export function checkShot(mp4: Uint8Array) {
  return workspace(async (dir): Promise<ShotCheck> => {
    if (mp4.length < 1000 || Buffer.from(mp4).toString("ascii", 4, 8) !== "ftyp") return { ok: false, reason: "ไฟล์วิดีโอเสีย" };
    await writeFile(join(dir, "in.mp4"), mp4);
    let log: string;
    try {
      log = await run(["-nostdin", "-hide_banner", "-i", "in.mp4", "-map", "0:v:0", "-vf", "blackdetect=d=0.5:pic_th=0.98:pix_th=0.10,freezedetect=n=-60dB:d=1.5",
        "-an", "-f", "null", "-"], dir, 120_000);
    } catch (error) {
      const detail = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim();
      if (isDecodeFailure(error)) return { ok: false, reason: `เปิดไฟล์วิดีโอไม่ได้ (${detail.slice(-160)})` };
      throw new Error(`${SHOT_CHECK_UNAVAILABLE}: ${ffmpegBinary() ?? "no ffmpeg"} ${detail}`.slice(0, 400));
    }
    const match = /Duration: (\d+):(\d+):([\d.]+)/.exec(log);
    const duration = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
    if (!/Stream #\d+:\d+.*Video:/.test(log)) return { ok: false, reason: "ไม่มีภาพ" };
    if (duration < 4) return { ok: false, reason: `สั้นเกินไป (${duration.toFixed(1)} วิ)` };
    if (covered(log, "black_start", "black_end", duration) >= duration * 0.8) return { ok: false, reason: "จอดำเกือบทั้งช็อต" };
    if (covered(log, "lavfi.freezedetect.freeze_start", "lavfi.freezedetect.freeze_end", duration) >= duration * 0.9) return { ok: false, reason: "ภาพค้างทั้งช็อต" };
    return { ok: true, durationSeconds: Math.round(duration * 1000) / 1000 };
  });
}

const hasAudio = async (dir: string, file: string) => {
  // `ffmpeg -i` with no output exits non-zero but lists the streams.
  const binary = ffmpegBinary();
  if (!binary) throw new Error("FFMPEG_UNAVAILABLE");
  return new Promise<boolean>(resolve => {
    const child = spawn(binary, ["-hide_banner", "-i", file], { cwd: dir, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] }), errors: Buffer[] = [];
    child.stderr.on("data", data => errors.push(Buffer.from(data)));
    child.on("close", () => resolve(/Stream #\d+:\d+.*Audio:/.test(Buffer.concat(errors).toString())));
    child.on("error", () => resolve(false));
  });
};

/**
 * Cuts an episode: the shots in order at 720x1280, Thai subtitles for each line, the series/episode tag at the start
 * and "next episode" (or "the end") over the last seconds. Shots without sound get silence so the cut never fails.
 */
export function assembleEpisode(input: { shots: Array<{ bytes: Uint8Array; durationSeconds: number; subtitle: string; trimStartSeconds?: number;
  /** Where the take is cut off (seconds from its own start): drops a slow settle at the end of a take. */
  maxSeconds?: number }>; cut?: Omit<EpisodeCut, "shots">;
  fontPath?: string;
  /**
   * 17 Nov (Lucky, after a competitor's clips): a short cross-dissolve between takes instead of a hard jump, picture
   * and sound together. 0 or unset keeps hard cuts.
   */
  transitionSeconds?: number;
  /** Ready-made subtitles (product clips); otherwise the episode's own are built from `cut`. */
  ass?: (durations: number[]) => string }) {
  if (!input.shots.length) throw new Error("NO_SHOTS");
  return workspace(async dir => {
    await mkdir(join(dir, "fonts"));
    await copyFile(input.fontPath ?? join(process.cwd(), "assets", "fonts", "NotoSansThai-Bold.ttf"), join(dir, "fonts", "NotoSansThai-Bold.ttf"));
    // A cut from the start of a take (product clips: Flow's first frames can still show the reference photo).
    const starts = input.shots.map(shot => Math.max(0, Math.min(2, shot.trimStartSeconds ?? 0)));
    const durations = input.shots.map((shot, i) => Math.max(1, Math.min(10, shot.durationSeconds || 8, shot.maxSeconds ?? 10) - starts[i]));
    // The dissolve overlaps neighbouring takes, so it can never be longer than a third of the shortest one.
    const fade = input.shots.length > 1 ? Math.max(0, Math.min(input.transitionSeconds ?? 0, Math.min(...durations) / 3)) : 0;
    // How long each take is on screen on its own once the overlaps are taken out (the subtitles follow these).
    const shown = durations.map((d, i) => i < durations.length - 1 ? d - fade : d);
    const args = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y"];
    const chains: string[] = [];
    for (const [i, shot] of input.shots.entries()) {
      const file = `shot-${i}.mp4`;
      await writeFile(join(dir, file), shot.bytes);
      args.push("-i", file);
      chains.push(`[${i}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},fps=${FPS},setsar=1,format=yuv420p,trim=start=${starts[i]}:duration=${durations[i]},setpts=PTS-STARTPTS,fps=${FPS}[v${i}]`);
      // 19 Nov (KAGE VELVET CLOUD): a Flow take whose sound decoded to NaN/Inf samples made the AAC encoder refuse the
      // whole cut (FFMPEG_FAILED(234), aac -22). 16-bit samples are always finite, so the take's sound is kept, clipped.
      chains.push(await hasAudio(dir, file)
        ? `[${i}:a]aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo,atrim=start=${starts[i]}:duration=${durations[i]},asetpts=PTS-STARTPTS,apad=whole_dur=${durations[i]}[a${i}]`
        : `aevalsrc=0:c=stereo:s=48000:d=${durations[i]}[a${i}]`);
    }
    const total = shown.reduce((sum, d) => sum + d, 0);
    if (!input.ass && !input.cut) throw new Error("NO_SUBTITLES");
    await writeFile(join(dir, "episode.ass"), input.ass ? input.ass(shown)
      : buildEpisodeSubtitles({ ...input.cut!, shots: input.shots.map((shot, i) => ({ durationSeconds: shown[i], subtitle: shot.subtitle })) }), "utf8");
    const joins: string[] = [];
    if (fade > 0) {
      let video = "v0", audio = "a0", offset = 0;
      for (let i = 1; i < input.shots.length; i++) {
        offset += shown[i - 1];
        const v = i === input.shots.length - 1 ? "cv" : `xv${i}`, a = i === input.shots.length - 1 ? "ca" : `xa${i}`;
        joins.push(`[${video}][v${i}]xfade=transition=fade:duration=${fade.toFixed(3)}:offset=${offset.toFixed(3)}[${v}]`);
        joins.push(`[${audio}][a${i}]acrossfade=d=${fade.toFixed(3)}:c1=tri:c2=tri[${a}]`);
        video = v; audio = a;
      }
    } else {
      joins.push(`${input.shots.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${input.shots.length}:v=1:a=1[cv][ca]`);
    }
    const filter = [...chains, ...joins, "[cv]ass=episode.ass:fontsdir=fonts,format=yuv420p[v]"].join(";");
    args.push("-filter_complex", filter, "-map", "[v]", "-map", "[ca]", "-t", total.toFixed(3), "-r", String(FPS),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-movflags", "+faststart", "episode.mp4");
    await run(args, dir);
    const bytes = await readFile(join(dir, "episode.mp4"));
    if (bytes.length < 1000 || bytes.toString("ascii", 4, 8) !== "ftyp") throw new Error("EPISODE_RENDER_FAILED");
    return { bytes, width: WIDTH, height: HEIGHT, durationSeconds: Math.round(total * 1000) / 1000 };
  });
}

export type TakeCheck = { ok: true; durationSeconds: number; note: string } | { ok: false; reason: string };
/**
 * AI LIVE presenter takes: the shot check above, plus for talking takes a sound track loud enough to be speech
 * (the lip-sync learns mouth shapes from it). Whether it is the same face is checked on the owner's computer.
 */
export async function checkPresenterTake(mp4: Uint8Array, needsVoice: boolean): Promise<TakeCheck> {
  const shot = await checkShot(mp4);
  // A face or idle take is meant to be almost still: "picture frozen" alone never fails it (a remake costs credits).
  if (!shot.ok && !(shot.reason === "ภาพค้างทั้งช็อต" && !needsVoice)) return shot;
  if (!shot.ok) return { ok: true, durationSeconds: 8, note: "ภาพนิ่งมาก (ตั้งใจ)" };
  if (!needsVoice) return { ok: true, durationSeconds: shot.durationSeconds, note: `${shot.durationSeconds.toFixed(1)} วิ` };
  return workspace(async dir => {
    await writeFile(join(dir, "in.mp4"), mp4);
    let log: string;
    try { log = await run(["-nostdin", "-hide_banner", "-i", "in.mp4", "-map", "0:a:0", "-af", "volumedetect", "-vn", "-f", "null", "-"], dir, 60_000); }
    catch { return { ok: false, reason: "ไม่มีเสียงพูด" }; }
    const mean = Number(/mean_volume:\s*(-?[\d.]+) dB/.exec(log)?.[1] ?? "-91");
    if (!(mean > -45)) return { ok: false, reason: `เสียงเบาเกินไป (${mean.toFixed(0)} dB)` };
    return { ok: true, durationSeconds: shot.durationSeconds, note: `${shot.durationSeconds.toFixed(1)} วิ · เสียง ${mean.toFixed(0)} dB` };
  });
}
