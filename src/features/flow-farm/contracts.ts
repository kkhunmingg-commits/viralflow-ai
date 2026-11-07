import { z } from "zod";

/** Semi-auto pipeline: one click plans clips, the owner's computer makes them in Google Flow, and the
 * finished clips wait in the library until the owner posts them. Statuses mirror the flow_clips table. */
export type FlowClipStatus = "QUEUED" | "GENERATING" | "READY" | "SCHEDULED" | "POSTED" | "FAILED" | "SKIPPED_NO_CREDIT" | "DISCARDED";
export type FlowClipKind = "GROWTH" | "AFFILIATE";

export const flowClipStatusLabels: Record<FlowClipStatus, string> = {
  QUEUED: "รอคิวสร้าง", GENERATING: "กำลังสร้างใน Flow", READY: "พร้อมโพสต์", SCHEDULED: "ตั้งเวลาไว้",
  POSTED: "โพสต์แล้ว (ลบไฟล์แล้ว)", FAILED: "สร้างไม่สำเร็จ", SKIPPED_NO_CREDIT: "ข้าม: เครดิต Flow หมด", DISCARDED: "ทิ้งแล้ว",
};

/** Clips that count toward today's target; failures and skips leave room for another try. */
export const COUNTED_STATUSES: FlowClipStatus[] = ["QUEUED", "GENERATING", "READY", "SCHEDULED", "POSTED"];
export const LIBRARY_STATUSES: FlowClipStatus[] = ["READY", "SCHEDULED"];
export const MAX_CLIPS_PER_BATCH = 30;
export const FLOW_CLIP_MAX_BYTES = 50_000_000;

export const MAX_FLOW_ACCOUNTS_PER_TIKTOK = 5;

export interface FlowAccountRow {
  id: string; tiktok_account_id: string | null; label: string; priority: number; clips_per_day_estimate: number; active: boolean;
  exhausted_on: string | null; clips_today: number; clips_today_on: string | null; last_used_at: string | null; created_at: string;
  login_state?: FlowLoginState; login_note?: string | null;
  /** CLIP: linked in the clip tab. REPAIR: added in the drama tab, remakes only drama shots sent to it. */
  purpose?: FlowAccountPurpose;
}
export type FlowAccountPurpose = "CLIP" | "REPAIR";
/** PENDING: the owner's computer will open a Google sign-in window for it. Only READY accounts make clips. */
export const FLOW_LOGIN_STATES = ["PENDING", "READY", "FAILED"] as const;
export type FlowLoginState = (typeof FLOW_LOGIN_STATES)[number];

export const startBatchSchema = z.object({
  accountId: z.union([z.uuid(), z.literal("ALL")]),
  count: z.coerce.number().int().min(1).max(MAX_CLIPS_PER_BATCH),
});
export const flowAccountSchema = z.object({
  tiktokAccountId: z.uuid(),
  label: z.string().trim().min(1).max(60),
  clipsPerDay: z.coerce.number().int().min(1).max(200).default(5),
});
export const repairAccountSchema = z.object({
  label: z.string().trim().min(1).max(60),
  clipsPerDay: z.coerce.number().int().min(1).max(200).default(5),
});
export const scheduleSchema = z.object({ id: z.uuid(), at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) });
export const postedSchema = z.object({
  id: z.uuid(),
  url: z.union([z.literal(""), z.string().trim().regex(/^https:\/\/(www\.|vm\.|vt\.)?tiktok\.com\/\S*$/)]).default(""),
});

/** Requests from the owner's local Flow worker. */
export const claimSchema = z.object({ flowAccountId: z.uuid() });
export const clipRefSchema = z.object({ clipId: z.uuid() });
export const completeSchema = z.object({
  clipId: z.uuid(), sha256: z.string().regex(/^[0-9a-f]{64}$/),
  width: z.number().int().positive().max(10_000), height: z.number().int().positive().max(10_000),
  durationSeconds: z.number().positive().max(600),
});
export const failSchema = z.object({
  clipId: z.uuid(), reason: z.string().trim().min(1).max(300),
  /** True only when Flow refused before accepting the job (no credits); the clip goes back in the queue. */
  notStarted: z.boolean().default(false),
});
export const exhaustedSchema = z.object({ flowAccountId: z.uuid() });
export const loginStateSchema = z.object({ flowAccountId: z.uuid(), state: z.enum(["READY", "FAILED"]), note: z.string().trim().max(200).optional() });

/** Bangkok calendar day, the day credits and daily targets are counted in. */
export function bangkokDate(at: Date | string = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}
/** Start and end of a Bangkok day as UTC ISO strings. */
export function bangkokDayRange(day: string) {
  const start = new Date(`${day}T00:00:00+07:00`);
  return { start: start.toISOString(), end: new Date(start.getTime() + 86_400_000).toISOString() };
}
/** "2026-10-28T19:30" typed in Bangkok time → ISO instant. */
export function bangkokLocalToIso(local: string) {
  const at = new Date(`${local}:00+07:00`);
  if (!Number.isFinite(at.getTime())) throw new Error("INVALID_TIME");
  return at.toISOString();
}

