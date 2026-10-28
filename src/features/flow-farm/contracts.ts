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
}

export const startBatchSchema = z.object({
  accountId: z.union([z.uuid(), z.literal("ALL")]),
  count: z.coerce.number().int().min(1).max(MAX_CLIPS_PER_BATCH),
});
export const flowAccountSchema = z.object({
  tiktokAccountId: z.uuid(),
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
