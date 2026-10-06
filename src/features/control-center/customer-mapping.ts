import type { CustomerAccount, CustomerClip, CustomerOverview, CustomerPeriod, CustomerPostAccount } from "./customer-types";

/** Server-side input records. No record is forwarded wholesale to customer components. */
export interface AccountRecord {
  id: string; display_name: string; username: string | null; avatar_url: string | null;
  mode: CustomerAccount["mode"]; authorization_status: string; account_status: string;
  daily_post_target: number; daily_post_hard_limit: number; daily_video_budget_usd: number | string;
  preferred_categories: string[]; is_mock: boolean; hidden_at: string | null;
}
export interface MediaRecord {
  id: string; tiktok_account_id: string; product_id: string | null; status: string; created_at: string;
  creative_project_id?: string; selected_script_id?: string; storage_path: string | null;
  master_video_id?: string;
}
export interface QueueRecord {
  id: string; tiktok_account_id: string; video_id: string; video_kind: string; status: string;
  scheduled_for: string | null; published_at: string | null; created_at: string;
  retry_count: number; max_retries: number; provider_publish_id: string | null; external_state: string;
}
export interface SnapshotRecord {
  id: string; tiktok_account_id: string; video_id: string; video_kind: string; product_id: string | null;
  source: string; source_snapshot_at: string; published_at: string | null;
  views: number | null; comments: number | null; clicks: number | null; orders: number | null;
  gmv: number | string | null; commission: number | string | null;
  items_sold?: number | null; currency?: string | null;
  raw_metadata_json?: Record<string, unknown>;
}
export interface CustomerDataRecords {
  accounts: AccountRecord[]; masters: MediaRecord[]; variations: MediaRecord[]; queues: QueueRecord[];
  snapshots: SnapshotRecord[];
  jobs: Array<{ id: string; master_video_id: string | null; video_variation_id: string | null; status: string; completed_at: string | null }>;
  products: Array<{ id: string; title: string; image_url: string | null }>;
  runs: Array<{ id: string; state: string; run_date: string; updated_at: string }>;
  states: Array<{ auto_run_id: string; tiktok_account_id: string; state: string; current_step: string;
    desired_daily_posts: number; blockers_json: string[]; updated_at: string }>;
}
const ACTIVE = new Set(["STARTING", "RUNNING", "PAUSED", "RETRY_PENDING"]);
const READY = new Set(["READY", "APPROVED"]);
const WAITING = new Set(["QUEUED", "WAITING_FOR_SLOT", "UPLOADING", "PROCESSING", "RETRYING", "WAITING_FOR_RECONCILIATION"]);
const timestamp = (value: string) => Date.parse(value);
const within = (value: string | null, start: string, end: string) => !!value && timestamp(value) >= timestamp(start) && timestamp(value) < timestamp(end);
const day = (value: string | null) => value && Number.isFinite(timestamp(value)) ? new Date(value).toISOString().slice(0, 10) : null;
export function customerPeriod(value: unknown): CustomerPeriod {
  return value === "7d" || value === "30d" ? value : "today";
}
export function periodBounds(period: CustomerPeriod, now: Date) {
  const end = new Date(now); end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - (period === "30d" ? 29 : period === "7d" ? 6 : 0));
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString(), today: now.toISOString().slice(0, 10) };
}
export function observedNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}
export function completeSum(values: Array<number | null>): number | null {
  return values.length && values.every((value) => value !== null) ? values.reduce<number>((sum, value) => sum + value!, 0) : null;
}
export function customerImage(value: string | null) {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null; } catch { return null; }
}
export function latestObservedSnapshots(rows: SnapshotRecord[], end: string) {
  const latest = new Map<string, SnapshotRecord>();
  for (const row of [...rows].sort((a, b) => timestamp(b.source_snapshot_at) - timestamp(a.source_snapshot_at))) {
    if (!['TIKTOK_DISPLAY', 'TIKTOK_SHOP_ANALYTICS'].includes(row.source) || !Number.isFinite(timestamp(row.source_snapshot_at)) || timestamp(row.source_snapshot_at) >= timestamp(end)) continue;
    const key = `${row.tiktok_account_id}:${row.video_kind}:${row.video_id}:${row.source}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  return [...latest.values()];
}
/** Cumulative observations require a baseline. Never sum repeated snapshots or call orders "units". */
export function periodMetrics(rows: SnapshotRecord[], start: string, end: string) {
  const latest = latestObservedSnapshots(rows, end).filter((row) => timestamp(row.source_snapshot_at) >= timestamp(start));
  const before = latestObservedSnapshots(rows.filter((row) => timestamp(row.source_snapshot_at) < timestamp(start)), start);
  const delta = (row: SnapshotRecord, field: "views" | "gmv" | "commission" | "items_sold") => {
    const current = observedNumber(row[field]); if (current === null) return null;
    const baseline = before.find((value) => value.video_id === row.video_id && value.video_kind === row.video_kind && value.source === row.source);
    const previous = baseline ? observedNumber(baseline[field]) : within(row.published_at, start, end) ? 0 : null;
    return previous !== null && current >= previous ? current - previous : null;
  };
  // Different sources can describe the same video. Select the most recent observed value per metric/video.
  const sums = (field: "views" | "gmv" | "commission" | "items_sold") => {
    const values = new Map<string, number | null>();
    for (const row of latest.sort((a, b) => timestamp(b.source_snapshot_at) - timestamp(a.source_snapshot_at))) {
      const key = `${row.video_kind}:${row.video_id}`;
      if (!values.has(key) || values.get(key) === null) values.set(key, delta(row, field));
    }
    return completeSum([...values.values()]);
  };
  const currencies = [...new Set(latest.filter((row) => observedNumber(row.gmv) !== null || observedNumber(row.commission) !== null).map((row) => row.currency ?? null))];
  const currency = currencies.length === 1 && /^[A-Z]{3}$/.test(currencies[0] ?? "") ? currencies[0] : null;
  return { currency, views: sums("views"), gmv: currency ? sums("gmv") : null, commission: currency ? sums("commission") : null, units: sums("items_sold"),
    liveSessions: null, liveHours: null, salesPerHour: null };
}
function activity(step: string) {
  if (/PRODUCT|ASSIGNMENT|SCOR/.test(step)) return "กำลังเลือกสินค้า";
  if (/CREATIVE|SCRIPT/.test(step)) return "กำลังเตรียมเนื้อหา";
  if (/GENERAT|VIDEO/.test(step)) return "กำลังสร้างวิดีโอ";
  if (/QUALITY|COMPLIANCE|ORIGINALITY/.test(step)) return "กำลังตรวจวิดีโอ";
  if (/PUBLISH|QUEUE/.test(step)) return "กำลังเตรียมโพสต์";
  if (/ANALYTICS|LEARN/.test(step)) return "กำลังเก็บผลลัพธ์";
  return "กำลังเตรียมงาน";
}
function clipStatus(status: string) {
  if (status === "PUBLISHED") return "โพสต์แล้ว";
  if (status === "DRAFT_DELIVERED") return "รอคุณโพสต์";
  if (status === "FAILED" || status === "REJECTED") return "มีปัญหา";
  if (status === "REVIEW_REQUIRED" || status === "DRAFT") return "ต้องตรวจสอบ";
  if (status === "CANCELLED") return "ยกเลิกแล้ว";
  if (WAITING.has(status)) return "รอดำเนินการ";
  if (READY.has(status)) return "พร้อมโพสต์";
  if (status === "PROCESSING") return "กำลังสร้าง";
  return "กำลังเตรียม";
}
export function mapCustomerOverview(data: CustomerDataRecords, period: CustomerPeriod, now = new Date()): CustomerOverview {
  const bounds = periodBounds(period, now);
  const active = data.runs.find((row) => ACTIVE.has(row.state));
  const runStates = active ? data.states.filter((row) => row.auto_run_id === active.id) : [];
  const accounts = data.accounts.filter((row) => !row.is_mock && !row.hidden_at).map((row): CustomerAccount => {
    const queue = data.queues.filter((item) => item.tiktok_account_id === row.id);
    const media = [...data.masters, ...data.variations].filter((item) => item.tiktok_account_id === row.id);
    const todayMedia = media.filter((item) => day(item.created_at) === bounds.today);
    const todayQueue = queue.filter((item) => day(item.created_at) === bounds.today);
    const state = runStates.find((item) => item.tiktok_account_id === row.id);
    const single = Boolean(state && runStates.length === 1);
    const snapshots = data.snapshots.filter((item) => item.tiktok_account_id === row.id);
    const metrics = periodMetrics(snapshots, bounds.start, bounds.end);
    const connected = row.authorization_status === "authorized" && row.account_status === "active";
    const blocked = state && /BLOCK|WAITING_FOR_(PROVIDER|BUDGET|APPROVAL|HEALTH)/.test(state.state);
    const next = queue.filter((item) => item.scheduled_for && WAITING.has(item.status) && timestamp(item.scheduled_for) >= now.getTime())
      .sort((a, b) => timestamp(a.scheduled_for!) - timestamp(b.scheduled_for!))[0];
    const productSales = new Map<string, number>();
    const rankedVideos = new Set<string>();
    for (const snapshot of latestObservedSnapshots(snapshots, bounds.end)) {
      if (timestamp(snapshot.source_snapshot_at) < timestamp(bounds.start) || !snapshot.product_id || observedNumber(snapshot.gmv) === null) continue;
      const key = `${snapshot.video_kind}:${snapshot.video_id}`;
      if (rankedVideos.has(key)) continue;
      rankedVideos.add(key);
      const value = periodMetrics(snapshots.filter((item) => item.video_id === snapshot.video_id && item.video_kind === snapshot.video_kind), bounds.start, bounds.end).gmv;
      if (value !== null) productSales.set(snapshot.product_id, (productSales.get(snapshot.product_id) ?? 0) + value);
    }
    const topId = [...productSales].sort((a, b) => b[1] - a[1])[0]?.[0];
    const generatedIds = new Set(data.jobs.filter((job) => job.status === "COMPLETED" && day(job.completed_at) === bounds.today)
      .map((job) => job.video_variation_id ?? job.master_video_id).filter((id) => media.some((item) => item.id === id)));
    const postStatus = !connected ? "ต้องเชื่อมใหม่" : blocked ? "ต้องดำเนินการ" : state?.state === "PAUSED" ? "หยุดชั่วคราว"
      : state ? "กำลังทำงาน" : queue.some((item) => WAITING.has(item.status)) ? "รอโพสต์" : "พร้อมเริ่ม";
    return {
      id: row.id, name: row.display_name, username: row.username, avatarUrl: customerImage(row.avatar_url), rank: null,
      connected, postStatus, liveStatus: null, mode: row.mode, target: state?.desired_daily_posts ?? row.daily_post_target,
      hardLimit: row.daily_post_hard_limit, budget: observedNumber(row.daily_video_budget_usd) ?? 0, categories: row.preferred_categories ?? [],
      postCount: queue.filter((item) => item.status === "PUBLISHED" && within(item.published_at, bounds.start, bounds.end)).length,
      today: { generated: generatedIds.size, ready: queue.filter((item) => item.status === "APPROVED").length,
        published: queue.filter((item) => item.status === "PUBLISHED" && day(item.published_at) === bounds.today).length,
        waiting: queue.filter((item) => item.status === "DRAFT_DELIVERED").length,
        failed: new Set([...todayMedia.filter((item) => item.status === "FAILED").map((item) => item.id), ...todayQueue.filter((item) => item.status === "FAILED").map((item) => item.video_id)]).size,
        review: queue.filter((item) => item.status === "REVIEW_REQUIRED" || item.status === "DRAFT").length },
      metrics, currentActivity: state ? activity(state.current_step) : "ยังไม่มีงานที่กำลังทำ", nextActivity: next ? "มีโพสต์ที่ตั้งเวลาไว้" : null,
      actionRequired: !connected ? { label: "เชื่อม TikTok ใหม่", href: `/accounts/${row.id}` }
        : blocked ? { label: "ตรวจความพร้อมก่อนเริ่มงาน", href: `/auto?account=${row.id}` } : null,
      nextScheduledPost: next?.scheduled_for ?? null, topProduct: data.products.find((item) => item.id === topId)?.title ?? null,
      activeRunId: state ? active!.id : null, isSingleAccountRun: single,
      canStart: connected && !active && row.daily_post_hard_limit > 0,
      canStop: single,
    };
  });
  const rankCurrencies = new Set(accounts.filter((row) => row.metrics.gmv !== null).map((row) => row.metrics.currency));
  const ranked = rankCurrencies.size <= 1 ? [...accounts].filter((row) => row.metrics.gmv !== null).sort((a, b) => b.metrics.gmv! - a.metrics.gmv! || a.name.localeCompare(b.name)) : [];
  ranked.forEach((row, i) => { row.rank = i === 0 || row.metrics.gmv !== ranked[i - 1].metrics.gmv ? i + 1 : ranked[i - 1].rank; });
  const ids = new Set(accounts.map((row) => row.id));
  const currencies = [...new Set(accounts.map((row) => row.metrics.currency))];
  const currency = currencies.length === 1 ? currencies[0] : null;
  return { period, updatedAt: now.toISOString(), startDate: bounds.start, endDate: bounds.end, accounts,
    summary: { currency, gmv: currency ? completeSum(accounts.map((row) => row.metrics.gmv)) : null, commission: currency ? completeSum(accounts.map((row) => row.metrics.commission)) : null,
      units: completeSum(accounts.map((row) => row.metrics.units)), views: completeSum(accounts.map((row) => row.metrics.views)), liveSessions: null, liveHours: null, salesPerHour: null,
      postCount: data.queues.filter((row) => ids.has(row.tiktok_account_id) && row.status === "PUBLISHED" && within(row.published_at, bounds.start, bounds.end)).length },
    analyticsNotice: "ยอดขายคือ GMV ไม่ใช่กำไร • ช่วงวันตามเวลา UTC • — หมายถึงยังไม่มีข้อมูลที่ยืนยันได้" };
}
export function mapCustomerPostAccount(data: CustomerDataRecords, accountId: string, period: CustomerPeriod, now = new Date(), retryAllowed = false): CustomerPostAccount | null {
  const overview = mapCustomerOverview(data, period, now), account = overview.accounts.find((row) => row.id === accountId);
  if (!account) return null;
  const media = [...data.masters.map((row) => ({ ...row, kind: "MASTER" })), ...data.variations.map((row) => ({ ...row, kind: "VARIATION" }))];
  const clips = media.filter((row) => row.tiktok_account_id === accountId && within(row.created_at, overview.startDate, overview.endDate)).map((row): CustomerClip => {
    const queue = [...data.queues].filter((q) => q.tiktok_account_id === accountId && q.video_id === row.id && q.video_kind === row.kind).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const product = data.products.find((p) => p.id === row.product_id);
    const metrics = periodMetrics(data.snapshots.filter((s) => s.tiktok_account_id === accountId && s.video_id === row.id && s.video_kind === row.kind), overview.startDate, overview.endDate);
    const canRetry = Boolean(retryAllowed && queue && ["FAILED", "RETRYING"].includes(queue.status) && queue.retry_count < queue.max_retries
      && ["FAILED_RETRYABLE", "CONFIRMED", "SUBMITTED"].includes(queue.external_state));
    return { currency: metrics.currency, key: `${row.kind}:${row.id}`, title: product?.title ?? "คลิปของคุณ", product: product?.title ?? null,
      thumbnail: customerImage(product?.image_url ?? null), status: queue ? clipStatus(queue.status) : READY.has(row.status) ? "รอการตรวจ" : clipStatus(row.status), scheduledAt: queue?.scheduled_for ?? null,
      postedAt: queue?.status === "PUBLISHED" ? queue.published_at : null, views: metrics.views, sales: metrics.gmv, canRetry, queueId: canRetry ? queue!.id : null };
  });
  return { account, clips, period, updatedAt: overview.updatedAt };
}
