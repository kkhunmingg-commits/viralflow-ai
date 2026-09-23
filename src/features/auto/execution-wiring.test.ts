import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OfficialTikTokPublishingProvider } from "../publishing/provider";
import type { ExecutionClaim } from "./processor";

vi.mock("server-only", () => ({}));
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
      master_videos: [{ id: videoId, owner_id: ownerId, tiktok_account_id: accountId,
        quality_status: "PASS", status: "READY", storage_path: `${ownerId}/master.mp4` }],
      publishing_queue: [],
    };
    const rpc = vi.fn().mockImplementation(async (name: string, params: Record<string, unknown>) => {
      expect(name).toBe("enqueue_publish_atomic");
      return { data: { id: "queue-a", ...params }, error: null };
    });
    const admin = { from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => { filters.push(row => row[column] === value); return query; },
        maybeSingle: async () => ({ data: tables[table].find(row => filters.every(test => test(row))) ?? null, error: null }),
      };
      return query;
    }, rpc } as unknown as SupabaseClient;
    const provider = new OfficialTikTokPublishingProvider(vi.fn() as unknown as typeof fetch);
    const ports = createAutoExecutionPorts(admin, { publishingProvider: provider });
    const claim: ExecutionClaim = { ownerId, accountId, runId: "run-a", itemIndex: 1,
      mode: "GROWTH", dailyTarget: 1, attempt: 1, step: "QUEUE_PUBLISH",
      leaseToken: "lease-a", operationKey: "queue-a", checkpoint: { videoId } };

    const outcome = await ports.QUEUE_PUBLISH(claim);
    expect(outcome).toMatchObject({ kind: "ADVANCE", evidence: { queueId: "queue-a", publishMode: "DIRECT_POST" } });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_owner_id: ownerId, p_tiktok_account_id: accountId,
      p_video_id: videoId, p_publish_mode: "DIRECT_POST" });
  });
});
