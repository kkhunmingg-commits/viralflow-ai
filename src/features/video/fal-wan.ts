import {createHash} from "node:crypto";
import {createFalClient} from "@fal-ai/client";
import {buildFalModelInput, FAL_MODEL_ENDPOINTS, getFalModel, getFalModelCost, resolveFalModelSettings, restoreFalModelSettings, type FalAspectRatio, type FalModelId, type FalModelSelection, type FalModelSettings, type FalVideoResolution} from "./fal-models";
import type {RenderedVideo, VideoQualityInput, VideoQualityResult} from "./types";

export const FAL_WAN_ENDPOINT = FAL_MODEL_ENDPOINTS.WAN_22_TURBO;
export const FAL_WAN_NOMINAL_COST_USD = .10;
export type FalWanProviderState = "PRIMARY_CANDIDATE" | "BENCHMARK_FAILED" | "BENCHMARK_PASS_PENDING_OWNER_REVIEW" | "PRODUCTION_APPROVED";
export type FalWanFailureCode = "UNAVAILABLE" | "BUDGET_EXCEEDED" | "BILLING_FAILED" | "RATE_LIMITED" | "SAFETY_REJECTED" | "TIMEOUT" | "CANCELLED" | "PROVIDER_FAILED" | "INVALID_OUTPUT" | "DOWNLOAD_FAILED";
export interface FalWanCapabilities {
  imageToVideo: true;
  resolutions: readonly FalVideoResolution[];
  aspectRatios: readonly FalAspectRatio[];
  sourceDuration: "PROVIDER_DEFINED" | "CONFIGURED";
  configurableFrames: boolean;
  safetyChecker: true;
  output: "FILE_URL";
  queue: true;
  commercialUse: true;
}
export interface FalWanGenerateInput {
  image: Blob;
  prompt: string;
  seed?: number;
  maxCostUsd: number;
  resolution?: FalVideoResolution;
  aspectRatio?: FalAspectRatio;
  durationSeconds?: number;
  signal?: AbortSignal;
  beforeSubmit?: () => Promise<void>;
  onSubmitted?: (requestId: string) => Promise<void>;
}
export interface FalWanNormalizedResult {
  requestId: string;
  videoUrl: string;
  provider: "fal";
  model: FalModelId;
  endpoint?: FalModelId;
  settings?: FalModelSettings;
  resolution: FalVideoResolution;
  aspectRatio: FalAspectRatio;
  estimatedCostUsd: number;
  // Compatibility accounting: held conservatively until billing reconciliation.
  actualCostUsd: number;
  recordedCostUsd?: null;
  costBasis?: "ESTIMATED";
  retryCount: 0;
  sourceDurationSeconds: number | null;
  queueTimeMs?: number | null;
  generationTimeMs?: number | null;
  latencyMs?: number;
}
export interface FalWanGenerationResult extends FalWanNormalizedResult {bytes: Uint8Array; checksum: string}
type FalResult = {data?: {video?: {url?: string; duration?: number; content_type?: string; file_name?: string; file_size?: number}}; requestId?: string};
type FalQueueStatus = {status?: string; error?: unknown; error_type?: string};
export interface FalWanClient {
  upload(file: Blob): Promise<string>;
  submit(endpoint: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<{request_id: string}>;
  status(endpoint: string, requestId: string, signal?: AbortSignal): Promise<FalQueueStatus>;
  result(endpoint: string, requestId: string, signal?: AbortSignal): Promise<FalResult>;
  cancel?(endpoint: string, requestId: string, signal?: AbortSignal): Promise<{success?: boolean; status?: string} | boolean>;
}

class FalHttpError extends Error {
  constructor(readonly status: number, readonly detail: unknown) {super("Video service request failed"); this.name = "FalHttpError";}
}
const queueRoot = (endpoint: string) => `https://queue.fal.run/${endpoint.split("/").slice(0, 2).join("/")}`;
const defaultClient = (apiKey: string, fetchImpl: typeof fetch): FalWanClient => {
  const storage = createFalClient({credentials: apiKey}).storage;
  async function request<T>(url: string, method: string, input?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    // SDK queue.submit retries POST internally. A paid submission must be one
    // direct POST, including when its response is lost or rate limited.
    const response = await fetchImpl(url, {method, signal, redirect: "error", headers: {Authorization: `Key ${apiKey}`, "Content-Type": "application/json", Accept: "application/json", ...(method === "POST" ? {"X-Fal-No-Retry": "1"} : {})}, ...(input ? {body: JSON.stringify(input)} : {})});
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new FalHttpError(response.status, data);
    return data as T;
  }
  return {
    upload: file => storage.upload(file),
    submit: (endpoint, input, signal) => request(`https://queue.fal.run/${endpoint}`, "POST", input, signal),
    status: (endpoint, id, signal) => request(`${queueRoot(endpoint)}/requests/${encodeURIComponent(id)}/status?logs=0`, "GET", undefined, signal),
    result: async (endpoint, id, signal) => ({data: await request(`${queueRoot(endpoint)}/requests/${encodeURIComponent(id)}`, "GET", undefined, signal), requestId: id}),
    cancel: (endpoint, id, signal) => request(`${queueRoot(endpoint)}/requests/${encodeURIComponent(id)}/cancel`, "PUT", undefined, signal),
  };
};
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const bounded = (value: number | undefined, fallback: number, min: number, max: number) => Math.min(max, Math.max(min, Math.floor(Number.isFinite(value) ? value! : fallback)));
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
function isFalMediaUrl(reference: string): boolean {
  try {
    const url = new URL(reference);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    if (url.hostname === "fal.media" || url.hostname.endsWith(".fal.media")) return true;
    // The official LTX output schema also uses this fal-owned storage bucket.
    // Do not allow arbitrary Google Cloud Storage buckets or encoded traversal.
    return url.hostname === "storage.googleapis.com" && url.pathname.startsWith("/falserverless/")
      && !/%(?:2f|5c)/i.test(url.pathname) && !decodeURIComponent(url.pathname).split("/").some(part => part === ".." || part === "." || part.includes("\\"));
  } catch {return false;}
}

export class FalWanProviderError extends Error {
  readonly recordedCostUsd = null;
  readonly costBasis = "ESTIMATED" as const;
  constructor(public readonly code: FalWanFailureCode, message: string, public readonly retryable = false, public readonly actualCostUsd = 0, public readonly requestId: string | null = null, public readonly terminalConfirmed = false) {super(message); this.name = "FalWanProviderError";}
}

interface OperationContext {settings: FalModelSettings; reservedCostUsd: number; requestId: string | null; submissionAttempted: boolean; completed: boolean; startedAt: number; acceptedAt: number | null; runningAt: number | null; completedAt: number | null}
export interface FalWanProviderOptions extends FalModelSelection {
  settings?: FalModelSettings;
  apiKey?: string;
  client?: FalWanClient;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  timeoutMs?: number;
  readRetryAttempts?: number;
}

export class FalWanVideoProvider {
  readonly provider = "fal" as const;
  readonly model: FalModelId;
  private readonly apiKey: string;
  private readonly client: FalWanClient;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;
  private readonly timeoutMs: number;
  private readonly readRetryAttempts: number;
  private readonly settings: FalModelSettings;
  constructor(options: FalWanProviderOptions = {}) {
    this.apiKey = options.apiKey ?? "";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.client = options.client ?? defaultClient(this.apiKey, this.fetchImpl);
    this.sleep = options.sleep ?? wait;
    this.pollIntervalMs = bounded(options.pollIntervalMs, 5_000, 0, 60_000);
    this.maxPollAttempts = bounded(options.maxPollAttempts, 144, 1, 144);
    this.timeoutMs = bounded(options.timeoutMs, 720_000, 1, 720_000);
    this.readRetryAttempts = bounded(options.readRetryAttempts, 1, 0, 2);
    this.settings = options.settings ? restoreFalModelSettings(options.settings) : resolveFalModelSettings(options);
    this.model = this.settings.model;
  }
  isAvailable() {return this.apiKey.length > 0;}
  getSettings(): FalModelSettings {return {...this.settings};}
  getCapabilities(): FalWanCapabilities {
    const model = getFalModel(this.model);
    return {imageToVideo: true, resolutions: model.resolutions, aspectRatios: model.aspectRatios, sourceDuration: model.durationMode === "PROVIDER_DEFINED" ? "PROVIDER_DEFINED" : "CONFIGURED", configurableFrames: model.durationMode === "FRAMES", safetyChecker: true, output: "FILE_URL", queue: true, commercialUse: true};
  }
  estimateCost(input: Pick<FalModelSelection, "resolution" | "durationSeconds"> = {}) {return getFalModelCost(this.settingsFor(input)).reservedCostUsd;}

