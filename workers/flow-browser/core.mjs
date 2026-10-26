import { createHash } from "node:crypto";
import { basename, resolve, sep } from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_VIDEO_BYTES = 50_000_000;

export function validateJob(input) {
  if (!input || typeof input !== "object" || !UUID.test(String(input.jobId ?? ""))) {
    throw new Error("INVALID_JOB_ID");
  }
  if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 12_000) {
    throw new Error("INVALID_PROMPT");
  }
  const portal = new URL(String(input.portalUrl ?? ""));
  const local = ["localhost", "127.0.0.1"].includes(portal.hostname);
  if ((portal.protocol !== "https:" && !(local && portal.protocol === "http:")) || portal.username || portal.password) {
    throw new Error("INVALID_PORTAL_URL");
  }
  if (input.imageUrl) {
    const image = new URL(String(input.imageUrl));
    if (image.protocol !== "https:" || image.username || image.password) throw new Error("INVALID_IMAGE_URL");
  }
  return {
    schema: "viralflow-flow-job-v1",
    jobId: input.jobId.toLowerCase(),
    prompt: input.prompt.trim(),
    instructions: typeof input.instructions === "string" ? input.instructions.slice(0, 4000) : "",
    portalUrl: portal.origin,
    imageUrl: input.imageUrl || null,
    label: typeof input.label === "string" ? input.label.slice(0, 200) : "",
    createdAt: input.createdAt || null
  };
}

export function inspectMp4(bytes) {
  const data = Buffer.from(bytes);
  if (data.length < 32 || data.length > MAX_VIDEO_BYTES || data.toString("ascii", 4, 8) !== "ftyp") {
    throw new Error("INVALID_MP4_OR_SIZE");
  }
  return { size: data.length, sha256: createHash("sha256").update(data).digest("hex") };
}

export function assertContained(root, path) {
  const base = resolve(root);
  const target = resolve(path);
  if (target !== base && !target.startsWith(base + sep)) throw new Error("UNSAFE_FILE_PATH");
  return target;
}

export function safeJobFilename(jobId) {
  if (!UUID.test(String(jobId))) throw new Error("INVALID_JOB_ID");
  return basename(String(jobId).toLowerCase() + ".mp4");
}

export function shouldGenerate(record) {
  // Never regenerate after a possibly accepted paid/credit-consuming UI click.
  return !record || record.state === "NEW";
}

// Stable DOM identity is required: result order/count can change while Flow renders.
export function validateResultIds(ids) {
  if (ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) {
    throw new Error('CALIBRATE_UNIQUE_RESULT_IDS');
  }
  return ids;
}

export function newResultId(before, current) {
  validateResultIds(before);
  validateResultIds(current);
  const previous = new Set(before);
  const added = current.filter(id => !previous.has(id));
  if (added.length > 1) throw new Error('AMBIGUOUS_NEW_RESULTS_REVIEW_REQUIRED');
  return added[0] ?? null;
}

export const STATES = Object.freeze(["NEW", "GENERATING", "DOWNLOADED", "IMPORTED", "NEEDS_REVIEW"]);
