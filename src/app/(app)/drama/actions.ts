"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { createSeriesSchema, seriesRefSchema, shotRefSchema } from "@/features/drama/contracts";
import { createSeries, retryEpisode, setSeriesStatus, skipShot } from "@/features/drama/service";

async function owner() {
  const client = await createClient(), { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/login?next=/drama");
  await enforceOwnerMutationRateLimit("drama-studio", data.user.id);
  return data.user.id;
}
function done(path: string, message: string): never {
  revalidatePath("/drama");
  redirect(`${path}${path.includes("?") ? "&" : "?"}msg=${encodeURIComponent(message)}`);
}
const KNOWN: Record<string, string> = {
  ACCOUNT_NOT_FOUND: "ไม่พบบัญชี TikTok นี้",
  GENRE_ALREADY_RUNNING: "มีละครแนวนี้กำลังผลิตอยู่แล้ว เลือกแนวอื่น (ตัวเขียนบทในตัวมีหนึ่งเรื่องต่อแนว)",
  SERIES_NOT_FOUND: "ไม่พบเรื่องนี้", SERIES_COMPLETED: "เรื่องนี้จบซีซันแล้ว", NO_OPEN_EPISODE: "ไม่มีตอนที่ค้างอยู่",
  SHOT_NOT_SKIPPABLE: "ข้ามได้เฉพาะช็อตที่ยังไม่ได้สร้างหรือสร้างไม่สำเร็จ",
};
const known = (error: unknown) => error instanceof Error ? KNOWN[error.message] : undefined;

/** One click: the showrunner writes the season and the first shot goes into the free Flow queue. */
export async function createSeriesAction(formData: FormData) {
  const parsed = createSeriesSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done("/drama", "เลือกบัญชี TikTok แนวละคร และจำนวนตอน 3–60");
  const ownerId = await owner();
  let id: string;
  try { id = await createSeries(createAdminClient(), ownerId, parsed.data); }
  catch (error) { const message = known(error); if (message) done("/drama", message); throw error; }
  done(`/drama/${id}`, "เขียนซีซันเสร็จแล้ว ช็อตแรกของตอนที่ 1 เข้าคิว Flow แล้ว เครื่องที่เปิด Flow worker จะเริ่มสร้างเอง");
}

export async function seriesStatusAction(formData: FormData) {
  const parsed = seriesRefSchema.extend({ status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) done("/drama", "คำขอไม่ถูกต้อง");
  const ownerId = await owner();
  try { await setSeriesStatus(createAdminClient(), ownerId, parsed.data.id, parsed.data.status); }
  catch (error) { const message = known(error); if (message) done(`/drama/${parsed.data.id}`, message); throw error; }
  if (parsed.data.status === "ARCHIVED") done("/drama", "เก็บเรื่องนี้เข้ากรุแล้ว ตอนที่ตัดเสร็จยังอยู่ในคลัง");
  done(`/drama/${parsed.data.id}`, parsed.data.status === "ACTIVE" ? "ผลิตต่อแล้ว" : "พักการผลิตไว้แล้ว ช็อตที่อยู่ในคิวจะสร้างให้เสร็จก่อน");
}

export async function retryEpisodeAction(formData: FormData) {
  const parsed = seriesRefSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done("/drama", "คำขอไม่ถูกต้อง");
  const ownerId = await owner();
  try { await retryEpisode(createAdminClient(), ownerId, parsed.data.id); }
  catch (error) { const message = known(error); if (message) done(`/drama/${parsed.data.id}`, message); throw error; }
  done(`/drama/${parsed.data.id}`, "ลองใหม่แล้ว ช็อตที่ไม่สำเร็จกลับเข้าคิว");
}

export async function skipShotAction(formData: FormData) {
  const parsed = shotRefSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done("/drama", "คำขอไม่ถูกต้อง");
  const ownerId = await owner();
  try { await skipShot(createAdminClient(), ownerId, parsed.data.seriesId, parsed.data.shotId); }
  catch (error) { const message = known(error); if (message) done(`/drama/${parsed.data.seriesId}`, message); throw error; }
  done(`/drama/${parsed.data.seriesId}`, "ข้ามช็อตนี้แล้ว ตอนนี้จะตัดต่อจากช็อตที่เหลือ");
}