  async generate(input: FalWanGenerateInput): Promise<FalWanGenerationResult> {
    this.requireAvailable();
    const settings = this.settingsFor(input), cost = getFalModelCost(settings);
    if (!Number.isFinite(input.maxCostUsd) || input.maxCostUsd < cost.reservedCostUsd) throw new FalWanProviderError("BUDGET_EXCEEDED", "Video generation exceeds the approved budget");
    if (!input.image.size || !input.prompt.trim()) throw new FalWanProviderError("INVALID_OUTPUT", "A product image and video prompt are required");
    const context = this.context(settings, null, false);
    return this.runWithContext(context, input.signal, async signal => {
      const imageUrl = await this.abortable(this.client.upload(input.image), signal);
      this.throwIfAborted(signal);
      await this.abortable(Promise.resolve(input.beforeSubmit?.()), signal);
      this.throwIfAborted(signal);
      context.submissionAttempted = true;
      const submitted = await this.abortable(this.client.submit(this.model, buildFalModelInput(settings, {imageUrl, prompt: input.prompt, seed: input.seed}), signal), signal);
      if (!submitted?.request_id) throw new FalWanProviderError("INVALID_OUTPUT", "Video service did not return a request identity");
      context.requestId = submitted.request_id;
      context.acceptedAt = Date.now();
      await this.abortable(Promise.resolve(input.onSubmitted?.(context.requestId)), signal);
      await this.pollInternal(context, signal);
      return this.finish(context, signal);
    });
  }

