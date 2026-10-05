import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FAL_MODEL_ENDPOINTS, type FalModelSettings } from "./fal-models";
import { FalWanVideoProvider, type FalWanClient } from "./fal-wan";
import { OpenAIFrameVisionProvider } from "./frame-verification";
import { customerVideoStatus } from "./customer-presentation";
import { autoVideoQualityOutcome } from "../auto/execution-policy";
import { FAL_BUDGET_GUARD_VERSION } from "./budget-ledger";
import { videoStoragePath } from "./storage";

const config = vi.hoisted(() => ({ falKey: "test-only-fal-credential", falWanProviderState: "PRODUCTION_APPROVED",
  videoFalEnabled: true, videoFalPrimaryModel: "fal-ai/ltxv-13b-098-distilled/image-to-video",
  videoFalFallbackModel: "wan/v2.6/image-to-video/flash", videoFalApprovedModels: ["fal-ai/ltxv-13b-098-distilled/image-to-video", "wan/v2.6/image-to-video/flash"],
  videoFalQualityThreshold: 85, videoFalMaxAttempts: 2, videoFalPerClipCapUsd: 1, videoFalPerJobCapUsd: 1,
  videoFalDailyCapUsd: 5, videoFalDurationSeconds: 8, videoFalResolution: "720p", videoProductImageAllowedHosts: [], openAIApiKey: undefined }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server-env", () => ({ serverEnv: config }));

type Row = Record<string, unknown>;
const owner = "11111111-1111-4111-8111-111111111111";
const photoPath = videoStoragePath(owner, "products", "product", "photo.jpg"), voicePath = videoStoragePath(owner, "masters", "project", "voice.wav");
let dir: string, photo: Uint8Array, video: Uint8Array, voice: Uint8Array;
function mediaCommand(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const binary = join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    const processHandle = spawn(binary, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...args], { windowsHide: true });
    processHandle.on("error", reject); processHandle.on("close", code => code === 0 ? resolve() : reject(new Error("fixture_media_failed")));
  });
}

