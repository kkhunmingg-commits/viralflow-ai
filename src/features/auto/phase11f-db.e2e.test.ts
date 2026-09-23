import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ffmpegPath from "ffmpeg-static";
import { describe, expect, it, vi } from "vitest";
import { assignmentDate } from "@/features/assignments/planner";

vi.mock("server-only", () => ({}));

const enabled = process.env.PHASE11F_DB_E2E === "1";
const day = () => assignmentDate(new Date().toISOString());
const uuid = () => randomUUID();

function must<T>(data: T | null, error: { message: string } | null, where: string): T {
  if (error || data === null) throw new Error(`${where}: ${error?.message ?? "missing"}`);
  return data;
}

async function ffmpeg(args: string[]) {
  const binary = ffmpegPath;
  if (!binary) throw new Error("ffmpeg-static unavailable");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...args],
      { windowsHide: true });
    let stderr = "";
    child.stdout.resume();
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + String(chunk)).slice(-600); });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`fixture_ffmpeg_failed:${stderr}`)));
  });
}

async function mediaFixture(dir: string) {
  const image = join(dir, "reference.png");
  const video = join(dir, "source.mp4");
  await ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=540x960:rate=30", "-frames:v", "1", image]);
  await ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=540x960:rate=30",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "8",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart", video]);
  return { image: new Uint8Array(await readFile(image)), video: new Uint8Array(await readFile(video)) };
}

async function insert(admin: SupabaseClient, table: string, row: Record<string, unknown>) {
  const result = await admin.from(table).insert(row).select("*").single();
  return must(result.data as Record<string, unknown> | null, result.error, `insert_${table}`);
}

async function count(admin: SupabaseClient, table: string, ownerId: string) {
  const result = await admin.from(table).select("id", { count: "exact", head: true }).eq("owner_id", ownerId);
  if (result.error) throw new Error(`count_${table}:${result.error.message}`);
  return result.count ?? 0;
}

async function seed(admin: SupabaseClient, ownerId: string, tag: string, image: Uint8Array, storagePaths: Set<string>) {
  const now = new Date().toISOString();
  const account = await insert(admin, "tiktok_accounts", {
    owner_id: ownerId, display_name: `Phase 11F ${tag}`, username: `e2e.${tag}`,
    open_id: `e2e-open-${tag}`, mode: "GROWTH", account_status: "active",
    authorization_status: "authorized", connection_status: "READY_FOR_DIRECT_POST", is_mock: false,
    daily_post_target: 1, daily_post_hard_limit: 1, max_cost_per_video_usd: 1,
    daily_video_budget_usd: 1, monthly_video_budget_usd: 10,
    granted_scopes: ["user.info.basic", "video.publish", "video.upload", "video.list"],
    direct_post_status: "READY", upload_status: "READY",
    video_publish_approval_status: "APPROVED", video_upload_approval_status: "APPROVED",
    audit_status: "AUDITED", privacy_level_options: ["SELF_ONLY"],
    creator_info_sync_at: now, creator_info_cache_expires_at: new Date(Date.now() + 3600_000).toISOString(),
  });
  const accountId = String(account.id);
  await insert(admin, "account_publish_health", {
    owner_id: ownerId, tiktok_account_id: accountId, requested_mode: "GROWTH", effective_mode: "GROWTH",
    account_status: "READY", authorization_status: "authorized", daily_target: 1,
    daily_hard_limit: 1, effective_publish_cap: 1, health_status: "READY", blockers_json: [],
  });
  const product = await insert(admin, "products", {
    owner_id: ownerId, external_provider: "e2e", external_product_id: tag,
    title: "Blue ceramic cup", slug: `blue-cup-${tag}`, category_key: "home",
    current_price: 199, commission_rate: 0, commission_amount: 0,
    review_count: 100, units_sold: 100, status: "available",
    first_seen_at: now, last_seen_at: now,
  });
  const productId = String(product.id);
  const score = await insert(admin, "account_product_scores", {
    owner_id: ownerId, tiktok_account_id: accountId, product_id: productId, run_id: uuid(),
    calculated_at: now, product_component: 80, category_component: 80,
    account_category_component: 80, commercial_component: 80, mode_fit_component: 80,
    confidence_component: 80, freshness_component: 80, competition_component: 80,
    account_product_fit_score: 80, final_viral_opportunity_score: 80,
    effective_mode: "GROWTH", eligible: true, score_version: "e2e-v1", explanation_json: {},
  });
  await insert(admin, "product_assignments", {
    owner_id: ownerId, tiktok_account_id: accountId, product_id: productId,
    category_key: "home", score_id: score.id, assignment_date: day(), rank_for_account: 1,
    effective_mode: "GROWTH", final_score: 80, status: "CANDIDATE",
    score_version: "e2e-v1", reason_json: { fixture: "phase11f-db-e2e" },
  });
  const imagePath = `owner/${ownerId}/products/${productId}/reference.png`;
  storagePaths.add(imagePath);
  const uploaded = await admin.storage.from("video-assets").upload(imagePath, image,
    { contentType: "image/png", upsert: false });
  if (uploaded.error) throw new Error(`reference_upload:${uploaded.error.message}`);
  await insert(admin, "media_assets", {
    owner_id: ownerId, product_id: productId, asset_type: "PRODUCT_IMAGE", source_type: "UPLOAD",
    storage_path: imagePath, mime_type: "image/png", width: 540, height: 960,
    provider: "e2e", model: "ffmpeg-testsrc2",
    checksum: createHash("sha256").update(image).digest("hex"),
  });
  return { accountId, productId, imagePath };
}

