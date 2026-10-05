import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { assertScriptCompliance, checkFinalMedia, commerceScope, scriptContent } from "../compliance-brain/server-runtime";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/server-env";
import { assertVerifiedPullUrl } from "@/features/publishing/provider";
import { stableAutoKey } from "@/features/auto/engine";
import { AtomicBudgetLedger, PaidGenerationUncertainError, PaidProviderConfirmedFailureError, PaidProviderNotSubmittedError } from "./budget-ledger";
import { FalWanProviderError, FalWanVideoProvider, type FalWanGenerationResult } from "./fal-wan";
import { getFalModel, resolveFalModelSettings, restoreFalModelSettings, type FalModelSettings } from "./fal-models";
import { submitAutoFalWithBudget } from "./auto-fal-boundary";
import { extractVideoFrameEvidence, OpenAIFrameVisionProvider, verifyVideoFrames, type FrameVisionProvider } from "./frame-verification";
import { DeterministicVideoQualityEvaluator } from "./quality";
import { FFmpegVideoRenderer } from "./renderer";
import { composeGeneratedVideo, portraitProductReference, validateNarrationAudio } from "./media-composition";
import { ownsVideoStoragePath, videoStoragePath } from "./storage";
import { VIDEO_BUCKET, type VideoQualityResult, type SceneInstruction } from "./types";

type Row = Record<string, unknown>;
export type FalBoundary = Pick<FalWanVideoProvider, "estimateCost" | "generate" | "retrieve">;
export type FalProviderFactory = (settings: FalModelSettings) => FalBoundary;
export interface AutoFalRequest { ownerId: string; runId: string; accountId: string; projectId: string; operationKey: string; signal?: AbortSignal }
interface FalRequest extends Omit<AutoFalRequest, "runId"> { runId: string | null }
interface FalPolicy { version: 1; models: FalModelSettings[]; qualityThreshold: number; maxAttempts: number; perClipCapUsd: number; perJobCapUsd: number; dailyCapUsd: number; durationSeconds: 8 | 10; resolution: string }
interface AttemptRecord { attempt: number; model: string; state: "PASS" | "QUALITY_FAILED" | "REVIEW" | "FAILED"; requestId?: string; reservedUsd: number; costBasis: "ESTIMATED"; qualityScore?: number }
interface FalJobOutput { attempts?: AttemptRecord[]; reviewRequired?: boolean; masterId?: string; storagePath?: string }
type Source = { project: Row; script: Row; angle: Row; product: Row; account: Row };

export class FalGenerationPendingError extends Error {
  constructor() { super("video_generation_pending"); this.name = "FalGenerationPendingError"; }
}

