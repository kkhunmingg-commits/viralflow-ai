"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { bangkokLocalToIso, flowAccountSchema, postedSchema, scheduleSchema, startBatchSchema } from "@/features/flow-farm/contracts";
import { addFlowAccount, closeClip, moveFlowAccount, removeFlowAccount, scheduleClip, startBatch, updateFlowAccount } from "@/features/flow-farm/service";

async function owner() {
  const client = await createClient(), { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/login?next=/library");
  await enforceOwnerMutationRateLimit("library", data.user.id);
  return data.user.id;
}
function done(message: string): never {
  revalidatePath("/library");
  redirect(`/library?msg=${encodeURIComponent(message)}`);
}

/** One click: find products (selling accounts) or warm-up topics and queue today's clips for the Flow worker. */
export async function startBatchAction(formData: FormData) {
  const parsed = startBatchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done("เลือกบัญชีและจำนวนคลิป 1–30");
  const ownerId = await owner();
  let added = 0, products = 0, affiliate = false;
  try {
    const results = await startBatch(createAdminClient(), ownerId, parsed.data.accountId, parsed.data.count);
    added = results.reduce((sum, r) => sum + r.added, 0);
    products = Math.max(0, ...results.map(r => r.products));
    affiliate = results.some(r => r.mode === "AFFILIATE");
  } catch (error) {
    if (error instanceof Error && error.message === "account_not_found") done("ไม่พบบัญชี TikTok นี้");
    throw error;
  }
  if (!added) done("วันนี้มีคลิปครบตามจำนวนแล้ว");
  done(`เข้าคิวแล้ว ${added} คลิป${affiliate ? ` จากสินค้า ${products} ตัว` : " (คลิปปั้นช่อง)"} เครื่องที่เปิด Flow worker จะเริ่มสร้างเอง`);
}

export async function addFlowAccountAction(formData: FormData) {
  const parsed = flowAccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done("ใส่ชื่อบัญชี Flow (ไม่เกิน 60 ตัวอักษร)");
  const ownerId = await owner();
  try { await addFlowAccount(createAdminClient(), ownerId, parsed.data); }
  catch (error) { if (error instanceof Error && error.message === "FLOW_ACCOUNT_LABEL_TAKEN") done("มีชื่อบัญชีนี้แล้ว"); throw error; }
  done(`เพิ่มบัญชี Flow “${parsed.data.label}” แล้ว อย่าลืมล็อกอินบัญชีนี้ในเครื่องที่รัน worker`);
}

const accountAction = z.object({ id: z.uuid(), op: z.enum(["UP", "DOWN", "PAUSE", "RESUME", "RESET", "REMOVE"]) });
export async function flowAccountAction(formData: FormData) {
  const parsed = accountAction.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done("คำสั่งไม่ถูกต้อง");
  const ownerId = await owner(), admin = createAdminClient(), { id, op } = parsed.data;
  if (op === "UP" || op === "DOWN") await moveFlowAccount(admin, ownerId, id, op);
  else if (op === "REMOVE") await removeFlowAccount(admin, ownerId, id);
  else await updateFlowAccount(admin, ownerId, id, op === "RESET" ? { resetCredits: true } : { active: op === "RESUME" });
  done("บันทึกแล้ว");
}

export async function scheduleClipAction(formData: FormData) {
  const parsed = scheduleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done("เลือกวันและเวลาที่จะโพสต์");
  const ownerId = await owner();
  await scheduleClip(createAdminClient(), ownerId, parsed.data.id, bangkokLocalToIso(parsed.data.at));
  done("ตั้งเวลาแล้ว ถึงเวลาจะขึ้นป้าย “ถึงเวลาโพสต์” ในคลัง");
}
export async function unscheduleClipAction(formData: FormData) {
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) done("คำสั่งไม่ถูกต้อง");
  await scheduleClip(createAdminClient(), await owner(), id.data, null);
  done("ยกเลิกเวลาแล้ว");
}

/** Posted by hand: the MP4 is deleted from the library automatically. */
export async function markPostedAction(formData: FormData) {
  const parsed = postedSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done("ลิงก์ต้องเป็นลิงก์ TikTok (หรือเว้นว่าง)");
  await closeClip(createAdminClient(), await owner(), parsed.data.id, { posted: true, url: parsed.data.url || null });
  done("บันทึกว่าโพสต์แล้ว และลบไฟล์ออกจากคลังแล้ว");
}
export async function discardClipAction(formData: FormData) {
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) done("คำสั่งไม่ถูกต้อง");
  await closeClip(createAdminClient(), await owner(), id.data, { posted: false });
  done("ทิ้งคลิปและลบไฟล์แล้ว");
}
