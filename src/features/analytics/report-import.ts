import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Imports the owner's own exported reports (TikTok Studio content analytics, TikTok Shop affiliate
 * orders) while API access is pending. Rows are stored as OWNER_REPORT_IMPORT, never mixed with MOCK or
 * API rows, and every row points back to the file it came from. Nothing here estimates or fills in numbers. */
export const REPORT_IMPORT_VERSION = "owner-report-import-v1";
export type ReportKind = "VIDEO_PERFORMANCE" | "AFFILIATE_ORDERS";
type Row = Record<string, unknown>;

/** RFC 4180 CSV (also tab-separated), with a UTF-8 BOM and quoted fields allowed. */
export function parseDelimited(text: string): string[][] {
  const body = text.replace(/^﻿/, ""), first = body.split(/\r?\n/, 1)[0] ?? "";
  const sep = (first.match(/\t/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? "\t" : ",";
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) { if (c === '"' && body[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') quoted = false; else cell += c; continue }
    if (c === '"' && cell === "") quoted = true;
    else if (c === sep) { row.push(cell); cell = "" }
    else if (c === "\n" || c === "\r") { if (c === "\r" && body[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some(v => v.trim())) rows.push(row); row = [] }
    else cell += c;
  }
  row.push(cell); if (row.some(v => v.trim())) rows.push(row);
  return rows;
}

const key = (h: string) => h.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
// Header names as the English and Thai TikTok dashboards export them. Unknown headers are reported, not guessed.
const VIDEO_COLUMNS: Record<string, string[]> = {
  link: ["Video link", "Video URL", "Link", "Post link", "ลิงก์วิดีโอ", "ลิงก์โพสต์"], videoId: ["Video ID", "Post ID", "รหัสวิดีโอ", "ไอดีวิดีโอ"],
  postedAt: ["Post time", "Posted", "Date posted", "Posted on", "Create time", "เวลาที่โพสต์", "วันที่โพสต์", "โพสต์เมื่อ"],
  views: ["Video views", "Views", "Total views", "Total play", "ยอดดู", "ยอดดูวิดีโอ", "จำนวนการดู"], likes: ["Likes", "Total likes", "ยอดไลก์", "ถูกใจ", "การกดถูกใจ"],
  comments: ["Comments", "Total comments", "ความคิดเห็น"], shares: ["Shares", "Total shares", "การแชร์", "แชร์"], favorites: ["Saves", "Favorites", "Add to Favorites", "บันทึก", "รายการโปรด"],
  newFollowers: ["New followers", "Followers gained", "Followers", "ผู้ติดตามใหม่", "ผู้ติดตามที่เพิ่มขึ้น"],
  avgWatch: ["Average watch time", "Avg. watch time", "Average time watched", "เวลาดูเฉลี่ย", "ระยะเวลาการดูเฉลี่ย"],
  fullWatch: ["Watched full video", "Full video watch rate", "Finish rate", "Completion rate", "ดูจนจบ", "อัตราการดูจนจบ"],
  duration: ["Duration", "Video duration", "ความยาววิดีโอ"],
};
const ORDER_COLUMNS: Record<string, string[]> = {
  orderId: ["Order ID", "Order id", "รหัสคำสั่งซื้อ", "หมายเลขคำสั่งซื้อ"], productId: ["Product ID", "รหัสสินค้า"], productName: ["Product name", "Product", "ชื่อสินค้า"],
  channel: ["Content type", "Content Type", "Source", "ประเภทเนื้อหา", "ช่องทาง"], contentId: ["Content ID", "Video ID", "LIVE ID", "รหัสเนื้อหา"],
  gmv: ["GMV", "Payment amount", "Order amount", "ยอดขาย", "ยอดชำระ"], estimated: ["Estimated commission", "Est. commission", "Estimated earnings", "ค่าคอมมิชชันโดยประมาณ", "ค่าคอมโดยประมาณ"],
  settled: ["Actual commission", "Settled commission", "Commission paid", "ค่าคอมมิชชันจริง", "ค่าคอมที่ได้รับ"], status: ["Order status", "Status", "สถานะคำสั่งซื้อ", "สถานะ"],
  createdAt: ["Order created time", "Created time", "Order time", "Time created", "เวลาสั่งซื้อ", "วันที่สั่งซื้อ"], quantity: ["Quantity", "Items", "จำนวน"],
};
function columns(header: string[], map: Record<string, string[]>) {
  const index: Record<string, number> = {}, keys = header.map(key);
  for (const [field, names] of Object.entries(map)) { const i = keys.findIndex(k => names.some(n => key(n) === k)); if (i >= 0) index[field] = i }
  return { index, unknown: header.filter((_, i) => !Object.values(index).includes(i)).filter(h => h.trim()) };
}

/** "1,234", "12.5K", "3.4M", "฿1,234.50", "23.5%" and "-" as dashboards print them; anything else is null, never 0. */
export function reportNumber(raw: string | undefined, kind: "count" | "money" | "rate" | "seconds" = "count"): number | null {
  const v = (raw ?? "").trim().replace(/^[฿$]|\s*(THB|บาท|USD)$/i, "").replace(/,/g, "");
  if (!v || v === "-" || v === "--" || /^n\/?a$/i.test(v)) return null;
  if (kind === "seconds") {
    const clock = /^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/.exec(v); if (clock) return Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
    const s = /^(\d+(?:\.\d+)?)\s*(s|sec|วินาที)?$/i.exec(v); return s ? Number(s[1]) : null;
  }
  if (kind === "rate") { const p = /^(\d+(?:\.\d+)?)\s*%$/.exec(v); if (p) return Number(p[1]) / 100; const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null }
  const m = /^(\d+(?:\.\d+)?)\s*([kKmMbB]?)$/.exec(v); if (!m) return null;
  const n = Number(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase() as "k" | "m" | "b"] ?? 1);
  return kind === "count" ? Math.round(n) : Math.round(n * 100) / 100;
}
/** Dates as exported: ISO, "2026-10-21 18:30", "21/10/2026 18:30" (day first, as Thai dashboards print), in the account's timezone offset. */
export function reportDate(raw: string | undefined, offset = "+07:00"): string | null {
  const v = (raw ?? "").trim(); if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(v)) { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null }
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(v);
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(v);
  const p = iso ? [iso[1], iso[2], iso[3], iso[4], iso[5], iso[6]] : dmy ? [dmy[3], dmy[2], dmy[1], dmy[4], dmy[5], dmy[6]] : null;
  if (!p) return null;
  let year = Number(p[0]); if (year > 2400) year -= 543; // Buddhist-era years
  const pad = (x: string | undefined, d = "00") => (x ?? d).padStart(2, "0");
  const t = Date.parse(`${year}-${pad(p[1])}-${pad(p[2])}T${pad(p[3])}:${pad(p[4])}:${pad(p[5])}${offset}`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
export const tiktokVideoId = (value: string | undefined) => /(?:\/video\/|^)([0-9]{8,25})(?:[/?#]|$)/.exec((value ?? "").trim())?.[1] ?? null;
export function reportChannel(raw: string | undefined): "VIDEO" | "LIVE" | "SHOWCASE" | "UNKNOWN" {
  const v = (raw ?? "").trim().toLowerCase();
  return /live|ไลฟ์|ถ่ายทอดสด/.test(v) ? "LIVE" : /video|วิดีโอ|คลิป/.test(v) ? "VIDEO" : /showcase|โชว์เคส|ร้านค้า/.test(v) ? "SHOWCASE" : "UNKNOWN";
}

export interface ParsedVideoRow { line: number; externalVideoId: string; postUrl: string | null; publishedAt: string | null; views: number | null; likes: number | null;
  comments: number | null; shares: number | null; favorites: number | null; newFollowers: number | null; averageWatchSeconds: number | null; fullWatchRate: number | null; durationSeconds: number | null }
export interface ParsedOrderRow { line: number; orderId: string; productExternalId: string | null; productName: string | null; channel: "VIDEO" | "LIVE" | "SHOWCASE" | "UNKNOWN";
  contentId: string | null; gmv: number | null; estimatedCommission: number | null; settledCommission: number | null; status: string; eventType: "ORDER_CREATED" | "ORDER_SETTLED" | "ORDER_CANCELLED"; occurredAt: string | null; quantity: number | null }
export interface ParsedReport<T> { kind: ReportKind; rows: T[]; rejections: Array<{ line: number; reason: string }>; unknownColumns: string[]; recognizedColumns: string[] }

export function parseVideoReport(text: string): ParsedReport<ParsedVideoRow> {
  const table = parseDelimited(text), [header = [], ...data] = table, { index, unknown } = columns(header, VIDEO_COLUMNS);
  const rejections: ParsedReport<ParsedVideoRow>["rejections"] = [], rows: ParsedVideoRow[] = [], seen = new Set<string>();
  if (index.link === undefined && index.videoId === undefined) return { kind: "VIDEO_PERFORMANCE", rows, rejections: [{ line: 1, reason: "NO_VIDEO_LINK_OR_ID_COLUMN" }], unknownColumns: unknown, recognizedColumns: Object.keys(index) };
  if (index.views === undefined) rejections.push({ line: 1, reason: "NO_VIEWS_COLUMN" });
  data.forEach((cells, i) => {
    const line = i + 2, get = (f: string) => index[f] === undefined ? undefined : cells[index[f]];
    const id = tiktokVideoId(get("videoId")) ?? tiktokVideoId(get("link"));
    if (!id) { rejections.push({ line, reason: "VIDEO_ID_MISSING" }); return }
    if (seen.has(id)) { rejections.push({ line, reason: "DUPLICATE_VIDEO_IN_FILE" }); return }
    const views = reportNumber(get("views"));
    if (views === null) { rejections.push({ line, reason: "VIEWS_MISSING" }); return }
    seen.add(id);
    rows.push({ line, externalVideoId: id, postUrl: get("link")?.trim().startsWith("https://") ? get("link")!.trim() : null, publishedAt: reportDate(get("postedAt")), views,
      likes: reportNumber(get("likes")), comments: reportNumber(get("comments")), shares: reportNumber(get("shares")), favorites: reportNumber(get("favorites")),
      newFollowers: reportNumber(get("newFollowers")), averageWatchSeconds: reportNumber(get("avgWatch"), "seconds"), fullWatchRate: reportNumber(get("fullWatch"), "rate"),
      durationSeconds: reportNumber(get("duration"), "seconds") });
  });
  return { kind: "VIDEO_PERFORMANCE", rows, rejections, unknownColumns: unknown, recognizedColumns: Object.keys(index) };
}

export function parseOrderReport(text: string): ParsedReport<ParsedOrderRow> {
  const table = parseDelimited(text), [header = [], ...data] = table, { index, unknown } = columns(header, ORDER_COLUMNS);
  const rejections: ParsedReport<ParsedOrderRow>["rejections"] = [], rows: ParsedOrderRow[] = [], seen = new Set<string>();
  if (index.orderId === undefined) return { kind: "AFFILIATE_ORDERS", rows, rejections: [{ line: 1, reason: "NO_ORDER_ID_COLUMN" }], unknownColumns: unknown, recognizedColumns: Object.keys(index) };
  data.forEach((cells, i) => {
    const line = i + 2, get = (f: string) => index[f] === undefined ? undefined : cells[index[f]];
    const orderId = get("orderId")?.trim(), status = (get("status") ?? "").trim();
    if (!orderId) { rejections.push({ line, reason: "ORDER_ID_MISSING" }); return }
    const eventType = /cancel|refund|ยกเลิก|คืนเงิน/i.test(status) ? "ORDER_CANCELLED" as const : /settled|completed|paid|สำเร็จ|ชำระแล้ว|ได้รับแล้ว/i.test(status) ? "ORDER_SETTLED" as const : "ORDER_CREATED" as const;
    const dedupe = `${orderId}:${get("productId") ?? ""}:${eventType}`;
    if (seen.has(dedupe)) { rejections.push({ line, reason: "DUPLICATE_ORDER_LINE_IN_FILE" }); return }
    seen.add(dedupe);
    const occurredAt = reportDate(get("createdAt"));
    if (!occurredAt) { rejections.push({ line, reason: "ORDER_TIME_MISSING" }); return }
    rows.push({ line, orderId, productExternalId: get("productId")?.trim() || null, productName: get("productName")?.trim() || null, channel: reportChannel(get("channel")),
      contentId: get("contentId")?.trim() || null, gmv: reportNumber(get("gmv"), "money"), estimatedCommission: reportNumber(get("estimated"), "money"),
      settledCommission: reportNumber(get("settled"), "money"), status, eventType, occurredAt, quantity: reportNumber(get("quantity")) });
  });
  return { kind: "AFFILIATE_ORDERS", rows, rejections, unknownColumns: unknown, recognizedColumns: Object.keys(index) };
}

/** Video ids are uuids in the analytics table; posts made outside this system get a stable id from their TikTok id. */
export function externalVideoUuid(accountId: string, externalVideoId: string) {
  const h = createHash("sha256").update(`viralflow-external-video:${accountId}:${externalVideoId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${(8 | parseInt(h[16], 16) & 3).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Stores one exported report. The same file for the same account is imported once; a mock account is refused.
 * `reportedAt` is when the owner exported the report: the counters are lifetime totals as of that moment. */
export async function importOwnerReport(client: SupabaseClient, owner: string, input: { accountId: string; kind: ReportKind; fileName: string; text: string; reportedAt: Date }) {
  if (!Number.isFinite(input.reportedAt.getTime()) || input.reportedAt.getTime() > Date.now() + 300_000) throw new Error("REPORT_TIME_INVALID");
  if (input.text.length > 5_000_000) throw new Error("REPORT_TOO_LARGE");
  const account = await client.from("tiktok_accounts").select("id,is_mock").eq("owner_id", owner).eq("id", input.accountId).maybeSingle();
  if (account.error || !account.data) throw new Error("REPORT_ACCOUNT_NOT_FOUND");
  // Real results only: a mock account's numbers could never be told apart from invented ones later.
  if (account.data.is_mock !== false) throw new Error("REPORT_ACCOUNT_IS_MOCK");
  const sha = createHash("sha256").update(input.text).digest("hex");
  const prior = await client.from("performance_import_batches").select("*").eq("owner_id", owner).eq("tiktok_account_id", input.accountId).eq("kind", input.kind).eq("file_sha256", sha).maybeSingle();
  if (prior.error) throw new Error(prior.error.message);
  if (prior.data) return { status: "ALREADY_IMPORTED" as const, batch: prior.data as Row };
  const parsed = input.kind === "VIDEO_PERFORMANCE" ? parseVideoReport(input.text) : parseOrderReport(input.text);
  const batchId = randomUUID(), at = input.reportedAt.toISOString();
  let linked = 0, records: Row[] = [];
  if (input.kind === "VIDEO_PERFORMANCE") {
    const rows = parsed.rows as ParsedVideoRow[];
    const bank = rows.length ? await client.from("content_bank_items").select("master_video_id,external_video_id,posted_at").eq("owner_id", owner)
      .eq("tiktok_account_id", input.accountId).in("external_video_id", rows.map(r => r.externalVideoId)) : { data: [], error: null };
    if (bank.error) throw new Error(bank.error.message);
    const masters = (bank.data ?? []).length ? await client.from("master_videos").select("id,creative_project_id,selected_script_id,product_id").eq("owner_id", owner)
      .in("id", (bank.data ?? []).map(b => String(b.master_video_id))) : { data: [], error: null };
    if (masters.error) throw new Error(masters.error.message);
    records = rows.map(r => {
      const item = (bank.data ?? []).find(b => b.external_video_id === r.externalVideoId), master = (masters.data ?? []).find(m => m.id === item?.master_video_id);
      if (master) linked++;
      return { owner_id: owner, tiktok_account_id: input.accountId, video_id: master ? master.id : externalVideoUuid(input.accountId, r.externalVideoId),
        video_kind: master ? "MASTER" : "EXTERNAL", external_video_id: r.externalVideoId, product_id: master?.product_id ?? null,
        creative_project_id: master?.creative_project_id ?? null, script_id: master?.selected_script_id ?? null,
        source: "OWNER_REPORT_IMPORT", source_snapshot_at: at, published_at: r.publishedAt ?? item?.posted_at ?? null, duration_seconds: r.durationSeconds,
        views: r.views, likes: r.likes, comments: r.comments, shares: r.shares, favorites: r.favorites, new_followers: r.newFollowers,
        average_watch_seconds: r.averageWatchSeconds, full_watch_rate: r.fullWatchRate, import_batch_id: batchId,
        // Owner-exported counters are real but not fetched by this system, so they carry less confidence than API rows.
        source_confidence: .8, availability_json: { counters: "LIFETIME_AT_EXPORT", newFollowers: r.newFollowers === null ? "NOT_IN_REPORT" : "PLATFORM_ATTRIBUTED_PER_POST",
          publishedAt: r.publishedAt ? "REPORT" : item?.posted_at ? "OWNER_RECORDED_POST" : "UNKNOWN" },
        raw_metadata_json: { importVersion: REPORT_IMPORT_VERSION, line: r.line, postUrl: r.postUrl } };
    });
  } else {
    const rows = parsed.rows as ParsedOrderRow[];
    const products = rows.some(r => r.productExternalId) ? await client.from("products").select("id,external_product_id").eq("owner_id", owner)
      .in("external_product_id", [...new Set(rows.flatMap(r => r.productExternalId ? [r.productExternalId] : []))]) : { data: [], error: null };
    if (products.error) throw new Error(products.error.message);
    records = rows.map(r => {
      const product = (products.data ?? []).find(p => p.external_product_id === r.productExternalId);
      if (product) linked++;
      return { owner_id: owner, tiktok_account_id: input.accountId, product_id: product?.id ?? null, external_order_id: r.orderId,
        external_event_id: `${r.orderId}:${r.productExternalId ?? ""}:${r.eventType}`, external_video_id: r.channel === "VIDEO" ? r.contentId : null,
        event_type: r.eventType, attribution_type: r.channel, channel: r.channel, quantity: r.quantity, gmv: r.gmv, estimated_commission: r.estimatedCommission,
        settled_commission: r.settledCommission, currency: "THB", occurred_at: r.occurredAt, source: "OWNER_REPORT_IMPORT", import_batch_id: batchId,
        raw_metadata_json: { importVersion: REPORT_IMPORT_VERSION, line: r.line, status: r.status, productName: r.productName, contentId: r.contentId } };
    });
  }
  const batch = { id: batchId, owner_id: owner, tiktok_account_id: input.accountId, kind: input.kind, file_name: input.fileName.slice(0, 300), file_sha256: sha,
    report_format: `${REPORT_IMPORT_VERSION}:${parsed.recognizedColumns.sort().join(",")}`, rows_read: parsed.rows.length + parsed.rejections.filter(r => r.line > 1).length,
    rows_imported: records.length, rows_linked: linked, rejections: [...parsed.rejections, ...parsed.unknownColumns.map(c => ({ line: 1, reason: `COLUMN_NOT_USED:${c}` }))] };
  const saved = await client.from("performance_import_batches").insert(batch).select("*").single();
  if (saved.error) throw new Error(saved.error.message);
  if (records.length) {
    const table = input.kind === "VIDEO_PERFORMANCE" ? "video_analytics_snapshots" : "affiliate_conversion_events";
    const inserted = await client.from(table).upsert(records, { onConflict: input.kind === "VIDEO_PERFORMANCE" ? "owner_id,source,external_video_id,source_snapshot_at" : "owner_id,source,external_event_id", ignoreDuplicates: true });
    if (inserted.error) { await client.from("performance_import_batches").delete().eq("owner_id", owner).eq("id", batchId); throw new Error(inserted.error.message) }
  }
  return { status: "IMPORTED" as const, batch: saved.data as Row, parsed: { rows: parsed.rows.length, rejections: parsed.rejections, unknownColumns: parsed.unknownColumns } };
}

/** VIDEO and LIVE revenue from imported orders, each order line counted once under the channel the report gives it. */
export function channelRevenue(orders: Array<{ channel: string; event_type: string; external_order_id: string; external_event_id: string; gmv: number | null; estimated_commission: number | null; settled_commission: number | null }>) {
  const latest = new Map<string, (typeof orders)[number]>();
  // An order line moves CREATED -> SETTLED or CANCELLED; the furthest state wins so it is not counted twice.
  const rank = (e: string) => e === "ORDER_CANCELLED" ? 3 : e === "ORDER_SETTLED" ? 2 : 1;
  for (const o of orders) { const k = o.external_event_id.replace(/:ORDER_(CREATED|SETTLED|CANCELLED)$/, ""), prior = latest.get(k); if (!prior || rank(o.event_type) > rank(prior.event_type)) latest.set(k, o) }
  const out: Record<string, { orders: number; gmv: number; estimatedCommission: number; settledCommission: number; cancelled: number }> = {};
  for (const o of latest.values()) {
    const c = out[o.channel] ??= { orders: 0, gmv: 0, estimatedCommission: 0, settledCommission: 0, cancelled: 0 };
    if (o.event_type === "ORDER_CANCELLED") { c.cancelled++; continue }
    c.orders++; c.gmv += o.gmv ?? 0; c.estimatedCommission += o.estimated_commission ?? 0; c.settledCommission += o.settled_commission ?? 0;
  }
  return out;
}