/** What the owner's computer is doing right now, reported step by step so the page can show live progress. */
export const FLOW_PROGRESS_STAGES = ["IDLE", "SIGNING_IN", "OPENING_FLOW", "ATTACHING_IMAGE", "CHECKING_COST", "TYPING_PROMPT", "WAITING_FLOW",
  "DOWNLOADING", "UPLOADING", "DONE", "FAILED"] as const;
export type FlowProgressStage = (typeof FLOW_PROGRESS_STAGES)[number];
export const flowProgressLabels: Record<FlowProgressStage, string> = {
  IDLE: "รอคิว", SIGNING_IN: "กำลังตรวจล็อกอิน Google", OPENING_FLOW: "กำลังเปิด Google Flow", ATTACHING_IMAGE: "กำลังใส่รูปสินค้า",
  CHECKING_COST: "กำลังตรวจเครดิตที่ใช้", TYPING_PROMPT: "กำลังใส่คำสั่ง (prompt)", WAITING_FLOW: "Flow กำลังสร้างวิดีโอ",
  DOWNLOADING: "กำลังดาวน์โหลดวิดีโอจาก Flow", UPLOADING: "กำลังส่งเข้าคลัง", DONE: "เสร็จ เข้าคลังแล้ว", FAILED: "ไม่สำเร็จ",
};
export const progressSchema = z.object({
  clipId: z.uuid().optional(), stage: z.enum(FLOW_PROGRESS_STAGES), detail: z.string().trim().max(120).optional(),
});
export interface FlowProgress { clipId: string | null; stage: FlowProgressStage; detail: string | null; at: string }

/** flow_worker_status.note holds the latest progress as compact JSON (≤300 chars); anything else reads as no progress. */
export function encodeProgress(input: { clipId?: string; stage: FlowProgressStage; detail?: string }, at = new Date()) {
  return JSON.stringify({ c: input.clipId ?? null, s: input.stage, d: input.detail?.slice(0, 120) || null, t: at.toISOString() });
}
export function decodeProgress(note: string | null | undefined): FlowProgress | null {
  if (!note) return null;
  try {
    const value = JSON.parse(note) as { c?: unknown; s?: unknown; d?: unknown; t?: unknown };
    if (!FLOW_PROGRESS_STAGES.includes(value.s as FlowProgressStage) || typeof value.t !== "string") return null;
    return { clipId: typeof value.c === "string" ? value.c : null, stage: value.s as FlowProgressStage, detail: typeof value.d === "string" ? value.d : null, at: value.t };
  } catch { return null; }
}

/** Plain-Thai reason for a clip that did not make it, from the worker's code. */
export function flowErrorLabel(error: string | null | undefined) {
  if (!error) return null;
  const known: Array<[RegExp, string]> = [
    [/^NO_CREDIT/, "เครดิต Flow หมด"], [/LOGIN/, "บัญชี Google หลุดล็อกอิน กด “ล็อกอินใหม่”"],
    [/^COST_UNREADABLE/, "อ่านค่าเครดิตใน Flow ไม่ได้ (หน้า Flow อาจเปลี่ยน)"], [/^COST_(\d+)_ABOVE/, "คลิปนี้ใช้เครดิตเกินที่ตั้งไว้ (ตรวจว่าเลือก Veo 3.1 Lite และ x1)"],
    [/PROMPT_BOX/, "หาช่องพิมพ์คำสั่งใน Flow ไม่เจอ (หน้า Flow อาจเปลี่ยน)"], [/GENERATE_BUTTON/, "หาปุ่มสร้างใน Flow ไม่เจอหรือกดไม่ได้"],
    [/^NEW_VIDEO_TIMEOUT/, "รอวิดีโอนานเกินกำหนด ตรวจในคลัง Flow ว่าสร้างเสร็จหรือไม่"], [/^FLOW_REPORTED_FAILURE/, "Flow แจ้งว่าสร้างไม่สำเร็จ (อาจติดนโยบายเนื้อหา)"],
    [/^WORKER_LOST/, "เครื่องสร้างคลิปหยุดกลางคัน ตรวจในคลัง Flow ว่ามีวิดีโอหรือไม่"], [/^BROWSER_UNAVAILABLE/, "เปิด Chrome ไม่ได้"],
    [/^UPLOAD_FAILED/, "ส่งไฟล์เข้าคลังไม่สำเร็จ (ไฟล์ยังอยู่ในเครื่อง)"], [/PRODUCT_IMAGE/, "รูปสินค้าใช้ไม่ได้"],
    [/NOT_PORTRAIT/, "วิดีโอไม่ใช่แนวตั้ง 9:16"], [/DUPLICATE_VIDEO/, "วิดีโอซ้ำกับที่มีในคลัง"], [/INVALID_MP4|CHECKSUM/, "ไฟล์วิดีโอเสีย"],
    [/REFERENCE|IMAGE_UPLOAD|ATTACH/, "ใส่รูปสินค้าใน Flow ไม่สำเร็จ"],
  ];
  return known.find(([pattern]) => pattern.test(error))?.[1] ?? error;
}

/** Inbox statuses meaning TikTok confirmed the draft reached the owner's TikTok app. */
export const DRAFT_DELIVERED_STATUSES = ["SEND_TO_USER_INBOX", "PUBLISH_COMPLETE"];
/** True only when TikTok confirmed delivery; uploading, processing, failed or uncertain sends keep the clip. */
export const draftDelivered = (status: string) => DRAFT_DELIVERED_STATUSES.includes(status);
