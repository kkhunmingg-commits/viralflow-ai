import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/server-env";
import { assertVerifiedPullUrl } from "@/features/publishing/provider";
import { stableAutoKey } from "@/features/auto/engine";
import { AtomicBudgetLedger, PaidGenerationUncertainError, PaidProviderNotSubmittedError } from "./budget-ledger";
import { FalWanVideoProvider, FAL_WAN_ENDPOINT, type FalWanGenerationResult } from "./fal-wan";
import { submitAutoFalWithBudget } from "./auto-fal-boundary";
import { normalizeProviderBenchmarkClip } from "@/features/video-benchmark/provider-normalization";
import { extractVideoFrameEvidence, OpenAIFrameVisionProvider, verifyVideoFrames, type FrameVisionProvider } from "./frame-verification";
import { DeterministicVideoQualityEvaluator } from "./quality";
import { FFmpegVideoRenderer } from "./renderer";
import { videoStoragePath } from "./storage";
import { VIDEO_BUCKET } from "./types";

type Row = Record<string, unknown>;
type FalBoundary = Pick<FalWanVideoProvider, "estimateCost" | "generate" | "retrieve">;
export interface AutoFalRequest { ownerId: string; runId: string; accountId: string; projectId: string; operationKey: string }

function required<T>(data: T | null, error: { message: string } | null, code: string): T {
  if (error || data === null) throw new Error(error?.message ?? code);
  return data;
}

async function readOne(admin: SupabaseClient, table: string, ownerId: string, id: string) {
  const { data, error } = await admin.from(table).select("*").eq("owner_id", ownerId).eq("id", id).maybeSingle();
  return required(data as Row | null, error, `${table}_missing`);
}

