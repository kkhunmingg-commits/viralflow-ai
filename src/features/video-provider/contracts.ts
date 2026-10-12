import { z } from "zod";
import { FAL_MODEL_ENDPOINTS } from "@/features/video/fal-models";
export const providerSettingsSchema = z.object({
  mode: z.enum(["AUTO", "GOOGLE_ONLY", "FAL_ONLY"]).default("AUTO"),
  paidFallback: z.boolean().default(false), maxCostUsd: z.coerce.number().finite().min(0).max(5).default(0),
  dailyBudgetUsd: z.coerce.number().finite().min(0).max(100).default(0), monthlyBudgetUsd: z.coerce.number().finite().min(0).max(1000).default(0),
  retryLimit: z.coerce.number().int().min(0).max(3).default(2), autoRecovery: z.boolean().default(false),
  googleStatus: z.enum(["ASSISTED", "QUOTA_EXHAUSTED", "LOGIN_EXPIRED", "UNAVAILABLE"]).default("ASSISTED"),
  falModel: z.enum([FAL_MODEL_ENDPOINTS.LTX_098_DISTILLED, FAL_MODEL_ENDPOINTS.LTX_23_FAST, FAL_MODEL_ENDPOINTS.WAN_26_FLASH]).default(FAL_MODEL_ENDPOINTS.LTX_23_FAST),
}).refine(value => !(value.paidFallback || value.mode === "FAL_ONLY") || (value.maxCostUsd > 0 && value.dailyBudgetUsd >= value.maxCostUsd && value.monthlyBudgetUsd >= value.dailyBudgetUsd), "ตั้งวงเงินก่อนอนุญาตการสร้างแบบมีค่าใช้จ่าย");
export type ProviderSettings = z.infer<typeof providerSettingsSchema>;
export const defaultProviderSettings = () => providerSettingsSchema.parse({});
export type ProviderId = "google_vids_omni" | "fal_ai";
export type GoogleHealth = "READY" | "ASSISTED" | "QUOTA_EXHAUSTED" | "LOGIN_EXPIRED" | "UNAVAILABLE" | "TRANSIENT_FAILURE";
export type JobState = "QUEUED" | "WAITING_ASSISTED" | "WAITING_PROVIDER" | "RETRY_WAIT" | "PROCESSING" | "RECONCILIATION_REQUIRED" | "REVIEW_REQUIRED" | "COMPLETED" | "FAILED";
export type SubmissionState = "NOT_SENT" | "EXTERNAL_PENDING" | "SUBMITTING" | "ACCEPTED" | "CONFIRMED_FAILED";
export interface RouterJob { state: JobState; provider: ProviderId | null; submission: SubmissionState; requestId: string | null; retries: number; nextRetryAt: string | null; }
export interface ProviderSnapshot { google: { status: GoogleHealth; automated: boolean }; falAvailable: boolean; estimateUsd: number | null; budgetAvailable: boolean; }
export type RouteDecision = { action: "ASSIST" | "SUBMIT" | "POLL" | "WAIT" | "RECONCILE" | "DONE"; provider: ProviderId | null; reason: string; retryAt?: string };
export const jobLabels: Record<JobState,string> = { QUEUED: "รอเริ่ม", WAITING_ASSISTED: "รอคลิปจาก Google", WAITING_PROVIDER: "รอบริการพร้อม", RETRY_WAIT: "รอลองเชื่อมต่อใหม่", PROCESSING: "กำลังสร้าง", RECONCILIATION_REQUIRED: "ต้องตรวจรายการเดิมก่อนเริ่มซ้ำ", REVIEW_REQUIRED: "รอตรวจคลิป", COMPLETED: "ตรวจแล้ว", FAILED: "ทำต่อไม่ได้" };
