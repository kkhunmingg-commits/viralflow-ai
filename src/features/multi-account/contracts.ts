import { z } from "zod";

export const accountAutomationSchema = z.object({
  enabled: z.boolean().default(false), paused: z.boolean().default(false),
  timezone: z.string().default("Asia/Bangkok").refine(value => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
  }, "เขตเวลาไม่ถูกต้อง"),
  spreadFullDay: z.boolean().default(true),
  windows: z.array(z.object({ start: z.number().int().min(0).max(1439), end: z.number().int().min(1).max(1440) }).refine(w => w.end > w.start)).max(24).default([{ start: 0, end: 1440 }]),
  // Audience timing is only populated from measured, owned data, never an invented optimum.
  audienceMinutes: z.array(z.number().int().min(0).max(1439)).max(1440).default([]),
  categories: z.array(z.string().min(1).max(80)).max(100).default([]),
  priority: z.coerce.number().int().min(0).max(100).default(50),
  dailyBudgetUsd: z.coerce.number().finite().min(0).default(0),
  minimumGapMinutes: z.coerce.number().finite().min(1).default(1),
  providerPreference: z.enum(["AUTO", "GOOGLE_ONLY", "FAL_ONLY"]).default("AUTO"),
}).refine(v => v.spreadFullDay || v.windows.length > 0, "ช่วงเวลาไม่ถูกต้อง");
export type AccountAutomation = z.infer<typeof accountAutomationSchema>;
export type WorkKind = "GENERATE" | "PUBLISH" | "RECONCILE";
export type WorkState = "WAITING" | "CLAIMED" | "COMPLETE" | "FAILED" | "CANCELLED" | "REVIEW_REQUIRED";
export interface SchedulerAccount {
  ownerId: string; id: string; config: AccountAutomation; connected: boolean; hidden: boolean;
  ready: number; produced: number; published: number; publishCap: number | null;
  recommendation: FrequencyRecommendation; scheduleSeed: string;
}
export interface FrequencyRecommendation { generation: number; publishing: number; reason: string; confidence: number; }
export interface PlannedWork {
  ownerId: string; accountId: string; day: string; ordinal: number; kind: WorkKind;
  dueAt: string; availableAt: string; priority: number;
}
export interface DurableWork {
  id: string; owner_id: string; tiktok_account_id: string; kind: WorkKind; state: WorkState;
  local_day: string; ordinal: number; due_at: string; available_at: string; attempts: number;
  lease_token: string; provider_job_id: string | null; publishing_queue_id: string | null;
  creative_project_id: string | null; reason: string | null;
}
export const reasonLabels: Record<string, string> = {
  SAFE_MODE: "เตรียมคิวแล้ว ยังไม่เปิดการสร้างหรือเผยแพร่", CREATIVE_REQUIRED: "รอเนื้อหาที่ตรวจแล้ว",
  ASSISTED: "รอคุณนำคลิปที่สร้างไว้เข้าระบบ", REVIEW_REQUIRED: "รอตรวจคลิป", READY: "พร้อม",
  CONSENT_REQUIRED: "รอยืนยันรายละเอียดก่อนเผยแพร่", TOKEN: "ต้องเชื่อมบัญชีใหม่",
  BUDGET: "วงเงินสร้างคลิปไม่พอ", PROVIDER: "รอการสร้างคลิป", PLATFORM_CAP: "ถึงจำนวนโพสต์ที่อนุญาต",
  APP_CAP: "รอรอบเผยแพร่ของแอป", APP_CAP_UNKNOWN: "รอยืนยันสิทธิ์เผยแพร่ของแอป",
  PRIVATE_ONLY: "เผยแพร่ได้เฉพาะแบบส่วนตัว", TRANSPORT: "รอตั้งค่าการส่งคลิปที่ได้รับอนุญาต",
  RECONCILE: "กำลังตรวจผลรายการเดิม", RETRY: "รอลองใหม่", ACCOUNT_PAUSED: "พักบัญชีแล้ว",
  RECOVERY_REQUIRED: "ต้องตรวจรายการก่อนดำเนินการต่อ", FAILED: "ทำต่อไม่ได้",
  RATE_LIMIT: "รอรอบการส่งถัดไป", FREQUENCY_DATA_REQUIRED: "ยังไม่มีผลลัพธ์จริงเพียงพอสำหรับประเมินความถี่",
  CAPACITY_SHORTAGE: "กำลังผลิตหรืองบยังไม่พอ", PLATFORM_CAP_UNKNOWN: "ยังไม่ทราบจำนวนโพสต์ที่อนุญาต",
  OBSERVED_PERFORMANCE: "ประเมินจากผลลัพธ์ของบัญชี", ACCOUNT_HEALTH: "บัญชียังไม่พร้อม",
  REPLANNED:"ปรับแผนตามข้อมูลล่าสุด",EXPIRED_PLAN:"พ้นช่วงเวลาของแผนเดิม",
};
