import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OfficialTikTokPublishingProvider } from "@/features/publishing/provider";
import { FalWanVideoProvider } from "@/features/video/fal-wan";
import { processAutoAccount, type ExecutionClaim, type ExecutionStore } from "./processor";

vi.mock("server-only", () => ({}));
const config = vi.hoisted(() => ({ postAutomationExecutionMode: "SAFE", falKey: "enabled-fixture-not-a-real-key",
  falWanProviderState: "PRODUCTION_APPROVED", openAIApiKey: "enabled-fixture-not-a-real-key", creativeAIProvider: "openai",
  tiktokPublishingRealMode: false, tiktokPublishingProvider: "official", tiktokAnalyticsProvider: "official" }));
vi.mock("@/lib/server-env", () => ({ serverEnv: config }));
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_safe_contract_fixture");
const { createAutoExecutionPorts } = await import("./execution-ports");
const { getPostAutomationExecutionMode } = await import("./execution-mode");

type Row = Record<string, unknown>;
function fixture() {
  const tables: Record<string, Row[]> = {
    auto_runs: [{ owner_id: "owner", id: "run", tiktok_account_id: "account", posting_mode: "AUTO" }],
    tiktok_accounts: [{ owner_id: "owner", id: "account", is_mock: false, effective_mode: "GROWTH", preferred_categories: [] }],
    product_assignments: [{ owner_id: "owner", id: "assignment", tiktok_account_id: "account", product_id: "product",
      final_score: 90, status: "SELECTED", score_id: "score", reason_json: {} }],
    creative_projects: [{ owner_id: "owner", id: "project", tiktok_account_id: "account", product_id: "product",
      product_assignment_id: "assignment", status: "DRAFT" }],
    products: [{ owner_id: "owner", id: "product", title: "Product", category_key: "home" }],
    account_product_scores: [{ owner_id: "owner", id: "score", account_product_fit_score: 90, final_viral_opportunity_score: 90 }],
    master_videos: [{ owner_id: "owner", id: "video", provider: "fal", quality_status: "RETRY", status: "READY",
      quality_explanation_json: { visualVerificationReason: "VISION_PROVIDER_ERROR" } }],
    scripts: [], creative_angles: [],
  };
  const claim: ExecutionClaim = { ownerId: "owner", runId: "run", accountId: "account",
    mode: "GROWTH", itemIndex: 1, dailyTarget: 1, attempt: 1, leaseToken: "lease", operationKey: "operation", step: "GENERATE_VIDEO",
    checkpoint: { assignmentId: "assignment", projectId: "project", productId: "product", videoId: "video", queueId: "queue" } };
  const runtime = { mode: "LIVE" as unknown, error: null as unknown, throwError: false };
  const rpc = vi.fn(async (name: string) => {
    if (name !== "get_post_automation_execution_mode") throw new Error(`Unexpected RPC ${name}`);
    if (runtime.throwError) throw new Error("database_unavailable");
    return { data: runtime.mode, error: runtime.error };
  });
  const client = { rpc, from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    const rows = () => (tables[table] ?? []).filter(row => filters.every(test => test(row)));
    const query = { select: () => query, order: () => query, limit: () => query,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
    }; return query;
  } } as unknown as SupabaseClient;
  return { client, tables, claim, rpc, runtime };
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