// Only external database/storage and provider boundaries are substituted. Composition,
// frame extraction, format probing, provider polling, quality and orchestration run unchanged.
function database(withVoice = true) {
  const tables: Record<string, Row[]> = {
    creative_projects: [{ id: "project", owner_id: owner, tiktok_account_id: "account", product_id: "product", selected_script_id: "script", selected_angle_id: "angle" }],
    scripts: [{ id: "script", owner_id: owner, creative_angle_id: "angle", hook_text: "Test product", cta_text: "View details", status: "READY", overlay_text_json: [], scene_plan_json: [
      { start: 0, end: 2, visual: "hook", motion: "push" }, { start: 2, end: 5, visual: "product", motion: "pan" }, { start: 5, end: 8, visual: "cta", motion: "hold" }] }],
    creative_angles: [{ id: "angle", owner_id: owner, policy_status: "SAFE" }], products: [{ id: "product", owner_id: owner, title: "Public test fixture" }],
    tiktok_accounts: [{ id: "account", owner_id: owner, is_mock: false, max_cost_per_video_usd: 1, daily_video_budget_usd: 5, monthly_video_budget_usd: 150 }],
    auto_runs: [{ id: "run", owner_id: owner, state: "RUNNING", budget_usd: 5, idempotency_key: "test-run-idempotency" }],
    generation_jobs: [], generation_budget_reservations: [], generation_costs: [], master_videos: [], video_variations: [],
    media_assets: [{ id: "photo", owner_id: owner, product_id: "product", asset_type: "PRODUCT_IMAGE", source_type: "UPLOAD", storage_path: photoPath, mime_type: "image/jpeg" },
      ...(withVoice ? [{ id: "voice", owner_id: owner, creative_project_id: "project", asset_type: "VOICE", source_type: "UPLOAD", storage_path: voicePath, mime_type: "audio/wav" }] : [])],
  };
  const files = new Map<string, Blob>([[photoPath, new Blob([new Uint8Array(photo)], { type: "image/jpeg" })], [voicePath, new Blob([new Uint8Array(voice)], { type: "audio/wav" })]]);
  let ids = 0;
  class Query implements PromiseLike<{ data: Row[]; error: null }> {
    private filters: Array<(row: Row) => boolean> = []; private operation = "read"; private values: Row[] = []; private conflict = "";
    constructor(private table: string) {}
    select() { return this; } order() { return this; } limit() { return this; }
    eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this; }
    neq(key: string, value: unknown) { this.filters.push(row => row[key] !== value); return this; }
    lte(key: string, value: number) { this.filters.push(row => Number(row[key]) <= value); return this; }
    in(key: string, values: unknown[]) { this.filters.push(row => values.includes(row[key])); return this; }
    insert(value: Row | Row[]) { this.operation = "insert"; this.values = Array.isArray(value) ? value : [value]; return this; }
    update(value: Row) { this.operation = "update"; this.values = [value]; return this; }
    upsert(value: Row | Row[], options: { onConflict: string }) { this.operation = "upsert"; this.values = Array.isArray(value) ? value : [value]; this.conflict = options.onConflict; return this; }
    execute() {
      let rows = tables[this.table].filter(row => this.filters.every(filter => filter(row)));
      if (this.operation === "insert" || this.operation === "upsert") {
        rows = this.values.map(value => {
          const keys = this.conflict.split(","), existing = this.operation === "upsert" && tables[this.table].find(row => keys.every(key => row[key] === value[key]));
          if (existing) { Object.assign(existing, value); return existing; }
          const created = { id: value.id ?? `row-${++ids}`, ...value }; tables[this.table].push(created); return created;
        });
      } else if (this.operation === "update") rows.forEach(row => Object.assign(row, this.values[0]));
      return { data: rows, error: null };
    }
    async maybeSingle() { const result = this.execute(); return { data: result.data[0] ?? null, error: null }; }
    async single() { return this.maybeSingle(); }
    then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
    }
  }
  const rpc = vi.fn(async (name: string, input: Row) => {
    if (name === "fal_budget_guard_version") return { data: FAL_BUDGET_GUARD_VERSION, error: null };
    const hold = tables.generation_budget_reservations.find(row => row.id === input.p_reservation_id);
    if (name === "reserve_generation_budget") {
      const prior = tables.generation_budget_reservations.find(row => row.logical_operation_key === input.p_logical_operation_key);
      if (prior) return { data: { ...prior }, error: null };
      const row = { id: `hold-${++ids}`, owner_id: owner, generation_job_id: input.p_generation_job_id, model: input.p_model,
        logical_operation_key: input.p_logical_operation_key, reserved_usd: input.p_reserved_usd, actual_usd: null, state: "RESERVED", provider_submission_state: "REQUEST_NOT_SENT", provider_request_id: null };
      tables.generation_budget_reservations.push(row); return { data: { ...row }, error: null };
    }
    if (name === "persist_fal_master") {
      const job = tables.generation_jobs.find(row => row.id === input.p_job_id)!;
      const current = tables.master_videos.find(row => row.generation_job_id === job.id);
      if (job.attempt !== input.p_expected_attempt || job.status === "CANCELLED") return { data: { accepted: false, master: current }, error: null };
      const payload = input.p_master_payload as Row, existing = tables.master_videos.find(row => row.creative_project_id === payload.creative_project_id);
      if (existing?.quality_status === "PASS" && payload.quality_status !== "PASS") return { data: { accepted: false, master: existing }, error: null };
      const master = existing ?? { ...payload }; Object.assign(master, payload); if (!existing) tables.master_videos.push(master);
      const output = input.p_job_output as Row;
      Object.assign(job, { master_video_id: master.id, output_json: { ...(job.output_json as Row ?? {}), ...output, masterId: master.id }, ...(input.p_complete ? { status: "COMPLETED" } : {}) });
      return { data: { accepted: true, master: { ...master } }, error: null };
    }
    if (!hold) throw new Error("fixture_hold_missing");
    if (name === "begin_generation_submission") { if (hold.provider_submission_state !== "REQUEST_NOT_SENT") throw new Error("duplicate_submission"); hold.provider_submission_state = "SUBMITTING"; }
    if (name === "mark_generation_submitted") Object.assign(hold, { provider_submission_state: "SUBMITTED", provider_request_id: input.p_provider_request_id });
    if (name === "mark_generation_unknown") Object.assign(hold, { provider_submission_state: "SUBMITTED_UNKNOWN", provider_request_id: input.p_provider_request_id ?? hold.provider_request_id });
    if (name === "release_generation_budget") Object.assign(hold, { state: "RELEASED", provider_submission_state: "FAILED" });
    if (name === "settle_generation_budget") {
      if (hold.state !== "SETTLED") tables.generation_costs.push({ generation_job_id: hold.generation_job_id, total_cost_usd: input.p_actual_usd });
      Object.assign(hold, { state: "SETTLED", provider_submission_state: "CONFIRMED", actual_usd: input.p_actual_usd });
    }
    return { data: { ...hold }, error: null };
  });
  const download = vi.fn(async (path: string) => ({ data: files.get(path) ?? null, error: files.has(path) ? null : { message: "missing" } }));
  const client = { from: (table: string) => new Query(table), rpc, storage: { from: () => ({
    download,
    upload: async (path: string, bytes: Uint8Array) => { files.set(path, new Blob([new Uint8Array(bytes)])); return { error: null }; },
  }) } } as unknown as SupabaseClient;
  return { client, tables, files, rpc, download };
}
const assessment = { productVisible: true, ctaVisible: true, checks: { shape: "PASS", colors: "PASS", packaging: "PASS", details: "PASS", deformation: "PASS", visibleText: "PASS", commercialSafety: "PASS" }, reasons: [] };
function vision(statuses: Array<"PASS" | "FAIL" | "REVIEW"> = ["PASS"]) {
  const network = vi.fn(async () => {
    const status = statuses.shift() ?? "PASS", result = { ...assessment, checks: { ...assessment.checks, packaging: status } };
    return new Response(JSON.stringify({ status: "completed", output_text: JSON.stringify(result) }), { status: 200 });
  });
  return { provider: new OpenAIFrameVisionProvider("test-vision-credential", "gpt-4.1-mini", network as typeof fetch), network };
}
function providers(primaryFailure: "none" | "terminal" | "unknown" = "none") {
  const submit = vi.fn(async (endpoint: string) => {
    if (endpoint === FAL_MODEL_ENDPOINTS.LTX_098_DISTILLED && primaryFailure === "unknown") throw new Error("connection lost after POST");
    return { request_id: endpoint === FAL_MODEL_ENDPOINTS.LTX_098_DISTILLED ? "primary-request" : "fallback-request" };
  });
  const client: FalWanClient = { upload: vi.fn(async () => "https://fal.media/input.jpg"), submit,
    status: vi.fn(async endpoint => endpoint === FAL_MODEL_ENDPOINTS.LTX_098_DISTILLED && primaryFailure === "terminal" ? { status: "FAILED", error: "provider failed" } : { status: "COMPLETED" }),
    result: vi.fn(async (_endpoint, requestId) => ({ requestId, data: { video: { url: "https://fal.media/fixture.mp4" } } })), cancel: vi.fn(async () => true) };
  const factory = (settings: FalModelSettings) => new FalWanVideoProvider({ apiKey: config.falKey, settings, client,
    fetchImpl: vi.fn(async () => new Response(new Uint8Array(video), { status: 200 })) as typeof fetch, sleep: async () => {}, pollIntervalMs: 0, maxPollAttempts: 1, readRetryAttempts: 0 });
  return { factory, submit, client };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "viralflow-production-pipeline-test-"));
  // Explicit test fixtures; no production mock provider or renderer is substituted.
  await mediaCommand(["-f", "lavfi", "-i", "color=c=blue:s=640x640", "-frames:v", "1", join(dir, "photo.jpg")]);
  await mediaCommand(["-f", "lavfi", "-i", "sine=frequency=330:duration=8", join(dir, "voice.wav")]);
  await mediaCommand(["-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=30", "-t", "8", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", join(dir, "source.mp4")]);
  [photo, voice, video] = await Promise.all([readFile(join(dir, "photo.jpg")), readFile(join(dir, "voice.wav")), readFile(join(dir, "source.mp4"))]);
}, 60_000);
afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });
beforeEach(() => {
  config.videoFalEnabled = true; config.videoFalPrimaryModel = FAL_MODEL_ENDPOINTS.LTX_098_DISTILLED;
  config.videoFalFallbackModel = FAL_MODEL_ENDPOINTS.WAN_26_FLASH;
  config.videoFalApprovedModels = [config.videoFalPrimaryModel, config.videoFalFallbackModel];
  config.videoFalResolution = "720p"; config.videoFalDurationSeconds = 8; config.videoFalQualityThreshold = 85;
});

