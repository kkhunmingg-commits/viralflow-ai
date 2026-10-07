import type { CustomerAccount, CustomerClip, CustomerOverview, CustomerPeriod, CustomerPostAccount, CustomerPostingMode, CustomerPostSchedule } from "./customer-types";

/** Server-side input records. No record is forwarded wholesale to customer components. */
export interface AccountRecord {
  id: string; display_name: string; username: string | null; avatar_url: string | null;
  mode: CustomerAccount["mode"]; authorization_status: string; account_status: string;
  daily_post_target: number; daily_post_hard_limit: number; daily_video_budget_usd: number | string;
  preferred_categories: string[]; is_mock: boolean; hidden_at: string | null;
  audit_status?: string; direct_post_status?: string; granted_scopes?: unknown; upload_status?: string;
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
  caption_snapshot?: string | null;
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
  schedules?: Array<{ tiktok_account_id: string; posting_mode: CustomerPostingMode; creative_mode: CustomerAccount["mode"];
    clips_per_day: number; active_start: number; active_end: number; timezone: string; min_spacing_minutes: number;
    allowed_days: number[]; enabled: boolean; daily_budget_usd: number | string; next_due_at: string | null }>;
  outputs?: Array<{ id: string; tiktok_account_id: string; video_id: string; publishing_queue_id: string | null;
    posting_mode: CustomerPostingMode; status: string; caption: string; hashtags_json: string[];
    product_reference_json: { title?: string; url?: string }; suggested_post_at: string | null; published_at?: string | null; created_at: string }>;
  scheduleSlots?: Array<{ tiktok_account_id: string; local_date: string; state: string;
    scheduled_at: string; expires_at: string; next_attempt_at: string | null; auto_run_id?: string | null }>;
  postingAvailability?: CustomerAccount["postingAvailability"];
  availabilityByAccount?: Record<string, CustomerAccount["postingAvailability"]>;
}
const ACTIVE = new Set(["STARTING", "RUNNING", "PAUSED", "WAITING_FOR_DATA", "WAITING_FOR_APPROVAL", "WAITING_FOR_SLOT", "WAITING_FOR_PROVIDER", "WAITING_FOR_RECONCILIATION", "RETRY_PENDING", "BLOCKED"]);
const READY = new Set(["READY", "APPROVED"]);
const WAITING = new Set(["QUEUED", "WAITING_FOR_SLOT", "UPLOADING", "PROCESSING", "RETRYING", "WAITING_FOR_RECONCILIATION"]);
const timestamp = (value: string) => Date.parse(value);
const within = (value: string | null, start: string, end: string) => !!value && timestamp(value) >= timestamp(start) && timestamp(value) < timestamp(end);
const day = (value: string | null) => value && Number.isFinite(timestamp(value)) ? new Date(value).toISOString().slice(0, 10) : null;
function localDay(value: string | null, timezone: string) {
  if (!value || !Number.isFinite(timestamp(value))) return null;
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)); }
  catch { return day(value); }
}
function accountSchedule(row: AccountRecord, data: CustomerDataRecords): CustomerPostSchedule {
  const schedule = data.schedules?.find((item) => item.tiktok_account_id === row.id);
  const time = (minutes: number | undefined, fallback: string) => minutes === undefined ? fallback : `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return { postingMode: schedule?.posting_mode ?? "AUTO", creativeMode: schedule?.creative_mode ?? row.mode,
    clipsPerDay: schedule?.clips_per_day ?? row.daily_post_target, activeStart: time(schedule?.active_start, "09:00"),
    activeEnd: time(schedule?.active_end, "22:00"), timezone: schedule?.timezone ?? "UTC",
    minSpacingMinutes: schedule?.min_spacing_minutes ?? 60, allowedDays: schedule?.allowed_days ?? [0, 1, 2, 3, 4, 5, 6],
    enabled: schedule?.enabled ?? false, dailyBudgetUsd: observedNumber(schedule?.daily_budget_usd ?? row.daily_video_budget_usd) ?? 0,
    nextRunAt: schedule?.next_due_at ?? null };
}
export function customerPeriod(value: unknown): CustomerPeriod {
  return value === "7d" || value === "30d" ? value : "today";
}
export function periodBounds(period: CustomerPeriod, now: Date) {
  const end = new Date(now); end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - (period === "30d" ? 29 : period === "7d" ? 6 : 0));
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString(), today: now.toISOString().slice(0, 10) };
}
/** Locate local midnight by date, including 23/25-hour DST days without a fixed UTC offset. */
export function accountPeriodBounds(period: CustomerPeriod, timezone: string, now: Date) {
  let formatter: Intl.DateTimeFormat;
  try { formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }); }
  catch { return periodBounds(period, now); }
  const dateAt = (ms: number) => {
    const parts = formatter.formatToParts(ms), value = (type: string) => parts.find(part => part.type === type)!.value;
    return `${value("year")}-${value("month")}-${value("day")}`;
  };
  const today = dateAt(now.getTime()), base = Date.parse(`${today}T00:00:00Z`);
  const dateAfter = (days: number) => new Date(base + days * 86400_000).toISOString().slice(0, 10);
  const midnight = (date: string) => {
    const utc = Date.parse(`${date}T00:00:00Z`);
    let low = utc - 18 * 3600_000, high = utc + 18 * 3600_000;
    while (low < high) { const middle = Math.floor((low + high) / 2); if (dateAt(middle) < date) low = middle + 1; else high = middle; }
    return new Date(low).toISOString();
  };
  return { start: midnight(dateAfter(period === "30d" ? -29 : period === "7d" ? -6 : 0)), end: midnight(dateAfter(1)), today };
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
function waitingActivity(state: string) {
  const messages: Record<string, string> = {
    WAITING_FOR_PROVIDER: "รอความพร้อมก่อนดำเนินงาน",
    WAITING_FOR_APPROVAL: "รอคุณตรวจและยืนยัน",
    WAITING_FOR_DATA: "รอข้อมูลสำหรับงานนี้",
    WAITING_FOR_SLOT: "รอถึงเวลาที่กำหนด",
    WAITING_FOR_RECONCILIATION: "รอตรวจผลการดำเนินงาน",
    RETRY_PENDING: "รอลองดำเนินงานอีกครั้ง",
    PAUSED: "หยุดชั่วคราว",
    BLOCKED: "มีปัญหาที่ต้องดำเนินการ",
    FAILED: "งานล่าสุดไม่สำเร็จ",
  };
  return messages[state] ?? null;
}
function clipStatus(status: string) {
  if (status === "PUBLISHED") return "โพสต์แล้ว";
  if (["DRAFT_DELIVERED", "DRAFT_UPLOADED", "WAITING_FOR_USER"].includes(status)) return "รอคุณโพสต์";
  if (status === "FAILED" || status === "REJECTED") return "มีปัญหา";
  if (status === "REVIEW_REQUIRED" || status === "DRAFT") return "ต้องตรวจสอบ";
  if (status === "CANCELLED") return "ยกเลิกแล้ว";
  if (status === "SCHEDULED") return "ตั้งเวลาแล้ว";
  if (WAITING.has(status)) return "รอดำเนินการ";
  if (READY.has(status)) return "พร้อมโพสต์";
  if (status === "PROCESSING") return "กำลังสร้าง";
  return "กำลังเตรียม";
}
export function mapCustomerOverview(data: CustomerDataRecords, period: CustomerPeriod, now = new Date()): CustomerOverview {
  const bounds = periodBounds(period, now);
  const accounts = data.accounts.filter((row) => !row.is_mock && !row.hidden_at).map((row): CustomerAccount => {
    const active = data.runs.find((run) => ACTIVE.has(run.state) && data.states.some((state) =>
      state.auto_run_id === run.id && state.tiktok_account_id === row.id && ACTIVE.has(state.state)));
    const runStates = active ? data.states.filter((item) => item.auto_run_id === active.id) : [];
    const schedule = accountSchedule(row, data);
    const accountBounds = accountPeriodBounds(period, schedule.timezone, now);
    const today = accountBounds.today;
    const isToday = (value: string | null) => localDay(value, schedule.timezone) === today;
    const queue = data.queues.filter((item) => item.tiktok_account_id === row.id);
    const outputs = data.outputs?.filter((item) => item.tiktok_account_id === row.id) ?? [];
    const media = [...data.masters, ...data.variations].filter((item) => item.tiktok_account_id === row.id);
    const todayMedia = media.filter((item) => isToday(item.created_at));
    const todayQueue = queue.filter((item) => isToday(item.created_at));
    const state = runStates.find((item) => item.tiktok_account_id === row.id);
    const latestState = [...data.states].filter((item) => item.tiktok_account_id === row.id)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    const slots = data.scheduleSlots?.filter((slot) => slot.tiktok_account_id === row.id && slot.local_date === today) ?? [];
    const dueSlots = schedule.enabled ? slots.filter((slot) => ["PENDING", "CLAIMED"].includes(slot.state)
      && timestamp(slot.scheduled_at) <= now.getTime() && timestamp(slot.expires_at) > now.getTime()) : [];
    // Slot finalization uses FAILED for a consumed STOPPED run too. A user's
    // intentional STOP must not become a customer error or a failed clip.
    const schedulerFailureCount = slots.filter((slot) => slot.state === "FAILED"
      && (!slot.auto_run_id || data.runs.find((run) => run.id === slot.auto_run_id)?.state !== "STOPPED")).length;
    const schedulerQueued = dueSlots.length > 0;
    const futureSchedule = schedule.enabled && !!schedule.nextRunAt && timestamp(schedule.nextRunAt) > now.getTime();
    const single = Boolean(state && runStates.length === 1);
    const snapshots = data.snapshots.filter((item) => item.tiktok_account_id === row.id);
    const metrics = periodMetrics(snapshots, accountBounds.start, accountBounds.end);
    const connected = row.authorization_status === "authorized" && row.account_status === "active";
    const blocked = state && /BLOCK|WAITING_FOR_(PROVIDER|BUDGET|APPROVAL|HEALTH)/.test(state.state);
    const next = queue.filter((item) => item.scheduled_for && WAITING.has(item.status) && timestamp(item.scheduled_for) >= now.getTime())
      .sort((a, b) => timestamp(a.scheduled_for!) - timestamp(b.scheduled_for!))[0];
    const productSales = new Map<string, number>();
    const rankedVideos = new Set<string>();
    for (const snapshot of latestObservedSnapshots(snapshots, accountBounds.end)) {
      if (timestamp(snapshot.source_snapshot_at) < timestamp(accountBounds.start) || !snapshot.product_id || observedNumber(snapshot.gmv) === null) continue;
      const key = `${snapshot.video_kind}:${snapshot.video_id}`;
      if (rankedVideos.has(key)) continue;
      rankedVideos.add(key);
      const value = periodMetrics(snapshots.filter((item) => item.video_id === snapshot.video_id && item.video_kind === snapshot.video_kind), accountBounds.start, accountBounds.end).gmv;
      if (value !== null) productSales.set(snapshot.product_id, (productSales.get(snapshot.product_id) ?? 0) + value);
    }
    const topId = [...productSales].sort((a, b) => b[1] - a[1])[0]?.[0];
    const generatedIds = new Set(data.jobs.filter((job) => job.status === "COMPLETED" && isToday(job.completed_at))
      .map((job) => job.video_variation_id ?? job.master_video_id).filter((id) => media.some((item) => item.id === id)));
    const availability = data.availabilityByAccount?.[row.id] ?? data.postingAvailability;
    const postingBlocked = availability?.[schedule.postingMode]?.available === false;
    const waiting = state ? waitingActivity(state.state) : null;
    const recentFailure = !state && (latestState?.state === "FAILED" || schedulerFailureCount > 0);
    const postStatus = !connected && schedule.postingMode !== "EXPORT" ? "ต้องเชื่อมใหม่" : postingBlocked ? "ต้องดำเนินการ"
      : state?.state === "BLOCKED" || recentFailure ? "มีปัญหา" : waiting ?? (state ? "กำลังทำงาน"
        : schedulerQueued ? "รอเริ่มตามคิว" : queue.some((item) => WAITING.has(item.status)) ? "รอโพสต์" : futureSchedule ? "รอเริ่มตามเวลา" : "พร้อมเริ่ม");
    return {
      id: row.id, name: row.display_name, username: row.username, avatarUrl: customerImage(row.avatar_url), rank: null,
      connected, postStatus, liveStatus: null, mode: row.mode, target: schedule.clipsPerDay,
      hardLimit: row.daily_post_hard_limit, budget: observedNumber(row.daily_video_budget_usd) ?? 0, categories: row.preferred_categories ?? [],
      postCount: new Set([...queue.filter((item) => item.status === "PUBLISHED" && within(item.published_at, accountBounds.start, accountBounds.end)).map(item => item.video_id), ...outputs.filter(item => item.status === "PUBLISHED" && within(item.published_at ?? null, accountBounds.start, accountBounds.end)).map(item => item.video_id)]).size,
      today: { generated: generatedIds.size,
        generating: data.jobs.filter((job) => ["QUEUED", "PROCESSING", "RUNNING"].includes(job.status) && media.some((item) => item.id === (job.video_variation_id ?? job.master_video_id))).length,
        ready: new Set([...queue.filter((item) => item.status === "APPROVED").map((item) => item.video_id), ...outputs.filter((item) => item.status === "READY").map((item) => item.video_id)]).size,
        scheduled: new Set([...queue.filter((item) => item.scheduled_for && WAITING.has(item.status)).map((item) => item.video_id), ...outputs.filter((item) => item.status === "SCHEDULED").map((item) => item.video_id)]).size,
        published: new Set([...queue.filter((item) => item.status === "PUBLISHED" && isToday(item.published_at)).map((item) => item.video_id), ...outputs.filter((item) => item.status === "PUBLISHED" && isToday(item.published_at ?? null)).map((item) => item.video_id)]).size,
        waiting: new Set([...queue.filter((item) => item.status === "DRAFT_DELIVERED").map((item) => item.video_id), ...outputs.filter((item) => ["DRAFT_UPLOADED", "WAITING_FOR_USER"].includes(item.status)).map((item) => item.video_id)]).size,
        failed: new Set([...todayMedia.filter((item) => item.status === "FAILED").map((item) => item.id), ...todayQueue.filter((item) => item.status === "FAILED").map((item) => item.video_id), ...outputs.filter((item) => item.status === "FAILED" && isToday(item.created_at)).map((item) => item.video_id)]).size,
        review: new Set([...queue.filter((item) => item.status === "REVIEW_REQUIRED" || item.status === "DRAFT").map((item) => item.video_id), ...outputs.filter((item) => item.status === "REVIEW_REQUIRED").map((item) => item.video_id)]).size },
      metrics, currentActivity: state ? waiting ?? activity(state.current_step)
        : recentFailure ? "งานล่าสุดไม่สำเร็จ" : schedulerQueued ? "รอเริ่มงานตามคิว" : futureSchedule ? "รอถึงเวลาทำงาน" : "ยังไม่มีงานที่กำลังทำ",
      nextActivity: next ? "มีโพสต์ที่ตั้งเวลาไว้" : futureSchedule ? "มีงานประจำที่ตั้งเวลาไว้" : null,
      actionRequired: !connected && schedule.postingMode !== "EXPORT" ? { label: "เชื่อม TikTok ใหม่", href: `/accounts/${row.id}` }
        : postingBlocked ? { label: availability?.[schedule.postingMode]?.message ?? "บัญชีนี้ยังไม่พร้อมสำหรับวิธีโพสต์ที่เลือก", href: `/post/${row.id}` }
        : blocked ? { label: "ตรวจความพร้อมก่อนเริ่มงาน", href: `/post/${row.id}` }
        : recentFailure ? { label: "ตรวจการตั้งเวลาและเริ่มงานอีกครั้ง", href: `/post/${row.id}` } : null,
      nextScheduledPost: next?.scheduled_for ?? null, topProduct: data.products.find((item) => item.id === topId)?.title ?? null,
      schedulerQueued, scheduleQueueCount: dueSlots.length, schedulerFailureCount,
      hasActiveRun: Boolean(state),
      canStart: (connected || schedule.postingMode === "EXPORT") && !active && row.daily_post_hard_limit > 0,
      canStop: single || schedule.enabled, schedule, postingAvailability: availability,
    };
  });
  const rankCurrencies = new Set(accounts.filter((row) => row.metrics.gmv !== null).map((row) => row.metrics.currency));
  const ranked = rankCurrencies.size <= 1 ? [...accounts].filter((row) => row.metrics.gmv !== null).sort((a, b) => b.metrics.gmv! - a.metrics.gmv! || a.name.localeCompare(b.name)) : [];
  ranked.forEach((row, i) => { row.rank = i === 0 || row.metrics.gmv !== ranked[i - 1].metrics.gmv ? i + 1 : ranked[i - 1].rank; });
  const currencies = [...new Set(accounts.map((row) => row.metrics.currency))];
  const currency = currencies.length === 1 ? currencies[0] : null;
  return { period, updatedAt: now.toISOString(), startDate: bounds.start, endDate: bounds.end, accounts,
    summary: { currency, gmv: currency ? completeSum(accounts.map((row) => row.metrics.gmv)) : null, commission: currency ? completeSum(accounts.map((row) => row.metrics.commission)) : null,
      units: completeSum(accounts.map((row) => row.metrics.units)), views: completeSum(accounts.map((row) => row.metrics.views)), liveSessions: null, liveHours: null, salesPerHour: null,
      postCount: accounts.reduce((sum, row) => sum + row.postCount, 0) },
    analyticsNotice: "ยอดขายคือยอดขายรวม ไม่ใช่กำไร • ความคืบหน้ารายวันใช้เขตเวลาของแต่ละบัญชี • — หมายถึงยังไม่มีข้อมูลที่ยืนยันได้" };
}
export function mapCustomerPostAccount(data: CustomerDataRecords, accountId: string, period: CustomerPeriod, now = new Date(), retryAllowed = false): CustomerPostAccount | null {
  const overview = mapCustomerOverview(data, period, now), account = overview.accounts.find((row) => row.id === accountId);
  if (!account) return null;
  const bounds = accountPeriodBounds(period, account.schedule?.timezone ?? "UTC", now);
  const media = [...data.masters.map((row) => ({ ...row, kind: "MASTER" })), ...data.variations.map((row) => ({ ...row, kind: "VARIATION" }))];
  const clips = media.filter((row) => row.tiktok_account_id === accountId && within(row.created_at, bounds.start, bounds.end)).map((row): CustomerClip => {
    const queue = [...data.queues].filter((q) => q.tiktok_account_id === accountId && q.video_id === row.id && q.video_kind === row.kind).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const product = data.products.find((p) => p.id === row.product_id);
    const output = data.outputs?.filter((item) => item.tiktok_account_id === accountId && item.video_id === row.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const metrics = periodMetrics(data.snapshots.filter((s) => s.tiktok_account_id === accountId && s.video_id === row.id && s.video_kind === row.kind), bounds.start, bounds.end);
    const canRetry = Boolean(retryAllowed && queue && ["FAILED", "RETRYING"].includes(queue.status) && queue.retry_count < queue.max_retries
      && ["FAILED_RETRYABLE", "CONFIRMED", "SUBMITTED"].includes(queue.external_state));
    return { currency: metrics.currency, key: `${row.kind}:${row.id}`, title: product?.title ?? "คลิปของคุณ", product: product?.title ?? null,
      thumbnail: customerImage(product?.image_url ?? null), status: queue ? clipStatus(queue.status) : output ? clipStatus(output.status) : READY.has(row.status) ? "รอการตรวจ" : clipStatus(row.status), scheduledAt: queue?.scheduled_for ?? output?.suggested_post_at ?? null,
      postedAt: queue?.status === "PUBLISHED" ? queue.published_at : output?.status === "PUBLISHED" ? output.published_at ?? null : null, views: metrics.views, sales: metrics.gmv, canRetry, queueId: canRetry ? queue!.id : null,
      caption: queue?.caption_snapshot ?? output?.caption ?? null, hashtags: output?.hashtags_json?.filter((tag) => typeof tag === "string") ?? [],
      videoUrl: row.storage_path ? `/api/post/clips/${encodeURIComponent(row.id)}/video?kind=${row.kind}` : null,
      postingMode: output?.posting_mode ?? account.schedule?.postingMode ?? "AUTO",
      downloadUrl: output?.posting_mode === "EXPORT" && output.status === "READY" ? `/api/post/outputs/${encodeURIComponent(output.id)}/download` : null,
      reviewRequired: ["REVIEW_REQUIRED", "DRAFT"].includes(queue?.status ?? output?.status ?? ""),
      reviewUrl: output && ["REVIEW_REQUIRED", "DRAFT"].includes(queue?.status ?? output.status) ? `/api/post/outputs/${encodeURIComponent(output.id)}/review` : null,
      result: queue?.status === "PUBLISHED" ? "โพสต์สำเร็จ" : output?.status === "DRAFT_UPLOADED" ? "ส่งไปให้คุณโพสต์ใน TikTok แล้ว" : null };
  });
  return { account, clips, period, updatedAt: overview.updatedAt };
}