async function productImage(admin: SupabaseClient, ownerId: string, product: Row) {
  const asset = await admin.from("media_assets").select("storage_path,mime_type")
    .eq("owner_id", ownerId).eq("product_id", product.id).eq("asset_type", "PRODUCT_IMAGE")
    .in("source_type", ["UPLOAD", "PRODUCT"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (asset.error) throw new Error("product_image_read_failed");
  if (asset.data) {
    const file = await admin.storage.from(VIDEO_BUCKET).download(asset.data.storage_path);
    if (file.error || !file.data) throw new Error("product_image_download_failed");
    if (file.data.size > 12_000_000) throw new Error("product_image_too_large");
    return new Blob([await file.data.arrayBuffer()], { type: asset.data.mime_type });
  }
  if (!product.image_url || !serverEnv.videoProductImageAllowedHosts.length) throw new Error("product_image_required");
  const url = assertVerifiedPullUrl(String(product.image_url), serverEnv.videoProductImageAllowedHosts);
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("product_image_download_failed");
  const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (!mime || !["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new Error("product_image_type_invalid");
  if (Number(response.headers.get("content-length") ?? 0) > 12_000_000) throw new Error("product_image_too_large");
  if (!response.body) throw new Error("product_image_download_failed");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 12_000_000) { await reader.cancel(); throw new Error("product_image_too_large"); }
    chunks.push(value);
  }
  if (!total) throw new Error("product_image_size_invalid");
  return new Blob(chunks.map(chunk => new Uint8Array(chunk)), { type: mime });
}

async function normalizeSource(bytes: Uint8Array, referenceImage: Blob) {
  const dir = join(tmpdir(), "viralflow-auto-fal", randomUUID());
  await mkdir(dir, { recursive: true });
  try {
    const sourcePath = join(dir, "source.mp4"), outputPath = join(dir, "master.mp4"), referencePath = join(dir, "reference-image");
    await Promise.all([writeFile(sourcePath, bytes), writeFile(referencePath, new Uint8Array(await referenceImage.arrayBuffer()))]);
    const normalized = await normalizeProviderBenchmarkClip(sourcePath, outputPath, { preserveAudio: true });
    if (!normalized.normalized || normalized.reason) throw new Error("fal_source_cannot_normalize_to_eight_seconds");
    const frameEvidence = await extractVideoFrameEvidence(outputPath, referencePath, normalized.normalized.duration);
    return { source: normalized.source, media: normalized.normalized, bytes: new Uint8Array(await readFile(outputPath)), frameEvidence };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function prompt(source: { product: Row; script: Row }) {
  return `Create one natural vertical 9:16 product video for TikTok commerce. Preserve the exact product shape, color, label, packaging, proportions and visible details from the reference image. Product: ${String(source.product.title).slice(0, 120)}. Creative intent: ${String(source.script.hook_text).slice(0, 200)}. Show this exact call to action legibly near the end: ${String(source.script.cta_text ?? "").slice(0, 140)}. Keep the product clearly visible throughout. Smooth realistic motion, clean background, no fabricated claims, no extra brands, no altered text or packaging. Do not add a different product.`;
}

export async function reverifyAutoFalMaster(admin: SupabaseClient,
  request: { ownerId: string; accountId: string; projectId: string; videoId: string }, visionProvider?: FrameVisionProvider) {
  const [master, project] = await Promise.all([
    readOne(admin, "master_videos", request.ownerId, request.videoId),
    readOne(admin, "creative_projects", request.ownerId, request.projectId),
  ]);
  if (master.provider !== "fal" || master.creative_project_id !== request.projectId ||
    master.tiktok_account_id !== request.accountId || project.tiktok_account_id !== request.accountId ||
    !master.storage_path || !project.selected_angle_id || !project.selected_script_id) throw new Error("auto_fal_reverify_source_invalid");
  if (master.quality_status === "PASS") return master;
  const [product, script, angle] = await Promise.all([
    readOne(admin, "products", request.ownerId, String(master.product_id)),
    readOne(admin, "scripts", request.ownerId, String(project.selected_script_id)),
    readOne(admin, "creative_angles", request.ownerId, String(project.selected_angle_id)),
  ]);
  const downloaded = await admin.storage.from(VIDEO_BUCKET).download(String(master.storage_path));
  if (downloaded.error || !downloaded.data || downloaded.data.size > 100_000_000) throw new Error("auto_fal_reverify_video_unavailable");
  const reference = await productImage(admin, request.ownerId, product);
  const dir = join(tmpdir(), "viralflow-auto-fal", randomUUID());
  await mkdir(dir, { recursive: true });
  try {
    const videoPath = join(dir, "stored-master.mp4"), referencePath = join(dir, "reference-image");
    await Promise.all([writeFile(videoPath, new Uint8Array(await downloaded.data.arrayBuffer())),
      writeFile(referencePath, new Uint8Array(await reference.arrayBuffer()))]);
    const media = await new FFmpegVideoRenderer().probe(videoPath);
    const frameEvidence = await extractVideoFrameEvidence(videoPath, referencePath, media.duration);
    const visualVerification = await verifyVideoFrames({ ...frameEvidence,
      productTitle: String(product.title), expectedText: [String(script.cta_text ?? "")] },
      visionProvider ?? (serverEnv.openAIApiKey ? new OpenAIFrameVisionProvider(serverEnv.openAIApiKey) : null));
    const quality = new DeterministicVideoQualityEvaluator().evaluate({ ...media,
      scenes: script.scene_plan_json as never, overlay: [], visualVerification,
      productVisible: visualVerification.productVisible, ctaVisible: visualVerification.ctaVisible,
      malformedAssets: false, inheritedRisk: angle.policy_status as "SAFE" | "REVIEW" | "REJECT" });
    const updated = await admin.from("master_videos").update({ quality_score: quality.score, quality_status: quality.status,
      quality_explanation_json: quality.explanation, status: quality.status === "REJECT" ? "FAILED" : "READY" })
      .eq("owner_id", request.ownerId).eq("id", request.videoId).select("*").single();
    if (updated.error || !updated.data) throw new Error("auto_fal_reverify_update_failed");
    return updated.data;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function existingMaster(admin: SupabaseClient, request: AutoFalRequest) {
  const result = await admin.from("master_videos").select("*").eq("owner_id", request.ownerId)
    .eq("creative_project_id", request.projectId).maybeSingle();
  if (result.error) throw new Error("auto_fal_master_read_failed");
  return result.data;
}

async function ensureJob(admin: SupabaseClient, request: AutoFalRequest) {
  const key = stableAutoKey(request.operationKey, "FAL_MASTER");
  const prior = await admin.from("generation_jobs").select("*").eq("owner_id", request.ownerId)
    .eq("idempotency_key", key).maybeSingle();
  if (prior.error) throw new Error("auto_fal_job_read_failed");
  if (prior.data) return prior.data;
  const created = await admin.from("generation_jobs").insert({ owner_id: request.ownerId,
    creative_project_id: request.projectId, idempotency_key: key, job_type: "MASTER_RENDER",
    provider: "fal", model: FAL_WAN_ENDPOINT, input_json: { autoRunId: request.runId, operationKey: request.operationKey },
    status: "QUEUED", attempt: 0, max_attempts: 1 }).select("*").single();
  if (created.error || !created.data) throw new Error("auto_fal_job_create_failed");
  return created.data;
}

async function persistMaster(admin: SupabaseClient, request: AutoFalRequest, jobId: string,
  source: { project: Row; script: Row; angle: Row; product: Row }, result: FalWanGenerationResult,
  referenceImage: Blob, visionProvider?: FrameVisionProvider) {
  const sourcePath = videoStoragePath(request.ownerId, "masters", jobId, "fal-source.mp4");
  const videoPath = videoStoragePath(request.ownerId, "masters", jobId, "master.mp4");
  const sourceUpload = await admin.storage.from(VIDEO_BUCKET).upload(sourcePath, result.bytes, { contentType: "video/mp4", upsert: true });
  if (sourceUpload.error) throw new Error("auto_fal_source_upload_failed");
  const normalized = await normalizeSource(result.bytes, referenceImage);
  const visualVerification = await verifyVideoFrames({ ...normalized.frameEvidence,
    productTitle: String(source.product.title), expectedText: [String(source.script.cta_text ?? "")] },
    visionProvider ?? (serverEnv.openAIApiKey ? new OpenAIFrameVisionProvider(serverEnv.openAIApiKey) : null));
  const quality = new DeterministicVideoQualityEvaluator().evaluate({ ...normalized.media,
    scenes: source.script.scene_plan_json as never, overlay: [], visualVerification,
    productVisible: visualVerification.productVisible, ctaVisible: visualVerification.ctaVisible,
    malformedAssets: false, inheritedRisk: source.angle.policy_status as "SAFE" | "REVIEW" | "REJECT" });
  const masterId = String((await existingMaster(admin, request))?.id ?? randomUUID());
  const finalUpload = await admin.storage.from(VIDEO_BUCKET).upload(videoPath, normalized.bytes, { contentType: "video/mp4", upsert: true });
  if (finalUpload.error) throw new Error("auto_fal_master_upload_failed");
  const assets = [
    { owner_id: request.ownerId, product_id: source.product.id, creative_project_id: request.projectId,
      asset_type: "VIDEO", source_type: "GENERATED", storage_path: sourcePath, mime_type: "video/mp4",
      width: normalized.source.width, height: normalized.source.height, duration_seconds: normalized.source.duration,
      provider: "fal", model: FAL_WAN_ENDPOINT, checksum: result.checksum },
    { owner_id: request.ownerId, product_id: source.product.id, creative_project_id: request.projectId,
      asset_type: "VIDEO", source_type: "RENDERED", storage_path: videoPath, mime_type: "video/mp4",
      width: normalized.media.width, height: normalized.media.height, duration_seconds: normalized.media.duration,
      provider: "fal", model: FAL_WAN_ENDPOINT, checksum: createHash("sha256").update(normalized.bytes).digest("hex") },
  ];
  const savedAssets = await admin.from("media_assets").upsert(assets, { onConflict: "owner_id,storage_path" });
  if (savedAssets.error) throw new Error("auto_fal_assets_write_failed");
  const row = { id: masterId, owner_id: request.ownerId, tiktok_account_id: request.accountId,
    product_id: source.product.id, creative_project_id: request.projectId, selected_script_id: source.script.id,
    generation_job_id: jobId, provider: "fal", model: FAL_WAN_ENDPOINT, render_strategy: "AI_IMAGE_TO_VIDEO",
    duration_seconds: normalized.media.duration, width: normalized.media.width, height: normalized.media.height,
    fps: normalized.media.fps, storage_path: videoPath, quality_score: quality.score,
    quality_status: quality.status, quality_explanation_json: quality.explanation,
    estimated_cost_usd: result.estimatedCostUsd, status: quality.status === "REJECT" ? "FAILED" : "READY" };
  const master = await admin.from("master_videos").upsert(row, { onConflict: "owner_id,creative_project_id" }).select("*").single();
  if (master.error || !master.data) throw new Error("auto_fal_master_write_failed");
  const updated = await admin.from("generation_jobs").update({ master_video_id: master.data.id,
    status: "COMPLETED", output_json: { masterId: master.data.id, storagePath: videoPath,
      sourcePath, providerRequestId: result.requestId, quality }, completed_at: new Date().toISOString() })
    .eq("owner_id", request.ownerId).eq("id", jobId);
  if (updated.error) throw new Error("auto_fal_job_complete_failed");
  return master.data;
}

export async function generateAutoFalMaster(admin: SupabaseClient, request: AutoFalRequest,
  provider: FalBoundary = new FalWanVideoProvider({ apiKey: serverEnv.falKey }), visionProvider?: FrameVisionProvider) {
  if (!serverEnv.falKey || serverEnv.falWanProviderState !== "PRODUCTION_APPROVED") throw new Error("fal_provider_not_approved");
  const [project, run] = await Promise.all([
    readOne(admin, "creative_projects", request.ownerId, request.projectId),
    readOne(admin, "auto_runs", request.ownerId, request.runId),
  ]);
  if (run.state !== "RUNNING" || project.tiktok_account_id !== request.accountId || !project.selected_script_id || !project.selected_angle_id) {
    throw new Error("auto_fal_source_not_ready");
  }
  const [script, angle, product, account] = await Promise.all([
    readOne(admin, "scripts", request.ownerId, String(project.selected_script_id)),
    readOne(admin, "creative_angles", request.ownerId, String(project.selected_angle_id)),
    readOne(admin, "products", request.ownerId, String(project.product_id)),
    readOne(admin, "tiktok_accounts", request.ownerId, request.accountId),
  ]);
  if (angle.policy_status !== "SAFE" || script.status === "REJECTED" || account.is_mock) throw new Error("auto_fal_creative_not_safe");
  const prior = await existingMaster(admin, request);
  if ((prior?.status === "READY" || prior?.status === "APPROVED") && prior.quality_status === "PASS") return prior;
  if (prior?.status === "READY" && prior.quality_status === "RETRY") {
    return reverifyAutoFalMaster(admin, { ownerId: request.ownerId, accountId: request.accountId,
      projectId: request.projectId, videoId: String(prior.id) }, visionProvider);
  }
  const job = await ensureJob(admin, request);
  const ledger = new AtomicBudgetLedger(admin);
  const image = await productImage(admin, request.ownerId, product);
  const estimatedCost = provider.estimateCost({ resolution: "720p" });
  const day = new Date().toISOString().slice(0, 10);
  const month = `${day.slice(0, 7)}-01`;
  const caps = { perVideo: Number(account.max_cost_per_video_usd), daily: Number(account.daily_video_budget_usd),
    monthly: Number(account.monthly_video_budget_usd), run: Number(run.budget_usd) };
  if (Object.values(caps).some(cap => !Number.isFinite(cap) || cap < estimatedCost)) throw new Error("auto_fal_budget_exceeded");
  const reservation = { ownerId: request.ownerId, accountId: request.accountId, generationJobId: job.id,
    autoRunId: request.runId, runKey: String(run.idempotency_key), logicalOperationKey: stableAutoKey(request.operationKey, "FAL_BUDGET"),
    provider: "fal", model: FAL_WAN_ENDPOINT, reservedUsd: estimatedCost,
    perVideoCapUsd: caps.perVideo, dailyCapUsd: caps.daily, monthlyCapUsd: caps.monthly,
    runCapUsd: caps.run, accountCapUsd: caps.daily, providerCapUsd: caps.run,
    budgetDay: day, budgetMonth: month };
  let generated: FalWanGenerationResult;
  let holdId: string | null = null;
  try {
    const paid = await submitAutoFalWithBudget({ ledger, reservation, provider, image, prompt: prompt({ product, script }),
      beforeSubmit: async () => {
        const active = await admin.from("auto_runs").select("state")
          .eq("owner_id", request.ownerId).eq("id", request.runId).maybeSingle();
        if (active.error || active.data?.state !== "RUNNING") throw new PaidProviderNotSubmittedError("auto_run_not_active");
        const started = await admin.from("generation_jobs").update({ status: "PROCESSING", attempt: 1,
          started_at: new Date().toISOString() }).eq("owner_id", request.ownerId).eq("id", job.id);
        if (started.error) throw new PaidProviderNotSubmittedError("auto_fal_job_start_failed");
      } });
    holdId = paid.reservation.id;
    if (paid.value) generated = paid.value;
    else if (paid.replayed) {
      const confirmed = await existingMaster(admin, request);
      if (confirmed?.status === "READY" || confirmed?.status === "APPROVED") return confirmed;
      if (!paid.reservation.provider_request_id) throw new PaidGenerationUncertainError(paid.reservation.id, null, new Error("settled_result_missing"));
      generated = await provider.retrieve(paid.reservation.provider_request_id);
    }
    else throw new Error("auto_fal_result_missing");
  } catch (error) {
    if (error instanceof PaidGenerationUncertainError) throw error;
    throw error;
  }
  try {
    return await persistMaster(admin, request, job.id, { project, script, angle, product }, generated, image, visionProvider);
  } catch (error) {
    throw new PaidGenerationUncertainError(holdId!, generated.requestId, error);
  }
}
