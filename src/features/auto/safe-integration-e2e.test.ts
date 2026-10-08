import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignedPolicyTestFixture } from "../compliance-brain/policy-test-fixtures";
import type { ExecutionClaim } from "./processor";
import { FalWanVideoProvider, type FalWanClient } from "../video/fal-wan";
import type { FalModelSettings } from "../video/fal-models";
import { FAL_BUDGET_GUARD_VERSION } from "../video/budget-ledger";
import { MockFrameVisionProvider } from "../video/frame-verification";
import { videoStoragePath } from "../video/storage";
import type { CreativeConcept } from "../creative/schemas";

vi.mock("server-only", () => ({}));
const boundary = vi.hoisted(() => ({ admin: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => boundary.admin }));
vi.mock("@/lib/ops/logger", () => ({ logOps: vi.fn() }));
const config = vi.hoisted(() => ({ postAutomationExecutionMode: "SAFE", falKey: undefined as string | undefined,
  falWanProviderState: "PRIMARY_CANDIDATE", creativeAIProvider: "openai", openAIApiKey: "isolated-fixture-only",
  creativeAIModel: "fixture", tiktokPublishingProvider: "official", tiktokPublishingRealMode: false,
  tiktokVideoPublishApproved: false, tiktokAnalyticsProvider: "official",
  videoFalEnabled: false, videoFalPrimaryModel: "fal-ai/ltxv-13b-098-distilled/image-to-video",
  videoFalFallbackModel: "wan/v2.6/image-to-video/flash", videoFalApprovedModels: [] as string[],
  videoFalQualityThreshold: 85, videoFalMaxAttempts: 2, videoFalPerClipCapUsd: 1, videoFalPerJobCapUsd: 1,
  videoFalDailyCapUsd: 5, videoFalDurationSeconds: 8, videoFalResolution: "720p", videoProductImageAllowedHosts: [] as string[] }));
vi.mock("@/lib/server-env", () => ({ serverEnv: config }));
const { getProductRadar } = await import("../products/services");
const { persistCategoryIntelligence } = await import("../categories/services");
const { persistDailyAssignments } = await import("../assignments/services");
const { startAccountPost, stopAccountPost, saveAccountPostSchedule, tickAccountPostSchedules } = await import("./account-schedule");
const { processAutoAccount, processAutoCycle } = await import("./processor");
const { SupabaseExecutionStore } = await import("./execution-store");
const { createAutoExecutionPorts } = await import("./execution-ports");
const { buildAuthorizedPostPackage } = await import("./export-package");
const { getAutoOverview } = await import("./services");
const { mapControlCenterStages } = await import("./control-center-view");
const { evaluateProductionCompliance, commerceScope } = await import("../compliance-brain/server-runtime");

type Row = Record<string, unknown>;
const NOW = new Date("2026-10-08T06:00:00Z");
const CATEGORY = ["SKINCARE", "HOME", "ELECTRONICS"] as const;
const CLAIMS = ["ช่วยเพิ่มความชุ่มชื้น", "แก้วเซรามิกสีฟ้า", "แบตเตอรี่ความจุ 5000 mAh"];
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
let localVideo: Uint8Array, localPhoto: Uint8Array, localVoice: Uint8Array, localDir: string;
const completedProofs = new Set<string>(), mediaProofs: Row[] = [];
let browserFixture: { owner: string; tables: Record<string, Row[]> } | undefined;
beforeAll(async () => {
  completedProofs.clear(); mediaProofs.length = 0; browserFixture = undefined;
  const artifactDir = join(process.cwd(), ".video-cache", "integration-readiness");
  await mkdir(artifactDir, { recursive: true });
  // Replace an older PASS before executing any proof so a failed rerun cannot
  // leave stale evidence that appears to describe the current source.
  await writeFile(join(artifactDir, "start-export-report.json"), JSON.stringify({
    suite: "src/features/auto/safe-integration-e2e.test.ts", generatedAt: new Date().toISOString(), status: "RUNNING",
  }, null, 2));
  if (!ffmpegPath) throw new Error("local_ffmpeg_fixture_unavailable");
  localDir = await mkdtemp(join(tmpdir(), "viralflow-safe-integration-"));
  const path = join(localDir, "safe-fixture.mp4");
  await promisify(execFile)(ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=0x173349:size=720x1280:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-vf", "drawbox=x=220:y=410:w=280:h=460:color=0x65c9d8:t=fill", "-t", "8", "-c:v", "libx264", "-preset", "ultrafast",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart", path], { windowsHide: true, timeout: 30_000 });
  localVideo = new Uint8Array(await readFile(path));
  await promisify(execFile)(ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", path,
    "-frames:v", "1", join(localDir, "reference.png")], { windowsHide: true, timeout: 30_000 });
  await promisify(execFile)(ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", path,
    "-vn", "-c:a", "pcm_s16le", join(localDir, "voice.wav")], { windowsHide: true, timeout: 30_000 });
  localPhoto = new Uint8Array(await readFile(join(localDir, "reference.png")));
  localVoice = new Uint8Array(await readFile(join(localDir, "voice.wav")));
  expect(localVideo.length).toBeGreaterThan(10_000);
}, 40_000);
afterAll(async () => {
  if (completedProofs.size === 4) {
    const artifactDir = join(process.cwd(), ".video-cache", "integration-readiness");
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, "start-export-report.json"), JSON.stringify({
      generatedAt: new Date().toISOString(), suite: "src/features/auto/safe-integration-e2e.test.ts", status: "PASS",
      reproduction: "pnpm --config.verify-deps-before-run=false test src/features/auto/safe-integration-e2e.test.ts",
      proofs: [...completedProofs], categories: CATEGORY, uninterruptedAccountCount: 3, safeFixtureAccountCount: 3,
      schedulerIsolationAccountCount: 10, realPaidCalls: 0, realTikTokPostingCalls: 0,
      sourceFixtureSha256: sha(localVideo), media: mediaProofs,
      boundaries: ["in-memory database/storage transport", "Creative HTTP response", "fal upload/queue/download transport",
        "explicit synthetic frame-vision verdict", "hash-scoped synthetic media attestation"],
      limitations: ["SQL atomicity and RLS require separate database tests", "Synthetic video is not a product quality benchmark",
        "Visual review verdict does not validate scanner accuracy", "EXPORT defers remote analytics and learning; no fabricated metrics"],
    }, null, 2));
    if (browserFixture) {
      const browserDir = join(process.cwd(), ".video-benchmark", "production-readiness-browser");
      await mkdir(browserDir, { recursive: true });
      // Synthetic database rows only: no process environment, API credential,
      // private signing key or authentication token is included in this snapshot.
      await writeFile(join(browserDir, "domain-fixture.json"), JSON.stringify(browserFixture, null, 2));
    }
  } else {
    await writeFile(join(process.cwd(), ".video-cache", "integration-readiness", "start-export-report.json"), JSON.stringify({
      generatedAt: new Date().toISOString(), suite: "src/features/auto/safe-integration-e2e.test.ts",
      status: "FAILED_OR_INCOMPLETE", completedProofs: [...completedProofs], expectedProofs: 4,
    }, null, 2));
  }
  if (localDir && localDir.startsWith(join(tmpdir(), "viralflow-safe-integration-"))) await rm(localDir, { recursive: true, force: true });
});

