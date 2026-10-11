import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AtomicBudgetLedger } from "@/features/video/budget-ledger";
import { composeGeneratedVideo, validateNarrationAudio } from "@/features/video/media-composition";
import { ownsVideoStoragePath, videoStoragePath } from "@/features/video/storage";
import { runContentComplianceCheck } from "@/features/compliance/compliance";
import { assertMp4, createPostPackageZip } from "@/features/manual-post/package";
import { contentExportConfig } from "./config";
import { contentPrompt, effectiveContentMode, ideaSchema, type ContentRequest, type ContentView, type Stage } from "./contracts";
import { ContentProvider, assertFalAssetUrl, paidStep, type PaidStep } from "./provider";

type StepRecord = { step: PaidStep; jobId: string; holdId: string; requestId?: string; result?: Record<string, unknown>; submitting?: boolean; polls?: number; submittedAt?: string };
type Checkpoint = { stage?: Stage; idea?: ReturnType<typeof ideaSchema.parse>; steps?: Partial<Record<Stage, StepRecord>>; product?: Record<string, unknown>; imageUrl?: string; voiceUrl?: string; videoUrl?: string; prompt?: string };
type Run = { id: string; owner_id: string; tiktok_account_id: string; product_id: string | null; mode: "GROWTH" | "AFFILIATE";
  status: ContentView["status"]; budget_usd: number; reserved_usd: number; checkpoint: Checkpoint; lease_token: string | null;
  title: string; script: string; caption: string; rationale: string; message: string; storage_path: string | null; checksum: string | null; approved_at: string | null; created_at: string };
const publicColumns = "id,tiktok_account_id,mode,status,budget_usd,reserved_usd,title,script,caption,rationale,message,created_at";
function must(error: unknown) { if (error) throw new Error("content_storage_unavailable"); }
export function customerRun(row: Run): ContentView { return { id: row.id, accountId: row.tiktok_account_id, mode: row.mode, status: row.status,
  title: row.title, script: row.script, caption: row.caption, rationale: row.rationale, message: row.message,
  budgetUsd: Number(row.budget_usd), reservedUsd: Number(row.reserved_usd), createdAt: row.created_at }; }
