"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { bangkokLocalToIso, flowAccountSchema, postedSchema, scheduleSchema, startBatchSchema } from "@/features/flow-farm/contracts";
import { addFlowAccount, closeClip, moveFlowAccount, removeFlowAccount, requestFlowLogin, scheduleClip, startBatch, updateFlowAccount } from "@/features/flow-farm/service";

async function owner() {
  const client = await createClient(), { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/login?next=/post");
  await enforceOwnerMutationRateLimit("flow-studio", data.user.id);
  return data.user.id;
}
/** Back to the page, on the TikTok account the form was shown for (each form carries it as "back"). */
function done(formData: FormData, message: string): never {
  const back = z.uuid().safeParse(formData.get("back"));
  revalidatePath("/post");
  redirect(`/post?${back.success ? `account=${back.data}&` : ""}msg=${encodeURIComponent(message)}`);
}

/** One click: find products (selling accounts) or warm-up topics and queue today's clips for the Flow worker. */
export async function startBatchAction(formData: FormData) {
  const parsed = startBatchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done(formData, "เลือกบัญชีและจำนวนคลิป 1–30");
  const ownerId = await owner();
  let added = 0, products = 0, affiliate = false;
  try {
    const results = await startBatch(createAdminClient(), ownerId, parsed.data.accountId, parsed.data.count);
    added = results.reduce((sum, r) => sum + r.added, 0);
    products = Math.max(0, ...results.map(r => r.products));
    affiliate = results.some(r => r.mode === "AFFILIATE");
  } catch (error) {
    if (error instanceof Error && error.message === "account_not_found") done(formData, "ไม่พบบัญชี TikTok นี้");
    throw error;
  }
  if (!added) done(formData, "วันนี้มีคลิปครบตามจำนวนแล้ว");
  done(formData, `เข้าคิวแล้ว ${added} คลิป${affiliate ? ` จากสินค้า ${products} ตัว` : " (คลิปปั้นช่อง)"} เครื่องที่เปิด Flow worker จะเริ่มสร้างเอง`);
}

export async function addFlowAccountAction(formData: FormData) {
  const parsed = flowAccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done(formData, "ใส่อีเมลหรือชื่อบัญชี Google (ไม่เกิน 60 ตัวอักษร)");
  const ownerId = await owner();
  const owned = await (await createClient()).from("tiktok_accounts").select("id").eq("owner_id", ownerId).eq("id", parsed.data.tiktokAccountId).maybeSingle();
  if (!owned.data) done(formData, "ไม่พบบัญชี TikTok นี้");
  try { await addFlowAccount(createAdminClient(), ownerId, parsed.data); }
  catch (error) {
    if (error instanceof Error && error.message === "FLOW_ACCOUNT_LABEL_TAKEN") done(formData, "มีบัญชี Google ชื่อนี้แล้ว");
    if (error instanceof Error && error.message === "FLOW_ACCOUNT_LIMIT_5") done(formData, "บัญชี TikTok หนึ่งผูกบัญชี Google ได้สูงสุด 5 บัญชี");
    throw error;
  }
  done(formData, `ผูกบัญชี Google “${parsed.data.label}” แล้ว คอมพิวเตอร์จะเปิดหน้าล็อกอิน Google ของบัญชีนี้ให้ภายใน 1 นาที ล็อกอินให้เสร็จแล้วหน้าต่างจะปิดเอง`);
}

const accountAction = z.object({ id: z.uuid(), op: z.enum(["UP", "DOWN", "PAUSE", "RESUME", "RESET", "RELOGIN", "REMOVE"]) });
export async function flowAccountAction(formData: FormData) {
  const parsed = accountAction.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done(formData, "คำสั่งไม่ถูกต้อง");
  const ownerId = await owner(), admin = createAdminClient(), { id, op } = parsed.data;
  if (op === "UP" || op === "DOWN") await moveFlowAccount(admin, ownerId, id, op);
  else if (op === "REMOVE") await removeFlowAccount(admin, ownerId, id);
  else if (op === "RELOGIN") { await requestFlowLogin(admin, ownerId, id); done(formData, "เครื่องจะเปิดหน้าล็อกอิน Google ของบัญชีนี้ให้ภายใน 1 นาที"); }
  else await updateFlowAccount(admin, ownerId, id, op === "RESET" ? { resetCredits: true } : { active: op === "RESUME" });
  done(formData, "บันทึกแล้ว");
}

export async function scheduleClipAction(formData: FormData) {
  const parsed = scheduleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done(formData, "เลือกวันและเวลาที่จะโพสต์");
  const ownerId = await owner();
  await scheduleClip(createAdminClient(), ownerId, parsed.data.id, bangkokLocalToIso(parsed.data.at));
  done(formData, "ตั้งเวลาแล้ว ถึงเวลาจะขึ้นป้าย “ถึงเวลาโพสต์แล้ว” ในคลัง");
}
export async function unscheduleClipAction(formData: FormData) {
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) done(formData, "คำสั่งไม่ถูกต้อง");
  await scheduleClip(createAdminClient(), await owner(), id.data, null);
  done(formData, "ยกเลิกเวลาแล้ว");
}

/** Posted by hand: the MP4 is deleted from the library automatically. */
export async function markPostedAction(formData: FormData) {
  const parsed = postedSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done(formData, "ลิงก์ต้องเป็นลิงก์ TikTok (หรือเว้นว่าง)");
  await closeClip(createAdminClient(), await owner(), parsed.data.id, { posted: true, url: parsed.data.url || null });
  done(formData, "บันทึกว่าโพสต์แล้ว และลบไฟล์ออกจากคลังแล้ว");
}
export async function discardClipAction(formData: FormData) {
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) done(formData, "คำสั่งไม่ถูกต้อง");
  await closeClip(createAdminClient(), await owner(), id.data, { posted: false });
  done(formData, "ทิ้งคลิปและลบไฟล์แล้ว");
}