/** Database and Storage transport fixture only. All application services, gates,
 * scheduler and processor below are the production implementations. Actual SQL
 * atomicity/RLS is exercised separately by post-database/compliance SQL tests. */
function transportFixture(count = 3) {
  const owner = randomUUID(), tables: Record<string, Row[]> = {}, files = new Map<string, Blob>();
  const runtime = { executionMode: "SAFE", onUpload: undefined as ((path: string, bytes: Uint8Array) => void) | undefined };
  const rows = (name: string) => tables[name] ??= [];
  const findState = (args: Row) => rows("auto_account_states").find(row => row.owner_id === args.p_owner_id
    && row.auto_run_id === args.p_run_id && row.tiktok_account_id === args.p_account_id);
  const rpc = vi.fn(async (name: string, args: Row = {}): Promise<{ data: unknown; error: null }> => {
    if (name === "get_post_automation_execution_mode") return { data: runtime.executionMode, error: null };
    if (name === "save_auto_creative_generation") {
      rows("creative_generations").push(args.p_generation as Row);
      rows("creative_angles").push(...args.p_angles as Row[]); rows("scripts").push(...args.p_scripts as Row[]);
      rows("creative_projects").find(row => row.id === args.p_project_id && row.owner_id === args.p_owner_id)!.status = "GENERATED";
      return { data: true, error: null };
    }
    if (name === "fal_budget_guard_version") return { data: FAL_BUDGET_GUARD_VERSION, error: null };
    if (name === "reserve_generation_budget") {
      const prior = rows("generation_budget_reservations").find(row => row.owner_id === args.p_owner_id
        && row.logical_operation_key === args.p_logical_operation_key);
      if (prior) return { data: { ...prior }, error: null };
      const hold = { id: randomUUID(), owner_id: args.p_owner_id, generation_job_id: args.p_generation_job_id, model: args.p_model,
        logical_operation_key: args.p_logical_operation_key, reserved_usd: args.p_reserved_usd, actual_usd: null,
        state: "RESERVED", provider_submission_state: "REQUEST_NOT_SENT", provider_request_id: null };
      rows("generation_budget_reservations").push(hold); return { data: { ...hold }, error: null };
    }
    if (["begin_generation_submission", "mark_generation_submitted", "mark_generation_unknown", "settle_generation_budget", "release_generation_budget"].includes(name)) {
      const hold = rows("generation_budget_reservations").find(row => row.id === args.p_reservation_id && row.owner_id === args.p_owner_id)!;
      if (name === "begin_generation_submission") { expect(hold.provider_submission_state).toBe("REQUEST_NOT_SENT"); hold.provider_submission_state = "SUBMITTING"; }
      if (name === "mark_generation_submitted") Object.assign(hold, { provider_submission_state: "SUBMITTED", provider_request_id: args.p_provider_request_id });
      if (name === "mark_generation_unknown") Object.assign(hold, { provider_submission_state: "SUBMITTED_UNKNOWN", provider_request_id: args.p_provider_request_id });
      if (name === "release_generation_budget") Object.assign(hold, { state: "RELEASED", provider_submission_state: "FAILED" });
      if (name === "settle_generation_budget") {
        if (hold.state !== "SETTLED") rows("generation_costs").push({ owner_id: owner, generation_job_id: hold.generation_job_id, total_cost_usd: args.p_actual_usd });
        Object.assign(hold, { state: "SETTLED", provider_submission_state: "CONFIRMED", actual_usd: args.p_actual_usd });
      }
      return { data: { ...hold }, error: null };
    }
    if (name === "persist_fal_master") {
      const job = rows("generation_jobs").find(row => row.id === args.p_job_id && row.owner_id === args.p_owner_id)!;
      const old = rows("master_videos").find(row => row.generation_job_id === job.id);
      if (job.attempt !== args.p_expected_attempt || job.status === "CANCELLED") return { data: { accepted: false, master: old }, error: null };
      // master_videos.created_at/updated_at default to now() in the real schema;
      // persist_fal_master intentionally omits them from its INSERT payload.
      const payload = args.p_master_payload as Row, master = old ?? {
        created_at: NOW.toISOString(), updated_at: NOW.toISOString(), ...payload,
      };
      Object.assign(master, payload, { updated_at: NOW.toISOString() }); if (!old) rows("master_videos").push(master);
      Object.assign(job, { master_video_id: master.id, output_json: { ...job.output_json as Row, ...args.p_job_output as Row, masterId: master.id },
        ...(args.p_complete ? { status: "COMPLETED", completed_at: NOW.toISOString() } : {}) });
      return { data: { accepted: true, master: { ...master } }, error: null };
    }
    if (name === "save_daily_assignments") {
      rows("account_product_scores").push(...args.p_scores as Row[]);
      for (const item of args.p_assignments as Row[]) if (!rows("product_assignments").some(old => old.tiktok_account_id === item.tiktok_account_id
        && old.assignment_date === item.assignment_date && old.rank_for_account === item.rank_for_account)) rows("product_assignments").push(item);
      return { data: true, error: null };
    }
    if (name === "upsert_post_account_schedule") {
      const input = args.p_config as Row;
      const schedule = { owner_id: args.p_owner_id, tiktok_account_id: args.p_account_id, posting_mode: input.postingMode,
        creative_mode: input.creativeMode, clips_per_day: input.clipsPerDay, active_start: input.activeStart, active_end: input.activeEnd,
        timezone: input.timezone, min_spacing_minutes: input.minSpacingMinutes, allowed_days: input.allowedDays,
        enabled: input.enabled, daily_budget_usd: input.dailyBudgetUsd, next_due_at: NOW.toISOString(), revision: 1,
        created_at: NOW.toISOString(), updated_at: NOW.toISOString() };
      rows("post_account_schedules").push(schedule); return { data: schedule, error: null };
    }
    if (name === "control_post_account") {
      const schedule = rows("post_account_schedules").find(row => row.owner_id === args.p_owner_id && row.tiktok_account_id === args.p_account_id)!;
      schedule.enabled = args.p_action !== "STOP";
      const run = rows("auto_runs").find(row => row.owner_id === args.p_owner_id && row.tiktok_account_id === args.p_account_id && row.state === "RUNNING");
      if (args.p_action === "STOP" && run) {
        run.state = "STOPPED"; const state = findState({ ...args, p_run_id: run.id }); if (state) state.state = "STOPPED";
      }
      return { data: { runId: args.p_action === "STOP" ? run?.id ?? null : run?.id ?? null, state: run?.state ?? "IDLE", enabled: schedule.enabled }, error: null };
    }
    if (name === "materialize_post_schedule_slots") {
      const schedule = rows("post_account_schedules").find(row => row.tiktok_account_id === args.p_account_id)!;
      for (const slot of args.p_slots as Row[]) if (!rows("post_schedule_slots").some(row => row.slot_key === slot.key)) rows("post_schedule_slots").push({
        owner_id: args.p_owner_id, tiktok_account_id: args.p_account_id, local_date: slot.localDate, ordinal: slot.ordinal,
        slot_key: slot.key, scheduled_at: slot.scheduledAt, expires_at: slot.expiresAt, posting_mode: schedule.posting_mode, state: "PENDING" });
      schedule.next_due_at = args.p_next_due; return { data: true, error: null };
    }
    if (name === "claim_post_schedule_slot") {
      const row = rows("post_schedule_slots").find(row => row.owner_id === args.p_owner_id && row.tiktok_account_id === args.p_account_id
        && row.state === "PENDING" && String(row.scheduled_at) <= String(args.p_now) && String(row.expires_at) > String(args.p_now));
      if (row) Object.assign(row, { state: "CLAIMED", lease_token: randomUUID() });
      return { data: row ? { ...row } : null, error: null };
    }
    if (name === "settle_post_schedule_slot") {
      const row = rows("post_schedule_slots").find(row => row.slot_key === args.p_slot_key && row.lease_token === args.p_lease_token)!;
      Object.assign(row, { state: args.p_run_id ? "COMPLETED" : "PENDING", auto_run_id: args.p_run_id, lease_token: null });
      return { data: true, error: null };
    }
    if (name === "reconcile_post_schedule_slots") return { data: 0, error: null };
    if (name === "create_operator_auto_run_atomic") {
      let run = rows("auto_runs").find(row => row.owner_id === args.p_owner_id && row.idempotency_key === args.p_idempotency_key);
      if (!run) {
        const plan = (args.p_plans as Row[])[0];
        run = { id: randomUUID(), owner_id: args.p_owner_id, tiktok_account_id: plan.accountId, run_date: args.p_run_date,
          state: "RUNNING", posting_mode: plan.postingMode, idempotency_key: args.p_idempotency_key, schedule_slot_key: plan.scheduleSlotKey,
          spent_usd: 0, budget_usd: 1, created_at: NOW.toISOString(), updated_at: NOW.toISOString() };
        rows("auto_runs").push(run);
        rows("auto_account_states").push({ id: randomUUID(), owner_id: args.p_owner_id, auto_run_id: run.id, tiktok_account_id: plan.accountId,
          state: "RUNNING", mode: plan.mode, priority: plan.priority, current_step: "FIND_OPPORTUNITY", current_item_index: 1,
          daily_target: plan.desiredPosts, generated_today: 0, published_today: 0, checkpoint_json: {}, blockers_json: [], lease_token: null });
      }
      return { data: { ...run }, error: null };
    }
    if (name === "claim_auto_execution_step") {
      const state = findState(args), run = rows("auto_runs").find(row => row.id === args.p_run_id && row.owner_id === args.p_owner_id);
      if (!state || run?.state !== "RUNNING" || state.lease_token || !["RUNNING", "WAITING_FOR_PROVIDER", "WAITING_FOR_DATA"].includes(String(state.state))) return { data: null, error: null };
      state.lease_token = randomUUID();
      const slot = rows("post_schedule_slots").find(row => row.slot_key === run.schedule_slot_key);
      return { data: { ownerId: args.p_owner_id, runId: run.id, accountId: args.p_account_id, mode: state.mode,
        postingMode: run.posting_mode, runDate: run.run_date, slotOrdinal: slot?.ordinal ?? 1, itemIndex: state.current_item_index,
        dailyTarget: state.daily_target, attempt: 1, step: state.current_step, leaseToken: state.lease_token,
        checkpoint: { ...state.checkpoint_json as Row }, operationKey: `${run.id}:${state.current_step}:${state.current_item_index}` }, error: null };
    }
    if (name === "finish_auto_execution_step") {
      const state = findState(args)!; expect(state.lease_token).toBe(args.p_lease_token);
      const evidence = args.p_evidence as Row;
      rows("auto_run_steps").push({ id: randomUUID(), owner_id: args.p_owner_id, auto_run_id: args.p_run_id,
        tiktok_account_id: args.p_account_id, step: args.p_step, state: args.p_kind === "WAIT" ? "WAITING" : "COMPLETED",
        input_json: { itemIndex: state.current_item_index }, output_json: evidence, created_at: NOW.toISOString(), completed_at: NOW.toISOString() });
      Object.assign(state, { current_step: args.p_next_step, current_item_index: args.p_next_item_index, lease_token: null,
        checkpoint_json: { ...state.checkpoint_json as Row, ...evidence, itemIndex: args.p_next_item_index },
        state: args.p_next_step === "COMPLETE" ? "COMPLETED" : args.p_kind === "WAIT" ? args.p_wait_state : "RUNNING" });
      if (args.p_step === "GENERATE_VIDEO" && args.p_kind === "ADVANCE") state.generated_today = Number(state.generated_today) + 1;
      if (args.p_next_step === "COMPLETE") rows("auto_runs").find(row => row.id === args.p_run_id)!.state = "COMPLETED";
      return { data: true, error: null };
    }
    if (name === "fail_auto_execution_step") {
      Object.assign(findState(args)!, { state: args.p_next_state, lease_token: null }); return { data: true, error: null };
    }
    if (name === "record_compliance_brain_decision") {
      const decision = args.p_decision as Row; rows("compliance_brain_decisions").push(decision); return { data: decision.id, error: null };
    }
    if (name === "read_compliance_brain_learning_observations") return { data: { snapshot_at: NOW.toISOString(), complete: true, observations: [] }, error: null };
    throw new Error(`Unexpected transport RPC: ${name}`);
  });
  const client = { rpc, from(table: string) {
    const filters: Array<(row: Row) => boolean> = [], ordering: Array<[string, boolean]> = []; let patch: Row | null = null, inserts: Row[] | null = null;
    let from = 0, to = Infinity, mutationRows: Row[] | null = null, done: { data: Row[]; error: null } | null = null;
    function response(): { data: Row[]; error: null } {
      if (done) return done;
      if (inserts) rows(table).push(...inserts.map(row => ({ id: randomUUID(), created_at: NOW.toISOString(), updated_at: NOW.toISOString(), ...row })));
      let selected = rows(table).filter(row => filters.every(test => test(row)));
      if (patch) selected.forEach(row => Object.assign(row, patch));
      selected = selected.toSorted((a, b) => { for (const [key, ascending] of ordering) {
        const c = String(a[key] ?? "").localeCompare(String(b[key] ?? "")); if (c) return ascending ? c : -c;
      } return 0; }).slice(from, to + 1);
      done = { data: inserts ? rows(table).slice(-inserts.length) : mutationRows ?? selected, error: null }; return done;
    }
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      is: (key: string, value: unknown) => { filters.push(row => (row[key] ?? null) === value); return query; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query; },
      neq: (key: string, value: unknown) => { filters.push(row => row[key] !== value); return query; },
      lte: (key: string, value: unknown) => { filters.push(row => String(row[key]) <= String(value)); return query; },
      gte: (key: string, value: unknown) => { filters.push(row => String(row[key]) >= String(value)); return query; },
      gt: (key: string, value: unknown) => { filters.push(row => String(row[key]) > String(value)); return query; },
      order: (key: string, options?: { ascending?: boolean }) => { ordering.push([key, options?.ascending !== false]); return query; },
      limit: (n: number) => { to = from + n - 1; return query; }, range: (a: number, b: number) => { from = a; to = b; return query; },
      update: (value: Row) => { patch = value; return query; }, insert: (value: Row | Row[]) => { inserts = Array.isArray(value) ? value : [value]; return query; },
      upsert: (value: Row | Row[], options: { onConflict?: string; ignoreDuplicates?: boolean } = {}) => {
        const keys = options.onConflict?.split(",") ?? ["id"];
        mutationRows = [];
        for (const row of Array.isArray(value) ? value : [value]) {
          const old = rows(table).find(old => keys.every(key => old[key] === row[key]));
          if (old) { if (!options.ignoreDuplicates) Object.assign(old, row); mutationRows.push(old); }
          else { const inserted = { id: randomUUID(), created_at: NOW.toISOString(), updated_at: NOW.toISOString(), ...row };
            rows(table).push(inserted); mutationRows.push(inserted); }
        } return query;
      },
      maybeSingle: async () => ({ data: response().data[0] ?? null, error: null }), single: async () => ({ data: response().data[0] ?? null, error: null }),
      then: (resolve: (value: ReturnType<typeof response>) => unknown) => Promise.resolve(response()).then(resolve),
    }; return query;
  }, storage: { from: () => ({ download: async (path: string) => ({ data: files.get(path) ?? null, error: null }),
    upload: async (path: string, data: Uint8Array | Blob) => {
      const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
      files.set(path, new Blob([new Uint8Array(bytes)])); runtime.onUpload?.(path, bytes); return { error: null };
    } }) } } as unknown as SupabaseClient;
  const accounts = Array.from({ length: count }, (_, index) => {
    const account = { id: randomUUID(), owner_id: owner, display_name: `Automated integration ${index + 1}`, username: `integration.${index}`,
      mode: "GROWTH", effective_mode: "GROWTH", follower_count: 2000, preferred_categories: [CATEGORY[index % 3]],
      account_status: "active", authorization_status: "authorized", is_mock: false, daily_post_target: 1, daily_post_hard_limit: 1,
      max_cost_per_video_usd: 1, daily_video_budget_usd: 1, monthly_video_budget_usd: 10, cart_enabled: false, ecommerce_permission: false };
    rows("tiktok_accounts").push(account); return account;
  });
  CATEGORY.forEach((category, index) => {
    const product = { id: randomUUID(), owner_id: owner, external_provider: "mock", external_product_id: `fixture-${index}`, slug: `fixture-${index}`,
      title: CLAIMS[index], category_key: category, current_price: 199, original_price: 299, commission_rate: .2, commission_amount: 50,
      rating: 4.8, review_count: 1000, units_sold: 4000, status: "available", first_seen_at: NOW.toISOString(), last_seen_at: NOW.toISOString(),
      product_url: "https://example.test/product" };
    rows("products").push(product);
    for (let hour = 24; hour >= 0; hour--) rows("product_snapshots").push({ id: randomUUID(), owner_id: owner, product_id: product.id,
      captured_at: new Date(NOW.getTime() - hour * 3600_000).toISOString(), price: 199, original_price: 299, commission_rate: .2,
      commission_amount: 50, rating: 4.8, review_count: 1000, units_sold: 4000 - hour * 100, status: "available", competition: .1, creative_potential: 1 });
    for (const account of accounts) rows("account_category_affinity").push({ owner_id: owner, tiktok_account_id: account.id,
      category_key: category, affinity_score: account.preferred_categories[0] === category ? 1 : 0, confidence: 1 });
  });
  const signed = createSignedPolicyTestFixture();
  vi.stubEnv("COMPLIANCE_POLICY_PUBLIC_KEYS_JSON", JSON.stringify(Object.fromEntries(Object.entries(signed.trustedKeys)
    .map(([id, key]) => [id, key.export({ format: "pem", type: "spki" }).toString()]))));
  rows("compliance_brain_policy_versions").push({ version: signed.payload.version, platform: "TIKTOK_SHOP", country: "TH", region: "TH",
    status: "ACTIVE", effective_at: "2026-01-01T00:00:00Z", activated_at: "2026-10-07T01:00:00Z", pack_json: signed.signed,
    checksum: signed.signed.checksum, signature: signed.signed.signature });
  rows("products").forEach(product => {
    const evidence = randomUUID();
    rows("compliance_brain_evidence").push({ id: evidence, owner_id: owner, product_id: product.id, kind: "PRODUCT_LABEL",
      source_url: "https://example.test/synthetic-label", source_hash: sha(String(product.title)), jurisdiction: "TH", verified: true, expires_at: null });
    rows("compliance_brain_claims").push({ id: randomUUID(), owner_id: owner, product_id: product.id, claim_text: product.title,
      claim_type: "PRODUCT_FACT", source: "synthetic verified test label", evidence_refs: [evidence], jurisdiction: "TH", verified: true,
      allowed_channels: ["POST"], expires_at: null, conditions: [], aliases: [] });
  });
  return { client, owner, accounts, tables, files, rows, rpc, runtime };
}

