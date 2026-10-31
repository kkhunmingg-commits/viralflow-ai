import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TikTokAnalyticsProvider } from "./provider";

vi.mock("server-only", () => ({}));

const { ProductionAnalyticsIngestion, selectAnalyticsProvider } = await import("./production-ingestion");
const now = new Date("2026-09-23T10:03:00.000Z");
const ownerId = "owner-1", accountId = "account-1", videoId = "video-1", queueId = "queue-1";
const video = { id: "123456789", create_time: Math.floor(Date.parse("2026-09-22T08:00:00Z") / 1000),
  view_count: 1500, like_count: 200, comment_count: 20, share_count: 30 };
const ok = () => Response.json({ data: { videos: [video] }, error: { code: "ok" } });

type Row = Record<string, unknown>;
class MemoryQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private insertValue: Row | null = null;
  constructor(private readonly rows: Record<string, Row[]>, private readonly table: string) {}
  select(columns: string) { void columns; return this; }
  eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this; }
  neq(key: string, value: unknown) { this.filters.push(row => row[key] !== value); return this; }
  order(key: string, options: unknown) { void key; void options; return this; }
  limit(count: number) { void count; return this; }
  insert(value: Row) { this.insertValue = value; return this; }
  private result(single: boolean) {
    if (this.insertValue) {
      const row: Row = { id: `${this.table}-${this.rows[this.table].length + 1}`,
        ...(this.table === "winner_scores" ? { score_version: "winner-detection-v1" } : {}), ...this.insertValue };
      const duplicate = this.rows[this.table].find(existing => this.table === "video_analytics_snapshots"
        ? existing.owner_id === row.owner_id && existing.source === row.source
          && existing.external_video_id === row.external_video_id && existing.source_snapshot_at === row.source_snapshot_at
        : this.table === "winner_scores" && existing.owner_id === row.owner_id
          && existing.video_id === row.video_id && existing.evidence_hash === row.evidence_hash);
      if (duplicate) return { data: null, error: { code: "23505", message: "duplicate" } };
      this.rows[this.table].push(row);
      return { data: single ? row : [row], error: null };
    }
    const matched = this.rows[this.table].filter(row => this.filters.every(filter => filter(row)));
    return { data: single ? matched[0] ?? null : matched, error: null };
  }
  maybeSingle() { return Promise.resolve(this.result(true)); }
  single() { return Promise.resolve(this.result(true)); }
  then<TResult1 = unknown, TResult2 = never>(onfulfilled?: ((value: {data: Row[];error: null}) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) {
    return Promise.resolve(this.result(false) as {data: Row[];error: null}).then(onfulfilled, onrejected);
  }
}
function memory() {
  const rows: Record<string, Row[]> = {
    publishing_queue: [{ id: queueId, owner_id: ownerId, tiktok_account_id: accountId,
      video_id: videoId, status: "PUBLISHED", published_post_ids_json: [video.id], completed_at: "2026-09-22T08:00:00Z" }],
    tiktok_accounts: [{ id: accountId, owner_id: ownerId, is_mock: false,
      authorization_status: "authorized", granted_scopes: ["video.list"] }],
    video_analytics_snapshots: [], winner_scores: [],
  };
  return { rows, admin: { from: (table: string) => new MemoryQuery(rows, table) } as unknown as SupabaseClient };
}
const input = { ownerId, accountId, queueId, videoId, videoKind: "MASTER" as const,
  mode: "GROWTH" as const, productId: null };

