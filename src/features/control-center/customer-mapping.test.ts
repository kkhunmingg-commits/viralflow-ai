import { describe, expect, it } from "vitest";
import { mapCustomerOverview, mapCustomerPostAccount, periodMetrics, customerPeriod, periodBounds, accountPeriodBounds } from "./customer-mapping";
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
    expect(view.accounts[1].canStart).toBe(true);
    expect(view.accounts[1].hasActiveRun).toBe(false);
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
  it("shows two independent active runs without one account masking another", () => {
    const data = records();
    data.runs = ["A", "B"].map(id => ({ id: `run-${id}`, state: "RUNNING", run_date: "2026-10-06", updated_at: now.toISOString() }));
    data.states = ["A", "B"].map(id => ({ auto_run_id: `run-${id}`, tiktok_account_id: id, state: "RUNNING", current_step: id === "A" ? "GENERATE_VIDEO" : "PUBLISH", desired_daily_posts: 5, blockers_json: [], updated_at: now.toISOString() }));
    const view = mapCustomerOverview(data, "today", now);
    expect(view.accounts.map(row => row.hasActiveRun)).toEqual([true, true]);
    expect(JSON.stringify(view)).not.toMatch(/run-A|run-B|activeRunId|isSingleAccountRun/);
    expect(view.accounts.every(row => row.canStop && !row.canStart)).toBe(true);
    expect(view.accounts.map(row => row.currentActivity)).toEqual(["กำลังสร้างวิดีโอ", "กำลังเตรียมโพสต์"]);
  });
  it("resets each account's generated and posted counters on its own timezone, excluding failed/rejected", () => {
    const data = records(), at = new Date("2026-10-06T18:00:00Z");
    data.schedules = ["A", "B"].map(id => ({ tiktok_account_id: id, posting_mode: "EXPORT", creative_mode: "AUTO", clips_per_day: 7,
      active_start: 540, active_end: 1320, timezone: id === "A" ? "Asia/Bangkok" : "UTC", min_spacing_minutes: 60, allowed_days: [0, 1, 2, 3, 4, 5, 6], enabled: true, daily_budget_usd: 1, next_due_at: null }));
    for (const account of ["A", "B"]) for (const [index, completed] of ["2026-10-06T04:00:00Z", "2026-10-06T17:30:00Z"].entries()) {
      const id = `${account}-${index}`;
      data.masters.push({ id, tiktok_account_id: account, product_id: null, status: "READY", created_at: completed, storage_path: null });
      data.jobs.push({ id, master_video_id: id, video_variation_id: null, status: "COMPLETED", completed_at: completed });
      data.queues.push({ id, tiktok_account_id: account, video_id: id, video_kind: "MASTER", status: "PUBLISHED", scheduled_for: null, published_at: completed,
        created_at: completed, retry_count: 0, max_retries: 2, provider_publish_id: "hidden-publish", external_state: "CONFIRMED" });
    }
    data.queues.push({ ...data.queues[0], id: "failed", video_id: "failed", status: "FAILED", published_at: "2026-10-06T17:45:00Z" });
    const view = mapCustomerOverview(data, "today", at);
    expect(view.accounts.map(row => row.today.generated)).toEqual([1, 2]);
    expect(view.accounts.map(row => row.today.published)).toEqual([1, 2]);
    expect(view.accounts.map(row => row.target)).toEqual([7, 7]);
  });
  it("combines output and queue state without duplicate ready clips and allows EXPORT without TikTok posting", () => {
    const data = records(); data.accounts[0].authorization_status = "revoked";
    data.schedules = [{ tiktok_account_id: "A", posting_mode: "EXPORT", creative_mode: "AUTO", clips_per_day: 5, active_start: 540, active_end: 1320, timezone: "UTC", min_spacing_minutes: 60, allowed_days: [1], enabled: false, daily_budget_usd: 1, next_due_at: null }];
    data.masters = [{ id: "video", tiktok_account_id: "A", product_id: "product", status: "READY", created_at: now.toISOString(), storage_path: "owner/A/masters/video/final.mp4" }];
    data.outputs = [{ id: "output", tiktok_account_id: "A", video_id: "video", publishing_queue_id: null, posting_mode: "EXPORT", status: "READY", caption: "คำบรรยายสินค้า", hashtags_json: ["สินค้า"], product_reference_json: { title: "สินค้า" }, suggested_post_at: null, created_at: now.toISOString() }];
    const account = mapCustomerOverview(data, "today", now).accounts[0];
    expect(account.canStart).toBe(true); expect(account.actionRequired).toBeNull(); expect(account.today.ready).toBe(1);
    const clip = mapCustomerPostAccount(data, "A", "today", now)!.clips[0];
    expect(clip.caption).toBe("คำบรรยายสินค้า"); expect(clip.videoUrl).toContain("/api/post/clips/");
    expect(clip.downloadUrl).toBe("/api/post/outputs/output/download");
    expect(JSON.stringify(clip)).not.toContain("storage_path");
  });
  it("uses local account days for clip detail and honors a real 25-hour daylight-saving day", () => {
    const autumn = accountPeriodBounds("today", "America/New_York", new Date("2026-11-01T18:00:00Z"));
    expect(autumn.start).toBe("2026-11-01T04:00:00.000Z"); expect(autumn.end).toBe("2026-11-02T05:00:00.000Z");
    const data = records();
    data.schedules = [{ tiktok_account_id: "A", posting_mode: "EXPORT", creative_mode: "AUTO", clips_per_day: 5, active_start: 540, active_end: 1320, timezone: "Asia/Bangkok", min_spacing_minutes: 60, allowed_days: [1], enabled: false, daily_budget_usd: 1, next_due_at: null }];
    data.masters = [{ id: "new-day", tiktok_account_id: "A", product_id: null, status: "READY", created_at: "2026-10-06T17:30:00Z", storage_path: null },
      { id: "yesterday", tiktok_account_id: "A", product_id: null, status: "READY", created_at: "2026-10-06T04:00:00Z", storage_path: null }];
    expect(mapCustomerPostAccount(data, "A", "today", new Date("2026-10-06T18:00:00Z"))!.clips.map(clip => clip.key)).toEqual(["MASTER:new-day"]);
  });
  it("reads due scheduler work separately from generated videos and queued publications", () => {
    const data = records();
    data.schedules = [{ tiktok_account_id: "A", posting_mode: "EXPORT", creative_mode: "AUTO", clips_per_day: 7,
      active_start: 540, active_end: 1320, timezone: "Asia/Bangkok", min_spacing_minutes: 60,
      allowed_days: [0, 1, 2, 3, 4, 5, 6], enabled: true, daily_budget_usd: 1, next_due_at: "2026-10-06T13:00:00Z" }];
    const slot = { tiktok_account_id: "A", local_date: "2026-10-06", state: "PENDING",
      scheduled_at: "2026-10-06T11:00:00Z", expires_at: "2026-10-06T15:00:00Z", next_attempt_at: null };
    data.scheduleSlots = [slot, { ...slot, state: "CLAIMED" }, { ...slot, scheduled_at: "2026-10-06T13:00:00Z" },
      { ...slot, expires_at: "2026-10-06T11:59:00Z" }, { ...slot, state: "DISABLED" },
      { ...slot, tiktok_account_id: "B" }, { ...slot, local_date: "2026-10-05" }];
    const view = mapCustomerOverview(data, "today", now);
    expect(view.accounts[0]).toMatchObject({ schedulerQueued: true, scheduleQueueCount: 2,
      postStatus: "รอเริ่มตามคิว", currentActivity: "รอเริ่มงานตามคิว", target: 7 });
    expect(view.accounts[0].today).toMatchObject({ generated: 0, generating: 0, scheduled: 0, published: 0 });
    expect(view.accounts[1]).toMatchObject({ schedulerQueued: false, scheduleQueueCount: 0 });
    const serialized = JSON.stringify(view);
    expect(serialized).not.toMatch(/PENDING|CLAIMED|next_attempt_at|expires_at|local_date/);
    data.schedules[0].enabled = false;
    expect(mapCustomerOverview(data, "today", now).accounts[0].schedulerQueued).toBe(false);
  });
  it("shows waiting and failed execution truth without claiming a video is generating", () => {
    const data = records();
    data.runs = [{ id: "r", state: "RUNNING", run_date: "2026-10-06", updated_at: now.toISOString() }];
    data.states = [{ auto_run_id: "r", tiktok_account_id: "A", state: "WAITING_FOR_PROVIDER", current_step: "GENERATE_VIDEO",
      desired_daily_posts: 5, blockers_json: ["SAFE_EXECUTION_BOUNDARY"], updated_at: now.toISOString() }];
    const waiting = mapCustomerOverview(data, "today", now).accounts[0];
    expect(waiting.postStatus).toBe("รอความพร้อมก่อนดำเนินงาน");
    expect(waiting.currentActivity).toBe("รอความพร้อมก่อนดำเนินงาน");
    expect(waiting.today.generating).toBe(0); expect(waiting.hasActiveRun).toBe(true);
    expect(JSON.stringify(waiting)).not.toMatch(/SAFE_EXECUTION_BOUNDARY|WAITING_FOR_PROVIDER|GENERATE_VIDEO/);
    data.states[0].state = "FAILED"; data.runs[0].state = "FAILED";
    const failed = mapCustomerOverview(data, "today", now).accounts[0];
    expect(failed.postStatus).toBe("มีปัญหา"); expect(failed.currentActivity).toBe("งานล่าสุดไม่สำเร็จ");
    expect(failed.hasActiveRun).toBe(false); expect(failed.canStart).toBe(true);
    expect(failed.actionRequired?.label).toBe("ตรวจการตั้งเวลาและเริ่มงานอีกครั้ง");
  });
  it("does not mark a completed account active because another account in its parent run is running", () => {
    const data = records();
    data.runs = [{ id: "shared", state: "RUNNING", run_date: "2026-10-06", updated_at: now.toISOString() }];
    data.states = ["A", "B"].map(id => ({ auto_run_id: "shared", tiktok_account_id: id,
      state: id === "A" ? "COMPLETED" : "RUNNING", current_step: "COMPLETE", desired_daily_posts: 5,
      blockers_json: [], updated_at: now.toISOString() }));
    const accounts = mapCustomerOverview(data, "today", now).accounts;
    expect(accounts[0].hasActiveRun).toBe(false); expect(accounts[0].canStart).toBe(true);
    expect(accounts[1].hasActiveRun).toBe(true); expect(accounts[1].canStart).toBe(false);
  });
  it("does not turn an intentionally stopped consumed slot into an error or failed clip", () => {
    const data = records();
    data.runs = [{ id: "stopped", state: "STOPPED", run_date: "2026-10-06", updated_at: now.toISOString() }];
    data.states = [{ auto_run_id: "stopped", tiktok_account_id: "A", state: "STOPPED", current_step: "STOP",
      desired_daily_posts: 5, blockers_json: [], updated_at: now.toISOString() }];
    data.scheduleSlots = [{ tiktok_account_id: "A", local_date: "2026-10-06", state: "FAILED",
      scheduled_at: "2026-10-06T11:00:00Z", expires_at: "2026-10-06T15:00:00Z", next_attempt_at: null, auto_run_id: "stopped" }];
    const account = mapCustomerOverview(data, "today", now).accounts[0];
    expect(account.schedulerFailureCount).toBe(0); expect(account.today.failed).toBe(0);
    expect(account.postStatus).toBe("พร้อมเริ่ม"); expect(account.actionRequired).toBeNull();
  });
});