async function clean(admin: SupabaseClient, ownerId: string, storagePaths: Set<string>) {
  const failures: string[] = [];
  const assets = await admin.from("media_assets").select("storage_path").eq("owner_id", ownerId);
  if (assets.error) failures.push("asset_query");
  const paths = new Set([...storagePaths, ...(assets.data ?? []).map(row => row.storage_path)].filter(Boolean));
  const collect = async (prefix: string, depth: number): Promise<void> => {
    if (depth > 5) { failures.push("asset_tree_depth"); return; }
    const listed = await admin.storage.from("video-assets").list(prefix, { limit: 1000 });
    if (listed.error) { failures.push("asset_tree_list"); return; }
    for (const row of listed.data ?? []) {
      const path = `${prefix}/${row.name}`;
      if (row.id) paths.add(path);
      else await collect(path, depth + 1);
    }
  };
  await collect(`owner/${ownerId}`, 0);
  if (paths.size) {
    const removed = await admin.storage.from("video-assets").remove([...paths]);
    if (removed.error) failures.push("asset_remove");
  }
  const deleted = await admin.auth.admin.deleteUser(ownerId);
  if (deleted.error) {
    // These writes are constrained to the newly created test owner. Cascades remove child rows.
    for (const table of ["growth_account_snapshots", "learning_decisions", "winner_scores",
      "video_analytics_snapshots", "publish_consents", "publishing_queue", "publish_eligibility_checks",
      "originality_checks", "content_compliance_checks", "auto_checkpoints", "auto_failures",
      "auto_actions", "auto_run_steps", "auto_account_states", "auto_runs", "master_videos",
      "generation_jobs", "generation_budget_reservations", "media_assets", "creative_generations",
      "scripts", "creative_angles", "creative_projects", "product_assignments",
      "account_product_scores", "account_publish_health", "tiktok_oauth_credentials",
      "tiktok_accounts", "products"]) {
      await admin.from(table).delete().eq("owner_id", ownerId);
    }
    await admin.from("profiles").delete().eq("id", ownerId);
    const retry = await admin.auth.admin.deleteUser(ownerId);
    if (retry.error) failures.push(`admin_delete:${retry.error.code ?? "unknown"}`);
  }
  for (const table of ["profiles", "tiktok_accounts", "products", "auto_runs", "media_assets",
    "generation_jobs", "generation_budget_reservations", "publishing_queue", "video_analytics_snapshots", "winner_scores",
    "learning_decisions", "growth_account_snapshots"]) {
    const result = await admin.from(table).select("id", { count: "exact", head: true })
      .eq(table === "profiles" ? "id" : "owner_id", ownerId);
    if (result.error || result.count !== 0) failures.push(`residual_${table}`);
  }
  if (failures.length) {
    const logPath = join(tmpdir(), `phase11f-e2e-cleanup-needed-${ownerId}.json`);
    await writeFile(logPath, JSON.stringify({ ownerId, failures, paths: [...paths] }), "utf8");
    throw new Error(`phase11f_e2e_cleanup_failed:${failures.join(",")}; details in ${logPath}`);
  }
}

