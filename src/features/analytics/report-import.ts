import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Imports the owner's own exported reports (TikTok Studio content analytics, TikTok Shop affiliate
 * orders) while API access is pending. Rows are stored as OWNER_REPORT_IMPORT, never mixed with MOCK or
 * API rows, and every row points back to the file it came from. Nothing here estimates or fills in numbers. */
export const REPORT_IMPORT_VERSION = "owner-report-import-v1";
export type ReportKind = "VIDEO_PERFORMANCE" | "AFFILIATE_ORDERS";
type Row = Record<string, unknown>;

/** RFC 4180 CSV (also tab-separated), with a UTF-8 BOM and quoted fields allowed. */
export function reportDelimiter(text: string): "\t" | "," {
  const first = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  return (first.match(/\t/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? "\t" : ",";
}
export function parseDelimited(text: string): string[][] {
  const body = text.replace(/^\uFEFF/, ""), sep = reportDelimiter(body);
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
  // Whole English words only: "Delivered" must not read as LIVE. Anything unrecognised stays UNKNOWN, never VIDEO or LIVE.
  return /\blive\b|ไลฟ์|ถ่ายทอดสด/.test(v) ? "LIVE" : /\bvideos?\b|วิดีโอ|คลิป/.test(v) ? "VIDEO" : /\bshowcase\b|โชว์เคส|ร้านค้า/.test(v) ? "SHOWCASE" : "UNKNOWN";
}
/** Order status as exported. "Unpaid" or "ไม่สำเร็จ" is not a settled order; a failed order earns nothing, like a cancelled one. */
export function reportOrderEvent(raw: string | undefined): "ORDER_CREATED" | "ORDER_SETTLED" | "ORDER_CANCELLED" {
  const v = (raw ?? "").trim();
  if (/\b(cancel\w*|refund\w*|failed)\b|ยกเลิก|คืนเงิน|ไม่สำเร็จ|ล้มเหลว/i.test(v)) return "ORDER_CANCELLED";
  return /\b(settled|completed|paid)\b|สำเร็จ|ชำระแล้ว|ได้รับแล้ว/i.test(v) ? "ORDER_SETTLED" : "ORDER_CREATED";
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
    const eventType = reportOrderEvent(status);
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

/** The file's identity for "already imported": the decoded text, exactly as import stores it. */
export const reportFileSha256 = (text: string) => createHash("sha256").update(text).digest("hex");

async function assertRealAccount(client: SupabaseClient, owner: string, accountId: string) {
  const account = await client.from("tiktok_accounts").select("id,is_mock").eq("owner_id", owner).eq("id", accountId).maybeSingle();
  if (account.error || !account.data) throw new Error("REPORT_ACCOUNT_NOT_FOUND");
  // Real results only: a mock account's numbers could never be told apart from invented ones later.
  if (account.data.is_mock !== false) throw new Error("REPORT_ACCOUNT_IS_MOCK");
}
async function priorImport(client: SupabaseClient, owner: string, accountId: string, kind: ReportKind, sha: string) {
  const prior = await client.from("performance_import_batches").select("*").eq("owner_id", owner).eq("tiktok_account_id", accountId).eq("kind", kind).eq("file_sha256", sha).maybeSingle();
  if (prior.error) throw new Error(prior.error.message);
  return (prior.data ?? null) as Row | null;
}
/** Posted content-bank clips by TikTok video id, with the master video they were rendered from (when it still exists). */
async function contentBankLinks(client: SupabaseClient, owner: string, accountId: string, externalIds: string[]) {
  const out = new Map<string, { item: Row; master: Row | undefined }>();
  if (!externalIds.length) return out;
  const bank = await client.from("content_bank_items").select("master_video_id,external_video_id,posted_at").eq("owner_id", owner)
    .eq("tiktok_account_id", accountId).in("external_video_id", [...new Set(externalIds)]);
  if (bank.error) throw new Error(bank.error.message);
  const items = (bank.data ?? []) as Row[];
  const masters = items.length ? await client.from("master_videos").select("id,creative_project_id,selected_script_id,product_id").eq("owner_id", owner)
    .in("id", items.map(b => String(b.master_video_id))) : { data: [], error: null };
  if (masters.error) throw new Error(masters.error.message);
  for (const item of items) out.set(String(item.external_video_id), { item, master: ((masters.data ?? []) as Row[]).find(m => m.id === item.master_video_id) });
  return out;
}
async function productLinks(client: SupabaseClient, owner: string, externalIds: string[]) {
  const out = new Map<string, Row>();
  if (!externalIds.length) return out;
  const products = await client.from("products").select("id,external_product_id").eq("owner_id", owner).in("external_product_id", [...new Set(externalIds)]);
  if (products.error) throw new Error(products.error.message);
  for (const p of (products.data ?? []) as Row[]) out.set(String(p.external_product_id), p);
  return out;
}

/** Stores one exported report. The same file for the same account is imported once; a mock account is refused.
 * `reportedAt` is when the owner exported the report: the counters are lifetime totals as of that moment. */
export async function importOwnerReport(client: SupabaseClient, owner: string, input: { accountId: string; kind: ReportKind; fileName: string; text: string; reportedAt: Date }) {
  if (!Number.isFinite(input.reportedAt.getTime()) || input.reportedAt.getTime() > Date.now() + 300_000) throw new Error("REPORT_TIME_INVALID");
  if (input.text.length > 5_000_000) throw new Error("REPORT_TOO_LARGE");
  await assertRealAccount(client, owner, input.accountId);
  const sha = reportFileSha256(input.text);
  const prior = await priorImport(client, owner, input.accountId, input.kind, sha);
  if (prior) return { status: "ALREADY_IMPORTED" as const, batch: prior };
  const parsed = input.kind === "VIDEO_PERFORMANCE" ? parseVideoReport(input.text) : parseOrderReport(input.text);
  const batchId = randomUUID(), at = input.reportedAt.toISOString();
  let linked = 0, records: Row[] = [];
  if (input.kind === "VIDEO_PERFORMANCE") {
    const rows = parsed.rows as ParsedVideoRow[];
    const bank = await contentBankLinks(client, owner, input.accountId, rows.map(r => r.externalVideoId));
    records = rows.map(r => {
      const { item, master } = bank.get(r.externalVideoId) ?? { item: undefined, master: undefined };
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
    const products = await productLinks(client, owner, rows.flatMap(r => r.productExternalId ? [r.productExternalId] : []));
    records = rows.map(r => {
      const product = r.productExternalId ? products.get(r.productExternalId) : undefined;
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

/** VIDEO and LIVE revenue from imported orders, each order line counted once under the channel the report gives it.
 * MOCK rows are never revenue; UNKNOWN and SHOWCASE stay in their own buckets and are never added to VIDEO or LIVE. */
export function channelRevenue(orders: Array<{ channel: string; event_type: string; external_order_id: string; external_event_id: string; gmv: number | null; estimated_commission: number | null; settled_commission: number | null; source?: string | null }>) {
  const latest = new Map<string, (typeof orders)[number]>();
  // An order line moves CREATED -> SETTLED or CANCELLED; the furthest state wins so it is not counted twice.
  const rank = (e: string) => e === "ORDER_CANCELLED" ? 3 : e === "ORDER_SETTLED" ? 2 : 1;
  for (const o of orders) {
    if (o.source === "MOCK") continue;
    const k = o.external_event_id.replace(/:(ORDER_CREATED|ORDER_SETTLED|ORDER_CANCELLED|COMMISSION_UPDATED)$/, ""), prior = latest.get(k);
    if (!prior || rank(o.event_type) > rank(prior.event_type)) latest.set(k, o);
  }
  const out: Record<string, { orders: number; gmv: number; estimatedCommission: number; settledCommission: number; cancelled: number }> = {};
  for (const o of latest.values()) {
    const c = out[o.channel] ??= { orders: 0, gmv: 0, estimatedCommission: 0, settledCommission: 0, cancelled: 0 };
    if (o.event_type === "ORDER_CANCELLED") { c.cancelled++; continue }
    c.orders++; c.gmv += o.gmv ?? 0; c.estimatedCommission += o.estimated_commission ?? 0; c.settledCommission += o.settled_commission ?? 0;
  }
  return out;
}

/** Turns the uploaded bytes into text the parsers read: UTF-8 (BOM or not), UTF-16 with a BOM (Excel "Unicode text"),
 * or Thai Windows-874 when the bytes are not valid UTF-8 (Excel "CSV" on Thai Windows). Excel workbooks are refused. */
export function decodeReportFile(bytes: Uint8Array): string {
  if (!bytes.length) throw new Error("REPORT_EMPTY");
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) throw new Error("REPORT_IS_EXCEL"); // .xlsx (zip)
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) throw new Error("REPORT_IS_EXCEL"); // legacy .xls
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes) }
  catch { return new TextDecoder("windows-874").decode(bytes) }
}

/** Which report the header looks like, from the same column names the parsers use. An order ID column means orders. */
export function detectReportKind(text: string): ReportKind | null {
  const header = parseDelimited(text)[0] ?? [];
  if (columns(header, ORDER_COLUMNS).index.orderId !== undefined) return "AFFILIATE_ORDERS";
  const video = columns(header, VIDEO_COLUMNS).index;
  return video.link !== undefined || video.videoId !== undefined ? "VIDEO_PERFORMANCE" : null;
}

const REJECTION_TH: Record<string, string> = {
  NO_VIDEO_LINK_OR_ID_COLUMN: "ไม่พบคอลัมน์ลิงก์วิดีโอหรือรหัสวิดีโอ ตรวจว่าเลือกประเภทรายงานถูกต้อง",
  NO_VIEWS_COLUMN: "ไม่พบคอลัมน์ยอดดู ทุกแถวจึงนำเข้าไม่ได้",
  VIDEO_ID_MISSING: "ไม่พบลิงก์หรือรหัสวิดีโอ TikTok ที่ถูกต้อง",
  DUPLICATE_VIDEO_IN_FILE: "วิดีโอนี้ซ้ำกับแถวก่อนหน้าในไฟล์เดียวกัน",
  VIEWS_MISSING: "ไม่มียอดดู ระบบไม่เดาเป็น 0",
  NO_ORDER_ID_COLUMN: "ไม่พบคอลัมน์รหัสคำสั่งซื้อ ตรวจว่าเลือกประเภทรายงานถูกต้อง",
  ORDER_ID_MISSING: "ไม่มีรหัสคำสั่งซื้อ",
  DUPLICATE_ORDER_LINE_IN_FILE: "คำสั่งซื้อ สินค้า และสถานะเดียวกันซ้ำในไฟล์",
  ORDER_TIME_MISSING: "ไม่มีเวลาสั่งซื้อ หรืออ่านรูปแบบวันที่ไม่ได้",
};
/** The Thai explanation the owner sees for a parser rejection code. */
export function rejectionMessage(reason: string): string {
  if (reason.startsWith("COLUMN_NOT_USED:")) return `ไม่ได้ใช้คอลัมน์ "${reason.slice(16)}"`;
  return REJECTION_TH[reason] ?? `แถวนี้นำเข้าไม่ได้ (${reason})`;
}

export const PREVIEW_SAMPLE_ROWS = 10;
export interface ReportPreview {
  kind: ReportKind; detectedKind: ReportKind | null; format: "CSV" | "TSV"; fileSha256: string;
  rowsRead: number; rowsAccepted: number; sample: Array<ParsedVideoRow | ParsedOrderRow>;
  rejections: Array<{ line: number; reason: string; message: string }>; unknownColumns: string[]; recognizedColumns: string[];
  /** Why nothing in this file can be imported as the chosen kind, or null when import can go ahead. */
  blocking: { reason: string; message: string } | null;
  alreadyImported: { importedAt: string | null; fileName: string | null; rowsImported: number | null } | null;
  /** Video rows that match a posted content-bank clip, or order rows that match one of the owner's products; null when not checked. */
  linkedRows: number | null;
  /** Orders only: VIDEO / LIVE / SHOWCASE / UNKNOWN kept apart exactly as import will count them. */
  channels: ReturnType<typeof channelRevenue> | null;
}

/** Parses an export the way import will, without storing anything. `prior` is the batch already holding this exact file,
 * `linkKeys` the TikTok video ids (video report) or product ids (order report) that import would link. */
export function buildReportPreview(input: { kind: ReportKind; text: string; prior?: Row | null; linkKeys?: ReadonlySet<string> | null }): ReportPreview {
  const parsed = input.kind === "VIDEO_PERFORMANCE" ? parseVideoReport(input.text) : parseOrderReport(input.text);
  const detectedKind = detectReportKind(input.text), header = parsed.rejections.find(r => r.line === 1 && /^NO_.*_COLUMN$/.test(r.reason));
  const rows = parsed.rows as Array<ParsedVideoRow | ParsedOrderRow>;
  const blockingReason = detectedKind && detectedKind !== input.kind ? "KIND_MISMATCH" : header && !rows.length ? header.reason : !rows.length ? "NO_ROWS" : null;
  const blockingText: Record<string, string> = {
    KIND_MISMATCH: detectedKind === "AFFILIATE_ORDERS" ? "ไฟล์นี้ดูเหมือนรายงานคำสั่งซื้อ Affiliate เปลี่ยนประเภทรายงานก่อนนำเข้า" : "ไฟล์นี้ดูเหมือนรายงานผลวิดีโอจาก TikTok Studio เปลี่ยนประเภทรายงานก่อนนำเข้า",
    NO_ROWS: "ไม่มีแถวที่นำเข้าได้ในไฟล์นี้",
  };
  const link = input.linkKeys ?? null;
  const linkedRows = link ? rows.filter(r => "externalVideoId" in r ? link.has(r.externalVideoId) : r.productExternalId !== null && link.has(r.productExternalId)).length : null;
  const orders = input.kind === "AFFILIATE_ORDERS" ? (parsed.rows as ParsedOrderRow[]) : null;
  return {
    kind: input.kind, detectedKind, format: reportDelimiter(input.text) === "\t" ? "TSV" : "CSV", fileSha256: reportFileSha256(input.text),
    rowsRead: parsed.rows.length + parsed.rejections.filter(r => r.line > 1).length, rowsAccepted: parsed.rows.length, sample: rows.slice(0, PREVIEW_SAMPLE_ROWS),
    rejections: parsed.rejections.map(r => ({ ...r, message: rejectionMessage(r.reason) })), unknownColumns: parsed.unknownColumns, recognizedColumns: parsed.recognizedColumns,
    blocking: blockingReason ? { reason: blockingReason, message: blockingText[blockingReason] ?? rejectionMessage(blockingReason) } : null,
    alreadyImported: input.prior ? { importedAt: typeof input.prior.imported_at === "string" ? input.prior.imported_at : null,
      fileName: typeof input.prior.file_name === "string" ? input.prior.file_name : null,
      rowsImported: typeof input.prior.rows_imported === "number" ? input.prior.rows_imported : null } : null,
    linkedRows,
    channels: orders ? channelRevenue(orders.map(o => ({ channel: o.channel, event_type: o.eventType, external_order_id: o.orderId,
      external_event_id: `${o.orderId}:${o.productExternalId ?? ""}:${o.eventType}`, gmv: o.gmv, estimated_commission: o.estimatedCommission, settled_commission: o.settledCommission }))) : null,
  };
}

/** Preview for one of the owner's real accounts: same account rule as import (mock refused), reads only. */
export async function previewOwnerReport(client: SupabaseClient, owner: string, input: { accountId: string; kind: ReportKind; text: string }) {
  if (input.text.length > 5_000_000) throw new Error("REPORT_TOO_LARGE");
  await assertRealAccount(client, owner, input.accountId);
  const prior = await priorImport(client, owner, input.accountId, input.kind, reportFileSha256(input.text));
  // Linking is only looked up when the file is the kind the owner chose; it counts what import would link, nothing more.
  const kindOk = (detectReportKind(input.text) ?? input.kind) === input.kind;
  let linkKeys: Set<string> | null = null;
  if (kindOk && input.kind === "VIDEO_PERFORMANCE") {
    const links = await contentBankLinks(client, owner, input.accountId, parseVideoReport(input.text).rows.map(r => r.externalVideoId));
    linkKeys = new Set([...links].filter(([, v]) => v.master).map(([k]) => k));
  } else if (kindOk) {
    linkKeys = new Set((await productLinks(client, owner, parseOrderReport(input.text).rows.flatMap(r => r.productExternalId ? [r.productExternalId] : []))).keys());
  }
  return buildReportPreview({ kind: input.kind, text: input.text, prior, linkKeys });
}