export async function listContentRuns(client: SupabaseClient, owner: string) {
  const result = await client.from("content_export_runs").select(publicColumns).eq("owner_id", owner).order("created_at", { ascending: false }).limit(20);
  must(result.error); return (result.data ?? []).map(row => customerRun(row as unknown as Run));
}
async function ownedAccount(admin: SupabaseClient, owner: string, account: string) {
  const result = await admin.from("tiktok_accounts").select("id,preferred_categories,ecommerce_permission,cart_enabled,is_mock,daily_video_budget_usd,monthly_video_budget_usd")
    .eq("owner_id", owner).eq("id", account).is("hidden_at", null).maybeSingle();
  must(result.error); if (!result.data || result.data.is_mock) throw new Error("content_account_required"); return result.data;
}
async function readRun(admin: SupabaseClient, owner: string, id: string) {
  const result = await admin.from("content_export_runs").select("*").eq("owner_id", owner).eq("id", id).maybeSingle();
  must(result.error); if (!result.data) throw new Error("content_run_missing"); return result.data as Run;
}
export async function startContentRun(admin: SupabaseClient, owner: string, input: ContentRequest) {
  const config = contentExportConfig(); if (!config.enabled || !config.key || !config.allowedOwners.includes(owner)) throw new Error("content_not_configured");
  const account = await ownedAccount(admin, owner, input.accountId);
  const prior = await admin.from("content_export_runs").select("*").eq("owner_id", owner).eq("request_key", input.requestKey).maybeSingle();
  must(prior.error); if (prior.data) return customerRun(prior.data as Run);
  const pending = await admin.from("generation_budget_reservations").select("id").eq("owner_id", owner)
    .eq("tiktok_account_id", input.accountId).eq("state", "RESERVED").neq("provider_submission_state", "REQUEST_NOT_SENT").limit(1);
  must(pending.error); if (pending.data?.length) throw new Error("content_submission_uncertain");
  let product: Record<string, unknown> | undefined;
  if (input.productId) {
    const result = await admin.from("products").select("id,title,category_key,status,image_url,product_url")
      .eq("owner_id", owner).eq("id", input.productId).eq("status", "available").maybeSingle();
    must(result.error); if (!result.data) throw new Error("content_product_required"); product = result.data;
  }
  const mode = effectiveContentMode(input, account, Boolean(product));
  if (mode === "AFFILIATE" && !product) throw new Error("content_product_required");
  // A product must use an actual owned photo, not a generated substitute.
  let imageUrl: string | undefined;
  if (product && mode === "AFFILIATE") {
    const asset = await admin.from("media_assets").select("storage_path,mime_type").eq("owner_id", owner).eq("product_id", product.id)
      .eq("asset_type", "PRODUCT_IMAGE").in("source_type", ["UPLOAD", "PRODUCT"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    must(asset.error);
    if (!asset.data || !ownsVideoStoragePath(owner, asset.data.storage_path)) throw new Error("content_product_image_required");
    const signed = await admin.storage.from("video-assets").createSignedUrl(asset.data.storage_path, 3600);
    must(signed.error); if (!signed.data?.signedUrl) throw new Error("content_product_image_required"); imageUrl = signed.data.signedUrl;
  }
  const history = await admin.from("content_export_runs").select("title").eq("owner_id", owner).eq("tiktok_account_id", input.accountId).order("created_at", { ascending: false }).limit(8);
  must(history.error);
  const prompt = contentPrompt({ mode, topic: input.topic, interests: account.preferred_categories ?? [],
    product: mode === "AFFILIATE" ? { title: product!.title, category: product!.category_key } : null, history: (history.data ?? []).map(row => row.title) });
  const result = await admin.from("content_export_runs").insert({ owner_id: owner, tiktok_account_id: input.accountId,
    product_id: mode === "AFFILIATE" ? product!.id : null, request_key: input.requestKey, mode, topic: input.topic,
    budget_usd: input.budgetUsd, checkpoint: { stage: "IDEA", prompt, product: mode === "AFFILIATE" ? product : null, imageUrl } }).select("*").single();
  if (result.error?.code === "23505") {
    const active = await admin.from("content_export_runs").select("*").eq("owner_id", owner).eq("tiktok_account_id", input.accountId)
      .in("status", ["QUEUED", "THINKING", "IMAGING", "VOICING", "GENERATING", "COMPOSING"]).maybeSingle();
    must(active.error); if (active.data) return customerRun(active.data as Run);
  }
  must(result.error); return customerRun(result.data as Run);
}
export interface ContentRuntime { provider: ContentProvider; compose: typeof composeGeneratedVideo; validateVoice?: typeof validateNarrationAudio; }
export async function advanceContentRun(admin: SupabaseClient, owner: string, id: string, runtime?: ContentRuntime) {
  const config = contentExportConfig(); if (!config.enabled || !config.key || !config.allowedOwners.includes(owner)) throw new Error("content_not_configured");
  const account = await ownedAccount(admin, owner, (await readRun(admin, owner, id)).tiktok_account_id);
  const token = randomUUID(), claim = await admin.rpc("claim_content_export_run", { p_owner_id: owner, p_run_id: id, p_lease_token: token });
  must(claim.error); if (!claim.data?.id) return customerRun(await readRun(admin, owner, id));
  const run = claim.data as Run, checkpoint: Checkpoint = run.checkpoint;
  const provider = runtime?.provider ?? new ContentProvider(config.key), ledger = new AtomicBudgetLedger(admin);
  async function save(values: Record<string, unknown>) {
    const result = await admin.from("content_export_runs").update({ ...values, checkpoint, updated_at: new Date().toISOString() })
      .eq("owner_id", owner).eq("id", id).eq("lease_token", token).neq("status", "CANCELLED").select("id").maybeSingle();
    must(result.error); if (!result.data) throw new Error("content_lease_lost");
  }
  async function assertActive() { const current = await readRun(admin, owner, id);
    if (current.status === "CANCELLED" || current.lease_token !== token) throw new Error("content_lease_lost"); }
  try {
    const stage = checkpoint.stage ?? "IDEA";
    if (stage === "COMPOSE") {
      await save({ status: "COMPOSING" });
      const dir = join(tmpdir(), "viralflow-export", id, token); await mkdir(dir, { recursive: true });
      try {
        const [video, voice] = await Promise.all([provider.download(checkpoint.videoUrl!, "video"), provider.download(checkpoint.voiceUrl!, "audio")]);
        const source = join(dir, "source.mp4"), audio = join(dir, "voice.mp3"), output = join(dir, "final.mp4");
        await writeFile(source, video.bytes); await writeFile(audio, voice.bytes);
        const composed = await (runtime?.compose ?? composeGeneratedVideo)(source, output, { durationSeconds: 8, resolution: "720p", overlay: [], voicePath: audio });
        if (!composed.media.hasAudio || composed.media.videoCodec !== "h264" || composed.media.audioCodec !== "aac" || composed.media.width !== 720 || composed.media.height !== 1280) throw new Error("content_quality_review");
        const bytes = await readFile(output); assertMp4(bytes, "video/mp4"); await assertActive();
        const path = videoStoragePath(owner, "masters", id, "content-export.mp4");
        const uploaded = await admin.storage.from("video-assets").upload(path, bytes, { contentType: "video/mp4", upsert: true }); must(uploaded.error);
        await save({ storage_path: path, checksum: createHash("sha256").update(bytes).digest("hex"), status: "REVIEW_REQUIRED",
          message: "คลิปพร้อมตรวจ กรุณาดูภาพ ฟังเสียง และตรวจคำบรรยายก่อนนำไปโพสต์ การตรวจภาพอัตโนมัติยังไม่รับรองว่าปลอดภัย" });
      } finally { await rm(dir, { recursive: true, force: true }); }
      return customerRun(await readRun(admin, owner, id));
    }
    const statuses = { IDEA: "THINKING", IMAGE: "IMAGING", VOICE: "VOICING", VIDEO: "GENERATING" };
    await save({ status: statuses[stage] });
    checkpoint.steps ??= {};
    let record = checkpoint.steps[stage];
    if (!record) {
      const step = await provider.quote(paidStep(stage, { prompt: checkpoint.prompt!, model: config.brainModel, idea: checkpoint.idea, imageUrl: checkpoint.imageUrl }));
      if (Number(run.reserved_usd) + step.reserveUsd > Number(run.budget_usd)) throw new Error("content_budget_exceeded");
      const jobKey = `content-export:${id}:${stage}`;
      const jobResult = await admin.from("generation_jobs").upsert({ owner_id: owner, idempotency_key: jobKey,
        job_type: "MASTER_RENDER", provider: "fal", model: step.endpoint, input_json: { contentExportId: id, stage },
        status: "QUEUED", max_attempts: 1 }, { onConflict: "owner_id,idempotency_key", ignoreDuplicates: true }); must(jobResult.error);
      const job = await admin.from("generation_jobs").select("id").eq("owner_id", owner).eq("idempotency_key", jobKey).single(); must(job.error);
      const day = new Date().toISOString().slice(0, 10);
      const hold = await ledger.reserve({ ownerId: owner, accountId: run.tiktok_account_id, generationJobId: job.data!.id,
        autoRunId: null, runKey: id, logicalOperationKey: jobKey, provider: "fal", model: step.endpoint, reservedUsd: step.reserveUsd,
        perVideoCapUsd: Number(run.budget_usd), dailyCapUsd: config.dailyCapUsd, monthlyCapUsd: config.monthlyCapUsd,
        runCapUsd: Number(run.budget_usd), accountCapUsd: config.dailyCapUsd,
        providerCapUsd: config.dailyCapUsd, budgetDay: day, budgetMonth: `${day.slice(0, 7)}-01` });
      record = { step, jobId: job.data!.id, holdId: hold.id, requestId: hold.provider_request_id ?? undefined,
        submitting: hold.provider_submission_state !== "REQUEST_NOT_SENT" };
      checkpoint.steps[stage] = record;
      run.reserved_usd = Number(run.reserved_usd) + step.reserveUsd;
      await save({ reserved_usd: run.reserved_usd });
    }
    if (!record.requestId) {
      if (record.submitting) throw new Error("content_submission_uncertain");
      await assertActive(); await ledger.begin(owner, record.holdId);
      record.submitting = true; await save({});
      const submitted = await provider.submit(record.step);
      record.requestId = submitted.request_id;
      record.submittedAt = new Date().toISOString();
      if (!record.requestId) throw new Error("content_submission_uncertain");
      // Persist the identity even if the user stopped while the provider accepted it.
      await ledger.submitted(owner, record.holdId, record.requestId);
      await save({});
      return customerRun(await readRun(admin, owner, id));
    }
    record.polls = (record.polls ?? 0) + 1;
    if (record.polls > 120 || (record.submittedAt && Date.now() - Date.parse(record.submittedAt) > 30 * 60_000)) throw new Error("content_submission_uncertain");
    await save({});
    let result: Record<string, unknown> | null;
    try { result = record.result ?? await provider.read(record.step, record.requestId); }
    catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "content_provider_failed") {
        await ledger.settle(owner, record.holdId, record.step.reserveUsd, record.requestId);
        throw error;
      }
      // Transient read failures recover the same ID, never a new submission.
      return customerRun(await readRun(admin, owner, id));
    }
    if (!result) return customerRun(await readRun(admin, owner, id));
    record.result = result; await save({});
    const usage = result.usage as { cost?: number } | undefined;
    const charged = typeof usage?.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0 ? usage.cost : record.step.reserveUsd;
    await ledger.settle(owner, record.holdId, charged, record.requestId);
    if (charged > record.step.reserveUsd) throw new Error("content_budget_reconciliation");
    const completedJob = await admin.from("generation_jobs").update({ status: "COMPLETED", completed_at: new Date().toISOString(),
      output_json: { requestId: record.requestId, estimatedCostUsd: record.step.reserveUsd, recordedCostUsd: usage?.cost ?? null } })
      .eq("owner_id", owner).eq("id", record.jobId); must(completedJob.error);
    if (stage === "IDEA") {
      if (result.error || result.partial || typeof result.output !== "string") throw new Error("content_idea_invalid");
      const idea = ideaSchema.parse(JSON.parse(result.output.replace(/^```(?:json)?\s*|\s*```$/g, "")));
      const checked = runContentComplianceCheck({ text: `${idea.script} ${idea.caption} ${idea.hook}`, mode: run.mode,
        approvedProductFacts: checkpoint.product ? [String(checkpoint.product.title)] : [], cartAvailable: account.cart_enabled === true,
        affiliateAvailable: account.ecommerce_permission === true, inheritedRisk: "SAFE", aiGenerated: true, aiModified: true,
        provenanceAvailable: true, provider: "fal" });
      // Offline preparation does not assert an Affiliate/cart entitlement.
      // Every content issue still blocks. Real posting uses its unchanged permission gate.
      if (checked.issues.some(issue => issue.code !== "AFFILIATE_UNAVAILABLE")) throw new Error("content_claim_review");
      checkpoint.idea = idea; checkpoint.stage = checkpoint.imageUrl ? "VOICE" : "IMAGE";
      await save({ title: idea.title, script: idea.script, caption: `${idea.caption}\n${idea.hashtags.join(" ")}`, rationale: idea.rationale });
    } else if (stage === "IMAGE") {
      const images = result.images as { url: string }[] | undefined;
      const unsafe = result.has_nsfw_concepts as boolean[] | undefined;
      if (!images?.[0]?.url || unsafe?.some(Boolean)) throw new Error("content_image_review");
      assertFalAssetUrl(images[0].url); checkpoint.imageUrl = images[0].url; checkpoint.stage = "VOICE"; await save({});
    } else if (stage === "VOICE") {
      const audio = result.audio as { url?: string } | undefined;
      if (!audio?.url) throw new Error("content_audio_invalid"); assertFalAssetUrl(audio.url);
      if (typeof result.duration_ms !== "number" || result.duration_ms > 8000 || result.duration_ms < 1000) throw new Error("content_voice_length_review");
      const voice = await provider.download(audio.url, "audio");
      await (runtime?.validateVoice ?? validateNarrationAudio)(new Blob([new Uint8Array(voice.bytes)], { type: voice.mime }), 8);
      checkpoint.voiceUrl = audio.url; checkpoint.stage = "VIDEO"; await save({});
    } else {
      const video = result.video as { url?: string } | undefined;
      if (!video?.url) throw new Error("content_video_invalid"); assertFalAssetUrl(video.url);
      checkpoint.videoUrl = video.url; checkpoint.stage = "COMPOSE"; await save({});
    }
    return customerRun(await readRun(admin, owner, id));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason === "content_lease_lost") return customerRun(await readRun(admin, owner, id));
    const current = checkpoint.steps?.[checkpoint.stage ?? "IDEA"];
    if (current?.submitting && !current.requestId) await ledger.uncertain(owner, current.holdId, null).catch(() => undefined);
    await save({ status: "FAILED", message: /budget/.test(reason) ? "งบที่ตั้งไว้ไม่พอหรือมีรายการที่ต้องตรวจยอด กรุณาตรวจงบก่อนเริ่มงานใหม่"
      : /claim|review|idea_invalid/.test(reason) ? "เนื้อหาหรือไฟล์นี้ต้องตรวจเพิ่มเติม ระบบหยุดการสร้างต่อเพื่อไม่เสียเงินเพิ่ม"
      : /uncertain/.test(reason) ? "กำลังตรวจรายการที่ส่งไปแล้ว กรุณาอย่าเริ่มซ้ำเพื่อป้องกันการจ่ายซ้ำ"
      : "ยังสร้างต่อไม่ได้ กรุณาตรวจยอดเงินและความพร้อมของบริการ ไม่มีการลองเสียเงินซ้ำอัตโนมัติ" });
    return customerRun(await readRun(admin, owner, id));
  } finally {
    const release = await admin.from("content_export_runs").update({ lease_token: null, lease_expires_at: null })
      .eq("owner_id", owner).eq("id", id).eq("lease_token", token); must(release.error);
  }
}
export async function stopContentRun(admin: SupabaseClient, owner: string, id: string) {
  const run = await readRun(admin, owner, id); await ownedAccount(admin, owner, run.tiktok_account_id);
  const result = await admin.from("content_export_runs").update({ status: "CANCELLED", message: "หยุดงานแล้ว รายการที่บริการรับไปก่อนหยุดอาจมีค่าใช้จ่าย", updated_at: new Date().toISOString() })
    .eq("owner_id", owner).eq("id", id).in("status", ["QUEUED", "THINKING", "IMAGING", "VOICING", "GENERATING", "COMPOSING"]); must(result.error);
}
export async function reviewContentRun(admin: SupabaseClient, owner: string, id: string) {
  const run = await readRun(admin, owner, id); await ownedAccount(admin, owner, run.tiktok_account_id);
  if (run.status !== "REVIEW_REQUIRED" || !run.storage_path || !run.checksum) throw new Error("content_review_required");
  const result = await admin.from("content_export_runs").update({ status: "READY", approved_at: new Date().toISOString(), message: "คุณตรวจภาพ เสียง และคำบรรยายแล้ว พร้อมดาวน์โหลดไปโพสต์เอง" })
    .eq("owner_id", owner).eq("id", id).eq("status", "REVIEW_REQUIRED"); must(result.error);
}
export async function contentMedia(admin: SupabaseClient, owner: string, id: string, download: boolean) {
  const run = await readRun(admin, owner, id); await ownedAccount(admin, owner, run.tiktok_account_id);
  if (!(download ? run.status === "READY" && run.approved_at : ["REVIEW_REQUIRED", "READY"].includes(run.status)) ||
    !run.storage_path || !ownsVideoStoragePath(owner, run.storage_path)) throw new Error("content_review_required");
  const file = await admin.storage.from("video-assets").download(run.storage_path); must(file.error);
  if (!file.data || file.data.size > 50_000_000) throw new Error("content_media_invalid");
  const bytes = new Uint8Array(await file.data.arrayBuffer()); assertMp4(bytes, "video/mp4");
  if (createHash("sha256").update(bytes).digest("hex") !== run.checksum) throw new Error("content_integrity_invalid");
  if (!download) return bytes;
  return createPostPackageZip([{ name: "video.mp4", bytes }, { name: "caption.txt", bytes: Buffer.from(`${run.caption}\n\nคอนเทนต์นี้สร้างด้วย AI กรุณาระบุเมื่อโพสต์`) },
    { name: "package.json", bytes: Buffer.from(JSON.stringify({ title: run.title, mode: run.mode, aiGenerated: true, publishing: "MANUAL", automatedVisualCompliance: "NOT_VERIFIED", reviewedByOwner: true })) }]);
}