describe.runIf(enabled)("Phase 11F database-backed operator START", () => {
  it("runs real service and database boundaries with external networks mocked, then removes all fixtures", async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
      process.loadEnvFile?.(".env.local");
    }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!url || !secret) throw new Error("Supabase E2E credentials unavailable");
    const supabaseOrigin = new URL(url).origin;
    if (!supabaseOrigin.endsWith(".supabase.co")) throw new Error("unexpected Supabase project URL");

    // All provider configuration is synthetic in this process. No real paid key is used.
    const fakeFalKey = "phase11f-e2e-fal-key-never-send";
    process.env.FAL_KEY = fakeFalKey;
    process.env.FAL_WAN_PROVIDER_STATE = "PRODUCTION_APPROVED";
    process.env.CREATIVE_AI_PROVIDER = "mock";
    process.env.TIKTOK_PROVIDER = "official";
    process.env.TIKTOK_CLIENT_KEY = "phase11f-e2e";
    process.env.TIKTOK_CLIENT_SECRET = "phase11f-e2e-secret";
    process.env.TIKTOK_REDIRECT_URI = "https://example.invalid/auth/tiktok/callback";
    process.env.TIKTOK_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
    process.env.TIKTOK_PUBLISHING_PROVIDER = "official";
    process.env.TIKTOK_PUBLISHING_REAL_MODE = "true";
    process.env.TIKTOK_ANALYTICS_PROVIDER = "official";
    process.env.TIKTOK_ANALYTICS_REAL_MODE = "true";
    process.env.TIKTOK_VIDEO_PUBLISH_APPROVED = "true";
    process.env.TIKTOK_VIDEO_UPLOAD_APPROVED = "true";
    process.env.TIKTOK_DIRECT_POST_AUDIT_STATUS = "AUDITED";
    process.env.APP_ENV = "production";
    process.env.APP_URL = "https://example.invalid";
    process.env.VIDEO_BENCHMARK_ALLOW_PAID = "false";

    const nativeFetch = globalThis.fetch;
    let directSubmissions = 0, analyticsQueries = 0, creatorQueries = 0, unexpectedExternal = 0;
    const postId = "1234567890123456";
    globalThis.fetch = async (input, init) => {
      const requestUrl = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
      if (requestUrl.origin === supabaseOrigin) return nativeFetch(input, init);
      if (requestUrl.hostname === "open-upload.tiktokapis.com" && requestUrl.pathname.startsWith("/phase11f-e2e/")) {
        return new Response(null, { status: 200 });
      }
      if (requestUrl.hostname === "open.tiktokapis.com") {
        if (requestUrl.pathname === "/v2/post/publish/creator_info/query/") {
          creatorQueries++;
          return Response.json({ data: { creator_username: "phase11f.e2e", creator_nickname: "Phase 11F E2E",
            privacy_level_options: ["SELF_ONLY"], comment_disabled: false, duet_disabled: false,
            stitch_disabled: false, max_video_post_duration_sec: 600 }, error: { code: "ok" } });
        }
        if (requestUrl.pathname === "/v2/post/publish/video/init/") {
          directSubmissions++;
          return Response.json({ data: { publish_id: "phase11f-publish-1",
            upload_url: "https://open-upload.tiktokapis.com/phase11f-e2e/upload" }, error: { code: "ok" } });
        }
        if (requestUrl.pathname === "/v2/post/publish/status/fetch/") {
          return Response.json({ data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [postId],
            uploaded_bytes: 0 }, error: { code: "ok" } });
        }
        if (requestUrl.pathname === "/v2/video/query/") {
          analyticsQueries++;
          return Response.json({ data: { videos: [{ id: postId, create_time: Math.floor(Date.now() / 1000) - 3 * 3600,
            view_count: 5000, like_count: 700, comment_count: 90, share_count: 180 }] }, error: { code: "ok" } });
        }
      }
      unexpectedExternal++;
      throw new Error(`unexpected_external_network:${requestUrl.hostname}`);
    };

    const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: globalThis.fetch } });
    const workspace = await mkdtemp(join(tmpdir(), "phase11f-db-e2e-"));
    let ownerId: string | null = null;
    const storagePaths = new Set<string>();
    let testFailure: unknown;
    try {
      const tag = uuid().replaceAll("-", "").slice(0, 12);
      const media = await mediaFixture(workspace);
      const created = await admin.auth.admin.createUser({ email: `phase11f-e2e-${tag}@example.invalid`,
        password: randomBytes(24).toString("base64url"), email_confirm: true,
        user_metadata: { display_name: "Phase 11F E2E" } });
      ownerId = must(created.data.user?.id ?? null, created.error, "admin_create_user");
      const profile = await admin.from("profiles").select("id").eq("id", ownerId).maybeSingle();
      must(profile.data, profile.error, "profile_trigger");
      const fixture = await seed(admin, ownerId, tag, media.image, storagePaths);

      const { createAutoRun, transitionAutoRun } = await import("./services");
      const { runAutoExecutionCycle } = await import("./execution-service");
      const { FalWanVideoProvider, FAL_WAN_ENDPOINT } = await import("@/features/video/fal-wan");
      const { MockFrameVisionProvider } = await import("@/features/video/frame-verification");
      const { TikTokTokenService } = await import("@/features/tiktok/services");
      const { OfficialTikTokPublishingProvider } = await import("@/features/publishing/provider");
      const { TikTokPublishingService } = await import("@/features/publishing/services");
      const { ProductionAnalyticsIngestion } = await import("@/features/analytics/production-ingestion");
      const { TikTokAnalyticsProvider } = await import("@/features/analytics/provider");

      const tokens = new TikTokTokenService(admin);
      await tokens.store(ownerId, fixture.accountId, { openId: `e2e-open-${tag}`,
        accessToken: "phase11f-e2e-access", refreshToken: "phase11f-e2e-refresh", tokenType: "Bearer",
        scopes: ["user.info.basic", "video.publish", "video.upload", "video.list"],
        accessTokenExpiresAt: new Date(Date.now() + 400 * 86_400_000).toISOString(),
        refreshTokenExpiresAt: new Date(Date.now() + 500 * 86_400_000).toISOString() });

      let falSubmissions = 0;
      const falProvider = new FalWanVideoProvider({ apiKey: fakeFalKey, pollIntervalMs: 0, maxPollAttempts: 1,
        client: {
          upload: async blob => { expect(blob.size).toBeGreaterThan(100); return "https://mock-fal.invalid/reference.png"; },
          submit: async endpoint => { expect(endpoint).toBe(FAL_WAN_ENDPOINT); falSubmissions++; return { request_id: "phase11f-fal-1" }; },
          status: async () => ({ status: "COMPLETED" }),
          result: async () => ({ data: { video: { url: "https://mock-fal.invalid/source.mp4" } }, requestId: "phase11f-fal-1" }),
        },
        fetchImpl: async input => {
          expect(String(input)).toBe("https://mock-fal.invalid/source.mp4");
          return new Response(media.video, { status: 200, headers: { "content-type": "video/mp4" } });
        },
      });
      const visionProvider = new MockFrameVisionProvider();
      const publishingProvider = new OfficialTikTokPublishingProvider(globalThis.fetch);
      const analyticsNow = new Date(Date.now() + 3 * 3600_000);
      const analyticsIngestion = new ProductionAnalyticsIngestion(admin,
        new TikTokAnalyticsProvider(true, globalThis.fetch), tokens,
        () => analyticsNow);
      const boundaries = { falProvider, visionProvider, publishingProvider, analyticsIngestion };

      // The operator service is the single START boundary. Assignment is a pre-existing input fixture.
      const run = await createAutoRun(admin, ownerId, uuid(), {
        accountId: fixture.accountId, mode: "GROWTH", dailyTarget: 1, dailyBudgetUsd: 1 });
      expect(run.state).toBe("RUNNING");
      expect(await count(admin, "auto_runs", ownerId)).toBe(1);

      // One worker cycle advances all safe steps and stops before the required owner consent.
      await runAutoExecutionCycle(admin, ownerId, run.id, 6, boundaries);
      const stateBeforeConsent = await admin.from("auto_account_states").select("current_step,state,checkpoint_version")
        .eq("owner_id", ownerId).eq("auto_run_id", run.id).single();
      expect(stateBeforeConsent.error).toBeNull();
      if (stateBeforeConsent.data?.current_step !== "PUBLISH") {
        const [failures, generations] = await Promise.all([
          admin.from("auto_failures").select("failure_type,reason,step").eq("owner_id", ownerId),
          admin.from("creative_generations").select("status,error").eq("owner_id", ownerId),
        ]);
        throw new Error(`auto_e2e_stalled:${JSON.stringify({ state: stateBeforeConsent.data,
          failures: failures.data, generations: generations.data })}`);
      }
      expect(stateBeforeConsent.data).toMatchObject({ current_step: "PUBLISH", state: "RUNNING", checkpoint_version: 6 });
      expect(await count(admin, "generation_jobs", ownerId)).toBe(1);
      expect(await count(admin, "generation_budget_reservations", ownerId)).toBe(1);
      expect(await count(admin, "master_videos", ownerId)).toBe(1);
      expect(await count(admin, "publishing_queue", ownerId)).toBe(1);
      expect(visionProvider.inputs).toHaveLength(1);
      expect(visionProvider.inputs[0]?.frames.map(frame => frame.atSeconds)).toEqual([0.75, 4, 7.25]);
      expect(falSubmissions).toBe(1);
      expect((await transitionAutoRun(admin, ownerId, run.id, "PAUSE")).state).toBe("PAUSED");
      expect((await runAutoExecutionCycle(admin, ownerId, run.id, 2, boundaries)).results).toHaveLength(0);
      expect(falSubmissions).toBe(1);
      expect((await transitionAutoRun(admin, ownerId, run.id, "RESUME")).state).toBe("RUNNING");

      const queueResult = await admin.from("publishing_queue").select("*")
        .eq("owner_id", ownerId).single();
      const queue = must(queueResult.data, queueResult.error, "publishing_queue");
      const publishing = new TikTokPublishingService(admin, publishingProvider);
      await publishing.recordConsent(ownerId, queue.id, { caption: "Phase 11F fixture",
        privacyLevel: "SELF_ONLY", disableComment: true, disableDuet: true, disableStitch: true,
        isAigc: true, commercialContent: {} });
      await runAutoExecutionCycle(admin, ownerId, run.id, 12, boundaries);
      const finished = await admin.from("auto_runs").select("state").eq("owner_id", ownerId).eq("id", run.id).single();
      if (finished.data?.state !== "COMPLETED") {
        const [states, failures, queue] = await Promise.all([
          admin.from("auto_account_states").select("state,current_step,blockers_json").eq("owner_id", ownerId),
          admin.from("auto_failures").select("failure_type,reason,step").eq("owner_id", ownerId),
          admin.from("publishing_queue").select("status,published_post_ids_json").eq("owner_id", ownerId),
        ]);
        throw new Error(`auto_e2e_incomplete:${JSON.stringify({ states: states.data,
          failures: failures.data, queue: queue.data })}`);
      }
      expect(finished.data?.state).toBe("COMPLETED");
      expect(await count(admin, "video_analytics_snapshots", ownerId)).toBe(1);
      expect(await count(admin, "winner_scores", ownerId)).toBe(1);
      expect(await count(admin, "learning_decisions", ownerId)).toBe(1);
      expect(await count(admin, "growth_account_snapshots", ownerId)).toBe(1);
      expect(directSubmissions).toBe(1);
      expect(analyticsQueries).toBe(1);
      expect(creatorQueries).toBeGreaterThanOrEqual(1);
      expect(unexpectedExternal).toBe(0);

      const master = must((await admin.from("master_videos").select("id")
        .eq("owner_id", ownerId).single()).data, null, "master_video");
      const analyticsReplay = await analyticsIngestion.collect({ ownerId, accountId: fixture.accountId,
        queueId: queue.id, videoId: master.id, videoKind: "MASTER", mode: "GROWTH",
        productId: fixture.productId });
      expect(analyticsReplay).toMatchObject({ status: "READY", duplicate: true });
      expect(analyticsQueries).toBe(1);
      expect(await count(admin, "video_analytics_snapshots", ownerId)).toBe(1);
      expect(await count(admin, "winner_scores", ownerId)).toBe(1);

      const replay = await runAutoExecutionCycle(admin, ownerId, run.id, 12, boundaries);
      expect(replay.results).toHaveLength(0);
      expect(falSubmissions).toBe(1);
      expect(directSubmissions).toBe(1);
      expect(await count(admin, "winner_scores", ownerId)).toBe(1);
      expect(await count(admin, "auto_checkpoints", ownerId)).toBe(10);

      const stopped = await createAutoRun(admin, ownerId, uuid(), {
        accountId: fixture.accountId, mode: "GROWTH", dailyTarget: 1, dailyBudgetUsd: 1 });
      expect((await transitionAutoRun(admin, ownerId, stopped.id, "STOP")).state).toBe("STOPPED");
      expect((await runAutoExecutionCycle(admin, ownerId, stopped.id, 2, boundaries)).results).toHaveLength(0);
      expect(falSubmissions).toBe(1);
      expect(directSubmissions).toBe(1);
    } catch (error) {
      testFailure = error;
    } finally {
      try {
        if (ownerId) await clean(admin, ownerId, storagePaths);
      } finally {
        globalThis.fetch = nativeFetch;
        await rm(workspace, { recursive: true, force: true });
      }
    }
    if (testFailure) throw testFailure;
  }, 240_000);
});
