"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { createSeriesSchema, seriesRefSchema, shotRefSchema } from "@/features/drama/contracts";
import { MAX_TAKES, TAKE_CREDIT_BUDGET, beginCutRestore, chooseTake, finishCutRestore, continueAfterCredits, createSeries, deleteRejectedTake, redoShot, remakeOpenTake, retryEpisode, reviewEpisode, setSeriesStatus, skipShot, startNextEpisode, startNextStory } from "@/features/drama/service";

async function owner() {
  const client = await createClient(), { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/login?next=/drama");
  await enforceOwnerMutationRateLimit("drama-studio", data.user.id);
  return data.user.id;
}
function done(path: string, message: string): never {
  revalidatePath("/post");
  revalidatePath("/drama", "layout");
  redirect(`${path}${path.includes("?") ? "&" : "?"}msg=${encodeURIComponent(message)}`);
}
const HOME = "/drama";
const KNOWN: Record<string, string> = {
  ACCOUNT_NOT_FOUND: "ไม่พบบัญชี TikTok นี้",
  FLOW_ACCOUNT_NOT_FOUND: "ไม่พบบัญชี Google นี้ หรือบัญชีถูกปิดอยู่",
  REPAIR_ACCOUNT_NOT_FOUND: "ไม่พบบัญชีซ่อมนี้ หรือบัญชีถูกปิดอยู่",
  FLOW_ACCOUNT_OTHER_CHANNEL: "บัญชี Google นี้ผูกกับช่อง TikTok อื่น เลือกบัญชีที่ผูกกับช่องนี้หรือบัญชีที่ใช้ได้ทุกช่อง",
  FLOW_ACCOUNT_BUSY: "บัญชี Google นี้มีละครเรื่องอื่นอยู่แล้ว (1 บัญชีทำได้ 1 เรื่อง) เลือกบัญชีอื่น",
  REPAIR_SAME_AS_MAIN: "บัญชีซ่อมต้องเป็นคนละบัญชีกับบัญชีหลัก",
  SERIES_NOT_FOUND: "ไม่พบเรื่องนี้", SERIES_COMPLETED: "เรื่องนี้จบซีซันแล้ว", NO_OPEN_EPISODE: "ไม่มีตอนที่ค้างอยู่",
  EPISODE_NOT_REVIEWABLE: "ตอนนี้ตรวจไปแล้ว หรือยังตัดต่อไม่เสร็จ",
  TOO_MANY_TAKES: `เก็บเวอร์ชันไว้เทียบได้สูงสุด ${MAX_TAKES} เวอร์ชัน ลบเวอร์ชันที่ไม่เอาออกก่อน หรือเลือกเวอร์ชันที่ดีที่สุด`,
  TAKE_IN_PRODUCTION: "เวอร์ชันใหม่กำลังสร้างช็อตอยู่ใน Flow ตอนนี้ รอช็อตนี้เสร็จสักครู่แล้วกดเลือกอีกครั้ง",
  SERIES_NOT_FINISHED: "เรื่องนี้ยังไม่จบซีซัน", NEXT_STORY_EXISTS: "สร้างเรื่องใหม่ต่อจากเรื่องนี้ไปแล้ว",
  SHOT_NOT_SKIPPABLE: "ข้ามได้เฉพาะช็อตที่ยังไม่ได้สร้างหรือสร้างไม่สำเร็จ",
  SHOT_NOT_REDOABLE: "ทำใหม่ได้เฉพาะช็อตที่เสร็จแล้วของตอนที่ยังไม่ได้กดผ่าน (และไม่ได้กำลังตัดต่ออยู่)",
  SHOT_FILES_GONE: "ไฟล์ช็อตของเวอร์ชันนี้ถูกลบไปแล้ว ทำใหม่ทีละช็อตไม่ได้ กด “ไม่ผ่าน ทำเวอร์ชันใหม่” แทน",
  NOTHING_WAITING_FOR_CREDITS: "ตอนนี้ไม่มีช็อตที่รอเครดิตอยู่",
};
const known = (error: unknown) => error instanceof Error ? KNOWN[error.message] : undefined;

/** One click: the showrunner writes the season and the first shot goes into the free Flow queue. */
export async function createSeriesAction(formData: FormData) {
  const parsed = createSeriesSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done(HOME, parsed.error.issues.some(i => i.message === "REPAIR_SAME_AS_MAIN") ? KNOWN.REPAIR_SAME_AS_MAIN : "เลือกแนวละคร ช่อง TikTok บัญชี Google หลัก และจำนวนตอน 3–60");
  const ownerId = await owner();
  let id: string;
  try { id = await createSeries(createAdminClient(), ownerId, parsed.data); }
  catch (error) { const message = known(error); if (message) done(HOME, message); throw error; }
  done(`/drama/${id}`, "เขียนซีซันเสร็จแล้ว ช็อตแรกของตอนที่ 1 เข้าคิว Flow ของบัญชีหลักแล้ว เครื่องที่เปิด Flow worker จะเริ่มสร้างเอง");
}

export async function seriesStatusAction(formData: FormData) {
  const parsed = seriesRefSchema.extend({ status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) done(HOME, "คำขอไม่ถูกต้อง");
  const ownerId = await owner();
  try { await setSeriesStatus(createAdminClient(), ownerId, parsed.data.id, parsed.data.status); }
  catch (error) { const message = known(error); if (message) done(`/drama/${parsed.data.id}`, message); throw error; }
  if (parsed.data.status === "ARCHIVED") done(HOME, "เก็บเรื่องนี้เข้ากรุแล้ว ตอนที่ตัดเสร็จยังอยู่ในคลัง");
  done(`/drama/${parsed.data.id}`, parsed.data.status === "ACTIVE" ? "ผลิตต่อแล้ว" : "พักการผลิตไว้แล้ว ช็อตที่อยู่ในคิวจะสร้างให้เสร็จก่อน");
}

/** Owner: start the next episode (or continue the open one) now. */
export async function startNextEpisodeAction(formData: FormData) {
  const parsed = seriesRefSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done(HOME, "คำขอไม่ถูกต้อง");
  const ownerId = await owner();
  try { await startNextEpisode(createAdminClient(), ownerId, parsed.data.id); }
  catch (error) { const message = known(error); if (message) done(`/drama/${parsed.data.id}`, message); throw error; }
  done(`/drama/${parsed.data.id}`, "เริ่มสร้างแล้ว เครื่องสร้างคลิปจะรับช็อตแรกในรอบถัดไป");
}

export async function retryEpisodeAction(formData: FormData) {
  const parsed = seriesRefSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done(HOME, "คำขอไม่ถูกต้อง");
  const ownerId = await owner();
  try { await retryEpisode(createAdminClient(), ownerId, parsed.data.id); }
  catch (error) { const message = known(error); if (message) done(`/drama/${parsed.data.id}`, message); throw error; }
  done(`/drama/${parsed.data.id}`, "ลองใหม่แล้ว ช็อตที่ไม่สำเร็จกลับเข้าคิว");
}

export async function skipShotAction(formData: FormData) {
  const parsed = shotRefSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done(HOME, "คำขอไม่ถูกต้อง");
  const ownerId = await owner();
  try { await skipShot(createAdminClient(), ownerId, parsed.data.seriesId, parsed.data.shotId); }
  catch (error) { const message = known(error); if (message) done(`/drama/${parsed.data.seriesId}`, message); throw error; }
  done(`/drama/${parsed.data.seriesId}`, "ข้ามช็อตนี้แล้ว ตอนนี้จะตัดต่อจากช็อตที่เหลือ");
}

/** Owner watched a finished shot and wants just that one made again; the episode is re-cut once it is in. */
export async function redoShotAction(formData: FormData) {
  const parsed = shotRefSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done(HOME, "คำขอไม่ถูกต้อง");
  const ownerId = await owner(), back = `/drama/${parsed.data.seriesId}`;
  try { await redoShot(createAdminClient(), ownerId, parsed.data.seriesId, parsed.data.shotId); }
  catch (error) { const message = known(error); if (message) done(back, message); throw error; }
  done(back, `ส่งช็อตนี้ไปทำใหม่แล้ว ช็อตอื่นเก็บไว้เหมือนเดิม เสร็จแล้วระบบตัดต่อใหม่ให้เอง (1 เวอร์ชันใช้ได้ไม่เกิน ${TAKE_CREDIT_BUDGET} เครดิต)`);
}

/** Credits came back before the system's "tomorrow": carry on with the waiting shot now. */
export async function continueAfterCreditsAction(formData: FormData) {
  const parsed = seriesRefSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done(HOME, "คำขอไม่ถูกต้อง");
  const ownerId = await owner(), back = `/drama/${parsed.data.id}`;
  try { await continueAfterCredits(createAdminClient(), ownerId, parsed.data.id); }
  catch (error) { const message = known(error); if (message) done(back, message); throw error; }
  done(back, "ทำต่อแล้ว ช็อตที่รอเครดิตกลับเข้าคิว ถ้า Flow ยังบอกว่าเครดิตหมด ระบบจะรอต่อโดยไม่เสียเครดิต");
}

/** Owner: scrap the version being made and shoot the whole episode again. */
export async function remakeTakeAction(formData: FormData) {
  const parsed = seriesRefSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done(HOME, "คำขอไม่ถูกต้อง");
  const ownerId = await owner(), back = `/drama/${parsed.data.id}`;
  try { await remakeOpenTake(createAdminClient(), ownerId, parsed.data.id); }
  catch (error) { const message = known(error); if (message) done(back, message); throw error; }
  done(back, "ทิ้งเวอร์ชันนี้แล้ว เริ่มสร้างตอนนี้ใหม่ทั้งหมดตั้งแต่ช็อต 1");
}

const reviewSchema = z.object({ seriesId: z.uuid(), episodeId: z.uuid(), verdict: z.enum(["APPROVE", "REJECT"]), back: z.enum(["home", "series"]).default("home") });
/** Owner checked the finished episode: approve to move on, or reject to shoot the same episode again tomorrow. */
export async function reviewEpisodeAction(formData: FormData) {
  const parsed = reviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done(HOME, "คำขอไม่ถูกต้อง");
  const ownerId = await owner(), { seriesId, episodeId, verdict, back } = parsed.data;
  const path = back === "series" ? `/drama/${seriesId}` : HOME;
  let result: { approved: boolean; finished: boolean };
  try { result = await reviewEpisode(createAdminClient(), ownerId, seriesId, episodeId, verdict === "APPROVE"); }
  catch (error) { const message = known(error); if (message) done(path, message); throw error; }
  done(path, !result.approved ? "บันทึกว่าไม่ผ่าน เก็บเวอร์ชันนี้ไว้ให้เทียบ กด “สร้างตอนต่อไป” ในหน้าเรื่องเมื่อพร้อมถ่ายเวอร์ชันใหม่"
    : result.finished ? "ผ่านแล้ว เรื่องนี้จบครบทุกตอน กด “สร้างเรื่องใหม่” ในการ์ดเพื่อเริ่มเรื่องต่อไปแนวเดิม"
    : "ผ่านแล้ว เรียงเข้าซีซันแล้ว กด “สร้างตอนต่อไป” ในหน้าเรื่องเมื่อพร้อม");
}

const takeSchema = z.object({ seriesId: z.uuid(), episodeId: z.uuid(), op: z.enum(["CHOOSE", "DELETE"]), back: z.enum(["home", "series"]).default("home") });
/** Takes of one episode: keep one (the others are deleted), or delete one rejected take. */
export async function takeAction(formData: FormData) {
  const parsed = takeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done(HOME, "คำขอไม่ถูกต้อง");
  const ownerId = await owner(), { seriesId, episodeId, op, back } = parsed.data;
  const path = back === "series" ? `/drama/${seriesId}` : HOME;
  let message: string;
  try {
    if (op === "DELETE") { await deleteRejectedTake(createAdminClient(), ownerId, seriesId, episodeId); message = "ลบเวอร์ชันนี้แล้ว"; }
    else {
      const result = await chooseTake(createAdminClient(), ownerId, seriesId, episodeId);
      message = `เลือกเวอร์ชันนี้แล้ว${result.deleted ? ` ลบอีก ${result.deleted} เวอร์ชันทิ้ง` : ""}${result.finished ? " เรื่องนี้จบครบทุกตอนแล้ว" : " ตอนถัดไปจะเริ่มต่อจากเวอร์ชันนี้"}`;
    }
  } catch (error) { const known_ = known(error); if (known_) done(path, known_); throw error; }
  done(path, message);
}

/** A finished season's card: start the next story of the same genre on the same accounts. */
export async function newStoryAction(formData: FormData) {
  const parsed = seriesRefSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) done(HOME, "คำขอไม่ถูกต้อง");
  const ownerId = await owner();
  let id: string;
  try { id = await startNextStory(createAdminClient(), ownerId, parsed.data.id); }
  catch (error) { const message = known(error); if (message) done(HOME, message); throw error; }
  done(`/drama/${id}`, "สร้างเรื่องใหม่แนวเดิมแล้ว ตอนที่ 1 เข้าคิว Flow ของบัญชีหลักแล้ว");
}

const RESTORE_ERRORS: Record<string, string> = {
  CUT_NOT_RESTORABLE: "ตอนนี้มีไฟล์อยู่แล้ว หรือไม่ใช่ตอนที่โพสต์แล้ว",
  CUT_NOT_THE_SAME: "ไฟล์นี้ไม่ใช่คลิปเดียวกับที่ระบบตัดต่อไว้ ใช้ไฟล์ต้นฉบับที่ดาวน์โหลดไปตอนนั้น",
  CUT_NOT_UPLOADED: "อัปโหลดไม่สำเร็จ ลองใหม่อีกครั้ง", UPLOAD_UNAVAILABLE: "อัปโหลดไม่สำเร็จ ลองใหม่อีกครั้ง",
};
/** Puts a posted episode's file back from the owner's own copy; returns an error message, or null when it worked. */
export async function cutRestoreTicketAction(clipId: string, bytes: number) {
  const id = await owner();
  try { return { ok: true as const, ...(await beginCutRestore(createAdminClient(), id, z.uuid().parse(clipId), z.number().int().positive().parse(bytes))) }; }
  catch (error) { return { ok: false as const, message: RESTORE_ERRORS[(error as Error).message] ?? "เริ่มอัปโหลดไม่สำเร็จ" }; }
}
export async function finishCutRestoreAction(clipId: string) {
  const id = await owner();
  try { await finishCutRestore(createAdminClient(), id, z.uuid().parse(clipId)); revalidatePath("/drama", "layout"); return null; }
  catch (error) { return RESTORE_ERRORS[(error as Error).message] ?? "เก็บไฟล์ไม่สำเร็จ"; }
}