describe("published video analytics ingestion", () => {
  it("selects official only with explicit configuration and credentials", () => {
    const config = { provider: "official" as const, realMode: true, oauthOfficial: true, credentialsReady: true };
    expect(selectAnalyticsProvider(config).name).toBe("tiktok-display-api");
    expect(selectAnalyticsProvider({ ...config, credentialsReady: false }).isAvailable()).toBe(false);
    expect(selectAnalyticsProvider({ ...config, credentialsReady: false }).name).toBe("tiktok-display-api");
  });

  it("uses an owner-scoped post identity, persists once, and reuses the snapshot on retry", async () => {
    const { rows, admin } = memory();
    const fetcher = vi.fn().mockResolvedValue(ok());
    const tokens = { getAccessToken: vi.fn().mockResolvedValue("private-token") };
    const ingestion = new ProductionAnalyticsIngestion(admin, new TikTokAnalyticsProvider(true, fetcher), tokens, () => now);
    const first = await ingestion.collect(input), repeated = await ingestion.collect(input);
    expect(first).toMatchObject({ status: "READY", duplicate: false });
    expect(repeated).toMatchObject({ status: "READY", duplicate: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(rows.video_analytics_snapshots).toHaveLength(1);
    expect(rows.winner_scores).toHaveLength(1);
    expect(rows.video_analytics_snapshots[0].availability_json).toMatchObject({ views: "AVAILABLE", orders: "UNKNOWN", favorites: "UNKNOWN" });
    expect(rows.winner_scores[0].decision).toBe("SCALE");
    expect(await ingestion.collect({ ...input, ownerId: "other-owner" })).toEqual({ status: "WAITING_FOR_DATA", availability: "UNKNOWN", reason: "PUBLISH_NOT_CONFIRMED" });
    expect(tokens.getAccessToken).toHaveBeenCalledTimes(1);
  });

  it("refreshes a rejected access token once through the existing token service boundary", async () => {
    const { admin } = memory();
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: { code: "access_token_invalid" } }, { status: 401 })).mockResolvedValue(ok());
    const tokens = { getAccessToken: vi.fn().mockResolvedValueOnce("old-token").mockResolvedValueOnce("fresh-token") };
    const result = await new ProductionAnalyticsIngestion(admin, new TikTokAnalyticsProvider(true, fetcher), tokens, () => now).collect(input);
    expect(result.status).toBe("READY");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(tokens.getAccessToken.mock.calls[1][2]).toBeGreaterThan(30_000_000);
  });

  it("waits for publication, scope and rate limit without inventing analytics", async () => {
    const { rows, admin } = memory();
    const tokens = { getAccessToken: vi.fn().mockResolvedValue("private-token") };
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: { code: "rate_limit_exceeded" } }, { status: 429 }));
    const ingestion = new ProductionAnalyticsIngestion(admin, new TikTokAnalyticsProvider(true, fetcher), tokens, () => now);
    rows.publishing_queue[0].status = "DRAFT_DELIVERED";
    expect(await ingestion.collect(input)).toEqual({ status: "WAITING_FOR_DATA", availability: "UNKNOWN", reason: "PUBLISH_NOT_CONFIRMED" });
    rows.publishing_queue[0].status = "PUBLISHED";
    rows.tiktok_accounts[0].granted_scopes = [];
    expect(await ingestion.collect(input)).toEqual({ status: "REAUTH_REQUIRED", availability: "AUTH_REQUIRED", reason: "VIDEO_LIST_SCOPE_REQUIRED" });
    rows.tiktok_accounts[0].granted_scopes = ["video.list"];
    expect(await ingestion.collect(input)).toEqual({ status: "WAITING_FOR_DATA", availability: "STALE", reason: "ANALYTICS_RATE_LIMITED" });
    expect(rows.video_analytics_snapshots).toHaveLength(0);
  });

  it("fails closed when disabled and treats absent provider data as unknown", async () => {
    const { rows, admin } = memory();
    const tokens = { getAccessToken: vi.fn().mockResolvedValue("private-token") };
    const disabled = new ProductionAnalyticsIngestion(admin, new TikTokAnalyticsProvider(false), tokens, () => now);
    expect(await disabled.collect(input)).toEqual({ status: "WAITING_FOR_DATA", availability: "UNAVAILABLE", reason: "ANALYTICS_PROVIDER_DISABLED" });
    expect(tokens.getAccessToken).not.toHaveBeenCalled();
    const empty = new TikTokAnalyticsProvider(true, vi.fn().mockResolvedValue(Response.json({ data: { videos: [] }, error: { code: "ok" } })));
    expect(await new ProductionAnalyticsIngestion(admin, empty, tokens, () => now).collect(input))
      .toEqual({ status: "WAITING_FOR_DATA", availability: "UNKNOWN", reason: "ANALYTICS_NOT_READY" });
    expect(rows.video_analytics_snapshots).toHaveLength(0);
  });
});