async function prepareSchedules(f: ReturnType<typeof transportFixture>) {
  await persistCategoryIntelligence(f.client, f.owner, NOW);
  const radar = await getProductRadar(f.client, f.owner, {}, NOW);
  expect(radar.items).toHaveLength(3); expect(radar.items.every(item => (item.score?.data_confidence ?? 0) > .8)).toBe(true);
  await persistDailyAssignments(f.client, f.owner);
  expect(f.rows("product_assignments")).toHaveLength(f.accounts.length);
  for (const account of f.accounts) await saveAccountPostSchedule(f.client, f.owner, account.id, {
    postingMode: "EXPORT", creativeMode: "GROWTH", clipsPerDay: 1, activeStart: "09:00", activeEnd: "22:00", timezone: "Asia/Bangkok",
    minSpacingMinutes: 60, allowedDays: [0, 1, 2, 3, 4, 5, 6], enabled: true, dailyBudgetUsd: 1 });
}

function preparedCreative(f: ReturnType<typeof transportFixture>, accountId: string) {
  const assignment = f.rows("product_assignments").find(row => row.tiktok_account_id === accountId)!;
  const product = f.rows("products").find(row => row.id === assignment.product_id)!;
  const project = { id: randomUUID(), owner_id: f.owner, tiktok_account_id: accountId, product_id: product.id,
    product_assignment_id: assignment.id, mode: "GROWTH", status: "SELECTED", selected_script_id: randomUUID(), selected_angle_id: randomUUID() };
  f.rows("creative_projects").push(project);
  const script = { id: project.selected_script_id, owner_id: f.owner, creative_project_id: project.id, creative_angle_id: project.selected_angle_id,
    status: "SELECTED", hook_text: product.title, voice_script: product.title, caption: product.title, cta_text: "ตรวจสอบข้อมูลสินค้า",
    hashtags_json: [], overlay_text_json: [], scene_plan_json: [{ start: 0, end: 8, visual: `fixture-${product.category_key}`, motion: "static" }] };
  f.rows("scripts").push(script);
  f.rows("creative_angles").push({ id: project.selected_angle_id, owner_id: f.owner, creative_project_id: project.id,
    is_selected: true, policy_status: "SAFE", angle_type: "DEMONSTRATION" });
  return { project, script, product };
}

