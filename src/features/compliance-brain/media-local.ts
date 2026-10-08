import "server-only";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { localMediaObservationSchema, type MediaInspection } from "./media-observations";

const exec = promisify(execFile);
// Do not launch unbounded decoders on a web server. Busy requests remain held for review.
let busy = false;
export async function inspectLocalMedia(bytes: Uint8Array): Promise<MediaInspection> {
  if (process.env.COMPLIANCE_LOCAL_MEDIA_ENABLED !== "true") return { state: "DISABLED" };
  if (busy || !bytes.byteLength || bytes.byteLength > 100_000_000) return { state: "FAILED" };
  busy = true;
  let directory: string | undefined;
  try {
    const root = process.cwd();
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP,
      HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1",
      COMPLIANCE_OCR_DATA_PATH: process.env.COMPLIANCE_OCR_DATA_PATH,
      COMPLIANCE_FFMPEG_PATH: process.env.COMPLIANCE_FFMPEG_PATH,
      COMPLIANCE_FFPROBE_PATH: process.env.COMPLIANCE_FFPROBE_PATH,
      COMPLIANCE_MEDIA_PYTHON: process.env.COMPLIANCE_MEDIA_PYTHON,
    };
    directory = await mkdtemp(path.join(tmpdir(), "viralflow-media-"));
    const input = path.join(directory, "input.mp4");
    await writeFile(input, bytes, { mode: 0o600 });
    const result = await exec(process.execPath, ["--max-old-space-size=384", path.join(root, "scripts/compliance-media-worker.mjs"), input],
      { env, windowsHide: true, timeout: 120_000, maxBuffer: 1_000_000, shell: false });
    const observation = localMediaObservationSchema.parse(JSON.parse(result.stdout));
    if (observation.assetHash !== createHash("sha256").update(bytes).digest("hex")) throw new Error("MEDIA_BYTES_CHANGED");
    return { state: "OBSERVED", observation };
  } catch { return { state: "FAILED" }; }
  finally {
    // Only the exact directory returned by mkdtemp is removed, never a caller path.
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    busy = false;
  }
}