describe("POST SAFE shared production boundary", () => {
  it("requires both LIVE controls and fails closed on absent, invalid or failed database reads", async () => {
    const f = fixture();
    expect(await getPostAutomationExecutionMode(f.client)).toBe("SAFE"); expect(f.rpc).not.toHaveBeenCalled();
    config.postAutomationExecutionMode = "LIVE";
    for (const mode of ["SAFE", null, undefined, "live", {}, false]) {
      f.runtime.mode = mode; expect(await getPostAutomationExecutionMode(f.client)).toBe("SAFE");
    }
    f.runtime.mode = "LIVE"; f.runtime.error = { message: "unavailable" };
    expect(await getPostAutomationExecutionMode(f.client)).toBe("SAFE");
    f.runtime.error = null; f.runtime.throwError = true;
    expect(await getPostAutomationExecutionMode(f.client)).toBe("SAFE");
    f.runtime.throwError = false; expect(await getPostAutomationExecutionMode(f.client)).toBe("LIVE");
  });

  it("blocks approved production adapters before any paid generation, queue, publishing or analytics call", async () => {
    for (const environmentMode of ["SAFE", "LIVE"]) {
      config.postAutomationExecutionMode = environmentMode;
      const f = fixture(), b = forbiddenBoundaries(); f.runtime.mode = "SAFE";
      const network = vi.spyOn(globalThis, "fetch").mockImplementation(b.network as typeof fetch);
      try {
        const ports = createAutoExecutionPorts(f.client, b.boundaries);
        for (const [step, blockedBoundary] of [["GENERATE_VIDEO", "VIDEO"], ["QUEUE_PUBLISH", "TIKTOK_QUEUE"],
          ["PUBLISH", "TIKTOK_PUBLISH"], ["COLLECT_ANALYTICS", "ANALYTICS"]] as const) {
          expect(await ports[step](f.claim)).toEqual({ kind: "WAIT", state: "WAITING_FOR_PROVIDER", reason: "SAFE_EXECUTION_BOUNDARY",
            evidence: { executionMode: "SAFE", blockedBoundary } });
        }
        b.assertNoNetwork(); expect(network).not.toHaveBeenCalled();
      } finally { network.mockRestore(); }
    }
  });

  it("blocks paid creative and vision work without fabricating scripts or readiness", async () => {
    const f = fixture(), b = forbiddenBoundaries();
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(b.network as typeof fetch);
    try {
      const ports = createAutoExecutionPorts(f.client, b.boundaries);
      expect(await ports.CREATE_CREATIVE(f.claim)).toMatchObject({ kind: "WAIT", evidence: { blockedBoundary: "CREATIVE" } });
      expect(await ports.QUALITY_CHECK(f.claim)).toMatchObject({ kind: "WAIT", evidence: { blockedBoundary: "VISION" } });
      expect(f.tables.scripts).toHaveLength(0); expect(f.tables.creative_projects[0].status).toBe("DRAFT");
      b.assertNoNetwork(); expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });

  it("allows an existing selected script through and stops before generation", async () => {
    const f = fixture(), b = forbiddenBoundaries();
    f.tables.creative_projects[0].selected_script_id = "script";
    f.tables.scripts.push({ owner_id: "owner", id: "script", creative_project_id: "project", status: "SELECTED" });
    const ports = createAutoExecutionPorts(f.client, b.boundaries);
    expect(await ports.CREATE_CREATIVE(f.claim)).toMatchObject({ kind: "ADVANCE", evidence: { scriptId: "script", projectId: "project" } });
    expect(await ports.GENERATE_VIDEO(f.claim)).toMatchObject({ kind: "WAIT", reason: "SAFE_EXECUTION_BOUNDARY" });
    b.assertNoNetwork();
  });

  it("does not instantiate a disabled publishing adapter before SAFE guards run", async () => {
    const f = fixture(), ports = createAutoExecutionPorts(f.client);
    expect(await ports.QUEUE_PUBLISH(f.claim)).toMatchObject({ kind: "WAIT", reason: "SAFE_EXECUTION_BOUNDARY" });
    expect(await ports.PUBLISH(f.claim)).toMatchObject({ kind: "WAIT", reason: "SAFE_EXECUTION_BOUNDARY" });
  });

  it("persists a waiting checkpoint without advancing or claiming generated success", async () => {
    const f = fixture(), b = forbiddenBoundaries();
    const finish = vi.fn();
    const store: ExecutionStore = { runnableAccounts: async () => ["account"], claim: async () => f.claim,
      finish, fail: vi.fn() };
    const result = await processAutoAccount(store, createAutoExecutionPorts(f.client, b.boundaries), "run", "account", "worker");
    expect(result).toMatchObject({ status: "WAIT", step: "GENERATE_VIDEO", nextStep: "GENERATE_VIDEO" });
    expect(finish).toHaveBeenCalledWith(f.claim, { kind: "WAIT", state: "WAITING_FOR_PROVIDER", reason: "SAFE_EXECUTION_BOUNDARY",
      evidence: { executionMode: "SAFE", blockedBoundary: "VIDEO" } }, "GENERATE_VIDEO", 1);
    expect(store.fail).not.toHaveBeenCalled(); b.assertNoNetwork();
  });
});
