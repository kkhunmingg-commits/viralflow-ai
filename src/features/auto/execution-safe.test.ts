import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OfficialTikTokPublishingProvider } from "@/features/publishing/provider";
import { FalWanVideoProvider } from "@/features/video/fal-wan";
import type { ExecutionClaim } from "./processor";

vi.mock("server-only", () => ({}));
const config = vi.hoisted(() => ({ postAutomationExecutionMode: "SAFE", falKey: "enabled-fixture-not-a-real-key",
  falWanProviderState: "PRODUCTION_APPROVED", openAIApiKey: "enabled-fixture-not-a-real-key", creativeAIProvider: "openai",
  tiktokPublishingRealMode: true, tiktokPublishingProvider: "official", tiktokVideoPublishApproved: true,
  tiktokVideoUploadApproved: true, tiktokAnalyticsProvider: "official" }));
vi.mock("@/lib/server-env", () => ({ serverEnv: config }));
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_safe_contract_fixture");
const { createAutoExecutionPorts } = await import("./execution-ports");
const { getPostAutomationExecutionMode } = await import("./execution-mode");
const { SupabaseExecutionStore } = await import("./execution-store");
const { processAutoAccount } = await import("./processor");
const { createAutoRun } = await import("./services");

type Row = Record<string, unknown>;
function fixture(mode = "AUTO") {
  const tables: Record<string, Row[]> = {
    auto_runs: [{ owner_id: "owner", id: "run", tiktok_account_id: "account", posting_mode: mode, state: "RUNNING" }],
    tiktok_accounts: [{ owner_id: "owner", id: "account", is_mock: false, effective_mode: "GROWTH", preferred_categories: [] }],
    product_assignments: [{ owner_id: "owner", id: "assignment", tiktok_account_id: "account", product_id: "product",
      final_score: 90, status: "SELECTED", score_id: "score", reason_json: {} }],
    creative_projects: [{ owner_id: "owner", id: "project", tiktok_account_id: "account", product_id: "product",
      product_assignment_id: "assignment", status: "DRAFT" }],
    products: [{ owner_id: "owner", id: "product", title: "สินค้า", category_key: "home" }],
    account_product_scores: [{ owner_id: "owner", id: "score", account_product_fit_score: 90, final_viral_opportunity_score: 90 }],
    master_videos: [{ owner_id: "owner", id: "video", provider: "fal", quality_status: "RETRY", status: "READY",
      quality_explanation_json: { visualVerificationReason: "VISION_PROVIDER_ERROR" } }],
    scripts: [], creative_angles: [], post_outputs: [],
  };
  const claim: ExecutionClaim = { ownerId: "owner", runId: "run", accountId: "account", postingMode: mode as ExecutionClaim["postingMode"],
    mode: "GROWTH", itemIndex: 1, dailyTarget: 1, attempt: 1, leaseToken: "lease", operationKey: "operation", step: "GENERATE_VIDEO",
    checkpoint: { assignmentId: "assignment", projectId: "project", productId: "product", videoId: "video", queueId: "queue" } };
  const runtime = { mode: "LIVE" as unknown, error: null as unknown, throwError: false };
  const finished: Row[] = [];
  const rpc = vi.fn(async (name: string, args: Row = {}) => {
    if (name === "get_post_automation_execution_mode") {
      if (runtime.throwError) throw new Error("database_unavailable");
      return { data: runtime.mode, error: runtime.error };
    }
    if (name === "claim_auto_execution_step") return { data: { ...claim }, error: null };
    if (name === "finish_auto_execution_step") { finished.push(args); return { data: true, error: null }; }
    if (name === "create_operator_auto_run_atomic") return { data: { id: "created-run", state: "RUNNING", spent_usd: 0 }, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  });
  const client = { rpc, from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    const rows = () => (tables[table] ?? []).filter(row => filters.every(test => test(row)));
    const query = { select: () => query, order: () => query, limit: () => query,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
    }; return query;
  } } as unknown as SupabaseClient;
  return { client, tables, claim, rpc, runtime, finished };
}
function forbiddenBoundaries() {
  const network = vi.fn(async () => { throw new Error("external_network_forbidden_in_safe_mode"); });
  const falNetwork = vi.fn(async () => { throw new Error("paid_provider_forbidden_in_safe_mode"); });
  const fal = new FalWanVideoProvider({ apiKey: "enabled-fixture", fetchImpl: network as typeof fetch,
    client: { upload: falNetwork, submit: falNetwork, status: falNetwork, result: falNetwork } });
  const verify = vi.fn(async () => { throw new Error("paid_vision_forbidden_in_safe_mode"); });
  const collect = vi.fn(async () => { throw new Error("analytics_network_forbidden_in_safe_mode"); });
  const boundaries = { falProvider: fal, visionProvider: { provider: "production-vision", model: "production-model", verify },
    publishingProvider: new OfficialTikTokPublishingProvider(network as typeof fetch), analyticsIngestion: { collect } as never };
  const assertNoNetwork = () => {
    expect(network).not.toHaveBeenCalled(); expect(falNetwork).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled(); expect(collect).not.toHaveBeenCalled();
  };
  return { boundaries, network, assertNoNetwork };
}
beforeEach(() => { config.postAutomationExecutionMode = "SAFE"; });

