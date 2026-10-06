"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { runAutoExecutionCycle } from "@/features/auto/execution-service";
import { saveAccountPostSchedule, startAccountPost, stopAccountPost } from "@/features/auto/account-schedule";
import { retryPublishAction } from "@/app/(app)/publishing/actions";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type CustomerPostActionState = { ok: boolean; message: string };
const scheduleSchema = z.object({
  accountId: z.uuid(), requestKey: z.uuid(),
  postingMode: z.enum(["AUTO", "DRAFT", "EXPORT"]), creativeMode: z.enum(["AUTO", "GROWTH", "AFFILIATE"]),
  clipsPerDay: z.coerce.number().int().min(1).max(20), dailyBudgetUsd: z.coerce.number().finite().min(0).max(1000),
  activeStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), activeEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().max(80).refine((value) => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }),
  minSpacingMinutes: z.coerce.number().int().min(1).max(1440),
  allowedDays: z.array(z.coerce.number().int().min(0).max(6)).min(1).max(7).refine((value) => new Set(value).size === value.length),
  enabled: z.boolean(),
});
function selection(formData: FormData) {
  return scheduleSchema.safeParse({ ...Object.fromEntries(formData), allowedDays: formData.getAll("allowedDays"), enabled: formData.get("enabled") === "on" });
}
async function authenticatedOwner(accountId: string) {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("authentication_required");
  await enforceOwnerMutationRateLimit("auto", data.user.id);
  const account = await client.from("tiktok_accounts").select("id").eq("owner_id", data.user.id).eq("id", accountId).maybeSingle();
  if (account.error || !account.data) throw new Error("account_not_found");
  return { client, ownerId: data.user.id };
}
function refreshCustomerPost(accountId: string) {
  for (const path of ["/home", "/post", `/post/${accountId}`, "/auto"]) revalidatePath(path);
}
function failure(error: unknown): CustomerPostActionState {
  const reason = error instanceof Error ? error.message : "";
  if (reason === "affiliate_not_eligible") return { ok: false, message: "บัญชีนี้ยังไม่พร้อมสำหรับโหมดนายหน้า กรุณาเลือก AUTO หรือ GROWTH" };
  if (/limit|budget|invalid.*schedule|invalid.*selection/.test(reason)) return { ok: false, message: "กรุณาตรวจเป้าหมาย ช่วงเวลา และงบของบัญชีนี้อีกครั้ง" };
  if (reason === "account_not_found") return { ok: false, message: "ไม่พบบัญชีที่เลือก กรุณาเลือกบัญชีของคุณอีกครั้ง" };
  return { ok: false, message: "ยังดำเนินการไม่ได้ กรุณาตรวจความพร้อมของบัญชีแล้วลองใหม่" };
}
export async function saveCustomerPostScheduleAction(_previous: CustomerPostActionState, formData: FormData): Promise<CustomerPostActionState> {
  const parsed = selection(formData);
  if (!parsed.success) return { ok: false, message: "กรุณาตรวจการตั้งเวลาและเลือกวันทำงานอย่างน้อยหนึ่งวัน" };
  try {
    const { ownerId } = await authenticatedOwner(parsed.data.accountId);
    const { accountId } = parsed.data;
    const input = scheduleSchema.omit({ accountId: true, requestKey: true }).parse(parsed.data);
    await saveAccountPostSchedule(createAdminClient(), ownerId, accountId, input);
    refreshCustomerPost(accountId);
    return { ok: true, message: "บันทึกการตั้งเวลาของบัญชีนี้แล้ว" };
  } catch (error) { return failure(error); }
}
/** Uses the durable account processor used for recurring work. */
export async function startCustomerPostAction(_previous: CustomerPostActionState, formData: FormData): Promise<CustomerPostActionState> {
  const parsed = selection(formData);
  if (!parsed.success) return { ok: false, message: "กรุณาตรวจเป้าหมาย งบ และการตั้งเวลาของบัญชีนี้อีกครั้ง" };
  try {
    const { ownerId } = await authenticatedOwner(parsed.data.accountId);
    const { accountId, requestKey, ...input } = parsed.data;
    const admin = createAdminClient();
    await saveAccountPostSchedule(admin, ownerId, accountId, input);
    const result = await startAccountPost(admin, ownerId, accountId, requestKey);
    if (result.run) after(async () => {
      try { await runAutoExecutionCycle(createAdminClient(), ownerId, result.run!.id); }
      catch { /* The existing recovery boundary resumes durable checkpoints. */ }
    });
    refreshCustomerPost(accountId);
    return { ok: true, message: result.run ? "เริ่มงานบัญชีนี้แล้ว บัญชีอื่นยังทำงานได้ตามเดิม" : "เปิดงานบัญชีนี้แล้ว ระบบจะเริ่มตามเวลาที่ตั้งไว้" };
  } catch (error) { return failure(error); }
}
export async function stopCustomerPostAction(_previous: CustomerPostActionState, formData: FormData): Promise<CustomerPostActionState> {
  const parsed = z.object({ accountId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "ไม่พบบัญชีที่เลือก" };
  try {
    const { ownerId } = await authenticatedOwner(parsed.data.accountId);
    await stopAccountPost(createAdminClient(), ownerId, parsed.data.accountId);
    refreshCustomerPost(parsed.data.accountId);
    return { ok: true, message: "หยุดเฉพาะบัญชีนี้แล้ว ผลงานที่ผ่านมาเก็บไว้ตามเดิม" };
  } catch (error) { return failure(error); }
}
export async function retryCustomerPostAction(_previous: CustomerPostActionState, formData: FormData): Promise<CustomerPostActionState> {
  const parsed = z.object({ accountId: z.uuid(), queueId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "ไม่พบคลิปที่เลือก" };
  try {
    const { client, ownerId } = await authenticatedOwner(parsed.data.accountId);
    const queue = await client.from("publishing_queue").select("id").eq("owner_id", ownerId)
      .eq("tiktok_account_id", parsed.data.accountId).eq("id", parsed.data.queueId).maybeSingle();
    if (queue.error || !queue.data) return { ok: false, message: "คลิปนี้ไม่ได้อยู่ในบัญชีที่เลือก" };
    await retryPublishAction(parsed.data.queueId);
    refreshCustomerPost(parsed.data.accountId);
    return { ok: true, message: "ตรวจและดำเนินการคลิปนี้อีกครั้งแล้ว" };
  } catch { return { ok: false, message: "คลิปนี้ยังดำเนินการซ้ำไม่ได้ กรุณาตรวจบัญชีและสิทธิ์เผยแพร่ก่อน" }; }
}