describe("real Video Factory production pipeline", () => {
  it("stores one passing master and never pays again after manual reload", async () => {
    const { generateVideoFactoryFalMaster } = await import("./auto-fal");
    const db = database(), network = providers(), verifier = vision();
    const master = await generateVideoFactoryFalMaster(db.client, owner, "project", network.factory, verifier.provider);
    const replay = await generateVideoFactoryFalMaster(db.client, owner, "project", network.factory, verifier.provider);
    expect(master).toMatchObject({ provider: "fal", quality_status: "PASS", status: "READY", width: 720, height: 1280 });
    expect(replay.id).toBe(master.id); expect(network.submit).toHaveBeenCalledOnce(); expect(db.tables.generation_costs).toHaveLength(1);
    expect((db.tables.generation_jobs[0].input_json as Row).falPolicy).toMatchObject({ maxAttempts: 2, durationSeconds: 8 });
    expect(verifier.network).toHaveBeenCalledOnce(); expect(customerVideoStatus(master)).toBe("สำเร็จ");
  }, 60_000);

  it("uses one fallback after a charged confirmed failure and accounts for both attempts", async () => {
    const { generateVideoFactoryFalMaster } = await import("./auto-fal");
    const db = database(), network = providers("terminal"), verifier = vision();
    const master = await generateVideoFactoryFalMaster(db.client, owner, "project", network.factory, verifier.provider);
    expect(master).toMatchObject({ model: FAL_MODEL_ENDPOINTS.WAN_26_FLASH, quality_status: "PASS" });
    expect(network.submit).toHaveBeenCalledTimes(2); expect(db.tables.generation_costs).toHaveLength(2);
    expect(db.tables.generation_budget_reservations.every(row => row.state === "SETTLED")).toBe(true);
    await generateVideoFactoryFalMaster(db.client, owner, "project", network.factory, verifier.provider);
    expect(network.submit).toHaveBeenCalledTimes(2);
  }, 60_000);

  it("stops at REVIEW_REQUIRED after two verified quality failures", async () => {
    const { generateVideoFactoryFalMaster } = await import("./auto-fal");
    const db = database(), network = providers(), verifier = vision(["FAIL", "FAIL"]);
    const master = await generateVideoFactoryFalMaster(db.client, owner, "project", network.factory, verifier.provider);
    expect(customerVideoStatus(master)).toBe("REVIEW_REQUIRED");
    expect(autoVideoQualityOutcome(master)).toMatchObject({ kind: "WAIT", state: "WAITING_FOR_APPROVAL", reason: "REVIEW_REQUIRED" });
    await generateVideoFactoryFalMaster(db.client, owner, "project", network.factory, verifier.provider);
    expect(network.submit).toHaveBeenCalledTimes(2); expect(db.tables.generation_costs).toHaveLength(2);
  }, 90_000);

  it("holds visual uncertainty without buying fallback footage", async () => {
    const { generateVideoFactoryFalMaster } = await import("./auto-fal");
    const db = database(), network = providers(), verifier = vision(["REVIEW"]);
    const master = await generateVideoFactoryFalMaster(db.client, owner, "project", network.factory, verifier.provider);
    expect(customerVideoStatus(master)).toBe("REVIEW_REQUIRED"); expect(network.submit).toHaveBeenCalledOnce();
    await generateVideoFactoryFalMaster(db.client, owner, "project", network.factory, verifier.provider);
    expect(network.submit).toHaveBeenCalledOnce();
  }, 60_000);

  it("does not submit a fallback or duplicate after an unknown charged POST", async () => {
    const { FalGenerationPendingError, generateVideoFactoryFalMaster } = await import("./auto-fal");
    const db = database(), network = providers("unknown"), verifier = vision();
    await expect(generateVideoFactoryFalMaster(db.client, owner, "project", network.factory, verifier.provider)).rejects.toMatchObject({ name: "PaidGenerationUncertainError" });
    await expect(generateVideoFactoryFalMaster(db.client, owner, "project", network.factory, verifier.provider)).rejects.toBeInstanceOf(FalGenerationPendingError);
    db.tables.generation_jobs[0].started_at = new Date(Date.now() - 21 * 60_000).toISOString();
    await expect(generateVideoFactoryFalMaster(db.client, owner, "project", network.factory, verifier.provider)).rejects.toMatchObject({ name: "PaidGenerationUncertainError" });
    expect(network.submit).toHaveBeenCalledOnce(); expect(db.tables.generation_budget_reservations[0].state).toBe("RESERVED");
  }, 60_000);

  it("requires real narration, vision, an enabled policy and model approval before paid work", async () => {
    const { generateVideoFactoryFalMaster } = await import("./auto-fal");
    const network = providers(), verifier = vision();
    expect(customerVideoStatus(await generateVideoFactoryFalMaster(database(false).client, owner, "project", network.factory, verifier.provider))).toBe("REVIEW_REQUIRED");
    expect(customerVideoStatus(await generateVideoFactoryFalMaster(database().client, owner, "project", network.factory))).toBe("REVIEW_REQUIRED");
    config.videoFalEnabled = false;
    await expect(generateVideoFactoryFalMaster(database().client, owner, "project", network.factory, verifier.provider)).rejects.toMatchObject({ name: "PaidProviderNotSubmittedError" });
    config.videoFalEnabled = true; config.videoFalApprovedModels = [];
    await expect(generateVideoFactoryFalMaster(database().client, owner, "project", network.factory, verifier.provider)).rejects.toThrow("fal_model_not_approved");
    expect(network.submit).not.toHaveBeenCalled();
  });

  it("honors a stopped AUTO run before reserving or submitting", async () => {
    const { generateAutoFalMaster } = await import("./auto-fal");
    const db = database(), network = providers(), verifier = vision(); db.tables.auto_runs[0].state = "STOPPED";
    await expect(generateAutoFalMaster(db.client, { ownerId: owner, runId: "run", accountId: "account", projectId: "project", operationKey: "test-operation" }, network.factory, verifier.provider)).rejects.toMatchObject({ name: "PaidProviderNotSubmittedError" });
    expect(network.submit).not.toHaveBeenCalled(); expect(db.tables.generation_budget_reservations).toHaveLength(0);
  });

  it("checks stored narration bytes before purchasing footage and rejects mock assets", async () => {
    const { generateVideoFactoryFalMaster } = await import("./auto-fal");
    const network = providers(), verifier = vision();
    for (const invalid of [null, new Blob(), new Blob(["broken audio"]), new Blob([new Uint8Array(video)])]) {
      const db = database();
      if (invalid === null) db.files.delete(voicePath); else db.files.set(voicePath, invalid);
      const master = await generateVideoFactoryFalMaster(db.client, owner, "project", network.factory, verifier.provider);
      expect(customerVideoStatus(master)).toBe("REVIEW_REQUIRED");
      expect(db.tables.generation_budget_reservations).toHaveLength(0);
    }
    const mock = database();
    for (const asset of mock.tables.media_assets) asset.source_type = "MOCK";
    expect(customerVideoStatus(await generateVideoFactoryFalMaster(mock.client, owner, "project", network.factory, verifier.provider))).toBe("REVIEW_REQUIRED");
    expect(network.submit).not.toHaveBeenCalled();
  }, 60_000);

  it("keeps validated narration when the stored asset disappears after submission", async () => {
    const { generateVideoFactoryFalMaster } = await import("./auto-fal");
    const db = database(), network = providers(), verifier = vision();
    network.submit.mockImplementationOnce(async () => {
      db.files.delete(voicePath); db.tables.media_assets = db.tables.media_assets.filter(row => row.asset_type !== "VOICE");
      return { request_id: "primary-request" };
    });
    const master = await generateVideoFactoryFalMaster(db.client, owner, "project", network.factory, verifier.provider);
    expect(master).toMatchObject({ quality_status: "PASS", status: "READY" });
    expect(network.submit).toHaveBeenCalledOnce();
  }, 60_000);

  it("preserves the saved model and quality policy when recovering known submitted footage", async () => {
    const { generateVideoFactoryFalMaster } = await import("./auto-fal");
    const db = database(), network = providers(), verifier = vision();
    network.client.status = vi.fn().mockRejectedValueOnce(new Error("temporary read timeout")).mockResolvedValue({ status: "COMPLETED" });
    await expect(generateVideoFactoryFalMaster(db.client, owner, "project", network.factory, verifier.provider))
      .rejects.toMatchObject({ name: "PaidGenerationUncertainError" });
    db.tables.generation_jobs[0].started_at = new Date(Date.now() - 21 * 60_000).toISOString();
    config.videoFalPrimaryModel = FAL_MODEL_ENDPOINTS.WAN_26_FLASH; config.videoFalDurationSeconds = 10;
    config.videoFalQualityThreshold = 100;
    const master = await generateVideoFactoryFalMaster(db.client, owner, "project", network.factory, verifier.provider);
    expect(master).toMatchObject({ model: FAL_MODEL_ENDPOINTS.LTX_098_DISTILLED, duration_seconds: 8,
      quality_explanation_json: { qualityThreshold: 85 }, quality_status: "PASS" });
    expect(network.submit).toHaveBeenCalledOnce(); expect(db.tables.generation_costs).toHaveLength(1);
  }, 60_000);

  it("blocks cancellation before fallback and keeps the paid attempt accounted for", async () => {
    const { cancelVideoFactoryGeneration, generateVideoFactoryFalMaster } = await import("./auto-fal");
    const db = database(), network = providers("terminal"), verifier = vision();
    network.client.status = vi.fn(async () => {
      const master = db.tables.master_videos[0];
      await cancelVideoFactoryGeneration(db.client, owner, String(master.id), () => ({ cancel: vi.fn(async () => true) }));
      return { status: "FAILED", error: "confirmed failure" };
    });
    await expect(generateVideoFactoryFalMaster(db.client, owner, "project", network.factory, verifier.provider)).rejects.toBeDefined();
    expect(db.tables.generation_jobs[0].status).toBe("CANCELLED");
    expect(db.tables.master_videos[0]).toMatchObject({ status: "FAILED", quality_explanation_json: { cancelled: true } });
    expect(network.submit).toHaveBeenCalledOnce(); expect(db.tables.generation_costs).toHaveLength(1);
    await expect(generateVideoFactoryFalMaster(db.client, owner, "project", network.factory, verifier.provider))
      .rejects.toMatchObject({ name: "PaidProviderNotSubmittedError" });
    expect(network.submit).toHaveBeenCalledOnce();
  }, 60_000);

  it("selects source resolution at least as large as the immutable render target", async () => {
    const { generateVideoFactoryFalMaster } = await import("./auto-fal");
    const network = providers(), verifier = vision();
    config.videoFalPrimaryModel = FAL_MODEL_ENDPOINTS.LTX_23_FAST;
    config.videoFalApprovedModels = [config.videoFalPrimaryModel, config.videoFalFallbackModel];
    const noVoice = database(false);
    await generateVideoFactoryFalMaster(noVoice.client, owner, "project", network.factory, verifier.provider);
    expect(((noVoice.tables.generation_jobs[0].input_json as Row).falPolicy as { models: FalModelSettings[] }).models[0].resolution).toBe("1080p");
    config.videoFalPrimaryModel = FAL_MODEL_ENDPOINTS.LTX_098_DISTILLED;
    config.videoFalApprovedModels = [config.videoFalPrimaryModel, config.videoFalFallbackModel];
    config.videoFalResolution = "1080p";
    await expect(generateVideoFactoryFalMaster(database().client, owner, "project", network.factory, verifier.provider))
      .rejects.toThrow("fal_model_resolution_insufficient");
    expect(network.submit).not.toHaveBeenCalled();
  });

  it("rejects media from another owner's storage path before paid work", async () => {
    const { generateVideoFactoryFalMaster } = await import("./auto-fal");
    const network = providers(), verifier = vision();
    const anotherOwner = "22222222-2222-4222-8222-222222222222";
    const photo = database();
    photo.tables.media_assets[0].storage_path = videoStoragePath(anotherOwner, "products", "product", "photo.jpg");
    await expect(generateVideoFactoryFalMaster(photo.client, owner, "project", network.factory, verifier.provider)).rejects.toThrow("product_image_storage_invalid");
    const narration = database();
    narration.tables.media_assets[1].storage_path = videoStoragePath(anotherOwner, "masters", "project", "voice.wav");
    expect(customerVideoStatus(await generateVideoFactoryFalMaster(narration.client, owner, "project", network.factory, verifier.provider))).toBe("REVIEW_REQUIRED");
    expect(network.submit).not.toHaveBeenCalled();
    expect(photo.tables.generation_budget_reservations).toHaveLength(0);
    expect(narration.tables.generation_budget_reservations).toHaveLength(0);
  });

  it("checks cancellation again after uploading the image and releases a known unsent hold", async () => {
    const { cancelVideoFactoryGeneration, generateVideoFactoryFalMaster } = await import("./auto-fal");
    const db = database(), network = providers(), verifier = vision();
    network.client.upload = vi.fn(async () => {
      await cancelVideoFactoryGeneration(db.client, owner, String(db.tables.master_videos[0].id), () => ({ cancel: vi.fn(async () => true) }));
      return "https://fal.media/input.jpg";
    });
    await expect(generateVideoFactoryFalMaster(db.client, owner, "project", network.factory, verifier.provider))
      .rejects.toMatchObject({ name: "PaidProviderNotSubmittedError" });
    expect(network.submit).not.toHaveBeenCalled(); expect(db.tables.generation_costs).toHaveLength(0);
    expect(db.tables.generation_budget_reservations[0]).toMatchObject({ state: "RELEASED", provider_request_id: null });
    expect(db.tables.master_videos[0]).toMatchObject({ status: "FAILED", quality_explanation_json: { cancelled: true } });
  });

  it("dispatches the production master service through the real fal pipeline", async () => {
    const fal = await import("./auto-fal"), { buildMasterVideo } = await import("./services");
    const original = fal.generateVideoFactoryFalMaster, db = database(), network = providers(), verifier = vision();
    const boundary = vi.spyOn(fal, "generateVideoFactoryFalMaster").mockImplementation((client, ownerId, projectId, _provider, visionProvider) =>
      original(client, ownerId, projectId, network.factory, visionProvider));
    try {
      expect(await buildMasterVideo(db.client, owner, "project", verifier.provider)).toMatchObject({ provider: "fal", quality_status: "PASS" });
      expect(boundary).toHaveBeenCalledOnce(); expect(network.submit).toHaveBeenCalledOnce();
    } finally { boundary.mockRestore(); }
  }, 60_000);

  it("rejects cross-owner stored masters in the production variation service", async () => {
    const { buildVideoVariation } = await import("./services");
    const db = database(), verifier = vision();
    db.tables.master_videos.push({ id: "master", owner_id: owner, provider: "fal", quality_status: "PASS", duration_seconds: 8,
      storage_path: videoStoragePath("22222222-2222-4222-8222-222222222222", "masters", "master", "master.mp4") });
    db.tables.video_variations.push({ id: "variation", owner_id: owner, master_video_id: "master", creative_project_id: "project", status: "QUEUED" });
    await expect(buildVideoVariation(db.client, owner, "variation", verifier.provider)).rejects.toThrow("master_video_storage_invalid");
    expect(db.download).not.toHaveBeenCalled(); expect(db.tables.generation_jobs).toHaveLength(0);
  });

  it("re-verifies stored footage with its original script and immutable policy", async () => {
    const { generateVideoFactoryFalMaster, reverifyAutoFalMaster } = await import("./auto-fal");
    const db = database(), network = providers(), verifier = vision(["REVIEW", "PASS"]);
    const master = await generateVideoFactoryFalMaster(db.client, owner, "project", network.factory, verifier.provider);
    config.videoFalDurationSeconds = 10; config.videoFalQualityThreshold = 100;
    db.tables.creative_projects[0].selected_script_id = "new-script"; db.tables.creative_projects[0].selected_angle_id = "new-angle";
    const verified = await reverifyAutoFalMaster(db.client, { ownerId: owner, accountId: "account", projectId: "project", videoId: String(master.id) }, verifier.provider);
    expect(verified).toMatchObject({ selected_script_id: "script", quality_status: "PASS", duration_seconds: 8,
      quality_explanation_json: { qualityThreshold: 85, targetDurationSeconds: 8 } });
    expect((db.tables.generation_jobs[0].output_json as Row).reviewRequired).toBe(false);
    expect(network.submit).toHaveBeenCalledOnce();
  }, 60_000);

  it("rejects a malformed stored generation policy before a paid submission", async () => {
    const { generateVideoFactoryFalMaster } = await import("./auto-fal");
    const db = database(false), network = providers(), verifier = vision();
    await generateVideoFactoryFalMaster(db.client, owner, "project", network.factory, verifier.provider);
    const saved = (db.tables.generation_jobs[0].input_json as Row).falPolicy as Row;
    saved.durationSeconds = 100;
    await expect(generateVideoFactoryFalMaster(db.client, owner, "project", network.factory, verifier.provider)).rejects.toThrow("fal_job_policy_invalid");
    expect(network.submit).not.toHaveBeenCalled(); expect(db.tables.generation_budget_reservations).toHaveLength(0);
  });

  it("rejects a stored job with the wrong provider, type or project before trusting its policy", async () => {
    const { generateVideoFactoryFalMaster } = await import("./auto-fal");
    const db = database(false), network = providers(), verifier = vision();
    await generateVideoFactoryFalMaster(db.client, owner, "project", network.factory, verifier.provider);
    db.tables.media_assets.push({ id: "voice", owner_id: owner, creative_project_id: "project", asset_type: "VOICE",
      source_type: "UPLOAD", storage_path: voicePath, mime_type: "audio/wav" });
    const job = db.tables.generation_jobs[0], validIdentity = { provider: job.provider, job_type: job.job_type, creative_project_id: job.creative_project_id };
    for (const invalid of [{ provider: "local-ffmpeg" }, { job_type: "VARIATION_RENDER" }, { creative_project_id: "another-project" }]) {
      Object.assign(job, validIdentity, invalid);
      await expect(generateVideoFactoryFalMaster(db.client, owner, "project", network.factory, verifier.provider))
        .rejects.toThrow("auto_fal_job_identity_invalid");
    }
    expect(network.submit).not.toHaveBeenCalled(); expect(db.tables.generation_budget_reservations).toHaveLength(0);
  });

  it("preserves original footage and requires narration during composition", async () => {
    const { composeGeneratedVideo } = await import("./media-composition");
    const source = join(dir, "source.mp4"), output = join(dir, "invalid-master.mp4");
    await expect(composeGeneratedVideo(source, source, { durationSeconds: 8, resolution: "720p", overlay: [], preserveAudio: true }))
      .rejects.toThrow("video_composition_source_overwrite");
    await expect(composeGeneratedVideo(source, output, { durationSeconds: 4, resolution: "720p", overlay: [], preserveAudio: true }))
      .rejects.toThrow("video_duration_invalid");
    await expect(composeGeneratedVideo(source, output, { durationSeconds: 8, resolution: "720p", overlay: [], preserveAudio: true }))
      .rejects.toThrow("video_voice_unavailable");
    expect((await readFile(source)).equals(Buffer.from(video))).toBe(true);
  });
});

describe("customer presentation boundary", () => {
  it("emits only fixed customer labels despite raw provider errors and metadata", () => {
    for (const row of [ { status: "PROCESSING", provider: "fal", model: "wan/v2.6/image-to-video/flash", error: "secret" },
      { status: "READY", quality_status: "RETRY", quality_explanation_json: { reviewRequired: true, raw: "fal-ai/endpoint" } },
      { status: "FAILED", error_message: "FAL_KEY provider error" } ]) {
      expect(customerVideoStatus(row)).not.toMatch(/fal|wan|kling|endpoint|secret|key|error/i);
    }
  });
});