  async retrieve(requestId: string, options: {signal?: AbortSignal} = {}): Promise<FalWanGenerationResult> {
    this.requireAvailable();
    const context = this.context(this.settings, requestId, true);
    return this.runWithContext(context, options.signal, async signal => {await this.pollInternal(context, signal); return this.finish(context, signal);});
  }
  async poll(requestId: string, options: {signal?: AbortSignal} = {}) {
    this.requireAvailable();
    const context = this.context(this.settings, requestId, true);
    return this.runWithContext(context, options.signal, signal => this.pollInternal(context, signal));
  }
  async cancel(requestId: string): Promise<boolean> {
    if (!this.isAvailable() || !this.client.cancel) return false;
    const signal = AbortSignal.timeout(5_000);
    // true acknowledges receipt only; running requests can still complete.
    try {const result = await this.abortable(this.client.cancel(this.model, requestId, signal), signal); return typeof result === "boolean" ? result : result?.success === true || result?.status === "CANCELLATION_REQUESTED";}
    catch {return false;}
  }

  async downloadResult(url: string, options: {signal?: AbortSignal; costUsd?: number; requestId?: string | null} = {}): Promise<Uint8Array> {
    if (!isFalMediaUrl(url)) throw new FalWanProviderError("INVALID_OUTPUT", "Video service returned an invalid download reference", false, options.costUsd ?? 0, options.requestId ?? null);
    const deadline = AbortSignal.timeout(this.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    try {
      const response = await this.read(async () => {
        const response = await this.fetchImpl(url, {redirect: "error", signal});
        if (!response.ok) {void response.body?.cancel().catch(() => {}); throw new FalHttpError(response.status, null);}
        if (response.redirected || response.url && !isFalMediaUrl(response.url)) throw new FalWanProviderError("DOWNLOAD_FAILED", "The generated video could not be downloaded", false, options.costUsd ?? 0, options.requestId ?? null);
        return response;
      }, signal);
      const declaredSize = Number(response.headers.get("content-length"));
      if (declaredSize > MAX_VIDEO_BYTES) throw new FalWanProviderError("INVALID_OUTPUT", "Video service returned an oversized video", false, options.costUsd ?? 0, options.requestId ?? null);
      if (!response.body) throw new FalWanProviderError("INVALID_OUTPUT", "Video service returned an empty video", false, options.costUsd ?? 0, options.requestId ?? null);
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const chunk = await this.abortable(reader.read(), signal);
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_VIDEO_BYTES) throw new FalWanProviderError("INVALID_OUTPUT", "Video service returned an oversized video", false, options.costUsd ?? 0, options.requestId ?? null);
          chunks.push(chunk.value);
        }
      } finally {void reader.cancel().catch(() => {}); reader.releaseLock();}
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
      if (!bytes.length) throw new FalWanProviderError("INVALID_OUTPUT", "Video service returned an empty video", false, options.costUsd ?? 0, options.requestId ?? null);
      return bytes;
    } catch (error) {
      if (error instanceof FalWanProviderError) throw error;
      throw new FalWanProviderError("DOWNLOAD_FAILED", "The generated video could not be downloaded", false, options.costUsd ?? 0, options.requestId ?? null);
    }
  }
  normalizeResult(result: FalResult, context: {requestId: string; resolution: FalVideoResolution; aspectRatio: FalAspectRatio; estimatedCostUsd: number; settings?: FalModelSettings; reservedCostUsd?: number}): FalWanNormalizedResult {
    const videoUrl = result.data?.video?.url;
    if (!videoUrl || !isFalMediaUrl(videoUrl) || result.requestId && result.requestId !== context.requestId) throw new FalWanProviderError("INVALID_OUTPUT", "Video generation completed without a valid video reference", false, context.reservedCostUsd ?? context.estimatedCostUsd, context.requestId, true);
    const settings = context.settings ?? this.settingsFor(context), duration = result.data?.video?.duration;
    return {requestId: result.requestId ?? context.requestId, videoUrl, provider: this.provider, model: this.model, endpoint: this.model, settings, resolution: context.resolution, aspectRatio: context.aspectRatio, estimatedCostUsd: context.estimatedCostUsd, actualCostUsd: context.reservedCostUsd ?? context.estimatedCostUsd, recordedCostUsd: null, costBasis: "ESTIMATED", retryCount: 0, sourceDurationSeconds: typeof duration === "number" && Number.isFinite(duration) ? duration : null, queueTimeMs: null, generationTimeMs: null, latencyMs: 0};
  }
  getFailureReason(error: unknown): {code: FalWanFailureCode; message: string; retryable: boolean} {
    const status = error instanceof FalHttpError ? error.status : typeof error === "object" && error && "status" in error ? Number(error.status) : null;
    const detail = error instanceof FalHttpError ? error.detail : error instanceof Error ? error.message : error;
    let text = "";
    try {text = typeof detail === "string" ? detail : JSON.stringify(detail ?? "");} catch { /* Error detail is untrusted and is never returned to the caller. */ }
    let code: FalWanFailureCode = error instanceof FalWanProviderError ? error.code : "PROVIDER_FAILED";
    if (!(error instanceof FalWanProviderError)) {
      if (status === 402 || /billing|credit|balance|payment/i.test(text)) code = "BILLING_FAILED";
      else if (status === 429 || /rate.limit|too many requests/i.test(text)) code = "RATE_LIMITED";
      else if (/safety|moderation|nsfw|blocked/i.test(text)) code = "SAFETY_REJECTED";
      else if (/cancelled|canceled|cancellation/i.test(text)) code = "CANCELLED";
      else if (/timeout|timed out/i.test(text)) code = "TIMEOUT";
      else if (status === 401 || status === 403) code = "UNAVAILABLE";
    }
    const messages: Record<FalWanFailureCode, string> = {UNAVAILABLE: "Video generation is unavailable", BUDGET_EXCEEDED: "Video generation exceeds the approved budget", BILLING_FAILED: "Video generation could not start because its balance is insufficient", RATE_LIMITED: "Video generation is busy; try again later", SAFETY_REJECTED: "The image or prompt could not be accepted", TIMEOUT: "Video generation did not finish in time", CANCELLED: "Video generation was cancelled", PROVIDER_FAILED: "Video generation could not be completed", INVALID_OUTPUT: "The generated video requires review", DOWNLOAD_FAILED: "The generated video could not be downloaded"};
    return {code, message: messages[code], retryable: code === "RATE_LIMITED" || status === 500 || status === 502 || status === 503 || status === 504 || error instanceof TypeError};
  }

  private context(settings: FalModelSettings, requestId: string | null, submissionAttempted: boolean): OperationContext {return {settings, requestId, submissionAttempted, reservedCostUsd: getFalModelCost(settings).reservedCostUsd, completed: false, startedAt: Date.now(), acceptedAt: null, runningAt: null, completedAt: null};}
  private requireAvailable() {if (!this.isAvailable()) throw new FalWanProviderError("UNAVAILABLE", "Video generation is unavailable");}
  private settingsFor(input: FalModelSelection): FalModelSettings {
    if (input.resolution === undefined && input.durationSeconds === undefined && input.aspectRatio === undefined) return this.settings;
    const selected = resolveFalModelSettings({model: this.model, resolution: input.resolution ?? this.settings.resolution, aspectRatio: input.aspectRatio ?? this.settings.aspectRatio, durationSeconds: input.durationSeconds ?? 8});
    return input.durationSeconds === undefined ? {...this.settings, resolution: selected.resolution, aspectRatio: selected.aspectRatio} : selected;
  }
  private async pollInternal(context: OperationContext, signal: AbortSignal) {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt++) {
      if (attempt > 0) await this.abortable(this.sleep(this.pollIntervalMs), signal);
      const status = await this.read(() => this.client.status(this.model, context.requestId!, signal), signal), value = status?.status?.toUpperCase();
      if (value === "IN_PROGRESS" && context.runningAt === null) context.runningAt = Date.now();
      if (value === "COMPLETED") {
        context.completed = true; context.completedAt = Date.now();
        // fal also represents terminal failures as COMPLETED with error fields.
        if ((status.error != null && status.error !== "") || status.error_type) {
          const failure = this.getFailureReason({error: status.error, error_type: status.error_type});
          throw new FalWanProviderError(failure.code, failure.message, false, context.reservedCostUsd, context.requestId, true);
        }
        return;
      }
      if (value === "FAILED" || value === "CANCELLED") {
        const failure = value === "CANCELLED" ? {code: "CANCELLED" as const, message: "Video generation was cancelled", retryable: false} : this.getFailureReason(status.error);
        throw new FalWanProviderError(failure.code, failure.message, false, context.reservedCostUsd, context.requestId, true);
      }
      if (value !== "IN_QUEUE" && value !== "IN_PROGRESS") throw new FalWanProviderError("PROVIDER_FAILED", "Video generation returned an unknown status");
    }
    throw new FalWanProviderError("TIMEOUT", "Video generation did not finish in time", false, context.reservedCostUsd, context.requestId);
  }
  private async finish(context: OperationContext, signal: AbortSignal): Promise<FalWanGenerationResult> {
    const result = await this.read(() => this.client.result(this.model, context.requestId!, signal), signal), cost = getFalModelCost(context.settings);
    const normalized = this.normalizeResult(result, {requestId: context.requestId!, resolution: context.settings.resolution, aspectRatio: context.settings.aspectRatio, settings: context.settings, estimatedCostUsd: cost.estimatedCostUsd, reservedCostUsd: cost.reservedCostUsd});
    const bytes = await this.downloadResult(normalized.videoUrl, {signal, costUsd: cost.reservedCostUsd, requestId: context.requestId});
    return {...normalized, bytes, checksum: createHash("sha256").update(bytes).digest("hex"), queueTimeMs: context.runningAt !== null && context.acceptedAt !== null ? context.runningAt - context.acceptedAt : null, generationTimeMs: context.runningAt !== null && context.completedAt !== null ? context.completedAt - context.runningAt : null, latencyMs: Date.now() - context.startedAt};
  }
  private async runWithContext<T>(context: OperationContext, callerSignal: AbortSignal | undefined, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController(), cancel = () => controller.abort(new FalWanProviderError("CANCELLED", "Video generation was cancelled"));
    callerSignal?.addEventListener("abort", cancel, {once: true});
    if (callerSignal?.aborted) cancel();
    const timer = setTimeout(() => controller.abort(new FalWanProviderError("TIMEOUT", "Video generation did not finish in time")), this.timeoutMs);
    try {this.throwIfAborted(controller.signal); return await action(controller.signal);}
    catch (error) {
      const failure = this.getFailureReason(error);
      if ((failure.code === "TIMEOUT" || failure.code === "CANCELLED") && context.requestId && !context.completed && !(error instanceof FalWanProviderError && error.terminalConfirmed)) await this.cancel(context.requestId);
      const explicitRejection = error instanceof FalHttpError && [400, 401, 402, 403, 404, 422, 429].includes(error.status) && !context.requestId;
      const cost = context.submissionAttempted && !explicitRejection ? context.reservedCostUsd : 0;
      const terminalConfirmed = error instanceof FalWanProviderError && error.terminalConfirmed || context.completed && (failure.code === "INVALID_OUTPUT" || failure.code === "DOWNLOAD_FAILED");
      throw new FalWanProviderError(failure.code, failure.message, explicitRejection && failure.retryable, cost, context.requestId, terminalConfirmed);
    } finally {clearTimeout(timer); callerSignal?.removeEventListener("abort", cancel);}
  }
  private async read<T>(action: () => Promise<T>, signal: AbortSignal): Promise<T> {
    for (let retry = 0; ; retry++) {
      this.throwIfAborted(signal);
      try {return await this.abortable(action(), signal);}
      catch (error) {if (signal.aborted || retry >= this.readRetryAttempts || !this.getFailureReason(error).retryable) throw error; await this.abortable(this.sleep(Math.min(1_000 * 2 ** retry, 5_000)), signal);}
    }
  }
  private abortedError(signal: AbortSignal) {return signal.reason instanceof FalWanProviderError ? signal.reason : signal.reason?.name === "TimeoutError" ? new FalWanProviderError("TIMEOUT", "Video generation did not finish in time") : new FalWanProviderError("CANCELLED", "Video generation was cancelled");}
  private throwIfAborted(signal: AbortSignal) {if (signal.aborted) throw this.abortedError(signal);}
  private async abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    this.throwIfAborted(signal);
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(this.abortedError(signal));
      signal.addEventListener("abort", onAbort, {once: true});
      promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
  }
}

export async function generateAcceptedFalWanMaster(input: {provider: FalWanVideoProvider; request: FalWanGenerateInput; inspect: (bytes: Uint8Array) => Promise<RenderedVideo>; qualityInput: (media: RenderedVideo) => VideoQualityInput; evaluate: (input: VideoQualityInput) => VideoQualityResult; store: (result: FalWanGenerationResult, media: RenderedVideo, quality: VideoQualityResult) => Promise<string>}) {
  const result = await input.provider.generate(input.request), media = await input.inspect(result.bytes), quality = input.evaluate(input.qualityInput(media));
  if (quality.status !== "PASS" || quality.score < 85) throw new FalWanProviderError("INVALID_OUTPUT", "The generated video requires review", false, result.actualCostUsd, result.requestId, true);
  const storagePath = await input.store(result, media, quality);
  return {result, media, quality, storagePath, status: "READY" as const};
}
