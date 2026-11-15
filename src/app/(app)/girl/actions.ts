"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { addFace, pickFace, renameGirl, resetOldClips } from "@/features/channel-girl/service";
import { setNicheChoice } from "@/features/flow-farm/learning-store";

const HOME = "/girl";
async function owner() {
  const client = await createClient(), { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect(`/login?next=${HOME}`);
  await enforceOwnerMutationRateLimit("channel-girl", data.user.id);
  return data.user.id;
}
function done(message: string): never {
  revalidatePath(HOME);
  redirect(`${HOME}?msg=${encodeURIComponent(message)}`);
}
const KNOWN: Record<string, string> = {
  account_not_found: "ต้องเชื่อมบัญชี TikTok อย่างน้อย 1 บัญชีก่อน",
  flow_clips_not_queued: "เข้าคิว Flow ไม่ได้ ลองใหม่อีกครั้ง",
  girl_not_saved: "บันทึกไม่ได้ ลองใหม่อีกครั้ง",
  FACE_NOT_FOUND: "ไม่พบหน้าที่เลือก",
  FACE_IN_PROGRESS: "กำลังสร้างหน้าอยู่ 1 แบบ รอให้เสร็จก่อนค่อยกดสร้างใหม่",
  flow_clips_unavailable: "อ่านคลิปเดิมไม่ได้ ลองใหม่อีกครั้ง",
  reset_backup_not_saved: "สำรองข้อมูลเดิมไม่สำเร็จ จึงยังไม่ล้างอะไร",
  clip_stats_not_saved: "สำรองสถิติเดิมไม่สำเร็จ จึงยังไม่ล้างอะไร",
};
function fail(error: unknown): never {
  const message = KNOWN[error instanceof Error ? error.message : ""];
  if (message) done(message);
  throw error;
}

const createSchema = z.object({ name: z.string().trim().min(1).max(40), look: z.string().trim().max(300).optional().default(""), credits: z.literal("on") });
export async function createGirlAction(formData: FormData) {
  const parsed = createSchema.safeParse({ name: formData.get("name"), look: formData.get("look") ?? "", credits: formData.get("credits") });
  if (!parsed.success) done("ใส่ชื่อน้อง และติ๊กยืนยันการใช้เครดิตก่อน");
  const ownerId = await owner();
  try { await addFace(createAdminClient(), ownerId, parsed.data); }
  catch (error) { fail(error); }
  done("เข้าคิวแล้ว เครื่องสร้างคลิปกำลังทำหน้าน้อง 1 แบบ (10 เครดิต) ประมาณ 2–5 นาที");
}

const nameSchema = z.object({ name: z.string().trim().min(1).max(40) });
export async function renameGirlAction(formData: FormData) {
  const parsed = nameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) done("ใส่ชื่อน้องก่อน");
  const ownerId = await owner();
  try { await renameGirl(createAdminClient(), ownerId, parsed.data.name); }
  catch (error) { fail(error); }
  done(`เปลี่ยนชื่อเป็น ${parsed.data.name} แล้ว`);
}

const pickSchema = z.object({ key: z.string().regex(/^face-\d+$/) });
export async function pickFaceAction(formData: FormData) {
  const parsed = pickSchema.safeParse({ key: formData.get("key") });
  if (!parsed.success) done("ไม่พบหน้าที่เลือก");
  const ownerId = await owner();
  const admin = createAdminClient();
  try {
    await pickFace(admin, ownerId, parsed.data.key);
    // Every channel's main niche becomes the girl, so the learning loop does not steer back to the old clips.
    const accounts = await admin.from("tiktok_accounts").select("id").eq("owner_id", ownerId).is("hidden_at", null);
    for (const account of (accounts.data ?? []) as Array<{ id: string }>) await setNicheChoice(admin, ownerId, account.id, "AI_GIRL").catch(() => {});
  } catch (error) { fail(error); }
  done("ล็อกหน้าแล้ว คลิปใหม่ทุกคลิปจะเป็นน้องคนนี้ กด “สร้างคลิป” ที่หน้าคลังคลิปได้เลย");
}

export async function resetOldClipsAction(formData: FormData) {
  if (formData.get("confirm") !== "on") done("ติ๊กยืนยันก่อนล้างคลิปเดิม");
  const ownerId = await owner();
  let cleared = 0;
  try { cleared = (await resetOldClips(createAdminClient(), ownerId)).clips; }
  catch (error) { fail(error); }
  done(`ล้างแล้ว: เอาคลิปเดิม ${cleared} คลิปออกจากคิวและคลัง และเริ่มสถิติใหม่ (สำรองข้อมูลเดิมไว้แล้ว)`);
}