describe("POST SAFE production execution boundary", () => {
  it("blocks paid generation even with approved real providers and injected production adapters", async () => {
    const f = fixture(), b = forbiddenBoundaries();
    const globalNetwork = vi.spyOn(globalThis, "fetch").mockImplementation(b.network as typeof fetch);
    try {
      for (const mode of ["AUTO", "DRAFT", "EXPORT"]) {
        const current = fixture(mode);
        expect(await createAutoExecutionPorts(current.client, b.boundaries).GENERATE_VIDEO(current.claim))
          .toMatchObject({ kind: "WAIT", reason: "SAFE_EXECUTION_BOUNDARY", evidence: { executionMode: "SAFE", blockedBoundary: "VIDEO" } });
        expect(current.tables.post_outputs).toHaveLength(0);
      }
      expect(f.rpc).not.toHaveBeenCalled(); b.assertNoNetwork(); expect(globalNetwork).not.toHaveBeenCalled();
    } finally { globalNetwork.mockRestore(); }
  });
  it("requires both server LIVE controls and fails closed on missing, invalid or failed database reads", async () => {
    const f = fixture();
    expect(await getPostAutomationExecutionMode(f.client)).toBe("SAFE"); expect(f.rpc).not.toHaveBeenCalled();
    config.postAutomationExecutionMode = "LIVE";
    for (const mode of ["SAFE", null, undefined, "live", {}, false]) {
      f.runtime.mode = mode; expect(await getPostAutomationExecutionMode(f.client)).toBe("SAFE");
    }
    f.runtime.mode = "LIVE"; f.runtime.error = { message: "unavailable" };
    expect(await getPostAutomationExecutionMode(f.client)).toBe("SAFE");
    f.runtime.error = null; f.runtime.throwError = true; expect(await getPostAutomationExecutionMode(f.client)).toBe("SAFE");
    f.runtime.throwError = false; expect(await getPostAutomationExecutionMode(f.client)).toBe("LIVE");
  });
  it("cannot bypass a database SAFE switch with an environment LIVE switch or direct port calls", async () => {
    config.postAutomationExecutionMode = "LIVE";
    for (const mode of ["AUTO", "DRAFT"]) {
      const f = fixture(mode), b = forbiddenBoundaries(); f.runtime.mode = "SAFE";
      const ports = createAutoExecutionPorts(f.client, b.boundaries);
      for (const step of ["QUEUE_PUBLISH", "PUBLISH", "COLLECT_ANALYTICS"] as const)
        expect(await ports[step](f.claim)).toMatchObject({ kind: "WAIT", reason: "SAFE_EXECUTION_BOUNDARY" });
      expect(f.tables.post_outputs).toHaveLength(0); b.assertNoNetwork();
    }
  });
  it("blocks paid creative and vision work without falling back to fabricated outputs", async () => {
    const f = fixture(), b = forbiddenBoundaries();
    const globalNetwork = vi.spyOn(globalThis, "fetch").mockImplementation(b.network as typeof fetch);
    try {
      const ports = createAutoExecutionPorts(f.client, b.boundaries);
      expect(await ports.CREATE_CREATIVE(f.claim)).toMatchObject({ kind: "WAIT", evidence: { blockedBoundary: "CREATIVE" } });
      expect(await ports.QUALITY_CHECK(f.claim)).toMatchObject({ kind: "WAIT", evidence: { blockedBoundary: "VISION" } });
      expect(f.tables.scripts).toHaveLength(0); expect(f.tables.creative_projects[0].status).toBe("DRAFT");
      b.assertNoNetwork(); expect(globalNetwork).not.toHaveBeenCalled();
    } finally { globalNetwork.mockRestore(); }
  });
  it("reuses an existing real selected script without inference and stops before generation", async () => {
    const f = fixture(), b = forbiddenBoundaries();
    f.tables.creative_projects[0].selected_script_id = "script";
    f.tables.scripts.push({ owner_id: "owner", id: "script", creative_project_id: "project", status: "SELECTED" });
    const ports = createAutoExecutionPorts(f.client, b.boundaries);
    expect(await ports.CREATE_CREATIVE(f.claim)).toMatchObject({ kind: "ADVANCE", evidence: { scriptId: "script", projectId: "project" } });
    expect(await ports.GENERATE_VIDEO(f.claim)).toMatchObject({ kind: "WAIT", reason: "SAFE_EXECUTION_BOUNDARY" });
    b.assertNoNetwork();
  });
  it("uses the production claim and finish RPCs in SAFE without claiming a generated or published success", async () => {
    const f = fixture(), b = forbiddenBoundaries();
    const result = await processAutoAccount(new SupabaseExecutionStore(f.client, "owner"), createAutoExecutionPorts(f.client, b.boundaries),
      "run", "account", "worker");
    expect(result).toMatchObject({ status: "WAIT", step: "GENERATE_VIDEO", nextStep: "GENERATE_VIDEO" });
    expect(f.rpc.mock.calls.find(([name]) => name === "claim_auto_execution_step")?.[1])
      .toMatchObject({ p_provider_ready: true, p_owner_id: "owner", p_account_id: "account" });
    expect(f.finished).toHaveLength(1);
    expect(f.finished[0]).toMatchObject({ p_kind: "WAIT", p_wait_state: "WAITING_FOR_PROVIDER", p_reason: "SAFE_EXECUTION_BOUNDARY",
      p_evidence: { executionMode: "SAFE", blockedBoundary: "VIDEO" }, p_next_step: "GENERATE_VIDEO", p_next_item_index: 1 });
    expect(f.tables.post_outputs).toHaveLength(0); b.assertNoNetwork();
  });
  it("retains the paid-budget readiness guard even though SAFE planning itself cannot spend", async () => {
    const f = fixture();
    Object.assign(f.tables.tiktok_accounts[0], { mode: "GROWTH", account_status: "active", authorization_status: "authorized",
      daily_post_target: 1, daily_post_hard_limit: 3, max_cost_per_video_usd: 1, daily_video_budget_usd: 1, monthly_video_budget_usd: 10 });
    const selection = { accountId: "account", mode: "GROWTH" as const, dailyTarget: 1, dailyBudgetUsd: 1 };
    await createAutoRun(f.client, "owner", "positive-budget", selection);
    const positive = f.rpc.mock.calls.find(([name]) => name === "create_operator_auto_run_atomic")?.[1];
    expect(positive).toMatchObject({ p_budget_usd: 1, p_provider_gate_reason: "SAFE_EXECUTION_BOUNDARY" });
    expect((positive?.p_plans as Row[])[0]).toMatchObject({ state: "RUNNING", maxDailyCostUsd: 1 });
    Object.assign(f.tables.tiktok_accounts[0], { max_cost_per_video_usd: 0, daily_video_budget_usd: 0, monthly_video_budget_usd: 0 });
    await createAutoRun(f.client, "owner", "zero-budget", { ...selection, dailyBudgetUsd: 0 });
    const zero = f.rpc.mock.calls.filter(([name]) => name === "create_operator_auto_run_atomic").at(-1)?.[1];
    expect((zero?.p_plans as Row[])[0]).toMatchObject({ state: "BLOCKED", maxDailyCostUsd: 0, blockers: ["BUDGET_EXCEEDED"] });
  });
});
