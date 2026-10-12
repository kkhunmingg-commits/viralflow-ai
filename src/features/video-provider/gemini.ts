import "server-only";
import { createHash } from "node:crypto";

export const GEMINI_OMNI_MODEL = "gemini-omni-1.1-flash";
export const GEMINI_INTERACTIONS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
export const GEMINI_OMNI_PRICING = {
  verifiedAt: "2026-10-12",
  source: "https://ai.google.dev/gemini-api/docs/pricing",
  inputPerMillionUsd: 1.5,
  textPerMillionUsd: 9,
  videoPerMillionUsd: 17.5,
  videoTokensPerSecond720p: 5792,
} as const;
export const GEMINI_OMNI_8_SECOND_VIDEO_ESTIMATE_USD = 8 * 5792 * 17.5 / 1_000_000;
const MAX_PROMPT_BYTES = 8_000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_JSON_BYTES = Math.ceil(MAX_VIDEO_BYTES * 4 / 3) + 1024 * 1024;
const MAX_OUTPUT_TOKENS = 65_536;
const MODEL_METADATA_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_OMNI_MODEL}`;

export interface GeminiImage { bytes: Uint8Array; mimeType: string }
/** Persist this descriptor only. Reference bytes and API keys never belong in a checkpoint. */
export interface GeminiRequest {
  endpoint: typeof GEMINI_OMNI_MODEL;
  model: typeof GEMINI_OMNI_MODEL;
  prompt: string;
  task: "text_to_video" | "image_to_video";
  durationSeconds: 8;
  aspectRatio: "9:16";
  resolution: "720p";
  maxOutputTokens: number;
  image?: { sha256: string; mimeType: string; byteLength: number };
  estimateUsd: number;
  videoEstimateUsd: number;
  estimateBasis: "CONSERVATIVE_RESERVATION_ESTIMATE";
  pricingVersion: "2026-10-12";
}
type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}
function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function requestId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,1024}$/.test(value)) throw new Error("GEMINI_REQUEST_ID_INVALID");
  return value;
}
function hash(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
function assertImage(image: GeminiImage) {
  if (!image.bytes.byteLength || image.bytes.byteLength > MAX_IMAGE_BYTES || !["image/jpeg", "image/png", "image/webp"].includes(image.mimeType)) throw new Error("GEMINI_IMAGE_INVALID");
  const bytes = Buffer.from(image.bytes);
  const valid = image.mimeType === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : image.mimeType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!valid) throw new Error("GEMINI_IMAGE_INVALID");
}
function estimate(prompt: string, hasImage: boolean) {
  // Reserve at the highest output rate for the declared output-token ceiling,
  // plus a separate thought allowance and conservative input allowance. This is
  // an application estimate, never a Google-enforced invoice/spend limit.
  const inputAllowance = Buffer.byteLength(prompt, "utf8") + (hasImage ? 16_384 : 0);
  return Math.ceil((MAX_OUTPUT_TOKENS * 17.5 + MAX_OUTPUT_TOKENS * 9 + inputAllowance * 1.5) / 1_000_000 * 1.1 * 1_000_000) / 1_000_000;
}
function assertRequest(request: GeminiRequest) {
  if (request.endpoint !== GEMINI_OMNI_MODEL || request.model !== GEMINI_OMNI_MODEL || request.durationSeconds !== 8 || request.aspectRatio !== "9:16" || request.resolution !== "720p" || request.maxOutputTokens !== MAX_OUTPUT_TOKENS || request.pricingVersion !== "2026-10-12" || !request.prompt.trim() || Buffer.byteLength(request.prompt, "utf8") > MAX_PROMPT_BYTES || request.estimateUsd !== estimate(request.prompt, !!request.image) || request.task !== (request.image ? "image_to_video" : "text_to_video")) throw new Error("GEMINI_REQUEST_INVALID");
  if (request.image && (!/^[a-f0-9]{64}$/.test(request.image.sha256) || !nonnegativeInteger(request.image.byteLength) || !request.image.byteLength || request.image.byteLength > MAX_IMAGE_BYTES || !["image/jpeg", "image/png", "image/webp"].includes(request.image.mimeType))) throw new Error("GEMINI_REQUEST_INVALID");
}
async function readBounded(response: Response, maxBytes: number): Promise<Buffer> {
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) { await response.body?.cancel(); throw new Error("GEMINI_RESPONSE_TOO_LARGE"); }
  if (!response.body) throw new Error("GEMINI_RESPONSE_INVALID");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("GEMINI_RESPONSE_TOO_LARGE"); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}
async function readJson(response: Response, maxBytes = MAX_JSON_BYTES): Promise<JsonObject> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) { await response.body?.cancel(); throw new Error("GEMINI_RESPONSE_INVALID"); }
  try { const value = object(JSON.parse((await readBounded(response, maxBytes)).toString("utf8"))); if (value) return value; }
  catch (error) { if (error instanceof Error && error.message === "GEMINI_RESPONSE_TOO_LARGE") throw error; }
  throw new Error("GEMINI_RESPONSE_INVALID");
}
function assertMp4(bytes: Buffer) {
  if (bytes.byteLength < 12 || bytes.byteLength > MAX_VIDEO_BYTES || bytes.toString("ascii", 4, 8) !== "ftyp") throw new Error("GEMINI_VIDEO_INVALID");
  return bytes;
}
function videoContent(interaction: JsonObject) {
  const videos: JsonObject[] = [];
  for (const step of Array.isArray(interaction.steps) ? interaction.steps : []) {
    const parsed = object(step);
    if (parsed?.type !== "model_output") continue;
    for (const content of Array.isArray(parsed.content) ? parsed.content : []) {
      const value = object(content); if (value?.type === "video") videos.push(value);
    }
  }
  if (videos.length !== 1 || videos[0].mime_type !== "video/mp4") throw new Error("GEMINI_VIDEO_INVALID");
  return videos[0];
}
function fileId(value: unknown) {
  if (typeof value !== "string") throw new Error("GEMINI_DOWNLOAD_URL_NOT_ALLOWED");
  const relative = /^files\/([A-Za-z0-9_-]{1,200})$/.exec(value);
  if (relative) return relative[1];
  let url: URL; try { url = new URL(value); } catch { throw new Error("GEMINI_DOWNLOAD_URL_NOT_ALLOWED"); }
  const match = /^\/v1beta\/files\/([A-Za-z0-9_-]{1,200})$/.exec(url.pathname);
  if (url.origin !== "https://generativelanguage.googleapis.com" || url.username || url.password || url.search || url.hash || !match) throw new Error("GEMINI_DOWNLOAD_URL_NOT_ALLOWED");
  return match[1];
}
/** Token usage is an estimate against a dated public rate card, not an invoice. */
export function geminiUsageCostUsd(usageValue: unknown): number | null {
  const usage = object(usageValue);
  if (!usage || !nonnegativeInteger(usage.total_input_tokens) || !nonnegativeInteger(usage.total_output_tokens) || !nonnegativeInteger(usage.total_thought_tokens) || !Array.isArray(usage.output_tokens_by_modality) || (usage.total_tool_use_tokens !== undefined && usage.total_tool_use_tokens !== 0) || (usage.total_cached_tokens !== undefined && usage.total_cached_tokens !== 0)) return null;
  let video = 0; let text = 0; const seen = new Set<string>();
  for (const entry of usage.output_tokens_by_modality) {
    const part = object(entry);
    if (!part || typeof part.modality !== "string" || seen.has(part.modality) || !nonnegativeInteger(part.tokens) || !["text", "video"].includes(part.modality)) return null;
    seen.add(part.modality); if (part.modality === "video") video = part.tokens; else text = part.tokens;
  }
  if (video + text !== usage.total_output_tokens) return null;
  return Math.ceil((usage.total_input_tokens * 1.5 + video * 17.5 + (text + usage.total_thought_tokens) * 9) / 1_000_000 * 1_000_000) / 1_000_000;
}

export class GeminiOmniProvider {
  readonly provider = "gemini_omni_api";
  constructor(private key: string, private fetcher: typeof fetch = fetch, private options: { paidMode?: boolean } = {}) {}
  prepare(prompt: string, image?: GeminiImage): GeminiRequest {
    if (!prompt.trim() || Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) throw new Error("GEMINI_PROMPT_INVALID");
    if (image) assertImage(image);
    return { endpoint: GEMINI_OMNI_MODEL, model: GEMINI_OMNI_MODEL, prompt, task: image ? "image_to_video" : "text_to_video", durationSeconds: 8, aspectRatio: "9:16", resolution: "720p", maxOutputTokens: MAX_OUTPUT_TOKENS,
      ...(image ? { image: { sha256: hash(image.bytes), mimeType: image.mimeType, byteLength: image.bytes.byteLength } } : {}),
      estimateUsd: estimate(prompt, !!image), videoEstimateUsd: GEMINI_OMNI_8_SECOND_VIDEO_ESTIMATE_USD, estimateBasis: "CONSERVATIVE_RESERVATION_ESTIMATE", pricingVersion: "2026-10-12" };
  }
  private headers() {
    if (!this.key) throw new Error("GEMINI_UNAVAILABLE");
    return { "x-goog-api-key": this.key, "Content-Type": "application/json" };
  }
  private async get(url: string, maxBytes = MAX_JSON_BYTES) {
    let response: Response;
    try { response = await this.fetcher(url, { method: "GET", headers: this.headers(), redirect: "error", signal: AbortSignal.timeout(30_000) }); }
    catch { throw new Error("GEMINI_STATUS_UNAVAILABLE"); }
    if (!response.ok) { await response.body?.cancel(); throw new Error("GEMINI_STATUS_UNAVAILABLE"); }
    return readJson(response, maxBytes);
  }
  async health(): Promise<{ keyConfigured: boolean; modelAvailable: boolean | null; billingVerified: false }> {
    if (!this.key) return { keyConfigured: false, modelAvailable: null, billingVerified: false };
    try { const body = await this.get(MODEL_METADATA_URL, 64 * 1024); return { keyConfigured: true, modelAvailable: body.name === `models/${GEMINI_OMNI_MODEL}`, billingVerified: false }; }
    catch { return { keyConfigured: true, modelAvailable: null, billingVerified: false }; }
  }
  async submit(request: GeminiRequest, image?: GeminiImage): Promise<{ request_id: string }> {
    if (!this.options.paidMode) throw new Error("GEMINI_PAID_MODE_DISABLED");
    assertRequest(request);
    if (request.image) {
      if (!image) throw new Error("GEMINI_IMAGE_REQUIRED");
      assertImage(image);
      if (image.mimeType !== request.image.mimeType || image.bytes.byteLength !== request.image.byteLength || hash(image.bytes) !== request.image.sha256) throw new Error("GEMINI_IMAGE_CHANGED");
    } else if (image) throw new Error("GEMINI_REQUEST_INVALID");
    const body = { model: GEMINI_OMNI_MODEL,
      input: image ? [{ type: "image", data: Buffer.from(image.bytes).toString("base64"), mime_type: image.mimeType }, { type: "text", text: request.prompt }] : request.prompt,
      response_format: { type: "video", duration: "8s", aspect_ratio: "9:16", resolution: "720p", delivery: "inline" },
      generation_config: { max_output_tokens: MAX_OUTPUT_TOKENS, video_config: { task: request.task } }, background: true, store: true, stream: false };
    // Exactly one POST. An unknown result must be reconciled by the ledger; never retry here.
    let response: Response;
    try { response = await this.fetcher(GEMINI_INTERACTIONS_ENDPOINT, { method: "POST", headers: this.headers(), body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(30_000) }); }
    catch { throw new Error("GEMINI_SUBMISSION_UNKNOWN"); }
    if (!response.ok) { await response.body?.cancel(); throw new Error("GEMINI_SUBMISSION_UNKNOWN"); }
    const result = await readJson(response);
    if (result.model !== undefined && result.model !== GEMINI_OMNI_MODEL) throw new Error("GEMINI_RESPONSE_INVALID");
    return { request_id: requestId(result.id) };
  }
  private async interaction(request: GeminiRequest, id: string) {
    assertRequest(request); const validId = requestId(id);
    const result = await this.get(`${GEMINI_INTERACTIONS_ENDPOINT}/${validId}`);
    if (result.id !== validId || (result.model !== undefined && result.model !== GEMINI_OMNI_MODEL)) throw new Error("GEMINI_RESPONSE_INVALID");
    return result;
  }
  async poll(request: GeminiRequest, id: string): Promise<{ status: "PENDING" | "COMPLETE" | "FAILED" }> {
    const result = await this.interaction(request, id);
    if (result.status === "queued" || result.status === "in_progress") return { status: "PENDING" };
    if (["failed", "cancelled", "incomplete", "requires_action"].includes(String(result.status))) return { status: "FAILED" };
    if (result.status !== "completed") throw new Error("GEMINI_STATUS_INVALID");
    const video = videoContent(result);
    if (video.uri !== undefined) {
      const info = await this.get(`https://generativelanguage.googleapis.com/v1beta/files/${fileId(video.uri)}`, 64 * 1024);
      if (info.state === "PROCESSING") return { status: "PENDING" };
      if (info.state === "FAILED") return { status: "FAILED" };
      if (info.state !== "ACTIVE") throw new Error("GEMINI_FILE_STATUS_INVALID");
    }
    return { status: "COMPLETE" };
  }
  async retrieve(request: GeminiRequest, id: string): Promise<{ bytes: Uint8Array; costUsd: null; usageCostUsd: number | null; costBasis: "PROVIDER_USAGE_ESTIMATE" }> {
    const result = await this.interaction(request, id);
    if (result.status !== "completed") throw new Error("GEMINI_VIDEO_NOT_READY");
    const video = videoContent(result); let bytes: Buffer;
    if (typeof video.data === "string") {
      if (!video.data.length || video.data.length > Math.ceil(MAX_VIDEO_BYTES / 3) * 4 || video.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(video.data)) throw new Error("GEMINI_VIDEO_INVALID");
      bytes = assertMp4(Buffer.from(video.data, "base64"));
      if (bytes.toString("base64") !== video.data) throw new Error("GEMINI_VIDEO_INVALID");
    } else {
      const validFileId = fileId(video.uri);
      const info = await this.get(`https://generativelanguage.googleapis.com/v1beta/files/${validFileId}`, 64 * 1024);
      if (info.state !== "ACTIVE" || info.mimeType !== "video/mp4") throw new Error("GEMINI_VIDEO_NOT_READY");
      let response: Response;
      try { response = await this.fetcher(`https://generativelanguage.googleapis.com/v1beta/files/${validFileId}:download?alt=media`, { method: "GET", headers: this.headers(), redirect: "error", signal: AbortSignal.timeout(60_000) }); }
      catch { throw new Error("GEMINI_DOWNLOAD_FAILED"); }
      if (!response.ok || !(response.headers.get("content-type") ?? "").startsWith("video/mp4")) { await response.body?.cancel(); throw new Error("GEMINI_DOWNLOAD_FAILED"); }
      bytes = assertMp4(await readBounded(response, MAX_VIDEO_BYTES));
    }
    return { bytes, costUsd: null, usageCostUsd: geminiUsageCostUsd(result.usage), costBasis: "PROVIDER_USAGE_ESTIMATE" };
  }
  async billedCost(): Promise<null> { return null; }
}