function provisionReviewedVideo(f: ReturnType<typeof transportFixture>, accountId: string, bytes: Uint8Array, text?: string) {
  const source = preparedCreative(f, accountId), videoId = randomUUID(), path = `owner/${f.owner}/masters/${videoId}/video.mp4`, assetHash = sha(bytes);
  f.files.set(path, new Blob([new Uint8Array(bytes)], { type: "video/mp4" }));
  f.rows("master_videos").push({ id: videoId, owner_id: f.owner, tiktok_account_id: accountId, product_id: source.product.id,
    creative_project_id: source.project.id, selected_script_id: source.script.id, storage_path: path, provider: "local-fixture",
    status: "READY", quality_status: "PASS", quality_score: 95, quality_explanation_json: {} });
  f.rows("media_assets").push({ id: randomUUID(), owner_id: f.owner, product_id: source.product.id, asset_type: "VIDEO", storage_path: path,
    mime_type: "video/mp4", checksum: assetHash });
  const evidenceId = randomUUID();
  f.rows("compliance_brain_evidence").push({ id: evidenceId, owner_id: f.owner, product_id: source.product.id, kind: "MEDIA_REVIEW",
    source_url: "https://example.test/isolated-fixture-attestation", source_hash: assetHash, jurisdiction: "TH", verified: true, expires_at: null });
  f.rows("compliance_brain_media_reviews").push({ owner_id: f.owner, product_id: source.product.id, account_id: accountId, asset_hash: assetHash,
    evidence_id: evidenceId, transcript: text ?? source.product.title, on_screen_text: [], cover_text: "", visible_claims: [], metadata: [],
    ai_disclosed: true, coverage_complete: true, reviewed_at: NOW.toISOString(), expires_at: null });
  return { ...source, videoId };
}

