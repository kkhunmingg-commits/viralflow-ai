"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { createPresenterSchema } from "@/features/ai-live/presenter-plan";
import { createPresenter, deletePresenter, retryPresenter } from "@/features/ai-live/presenter-service";

const HOME = "/ai-live";
async function owner() {
  const client = await createClient(), { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect(`/login?next=${HOME}`);
  await enforceOwnerMutationRateLimit("ai-live-presenters", data.user.id);
  return data.user.id;
}
function done(message: string): never {
  revalidatePath(HOME);
  redirect(`${HOME}?msg=${encodeURIComponent(message)}#presenter-studio`);
}
const KNOWN: Record<string, string> = {
  account_not_found: "ต้องเชื่อมบัญชี TikTok อย่างน้อย 1 บัญชีก่อน",
  PRESENTER_IN_PROGRESS: "มีพรีเซนเตอร์ที่กำลังสร้างอยู่ รอให้เสร็จก่อนค่อยสร้างคนใหม่",
  PRESENTER_NOT_FOUND: "ไม่พบพรีเซนเตอร์นี้", PRESENTER_NOT_FAILED: "พรีเซนเตอร์นี้ไม่ได้ล้มเหลว",
  presenter_not_saved: "บันทึกไม่ได้ (ฐานข้อมูลอาจยังไม่ได้เพิ่มตาราง ai_live_presenters)",
  flow_clips_not_queued: "เข้าคิว Flow ไม่ได้ (ฐานข้อมูลอาจยังไม่อัปเดต)",
};
function fail(error: unknown): never {
  const message = KNOWN[error instanceof Error ? error.message : ""];
  if (message) done(message);
  throw error;
}

/** Queue a new presenter: the Flow worker makes the face first, then the talking and idle takes from it. */
export async function createPresenterAction(formData: FormData) {
  const parsed = createPresenterSchema.safeParse({
    name: formData.get("name"), look: formData.get("look") ?? "", credits: formData.get("credits"),
  });
  if (!parsed.success) done("ใส่ชื่อพรีเซนเตอร์ และติ๊กยืนยันการใช้เครดิตก่อน");
  const ownerId = await owner();
  try { await createPresenter(createAdminClient(), ownerId, parsed.data); }
  catch (error) { fail(error); }
  done("เข้าคิวแล้ว เครื่องสร้างคลิปจะทำหน้าพรีเซนเตอร์ก่อน แล้วต่อด้วยคลิปพูด 12 คลิปและคลิปนิ่ง 2 คลิปเอง");
}

const idSchema = z.object({ id: z.uuid() });
export async function retryPresenterAction(formData: FormData) {
  const parsed = idSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) done("ไม่พบพรีเซนเตอร์นี้");
  const ownerId = await owner();
  try { await retryPresenter(createAdminClient(), ownerId, parsed.data.id); }
  catch (error) { fail(error); }
  done("สร้างต่อจากคลิปที่ไม่สำเร็จแล้ว");
}
export async function deletePresenterAction(formData: FormData) {
  const parsed = idSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) done("ไม่พบพรีเซนเตอร์นี้");
  const ownerId = await owner();
  try { await deletePresenter(createAdminClient(), ownerId, parsed.data.id); }
  catch (error) { fail(error); }
  done("ลบพรีเซนเตอร์แล้ว");
}
