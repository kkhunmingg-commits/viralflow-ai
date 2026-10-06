import { describe, expect, it } from "vitest";
import { mapCustomerOverview, mapCustomerPostAccount, periodMetrics, customerPeriod, periodBounds } from "./customer-mapping";
import type { CustomerDataRecords, SnapshotRecord } from "./customer-mapping";

const now = new Date("2026-10-06T12:00:00.000Z");
function records(): CustomerDataRecords {
  return { accounts: ["A", "B"].map((id) => ({ id, display_name: `บัญชี ${id}`, username: id, avatar_url: null,
    mode: "AUTO", authorization_status: "authorized", account_status: "active", daily_post_target: 5, daily_post_hard_limit: 7,
    daily_video_budget_usd: "0.5", preferred_categories: [], is_mock: false, hidden_at: null })),
    masters: [], variations: [], queues: [], jobs: [], products: [], runs: [], states: [], snapshots: [] };
}
function snapshot(overrides: Partial<SnapshotRecord> = {}): SnapshotRecord {
  return { id: "s", tiktok_account_id: "A", video_id: "video-A", video_kind: "MASTER", product_id: "product",
    source: "TIKTOK_SHOP_ANALYTICS", source_snapshot_at: "2026-10-06T11:00:00.000Z", published_at: "2026-10-06T09:00:00.000Z",
    views: 100, comments: 4, clicks: 2, orders: 1, items_sold: 2, gmv: "200", commission: "20", currency: "THB", ...overrides };
}
describe("owner-projected multi-account customer data", () => {
  it("keeps unknown metrics null, recorded zero distinct and no fabricated LIVE history", () => {
    const data = records();
    data.snapshots = [snapshot({ views: 0, gmv: "0", commission: "0", items_sold: 0 })];
    const view = mapCustomerOverview(data, "today", now);
    expect(view.accounts[0].metrics.gmv).toBe(0);
    expect(view.accounts[1].metrics.gmv).toBeNull();
    expect(view.summary.gmv).toBeNull(); // Incomplete totals must not imply account B had zero sales.
    expect(view.summary.liveHours).toBeNull();
    expect(view.summary.salesPerHour).toBeNull();
  });
  it("never double-counts cumulative snapshots and separates units from orders", () => {
    const rows = [snapshot({ id: "old", source_snapshot_at: "2026-10-05T23:59:00.000Z", published_at: "2026-10-01T00:00:00.000Z", views: 60, gmv: 100, items_sold: 1 }),
      snapshot({ id: "early", source_snapshot_at: "2026-10-06T10:00:00.000Z", views: 90 }), snapshot({ published_at: "2026-10-01T00:00:00.000Z" })];
    expect(periodMetrics(rows, "2026-10-06T00:00:00.000Z", "2026-10-07T00:00:00.000Z")).toMatchObject({ views: 40, gmv: 100, units: 1 });
    expect(periodMetrics([snapshot({ items_sold: null, orders: 9 })], "2026-10-06", "2026-10-07").units).toBeNull();
  });
  it("requires observed baseline for older videos and does not sum different currencies", () => {
    expect(periodMetrics([snapshot({ published_at: "2026-10-01T00:00:00.000Z" })], "2026-10-06", "2026-10-07").gmv).toBeNull();
    expect(periodMetrics([snapshot(), snapshot({ video_id: "usd", currency: "USD" })], "2026-10-06", "2026-10-07").gmv).toBeNull();
  });
  it("compares timestamp instants and never calls a failed completion a posted clip", () => {
    const data = records();
    data.snapshots = [snapshot({ source_snapshot_at: "2026-10-06T00:00:00+00:00", published_at: "2026-10-06T00:00:00+00:00" })];
    expect(mapCustomerOverview(data, "today", now).accounts[0].metrics.gmv).toBe(200);
    data.masters = [{ id: "v", tiktok_account_id: "A", product_id: null, status: "FAILED", created_at: "2026-10-05T12:00:00Z", storage_path: null }];
    data.queues = [{ id: "q", tiktok_account_id: "A", video_id: "v", video_kind: "MASTER", status: "FAILED", scheduled_for: null, published_at: now.toISOString(), created_at: now.toISOString(), retry_count: 0, max_retries: 2, provider_publish_id: null, external_state: "FAILED_RETRYABLE" }];
    expect(mapCustomerPostAccount(data, "A", "today", now)?.clips).toHaveLength(0);
    expect(mapCustomerPostAccount(data, "A", "7d", now)?.clips[0].postedAt).toBeNull();
  });
  it("filters hidden/mock accounts and mocked observations", () => {
    const data = records(); data.accounts[1].is_mock = true;
    data.snapshots = [snapshot({ source: "MOCK" })];
    expect(mapCustomerOverview(data, "today", now).accounts).toHaveLength(1);
    expect(mapCustomerOverview(data, "today", now).accounts[0].metrics.views).toBeNull();
    data.accounts[0].hidden_at = now.toISOString();
    expect(mapCustomerOverview(data, "today", now).accounts).toHaveLength(0);
  });
  it("isolates account A's current job, scheduled clip and retry from account B", () => {
    const data = records();
    data.runs = [{ id: "run-A", state: "RUNNING", run_date: "2026-10-06", updated_at: now.toISOString() }];
    data.states = [{ auto_run_id: "run-A", tiktok_account_id: "A", state: "RUNNING", current_step: "GENERATE_VIDEO", desired_daily_posts: 5, blockers_json: [], updated_at: now.toISOString() }];
    data.masters = [{ id: "video-A", tiktok_account_id: "A", product_id: null, status: "FAILED", created_at: now.toISOString(), storage_path: null }];
    data.queues = [{ id: "queue-A", tiktok_account_id: "A", video_id: "video-A", video_kind: "MASTER", status: "FAILED", scheduled_for: null, published_at: null,
      created_at: now.toISOString(), retry_count: 1, max_retries: 2, provider_publish_id: null, external_state: "FAILED_RETRYABLE" }];
    const view = mapCustomerOverview(data, "today", now);
    expect(view.accounts[0].canStop).toBe(true); expect(view.accounts[1].canStop).toBe(false);
    expect(view.accounts[1].canStart).toBe(false);
    expect(view.accounts[1].activeRunId).toBeNull();
    expect(view.accounts[0].today.failed).toBe(1);
    expect(mapCustomerPostAccount(data, "B", "today", now, true)?.clips).toEqual([]);
    expect(mapCustomerPostAccount(data, "A", "today", now, true)?.clips[0].canRetry).toBe(true);
    expect(mapCustomerPostAccount(data, "A", "today", now, false)?.clips[0].canRetry).toBe(false);
    data.states.push({ ...data.states[0], tiktok_account_id: "B" });
    expect(mapCustomerOverview(data, "today", now).accounts.every((row) => !row.canStop)).toBe(true);
  });
  it("uses actual schedule timestamps and ranks only observed period sales", () => {
    const data = records(); data.snapshots = [snapshot(), snapshot({ id: "b", tiktok_account_id: "B", video_id: "B", gmv: 400 })];
    data.queues = [{ id: "q", tiktok_account_id: "B", video_id: "B", video_kind: "MASTER", status: "QUEUED", scheduled_for: "2026-10-06T14:00:00.000Z", published_at: null,
      created_at: now.toISOString(), retry_count: 0, max_retries: 2, provider_publish_id: null, external_state: "READY" }];
    const view = mapCustomerOverview(data, "today", now);
    expect(view.accounts.map((row) => row.rank)).toEqual([2, 1]);
    expect(view.accounts[1].nextScheduledPost).toBe("2026-10-06T14:00:00.000Z");
    expect(view.summary.gmv).toBe(600);
  });
  it("bounds today/7/30 days and projects no raw account secrets", () => {
    expect(customerPeriod("100d")).toBe("today");
    expect(periodBounds("7d", now).start).toBe("2026-09-30T00:00:00.000Z");
    expect(periodBounds("30d", now).start).toBe("2026-09-07T00:00:00.000Z");
    const data = records(); Object.assign(data.accounts[0], { access_token: "DO_NOT_SEND", open_id: "PRIVATE", provider: "internal" });
    const json = JSON.stringify(mapCustomerOverview(data, "today", now));
    expect(json).not.toMatch(/DO_NOT_SEND|PRIVATE|open_id|access_token|provider/);
  });
});
