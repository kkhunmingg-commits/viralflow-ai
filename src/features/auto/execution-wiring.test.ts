import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OfficialTikTokPublishingProvider } from "../publishing/provider";
import type { ExecutionClaim } from "./processor";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server-env", () => ({ serverEnv: { tiktokPublishingRealMode: true, tiktokPublishingProvider: "official",
  tiktokVideoPublishApproved: true, tiktokVideoUploadApproved: true, postAutomationExecutionMode: "LIVE" } }));
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_phase11f_wiring_fixture");
const { createAutoExecutionPorts } = await import("./execution-ports");

describe("Auto production service wiring", () => {
  it("queues an audited account through the real publishing service in direct-post mode", async () => {
    const ownerId = "owner-a", accountId = "account-a", videoId = "video-a";
    const tables: Record<string, Array<Record<string, unknown>>> = {
      tiktok_accounts: [{ id: accountId, owner_id: ownerId, is_mock: false,
        authorization_status: "authorized", audit_status: "AUDITED", direct_post_status: "READY",
        granted_scopes: ["video.publish", "video.list"] }],
      auto_runs: [{ id: "run-a", owner_id: ownerId, tiktok_account_id: accountId, posting_mode: "AUTO" }],
      master_videos: [{ id: videoId, owner_id: ownerId, tiktok_account_id: accountId, product_id: "product-a", selected_script_id: "script-a", provider: "local", quality_score: 93,
        quality_status: "PASS", status: "READY", storage_path: `owner/${ownerId}/master.mp4` }],
      products: [{ id: "product-a", owner_id: ownerId, title: "สินค้า", product_url: null }],
      scripts: [{ id: "script-a", owner_id: ownerId, caption: "สินค้า", hashtags_json: [] }],
      post_outputs: [],
      publishing_queue: [],
    };
    const rpc = vi.fn().mockImplementation(async (name: string, params: Record<string, unknown>) => {
      if (name === "get_post_automation_execution_mode") return { data: "LIVE", error: null };
      expect(name).toBe("enqueue_publish_atomic");
      return { data: { id: "queue-a", ...params }, error: null };
    });
    const admin = { from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const query = {
        select: () => query,
        upsert: async (row: Record<string, unknown>) => { tables[table].push({ id: "output-a", ...row }); return { error: null }; },
        eq: (column: string, value: unknown) => { filters.push(row => row[column] === value); return query; },
        maybeSingle: async () => ({ data: tables[table].find(row => filters.every(test => test(row))) ?? null, error: null }),
      };
      return query;
    }, rpc } as unknown as SupabaseClient;
    const provider = new OfficialTikTokPublishingProvider(vi.fn() as unknown as typeof fetch);
    const ports = createAutoExecutionPorts(admin, { publishingProvider: provider });
    const claim: ExecutionClaim = { ownerId, accountId, runId: "run-a", itemIndex: 1,
      mode: "GROWTH", dailyTarget: 1, attempt: 1, step: "QUEUE_PUBLISH",
      leaseToken: "lease-a", operationKey: "queue-a", checkpoint: { videoId, productId: "product-a" } };

    const outcome = await ports.QUEUE_PUBLISH(claim);
    expect(outcome).toMatchObject({ kind: "ADVANCE", evidence: { queueId: "queue-a", publishMode: "DIRECT_POST" } });
    const queued = rpc.mock.calls.filter(([name]) => name === "enqueue_publish_atomic");
    expect(queued).toHaveLength(1);
    expect(queued[0][1]).toMatchObject({ p_owner_id: ownerId, p_tiktok_account_id: accountId,
      p_video_id: videoId, p_publish_mode: "DIRECT_POST" });
  });
});