const GROUNDED_FACTS = [
  ["Net weight 42 grams", "Bottle width 3 cm", "Capacity 50 ml", "White cap", "Blue packaging"],
  ["Ceramic material", "Handle width 2 cm", "Capacity 350 ml", "Round base", "Blue finish"],
  ["Battery capacity 5000 mAh", "Cable length 15 cm", "Weight 100 grams", "USB connector", "Black casing"],
];
function structuredCreativeFixture(facts: string[]): { concepts: CreativeConcept[] } {
  const angles = ["POV", "MUST_HAVE", "PROBLEM_SOLUTION", "DEMONSTRATION", "COMPARISON"] as const;
  const ctas = ["ตรวจสอบข้อมูลสินค้า", "ดูรายละเอียดสินค้า", "ขอบคุณที่รับชม"];
  return { concepts: facts.map((fact, index) => ({ angleType: angles[index], title: fact, hook: fact, coreMessage: fact,
    voiceScript: fact, overlayText: [{ start: 0, end: 2, text: fact }],
    scenePlan: [{ start: 0, end: 2, visual: `${fact} initial closeup`, motion: "push" },
      { start: 2, end: 5, visual: `${fact} product detail`, motion: "pan" },
      { start: 5, end: 8, visual: `${fact} closing shot`, motion: "hold" }],
    cta: ctas[index % 3], caption: fact, hashtags: ["#สินค้า", "#รายละเอียด"], visualStrategy: fact,
    modelSignals: { hookStrength: 95 - index, novelty: 90 - index, visualFeasibility: 95 } })) };
}
function addFixtureClaim(f: ReturnType<typeof transportFixture>, productId: string, fact: string) {
  const evidenceId = randomUUID();
  f.rows("compliance_brain_evidence").push({ id: evidenceId, owner_id: f.owner, product_id: productId, kind: "PRODUCT_LABEL",
    source_url: "https://example.test/synthetic-label", source_hash: sha(fact), jurisdiction: "TH", verified: true, expires_at: null });
  f.rows("compliance_brain_claims").push({ id: randomUUID(), owner_id: f.owner, product_id: productId, claim_text: fact,
    claim_type: "PRODUCT_FACT", source: "synthetic verified label for isolated transport test", evidence_refs: [evidenceId],
    jurisdiction: "TH", verified: true, allowed_channels: ["POST"], expires_at: null, conditions: [], aliases: [] });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_integration_fixture_only");
  config.postAutomationExecutionMode = "SAFE";
  config.falKey = undefined; config.falWanProviderState = "PRIMARY_CANDIDATE"; config.videoFalEnabled = false;
});
afterEach(() => { boundary.admin = null; config.postAutomationExecutionMode = "SAFE";
  vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("production START-to-EXPORT application path using isolated transports", () => {
  it("executes one uninterrupted production orchestration per category with actual Creative/fal adapters and fixture network responses", async () => {
    const f = transportFixture(); boundary.admin = f.client;
    // LIVE and approvals exist only in this isolated test's in-memory transport/config.
    // No remote config, credential, paid API or TikTok API is accessed.
    f.runtime.executionMode = "LIVE"; config.postAutomationExecutionMode = "LIVE";
    config.falKey = "isolated-fixture-only"; config.falWanProviderState = "PRODUCTION_APPROVED";
    config.videoFalEnabled = true; config.videoFalApprovedModels = [config.videoFalPrimaryModel, config.videoFalFallbackModel];
    let currentFacts = GROUNDED_FACTS[0];
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url) !== "https://api.openai.com/v1/responses" || init?.method !== "POST") throw new Error("external_network_forbidden");
      const request = JSON.parse(String(init.body)) as { input: string };
      expect(request.input).toContain("Compliance constraints");
      return new Response(JSON.stringify({ output_text: JSON.stringify(structuredCreativeFixture(currentFacts)),
        usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200 });
    });
    await prepareSchedules(f);
    f.rows("products").forEach((product, index) => [...GROUNDED_FACTS[index], "#สินค้า", "#รายละเอียด"]
      .forEach(fact => addFixtureClaim(f, String(product.id), fact)));
    const submit = vi.fn(async () => ({ request_id: randomUUID() }));
    const client: FalWanClient = { upload: vi.fn(async () => "https://v3b.fal.media/fixture-reference.png"), submit,
      status: vi.fn(async () => ({ status: "COMPLETED" })), result: vi.fn(async (_model, requestId) => ({ requestId,
        data: { video: { url: "https://v3b.fal.media/fixture.mp4", duration: 8 } } })) };
    const download = vi.fn(async () => new Response(new Uint8Array(localVideo), { status: 200, headers: { "Content-Type": "video/mp4" } }));
    const factory = (settings: FalModelSettings) => new FalWanVideoProvider({ apiKey: config.falKey, settings, client,
      fetchImpl: download as typeof fetch, sleep: async () => {}, pollIntervalMs: 0, maxPollAttempts: 1, readRetryAttempts: 0 });
    // An explicitly synthetic vision verdict is injected only at the external
    // vision boundary. Production extraction verifies three actual JPEG frames.
    // This proves wiring/gates, not visual scanner accuracy or product fidelity.
    const vision = new MockFrameVisionProvider();
    f.runtime.onUpload = (path, bytes) => {
      if (!/master-\d+\.mp4$/.test(path)) return;
      const job = f.rows("generation_jobs").find(row => path.includes(String(row.id)))!;
      const project = f.rows("creative_projects").find(row => row.id === job.creative_project_id)!;
      const script = f.rows("scripts").find(row => row.id === project.selected_script_id)!;
      const hash = sha(bytes), evidenceId = randomUUID();
      // Hash-scoped media attestation at the DB transport; actual policy engine
      // must still evaluate every scanned text and the current Claim Ledger.
      f.rows("compliance_brain_evidence").push({ id: evidenceId, owner_id: f.owner, product_id: project.product_id, kind: "MEDIA_REVIEW",
        source_url: "https://example.test/isolated-media-review", source_hash: hash, jurisdiction: "TH", verified: true, expires_at: null });
      f.rows("compliance_brain_media_reviews").push({ owner_id: f.owner, product_id: project.product_id, account_id: project.tiktok_account_id,
        asset_hash: hash, evidence_id: evidenceId, transcript: script.voice_script, on_screen_text: [script.hook_text, script.cta_text],
        cover_text: "", visible_claims: [], metadata: [], ai_disclosed: true, coverage_complete: true, reviewed_at: NOW.toISOString(), expires_at: null });
    };
    for (const account of f.accounts) {
      const start = await startAccountPost(f.client, f.owner, account.id, "full-fixture-start");
      const runId = start.run!.id;
      let store = new SupabaseExecutionStore(f.client, f.owner), ports = createAutoExecutionPorts(f.client, { falProvider: factory, visionProvider: vision });
      expect(await processAutoAccount(store, ports, runId, account.id, "fixture-worker")).toMatchObject({ status: "ADVANCE", step: "FIND_OPPORTUNITY" });
      const state = f.rows("auto_account_states").find(row => row.tiktok_account_id === account.id)!;
      const productId = String((state.checkpoint_json as Row).productId);
      const product = f.rows("products").find(row => row.id === productId)!;
      currentFacts = GROUNDED_FACTS[CATEGORY.indexOf(product.category_key as typeof CATEGORY[number])];
      expect(await processAutoAccount(store, ports, runId, account.id, "fixture-worker"), JSON.stringify(f.rows("creative_generations")))
        .toMatchObject({ status: "ADVANCE", step: "CREATE_CREATIVE" });
      const projectId = String((state.checkpoint_json as Row).projectId);
      const photoPath = videoStoragePath(f.owner, "products", productId, "reference.png"), voicePath = videoStoragePath(f.owner, "masters", projectId, "voice.wav");
      f.files.set(photoPath, new Blob([new Uint8Array(localPhoto)], { type: "image/png" }));
      f.files.set(voicePath, new Blob([new Uint8Array(localVoice)], { type: "audio/wav" }));
      f.rows("media_assets").push({ id: randomUUID(), owner_id: f.owner, product_id: productId, asset_type: "PRODUCT_IMAGE", source_type: "UPLOAD", storage_path: photoPath, mime_type: "image/png" },
        { id: randomUUID(), owner_id: f.owner, creative_project_id: projectId, asset_type: "VOICE", source_type: "UPLOAD", storage_path: voicePath, mime_type: "audio/wav" });
      expect(await processAutoAccount(store, ports, runId, account.id, "fixture-worker"), JSON.stringify(f.rows("generation_jobs")))
        .toMatchObject({ status: "ADVANCE", step: "GENERATE_VIDEO" });
      // Restart after a durable real media result, with no reset or substituted stage.
      store = new SupabaseExecutionStore(f.client, f.owner); ports = createAutoExecutionPorts(f.client, { falProvider: factory, visionProvider: vision });
      const rest = await processAutoCycle(store, ports, runId, "resumed-fixture-worker", 9);
      expect(rest.results.map(result => result.status), JSON.stringify(f.rows("compliance_brain_decisions"))).toEqual(Array(6).fill("ADVANCE"));
      expect(state.state).toBe("COMPLETED");
      const master = f.rows("master_videos").find(row => row.creative_project_id === projectId)!;
      expect(master).toMatchObject({ quality_status: "PASS", width: 720, height: 1280, duration_seconds: 8 });
      const output = f.rows("post_outputs").find(row => row.tiktok_account_id === account.id)!;
      const zip = await buildAuthorizedPostPackage(f.client, f.owner, String(output.id));
      const normalized = f.files.get(String(master.storage_path))!;
      const normalizedBytes = new Uint8Array(await normalized.arrayBuffer());
      expect(zip.includes(Buffer.from(normalizedBytes))).toBe(true);
      mediaProofs.push({ account: `isolated-account-${mediaProofs.length + 1}`, category: product.category_key,
        width: master.width, height: master.height, durationSeconds: master.duration_seconds, qualityScore: master.quality_score,
        qualityVerdictSource: "explicit synthetic frame-vision boundary", normalizedSha256: sha(normalizedBytes),
        zipSha256: sha(zip), sourceSizeBytes: localVideo.length, normalizedSizeBytes: normalizedBytes.length, zipSizeBytes: zip.length });
      const steps = f.rows("auto_run_steps").filter(row => row.auto_run_id === runId);
      expect(steps.map(row => row.step)).toEqual(["FIND_OPPORTUNITY", "CREATE_CREATIVE", "GENERATE_VIDEO", "QUALITY_CHECK", "COMPLIANCE_CHECK", "QUEUE_PUBLISH", "PUBLISH", "COLLECT_ANALYTICS", "LEARN"]);
      expect(steps.find(row => row.step === "COLLECT_ANALYTICS")?.output_json).toMatchObject({ analyticsDeferred: true });
    }
    expect(network).toHaveBeenCalledTimes(3); expect(submit).toHaveBeenCalledTimes(3); expect(download).toHaveBeenCalledTimes(3);
    expect(vision.inputs).toHaveLength(3); expect(vision.inputs.every(input => input.frames.length === 3)).toBe(true);
    expect(f.rows("creative_generations")).toHaveLength(3); expect(f.rows("scripts")).toHaveLength(15);
    expect(f.rows("generation_jobs").every(row => row.status === "COMPLETED")).toBe(true);
    expect(f.rows("generation_budget_reservations")).toHaveLength(3);
    expect(f.rows("generation_budget_reservations").every(row => row.state === "SETTLED")).toBe(true);
    expect(f.rows("post_outputs")).toHaveLength(3);
    expect((await getAutoOverview(f.client, f.owner)).summary).toMatchObject({ generatedToday: 3, publishedToday: 0 });
    browserFixture = { owner: f.owner, tables: f.tables };
    config.postAutomationExecutionMode = "SAFE"; f.runtime.executionMode = "SAFE";
    expect(config.postAutomationExecutionMode).toBe("SAFE"); // Restore the isolated fixture; remote/default SAFE is never changed.
    completedProofs.add("Three full production service runs from START through actual media composition to EXPORT/deferred analytics");
  }, 120_000);

  it("runs three account/category plans, holds SAFE generation, then resumes reviewed fixture checkpoints to real export bytes", async () => {
    const f = transportFixture(); boundary.admin = f.client;
    const outbound = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("external_network_forbidden"));
    await prepareSchedules(f);
    const prepared = f.accounts.map(account => preparedCreative(f, account.id));
    const starts = await Promise.all(f.accounts.map(account => startAccountPost(f.client, f.owner, account.id, "isolated-start")));
    expect(starts.map(result => result.run?.id)).toHaveLength(3);
    expect(new Set(f.rows("auto_runs").map(row => row.tiktok_account_id)).size).toBe(3);
    const ports = createAutoExecutionPorts(f.client);
    for (const result of starts) {
      const run = result.run!;
      const store = new SupabaseExecutionStore(f.client, f.owner);
      const first = await processAutoCycle(store, ports, run.id, "worker-before-restart", 9);
      expect(first.results.map(row => row.step)).toEqual(["FIND_OPPORTUNITY", "CREATE_CREATIVE", "GENERATE_VIDEO"]);
      expect(first.results.at(-1)?.status).toBe("WAIT");
    }
    expect(f.rows("post_outputs")).toHaveLength(0);
    // Simulate a separately completed, attested local fixture at the durable
    // provider-result boundary. No gate or application stage is replaced.
    for (const [index, account] of f.accounts.entries()) {
      const source = prepared[index];
      const bytes = localVideo;
      const video = provisionReviewedVideo(f, account.id, bytes);
      // Reuse the selected project that CREATE_CREATIVE recorded, not a new orchestration path.
      const master = f.rows("master_videos").at(-1)!; master.creative_project_id = source.project.id; master.selected_script_id = source.script.id;
      const state = f.rows("auto_account_states").find(row => row.tiktok_account_id === account.id)!;
      const run = f.rows("auto_runs").find(row => row.id === state.auto_run_id)!;
      Object.assign(state, { state: "RUNNING", current_step: "QUALITY_CHECK", generated_today: 1,
        checkpoint_json: { ...state.checkpoint_json as Row, videoId: video.videoId } });
      const resumed = await processAutoCycle(new SupabaseExecutionStore(f.client, f.owner), createAutoExecutionPorts(f.client), String(run.id), "worker-after-restart", 12);
      expect(resumed.results, JSON.stringify(f.rows("compliance_brain_decisions"))).toEqual(expect.arrayContaining([{ status: "ADVANCE", step: "LEARN", nextStep: "COMPLETE" }]));
      expect(state.state).toBe("COMPLETED");
      const output = f.rows("post_outputs").find(row => row.tiktok_account_id === account.id)!;
      expect(output).toMatchObject({ status: "READY", posting_mode: "EXPORT", video_id: video.videoId });
      const zip = await buildAuthorizedPostPackage(f.client, f.owner, String(output.id));
      expect(zip.readUInt32LE()).toBe(0x04034b50); expect(zip.includes(Buffer.from(bytes))).toBe(true);
      expect(zip.toString()).toContain("video.mp4"); expect(zip.toString()).not.toContain(f.owner);
      const steps = f.rows("auto_run_steps").filter(row => row.auto_run_id === run.id);
      expect(steps.find(row => row.step === "COLLECT_ANALYTICS")?.output_json).toMatchObject({ analyticsDeferred: true });
      expect(mapControlCenterStages({ steps: steps as never, currentStep: String(state.current_step), currentState: String(state.state),
        checkpoint: state.checkpoint_json as Row }).find(stage => stage.id === "QUALITY")?.state).toBe("completed");
    }
    const overview = await getAutoOverview(f.client, f.owner);
    expect(overview.summary).toMatchObject({ generatedToday: 3, publishedToday: 0, costToday: 0 });
    expect(f.rows("post_outputs")).toHaveLength(3); expect(f.rows("compliance_brain_decisions").every(row => ["PASS", "WARNING"].includes(String(row.decision)))).toBe(true);
    const replay = await tickAccountPostSchedules(f.client, 10, NOW);
    expect(replay.runs).toHaveLength(0); expect(f.rows("auto_runs")).toHaveLength(3);
    expect(outbound).not.toHaveBeenCalled(); expect(config.postAutomationExecutionMode).toBe("SAFE");
    completedProofs.add("SAFE provider hold, reviewed fixture resume, restart persistence and real dashboard aggregation");
  });

  it("isolates START/STOP and simultaneous claims across ten account schedules without raising daily targets", async () => {
    const f = transportFixture(10); boundary.admin = f.client;
    // Schedule/isolation does not require generation or product assignment fixtures.
    for (const account of f.accounts) await saveAccountPostSchedule(f.client, f.owner, account.id, { postingMode: "EXPORT", creativeMode: "GROWTH",
      clipsPerDay: 1, activeStart: "09:00", activeEnd: "22:00", timezone: "Asia/Bangkok", minSpacingMinutes: 60,
      allowedDays: [0, 1, 2, 3, 4, 5, 6], enabled: true, dailyBudgetUsd: 1 });
    const initial = await tickAccountPostSchedules(f.client, 10, NOW);
    expect(initial.runs).toHaveLength(10);
    const stopped = f.accounts[0].id; await stopAccountPost(f.client, f.owner, stopped);
    expect(f.rows("auto_account_states").filter(row => row.state === "STOPPED").map(row => row.tiktok_account_id)).toEqual([stopped]);
    expect(f.rows("auto_account_states").filter(row => row.state === "RUNNING")).toHaveLength(9);
    const runId = String(f.rows("auto_runs").find(row => row.tiktok_account_id === f.accounts[1].id)!.id);
    const store = new SupabaseExecutionStore(f.client, f.owner);
    const claims = await Promise.all([store.claim(runId, f.accounts[1].id, "one"), store.claim(runId, f.accounts[1].id, "two")]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await new SupabaseExecutionStore(f.client, f.owner).claim(initial.runs[0].id, stopped, "stopped-worker")).toBeNull();
    const again = await tickAccountPostSchedules(f.client, 10, NOW);
    expect(again.runs).toHaveLength(0); expect(f.rows("auto_runs")).toHaveLength(10);
    expect(f.rows("post_schedule_slots")).toHaveLength(10); expect(f.rows("auto_account_states").every(row => row.daily_target === 1)).toBe(true);
    completedProofs.add("Ten account START/STOP isolation, simultaneous claim, duplicate slot prevention and daily target");
  });

  it("blocks unsafe final media and refuses visually unverified content while safe rewrite is rescanned", async () => {
    const f = transportFixture(); boundary.admin = f.client;
    await prepareSchedules(f);
    const account = f.accounts[0], product = f.rows("products").find(row => row.category_key === "SKINCARE")!;
    const scope = commerceScope(f.owner, String(product.id), account.id, "SKINCARE");
    const rewritten = await evaluateProductionCompliance(f.client, { scope, stage: "PRE_GENERATION",
      content: { script: "วัสดุเป็นทองแท้" } }, true);
    expect(rewritten.decision.rewrites.length).toBeGreaterThan(0);
    expect(rewritten.input.content.script).not.toContain("วัสดุเป็นทองแท้");
    const rescanned = await evaluateProductionCompliance(f.client, { scope, stage: "PRE_GENERATION", content: rewritten.input.content });
    expect(rescanned.decision.status).toBe("PASS");
    const bytes = localVideo, video = provisionReviewedVideo(f, account.id, bytes, "รักษาสิวหายขาด");
    const started = await startAccountPost(f.client, f.owner, account.id, "unsafe-case");
    const state = f.rows("auto_account_states").find(row => row.tiktok_account_id === account.id)!;
    Object.assign(state, { current_step: "COMPLIANCE_CHECK", checkpoint_json: { projectId: video.project.id, productId: video.product.id,
      scriptId: video.script.id, videoId: video.videoId } });
    const result = await processAutoAccount(new SupabaseExecutionStore(f.client, f.owner), createAutoExecutionPorts(f.client), started.run!.id, account.id, "unsafe-worker");
    expect(result.status).toBe("SKIP_ITEM"); expect(f.rows("post_outputs")).toHaveLength(0);
    expect(f.rows("compliance_brain_decisions").some(row => row.decision === "BLOCK")).toBe(true);
    f.rows("compliance_brain_media_reviews").length = 0;
    vi.setSystemTime(new Date(NOW.getTime() + 1000));
    const claim: ExecutionClaim = { ownerId: f.owner, accountId: account.id, runId: started.run!.id, mode: "GROWTH", postingMode: "EXPORT",
      step: "COMPLIANCE_CHECK", dailyTarget: 1, itemIndex: 1, attempt: 1, leaseToken: "fixture", operationKey: "fixture",
      checkpoint: { videoId: video.videoId } };
    expect(await createAutoExecutionPorts(f.client).COMPLIANCE_CHECK(claim)).toMatchObject({ kind: "WAIT", reason: "COMPLIANCE_REVIEW" });
    expect(f.rows("post_outputs")).toHaveLength(0);
    completedProofs.add("Unsupported fact rewritten and rescanned; unsafe final media blocked; unverified visual content waits");
  });
});