function required<T>(data: T | null, error: { message: string } | null, code: string): T {
  if (error || data === null) throw new Error(code);
  return data;
}
async function readOne(admin: SupabaseClient, table: string, ownerId: string, id: string) {
  const { data, error } = await admin.from(table).select("*").eq("owner_id", ownerId).eq("id", id).maybeSingle();
  return required(data as Row | null, error, `${table}_missing`);
}
export async function referenceProductImage(admin: SupabaseClient, ownerId: string, product: Row) {
  const asset = await admin.from("media_assets").select("storage_path,mime_type")
    .eq("owner_id", ownerId).eq("product_id", product.id).eq("asset_type", "PRODUCT_IMAGE")
    .in("source_type", ["UPLOAD", "PRODUCT"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (asset.error) throw new Error("product_image_read_failed");
  if (asset.data) {
    if (!ownsVideoStoragePath(ownerId, asset.data.storage_path)) throw new Error("product_image_storage_invalid");
    if (!["image/jpeg", "image/png", "image/webp"].includes(asset.data.mime_type)) throw new Error("product_image_type_invalid");
    const file = await admin.storage.from(VIDEO_BUCKET).download(asset.data.storage_path);
    if (file.error || !file.data) throw new Error("product_image_download_failed");
    if (!file.data.size || file.data.size > 12_000_000) throw new Error("product_image_too_large");
    return new Blob([await file.data.arrayBuffer()], { type: asset.data.mime_type });
  }
  if (!product.image_url || !serverEnv.videoProductImageAllowedHosts.length) throw new Error("product_image_required");
  const url = assertVerifiedPullUrl(String(product.image_url), serverEnv.videoProductImageAllowedHosts);
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok || !response.body) throw new Error("product_image_download_failed");
  const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (!mime || !["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new Error("product_image_type_invalid");
  if (Number(response.headers.get("content-length") ?? 0) > 12_000_000) throw new Error("product_image_too_large");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > 12_000_000) { await reader.cancel(); throw new Error("product_image_too_large"); }
    chunks.push(value);
  }
  if (!total) throw new Error("product_image_size_invalid");
  return new Blob(chunks.map(chunk => new Uint8Array(chunk)), { type: mime });
}
function policy(): FalPolicy {
  const endpoints = [serverEnv.videoFalPrimaryModel, ...(serverEnv.videoFalFallbackModel ? [serverEnv.videoFalFallbackModel] : [])];
  if (endpoints.some(endpoint => !serverEnv.videoFalApprovedModels.includes(endpoint))) throw new Error("fal_model_not_approved");
  const models = [...new Set(endpoints)].map(model => {
    const resolution = [...getFalModel(model).resolutions].sort((a, b) => parseInt(a) - parseInt(b))
      .find(value => parseInt(value) >= parseInt(serverEnv.videoFalResolution));
    if (!resolution) throw new Error("fal_model_resolution_insufficient");
    return resolveFalModelSettings({ model, durationSeconds: serverEnv.videoFalDurationSeconds, resolution, aspectRatio: "9:16" });
  });
  return { version: 1, models, qualityThreshold: serverEnv.videoFalQualityThreshold,
    maxAttempts: Math.min(2, serverEnv.videoFalMaxAttempts, models.length),
    perClipCapUsd: serverEnv.videoFalPerClipCapUsd, perJobCapUsd: serverEnv.videoFalPerJobCapUsd,
    dailyCapUsd: serverEnv.videoFalDailyCapUsd, durationSeconds: serverEnv.videoFalDurationSeconds, resolution: serverEnv.videoFalResolution };
}
function savedPolicy(job: Row): FalPolicy {
  const input = job.input_json as { falPolicy?: FalPolicy } | null;
  if (!input?.falPolicy || input.falPolicy.version !== 1 || !Array.isArray(input.falPolicy.models)) throw new Error("fal_job_policy_missing");
  const saved = input.falPolicy;
  if (![8, 10].includes(saved.durationSeconds) || !["720p", "1080p"].includes(saved.resolution) ||
    !Number.isFinite(saved.qualityThreshold) || saved.qualityThreshold < 85 || saved.qualityThreshold > 100 ||
    !Number.isInteger(saved.maxAttempts) || saved.maxAttempts < 1 || saved.maxAttempts > 2 ||
    saved.models.length < saved.maxAttempts || saved.models.length > 2 ||
    [saved.perClipCapUsd, saved.perJobCapUsd, saved.dailyCapUsd].some(value => !Number.isFinite(value) || value <= 0) ||
    saved.perClipCapUsd > 100 || saved.perJobCapUsd > 100 || saved.dailyCapUsd > 10_000) throw new Error("fal_job_policy_invalid");
  const models = saved.models.map(model => restoreFalModelSettings(model));
  if (new Set(models.map(model => model.model)).size !== models.length ||
    models.some(model => parseInt(model.resolution) < parseInt(saved.resolution) ||
      (model.durationSeconds !== null && model.durationSeconds < saved.durationSeconds))) throw new Error("fal_job_policy_invalid");
  return Object.freeze({ ...saved, models });
}
async function active(admin: SupabaseClient, request: FalRequest, job?: Row) {
  if (request.signal?.aborted) throw new PaidProviderNotSubmittedError("video_generation_cancelled");
  if (!serverEnv.videoFalEnabled) throw new PaidProviderNotSubmittedError("video_generation_disabled");
  if (!serverEnv.falKey || serverEnv.falWanProviderState !== "PRODUCTION_APPROVED") throw new PaidProviderNotSubmittedError("fal_provider_not_approved");
  if (job && savedPolicy(job).models.some(model => !serverEnv.videoFalApprovedModels.includes(model.model))) throw new PaidProviderNotSubmittedError("fal_model_not_approved");
  if (request.runId) {
    const run = await readOne(admin, "auto_runs", request.ownerId, request.runId);
    if (run.state !== "RUNNING") throw new PaidProviderNotSubmittedError("auto_run_not_active");
  }
  if (job && (await readOne(admin, "generation_jobs", request.ownerId, String(job.id))).status === "CANCELLED") {
    throw new PaidProviderNotSubmittedError("video_generation_cancelled");
  }
}
async function existingMaster(admin: SupabaseClient, request: Pick<FalRequest, "ownerId" | "projectId">) {
  const result = await admin.from("master_videos").select("*").eq("owner_id", request.ownerId).eq("creative_project_id", request.projectId).maybeSingle();
  if (result.error) throw new Error("auto_fal_master_read_failed");
  return result.data as Row | null;
}
function verifiedJob(job: Row, projectId: string, masterId?: unknown): Row {
  if (job.provider !== "fal" || job.job_type !== "MASTER_RENDER" || job.creative_project_id !== projectId ||
    (masterId !== undefined && job.master_video_id !== masterId)) throw new Error("auto_fal_job_identity_invalid");
  return job;
}
async function ensureJob(admin: SupabaseClient, request: FalRequest, source: Source) {
  // One creative script owns one generation job across reloads, manual actions and AUTO runs.
  const key = stableAutoKey(request.projectId, String(source.script.id), "FAL_MASTER");
  const read = () => admin.from("generation_jobs").select("*").eq("owner_id", request.ownerId).eq("idempotency_key", key).maybeSingle();
  const prior = await read();
  if (prior.error) throw new Error("auto_fal_job_read_failed");
  if (prior.data) return verifiedJob(prior.data as Row, request.projectId);
  const settings = policy();
  const created = await admin.from("generation_jobs").insert({ owner_id: request.ownerId,
    creative_project_id: request.projectId, idempotency_key: key, job_type: "MASTER_RENDER",
    provider: "fal", model: settings.models[0].model, input_json: { autoRunId: request.runId,
      operationKey: request.operationKey, falPolicy: settings }, status: "QUEUED", attempt: 0, max_attempts: settings.maxAttempts }).select("*").single();
  if (created.error?.code === "23505") {
    const winner = await read();
    return verifiedJob(required(winner.data as Row | null, winner.error, "auto_fal_job_read_failed"), request.projectId);
  }
  return verifiedJob(required(created.data as Row | null, created.error, "auto_fal_job_create_failed"), request.projectId);
}
async function saveJob(admin: SupabaseClient, request: FalRequest, job: Row, output: FalJobOutput, patch: Row = {}) {
  const updated = await admin.from("generation_jobs").update({ ...patch, output_json: output }).eq("owner_id", request.ownerId).eq("id", job.id)
    .eq("attempt", job.attempt).neq("status", "CANCELLED").select("id").maybeSingle();
  if (updated.error) throw new Error("auto_fal_job_write_failed");
  if (!updated.data) throw new FalGenerationPendingError();
  job.output_json = output; Object.assign(job, patch);
}
async function masterPayload(admin: SupabaseClient, request: FalRequest, job: Row, source: Source, settings: FalPolicy, patch: Row = {}) {
  const prior = await existingMaster(admin, request);
  return { id: prior?.id ?? randomUUID(), owner_id: request.ownerId, tiktok_account_id: request.accountId,
    product_id: source.product.id, creative_project_id: request.projectId, selected_script_id: source.script.id,
    generation_job_id: job.id, provider: "fal", model: settings.models[0].model, render_strategy: "AI_IMAGE_TO_VIDEO",
    duration_seconds: settings.durationSeconds, width: 720, height: 1280, fps: 30,
    quality_explanation_json: {}, estimated_cost_usd: 0, status: "PROCESSING", ...prior, ...patch };
}
async function saveMaster(admin: SupabaseClient, request: FalRequest, job: Row, source: Source, settings: FalPolicy, patch: Row = {}) {
  return persistAtomically(admin, request, job, source, settings, patch, job.output_json as FalJobOutput ?? {}, false);
}
async function persistAtomically(admin: SupabaseClient, request: FalRequest, job: Row, source: Source, settings: FalPolicy, patch: Row, output: FalJobOutput, complete: boolean) {
  const payload = await masterPayload(admin, request, job, source, settings, patch);
  const { data, error } = await admin.rpc("persist_fal_master", { p_owner_id: request.ownerId, p_job_id: job.id,
    p_expected_attempt: Number(job.attempt), p_master_payload: payload, p_job_output: output, p_complete: complete });
  if (error || !data?.master) throw new Error("auto_fal_master_persist_failed");
  if (!data.accepted && data.master.quality_status !== "PASS") throw new FalGenerationPendingError();
  return data.master as Row;
}
async function reviewMaster(admin: SupabaseClient, request: FalRequest, job: Row, source: Source, settings: FalPolicy, reason: string) {
  const prior = await existingMaster(admin, request);
  const explanation = { ...(prior?.quality_explanation_json as Row ?? {}), reviewRequired: true, reviewReason: reason, qualityThreshold: settings.qualityThreshold };
  return persistAtomically(admin, request, job, source, settings, { status: "READY", quality_status: "RETRY", quality_explanation_json: explanation },
    { ...(job.output_json as FalJobOutput ?? {}), reviewRequired: true }, true);
}
function scenesFor(source: Source, duration: number): SceneInstruction[] {
  const scenes = source.script.scene_plan_json as SceneInstruction[];
  const end = scenes.at(-1)?.end || 8;
  return scenes.map(scene => ({ ...scene, start: scene.start / end * duration, end: scene.end / end * duration }));
}
async function prepareMedia(source: Source, image: Blob, voice: Blob, result: FalWanGenerationResult, settings: FalPolicy, vision: FrameVisionProvider) {
  const dir = join(tmpdir(), "viralflow-auto-fal", randomUUID()); await mkdir(dir, { recursive: true });
  try {
    const sourcePath = join(dir, "source.mp4"), outputPath = join(dir, "master.mp4"), referencePath = join(dir, "reference-image"), voicePath = join(dir, "voice");
    await Promise.all([writeFile(sourcePath, result.bytes), writeFile(referencePath, new Uint8Array(await image.arrayBuffer())),
      writeFile(voicePath, new Uint8Array(await voice.arrayBuffer()))]);
    const overlay = [{ text: String(source.script.hook_text ?? ""), start: 0, end: Math.min(3, settings.durationSeconds) },
      { text: String(source.script.cta_text ?? ""), start: Math.max(0, settings.durationSeconds - 3), end: settings.durationSeconds }];
    const composed = await composeGeneratedVideo(sourcePath, outputPath, { durationSeconds: settings.durationSeconds, resolution: settings.resolution, overlay, voicePath });
    const frameEvidence = await extractVideoFrameEvidence(outputPath, referencePath, composed.media.duration);
    const visualVerification = await verifyVideoFrames({ ...frameEvidence, productTitle: String(source.product.title),
      expectedText: [String(source.script.cta_text ?? "")] }, vision);
    const quality = new DeterministicVideoQualityEvaluator().evaluate({ ...composed.media, scenes: scenesFor(source, settings.durationSeconds),
      overlay, visualVerification, productVisible: visualVerification.productVisible, ctaVisible: visualVerification.ctaVisible,
      malformedAssets: false, inheritedRisk: source.angle.policy_status as "SAFE" | "REVIEW" | "REJECT",
      targetDurationSeconds: settings.durationSeconds, qualityThreshold: settings.qualityThreshold });
    return { ...composed, bytes: new Uint8Array(await readFile(outputPath)), quality };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
async function persistMedia(admin: SupabaseClient, request: FalRequest, job: Row, source: Source, settings: FalPolicy, result: FalWanGenerationResult,
  prepared: Awaited<ReturnType<typeof prepareMedia>>, attempt: number, output: FalJobOutput, complete: boolean) {
  await active(admin, request, job);
  const sourcePath = videoStoragePath(request.ownerId, "masters", String(job.id), `source-${attempt}.mp4`);
  const storagePath = videoStoragePath(request.ownerId, "masters", String(job.id), `master-${attempt}.mp4`);
  for (const [path, bytes] of [[sourcePath, result.bytes], [storagePath, prepared.bytes]] as const) {
    const uploaded = await admin.storage.from(VIDEO_BUCKET).upload(path, bytes, { contentType: "video/mp4", upsert: true });
    if (uploaded.error) throw new Error("auto_fal_video_upload_failed");
  }
  const assets = [{ path: sourcePath, bytes: result.bytes, media: prepared.source, sourceType: "GENERATED" },
    { path: storagePath, bytes: prepared.bytes, media: prepared.media, sourceType: "RENDERED" }].map(asset => ({
      owner_id: request.ownerId, product_id: source.product.id, creative_project_id: request.projectId, asset_type: "VIDEO",
      source_type: asset.sourceType, storage_path: asset.path, mime_type: "video/mp4", width: asset.media.width, height: asset.media.height,
      duration_seconds: asset.media.duration, provider: "fal", model: result.model, checksum: createHash("sha256").update(asset.bytes).digest("hex"),
    }));
  const stored = await admin.from("media_assets").upsert(assets, { onConflict: "owner_id,storage_path" });
  if (stored.error) throw new Error("auto_fal_assets_write_failed");
  // The merged pipeline retains the shared gate on the actual normalized asset.
  await checkFinalMedia(admin,commerceScope(request.ownerId,String(source.product.id),request.accountId,String(source.product.category_key)),storagePath,scriptContent(source.script),"POST_GENERATION");
  return persistAtomically(admin, request, job, source, settings, { storage_path: storagePath, model: result.model,
    duration_seconds: prepared.media.duration, width: prepared.media.width, height: prepared.media.height, fps: prepared.media.fps,
    quality_score: prepared.quality.score, quality_status: prepared.quality.status, quality_explanation_json: {
      ...prepared.quality.explanation, qualityThreshold: settings.qualityThreshold }, estimated_cost_usd: result.estimatedCostUsd, status: "READY" }, output, complete);
}
function isQualityReview(quality: VideoQualityResult) {
  return quality.explanation.visualVerificationStatus === "REVIEW";
}
async function generateFalMaster(admin: SupabaseClient, request: FalRequest, boundary?: FalBoundary | FalProviderFactory, visionProvider?: FrameVisionProvider) {
  if (!serverEnv.falKey || serverEnv.falWanProviderState !== "PRODUCTION_APPROVED") throw new Error("fal_provider_not_approved");
  const project = await readOne(admin, "creative_projects", request.ownerId, request.projectId);
  if (project.tiktok_account_id !== request.accountId || !project.selected_script_id || !project.selected_angle_id) throw new Error("auto_fal_source_not_ready");
  const [script, angle, product, account] = await Promise.all([
    readOne(admin, "scripts", request.ownerId, String(project.selected_script_id)),
    readOne(admin, "creative_angles", request.ownerId, String(project.selected_angle_id)),
    readOne(admin, "products", request.ownerId, String(project.product_id)), readOne(admin, "tiktok_accounts", request.ownerId, request.accountId),
  ]);
  const source = { project, script, angle, product, account };
  if (angle.policy_status !== "SAFE" || script.status === "REJECTED" || account.is_mock) throw new Error("auto_fal_creative_not_safe");
  await assertScriptCompliance(admin,commerceScope(request.ownerId,String(product.id),request.accountId,String(product.category_key)),script);
  const prior = await existingMaster(admin, request);
  if (["READY", "APPROVED"].includes(String(prior?.status)) && prior?.quality_status === "PASS") return prior;
  const job = await ensureJob(admin, request, source), settings = savedPolicy(job);
  let output = job.output_json as FalJobOutput | null;
  if (output?.reviewRequired) {
    if (request.runId === null && Number(job.attempt) === 0) {
      output = { ...output, reviewRequired: false };
      await saveJob(admin, request, job, output, { status: "QUEUED" });
    } else return prior ?? reviewMaster(admin, request, job, source, settings, "REVIEW_REQUIRED");
  }
  if (job.status === "CANCELLED") throw new PaidProviderNotSubmittedError("video_generation_cancelled");
  if (job.status === "PROCESSING" && Date.parse(String(job.started_at)) > Date.now() - 20 * 60_000 &&
    !(output?.attempts ?? []).some(row => row.attempt === Number(job.attempt))) throw new FalGenerationPendingError();
  // Approval is checked again on every resume; an old job snapshot never bypasses the current kill switch or allowlist.
  await active(admin, request, job);
  if (settings.models.some(model => !serverEnv.videoFalApprovedModels.includes(model.model))) throw new Error("fal_model_not_approved");
  const vision = visionProvider ?? (serverEnv.openAIApiKey ? new OpenAIFrameVisionProvider(serverEnv.openAIApiKey) : null);
  if (!vision) return reviewMaster(admin, request, job, source, settings, "VISION_PROVIDER_UNAVAILABLE");
  const voice = await admin.from("media_assets").select("storage_path").eq("owner_id", request.ownerId)
    .eq("creative_project_id", request.projectId).eq("asset_type", "VOICE").in("source_type", ["UPLOAD", "GENERATED"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (voice.error) throw new Error("video_voice_read_failed");
  if (!voice.data) return reviewMaster(admin, request, job, source, settings, "VOICE_ASSET_REQUIRED");
  if (!ownsVideoStoragePath(request.ownerId, voice.data.storage_path)) return reviewMaster(admin, request, job, source, settings, "VOICE_ASSET_UNAVAILABLE");
  const narration = await admin.storage.from(VIDEO_BUCKET).download(voice.data.storage_path);
  if (narration.error || !narration.data) return reviewMaster(admin, request, job, source, settings, "VOICE_ASSET_UNAVAILABLE");
  try { await validateNarrationAudio(narration.data); }
  catch { return reviewMaster(admin, request, job, source, settings, "VOICE_ASSET_UNAVAILABLE"); }
  const image = await referenceProductImage(admin, request.ownerId, product), portraitImage = await portraitProductReference(image), ledger = new AtomicBudgetLedger(admin);
  const run = request.runId ? await readOne(admin, "auto_runs", request.ownerId, request.runId) : null;
  const cap = Math.min(Number(account.max_cost_per_video_usd), settings.perClipCapUsd, settings.perJobCapUsd);
  const daily = Math.min(Number(account.daily_video_budget_usd), settings.dailyCapUsd);
  const monthly = Number(account.monthly_video_budget_usd), runCap = run ? Number(run.budget_usd) : settings.perJobCapUsd;
  if ([cap, daily, monthly, runCap].some(value => !Number.isFinite(value) || value <= 0)) throw new Error("auto_fal_budget_exceeded");
  const attempts = [...(output?.attempts ?? [])];
  const factory: FalProviderFactory = typeof boundary === "function" ? boundary : model => boundary ?? new FalWanVideoProvider({ apiKey: serverEnv.falKey, settings: model });
  for (let index = 0; index < Math.min(settings.maxAttempts, 2); index++) {
    const model = settings.models[index], attempt = index + 1;
    if (attempts.some(row => row.attempt === attempt && ["FAILED", "QUALITY_FAILED"].includes(row.state))) continue;
    await active(admin, request, job);
    const provider = factory(model), reservedUsd = provider.estimateCost();
    if (reservedUsd > cap) return reviewMaster(admin, request, job, source, settings, "BUDGET_EXCEEDED");
    const day = new Date().toISOString().slice(0, 10);
    const reservation = { ownerId: request.ownerId, accountId: request.accountId, generationJobId: String(job.id), autoRunId: request.runId,
      runKey: run ? String(run.idempotency_key) : `manual:${job.id}`, logicalOperationKey: stableAutoKey(String(job.id), index === 0 ? "PRIMARY" : "FALLBACK"),
      provider: "fal", model: model.model, reservedUsd, perVideoCapUsd: cap, dailyCapUsd: daily, monthlyCapUsd: monthly,
      runCapUsd: runCap, accountCapUsd: Number(account.daily_video_budget_usd), providerCapUsd: daily,
      budgetDay: day, budgetMonth: `${day.slice(0, 7)}-01` };
    let generated: FalWanGenerationResult, holdId: string | null = null;
    try {
      const paid = await submitAutoFalWithBudget({ ledger, reservation, provider, image: portraitImage,
        prompt: `Create a natural vertical product showcase using exactly the product in this reference image. Preserve its shape, colors, label, logo, packaging and details. Product metadata: ${String(product.title).slice(0, 120)}. Creative direction: ${String(script.hook_text).slice(0, 200)}. Smooth realistic motion, stable identity, clear product throughout, clean background. No additional products, brands, false claims, generated lettering or audio; captions and voice are added separately.`,
        settings: { resolution: model.resolution, aspectRatio: "9:16" }, signal: request.signal,
        recheckBeforeSubmit: async () => {
          await assertScriptCompliance(admin,commerceScope(request.ownerId,String(product.id),request.accountId,String(product.category_key)),script);
          await active(admin, request, job);
        },
        beforeSubmit: async () => {
          await active(admin, request, job);
          const started = await admin.from("generation_jobs").update({ status: "PROCESSING", attempt, started_at: new Date().toISOString() })
            .eq("owner_id", request.ownerId).eq("id", job.id).lte("attempt", attempt).neq("status", "CANCELLED").select("*").maybeSingle();
          if (started.error || !started.data) throw new PaidProviderNotSubmittedError("auto_fal_job_start_failed");
          Object.assign(job, started.data);
          try { await saveMaster(admin, request, job, source, settings); }
          catch { throw new PaidProviderNotSubmittedError("auto_fal_job_start_failed"); }
        } });
      holdId = paid.reservation.id;
      if (paid.value) generated = paid.value;
      else if (paid.reservation.provider_request_id) generated = await provider.retrieve(paid.reservation.provider_request_id);
      else throw new PaidGenerationUncertainError(holdId, null, new Error("settled_result_missing"));
    } catch (error) {
      const terminal = error instanceof PaidProviderConfirmedFailureError ? error :
        error instanceof FalWanProviderError && error.terminalConfirmed && error.requestId
          ? new PaidProviderConfirmedFailureError(error.code, error.requestId, error.actualCostUsd, error) : null;
      if (terminal) {
        attempts.push({ attempt, model: model.model, state: "FAILED", requestId: terminal.requestId, reservedUsd, costBasis: "ESTIMATED" });
        await saveJob(admin, request, job, { attempts });
        continue;
      }
      if (error instanceof Error && /budget_exceeded/.test(error.message)) return reviewMaster(admin, request, job, source, settings, "BUDGET_EXCEEDED");
      throw error;
    }
    await active(admin, request, job);
    let prepared: Awaited<ReturnType<typeof prepareMedia>>;
    try { prepared = await prepareMedia(source, image, narration.data, generated, settings, vision); }
    catch (error) {
      if (error instanceof Error && error.message === "generated_source_too_short") {
        attempts.push({ attempt, model: model.model, state: "QUALITY_FAILED", requestId: generated.requestId, reservedUsd, costBasis: "ESTIMATED" });
        await saveJob(admin, request, job, { attempts }); continue;
      }
      throw new PaidGenerationUncertainError(holdId!, generated.requestId, error);
    }
    try {
      const review = isQualityReview(prepared.quality), pass = prepared.quality.status === "PASS" && prepared.quality.score >= settings.qualityThreshold;
      attempts.push({ attempt, model: model.model, state: pass ? "PASS" : review ? "REVIEW" : "QUALITY_FAILED", requestId: generated.requestId,
        reservedUsd, costBasis: "ESTIMATED", qualityScore: prepared.quality.score });
      const master = await persistMedia(admin, request, job, source, settings, generated, prepared, attempt, { attempts }, pass);
      job.output_json = { attempts };
      if (pass || master.quality_status === "PASS") return master;
      if (review) return reviewMaster(admin, request, job, source, settings, "VISUAL_VERIFICATION_PENDING");
    } catch (error) { if (error instanceof FalGenerationPendingError) throw error; throw new PaidGenerationUncertainError(holdId!, generated.requestId, error); }
  }
  return reviewMaster(admin, request, job, source, settings, "ATTEMPTS_EXHAUSTED");
}

export async function generateAutoFalMaster(admin: SupabaseClient, request: AutoFalRequest, provider?: FalBoundary | FalProviderFactory, visionProvider?: FrameVisionProvider) {
  return generateFalMaster(admin, request, provider, visionProvider);
}
export async function generateVideoFactoryFalMaster(admin: SupabaseClient, ownerId: string, projectId: string, provider?: FalBoundary | FalProviderFactory, visionProvider?: FrameVisionProvider) {
  const project = await readOne(admin, "creative_projects", ownerId, projectId);
  return generateFalMaster(admin, { ownerId, runId: null, projectId, accountId: String(project.tiktok_account_id),
    operationKey: stableAutoKey(projectId, String(project.selected_script_id), "MANUAL_VIDEO") }, provider, visionProvider);
}
export async function cancelVideoFactoryGeneration(admin: SupabaseClient, ownerId: string, videoId: string,
  factory: (settings: FalModelSettings) => Pick<FalWanVideoProvider, "cancel"> = settings => new FalWanVideoProvider({ apiKey: serverEnv.falKey, settings })) {
  const master = await readOne(admin, "master_videos", ownerId, videoId);
  if (master.provider !== "fal" || !master.generation_job_id || master.quality_status === "PASS") return;
  const changed = await admin.from("generation_jobs").update({ status: "CANCELLED", completed_at: new Date().toISOString() })
    .eq("owner_id", ownerId).eq("id", master.generation_job_id).in("status", ["QUEUED", "PROCESSING", "RETRYING"]).select("*").maybeSingle();
  if (changed.error) throw new Error("video_cancellation_failed");
  if (!changed.data) return;
  const updated = await admin.from("master_videos").update({ status: "FAILED", quality_status: "RETRY",
    quality_explanation_json: { ...(master.quality_explanation_json as Row), cancelled: true, reviewRequired: false } })
    .eq("owner_id", ownerId).eq("id", videoId);
  if (updated.error) throw new Error("video_cancellation_failed");
  const holds = await admin.from("generation_budget_reservations").select("model,provider_request_id")
    .eq("owner_id", ownerId).eq("generation_job_id", master.generation_job_id).eq("state", "RESERVED");
  if (holds.error) throw new Error("video_cancellation_failed");
  const saved = savedPolicy(changed.data);
  for (const hold of holds.data ?? []) {
    const settings = saved.models.find(model => model.model === hold.model);
    if (settings && hold.provider_request_id) await factory(settings).cancel(hold.provider_request_id);
  }
  // A cancellation acknowledgement is not a billing confirmation. Keep paid holds for read-only reconciliation.
}
export async function reverifyAutoFalMaster(admin: SupabaseClient, request: { ownerId: string; accountId: string; projectId: string; videoId: string }, visionProvider?: FrameVisionProvider) {
  const master = await readOne(admin, "master_videos", request.ownerId, request.videoId), project = await readOne(admin, "creative_projects", request.ownerId, request.projectId);
  if (master.provider !== "fal" || master.creative_project_id !== request.projectId || master.tiktok_account_id !== request.accountId ||
    project.tiktok_account_id !== request.accountId || !master.storage_path || !master.generation_job_id) throw new Error("auto_fal_reverify_source_invalid");
  if (!ownsVideoStoragePath(request.ownerId, String(master.storage_path))) throw new Error("auto_fal_reverify_source_invalid");
  if ((master.quality_explanation_json as Row | null)?.cancelled) return master;
  if (master.quality_status === "PASS") return master;
  const vision = visionProvider ?? (serverEnv.openAIApiKey ? new OpenAIFrameVisionProvider(serverEnv.openAIApiKey) : null);
  if (!vision) return master;
  const job = verifiedJob(await readOne(admin, "generation_jobs", request.ownerId, String(master.generation_job_id)), request.projectId, master.id), settings = savedPolicy(job);
  if (job.status === "CANCELLED") return master;
  const [product, script] = await Promise.all([readOne(admin, "products", request.ownerId, String(master.product_id)),
    readOne(admin, "scripts", request.ownerId, String(master.selected_script_id))]);
  const angle = await readOne(admin, "creative_angles", request.ownerId, String(script.creative_angle_id));
  const stored = await admin.storage.from(VIDEO_BUCKET).download(String(master.storage_path));
  if (stored.error || !stored.data || stored.data.size > 100_000_000) throw new Error("auto_fal_reverify_video_unavailable");
  const reference = await referenceProductImage(admin, request.ownerId, product), dir = join(tmpdir(), "viralflow-auto-fal", randomUUID());
  await mkdir(dir, { recursive: true });
  try {
    const path = join(dir, "master.mp4"), referencePath = join(dir, "reference");
    await Promise.all([writeFile(path, new Uint8Array(await stored.data.arrayBuffer())), writeFile(referencePath, new Uint8Array(await reference.arrayBuffer()))]);
    const media = await new FFmpegVideoRenderer().probe(path), evidence = await extractVideoFrameEvidence(path, referencePath, media.duration);
    const visualVerification = await verifyVideoFrames({ ...evidence, productTitle: String(product.title), expectedText: [String(script.cta_text ?? "")] }, vision);
    const source = { product, script, angle, project, account: {} };
    const quality = new DeterministicVideoQualityEvaluator().evaluate({ ...media, scenes: scenesFor(source, media.duration), overlay: [],
      visualVerification, productVisible: visualVerification.productVisible, ctaVisible: visualVerification.ctaVisible, malformedAssets: false,
      inheritedRisk: angle.policy_status as "SAFE" | "REVIEW" | "REJECT", targetDurationSeconds: settings.durationSeconds,
      qualityThreshold: settings.qualityThreshold });
    return persistAtomically(admin, { ...request, runId: null, operationKey: "REVERIFY" }, job, source, settings,
      { quality_score: quality.score, quality_status: quality.status,
        quality_explanation_json: { ...quality.explanation, qualityThreshold: settings.qualityThreshold, reviewRequired: quality.status !== "PASS" }, status: "READY" },
      { ...(job.output_json as FalJobOutput ?? {}), reviewRequired: quality.status !== "PASS" }, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
