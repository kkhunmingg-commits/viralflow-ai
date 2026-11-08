"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { linkErrorLabel, parseProductLink } from "@/features/product-links/link";
import { factCandidates, lookupProduct, type ProductDetails } from "@/features/product-links/source";
import { createProductClip, deleteProductClip, remakeProductClip, reviewProductClip } from "@/features/product-links/service";
import { SOCIAL_LABEL, SOCIAL_PLATFORMS, type SocialPlatform } from "@/features/social-publish/config";

const HOME = "/product-clips";
async function owner() {
  const client = await createClient(), { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect(`/login?next=${HOME}`);
  await enforceOwnerMutationRateLimit("product-clips", data.user.id);
  return data.user.id;
}
function done(message: string): never {
  revalidatePath(HOME);
  redirect(`${HOME}?msg=${encodeURIComponent(message)}`);
}
const KNOWN: Record<string, string> = {
  ...linkErrorLabel,
  account_not_found: "ไม่พบบัญชี TikTok นี้",
  NO_USABLE_IMAGE: "ไม่มีรูปสินค้าที่ใช้ได้ เลือกรูปจากหน้าร้าน หรืออัปโหลดรูป JPG/PNG/WebP อย่างน้อย 1 รูป",
  SCRIPT_REJECTED: "ข้อความมีคำกล่าวอ้างที่ห้ามใช้ ลบข้อมูลที่อ้างสรรพคุณ/การรักษา/รับประกันผลออกแล้วลองใหม่",
  NOT_WAITING_FOR_REVIEW: "คลิปนี้ไม่ได้รอตรวจแล้ว", PRODUCT_CLIP_NOT_FOUND: "ไม่พบคลิปนี้", STILL_IN_PROGRESS: "คลิปนี้กำลังทำงานอยู่ รอให้เสร็จก่อน",
  product_clip_not_saved: "บันทึกไม่ได้ (ฐานข้อมูลอาจยังไม่ได้เพิ่มตาราง product_link_clips)", flow_clips_not_queued: "เข้าคิว Flow ไม่ได้ (ฐานข้อมูลอาจยังไม่อัปเดต)",
};
const label = (error: unknown) => { const code = error instanceof Error ? error.message : ""; return KNOWN[code] ?? null; };

export type PreviewResult = { ok: true; details: ProductDetails; facts: string[] } | { ok: false; message: string };

/** Step 1: read the pasted link. Returns what the product page gave; the owner checks and completes it in the form. */
export async function previewLinkAction(link: string): Promise<PreviewResult> {
  await owner();
  try { parseProductLink(String(link ?? "").slice(0, 1500)); } catch (error) { return { ok: false, message: label(error) ?? "ลิงก์นี้ใช้ไม่ได้" }; }
  const details = await lookupProduct(String(link).slice(0, 1500));
  return { ok: true, details, facts: factCandidates(details.description) };
}

const createSchema = z.object({
  tiktokAccountId: z.uuid(),
  link: z.string().trim().min(8).max(1500),
  productUrl: z.string().trim().max(2000).optional().default(""),
  externalId: z.string().trim().max(80).optional().default(""),
  title: z.string().trim().min(2).max(300),
  facts: z.string().max(4000).optional().default(""),
  lengthSeconds: z.coerce.number().pipe(z.union([z.literal(8), z.literal(16), z.literal(32)])),
  rights: z.literal("on"),
});

/** Step 2: save the photos, write the script, queue the Flow takes. */
export async function createProductClipAction(formData: FormData) {
  const parsed = createSchema.safeParse({
    tiktokAccountId: formData.get("tiktokAccountId"), link: formData.get("link"), productUrl: formData.get("productUrl") ?? "", externalId: formData.get("externalId") ?? "",
    title: formData.get("title"), facts: formData.get("facts") ?? "", lengthSeconds: formData.get("lengthSeconds"), rights: formData.get("rights"),
  });
  if (!parsed.success) done("กรอกให้ครบ: ลิงก์ ชื่อสินค้า ความยาวคลิป และติ๊กยืนยันสิทธิ์ใช้รูป");
  const ownerId = await owner();
  let platform;
  try { platform = parseProductLink(parsed.data.link).platform; } catch (error) { done(label(error) ?? "ลิงก์นี้ใช้ไม่ได้"); }
  const imageUrls = formData.getAll("imageUrl").map(String).filter(Boolean).slice(0, 4);
  const uploads: Uint8Array[] = [];
  for (const file of formData.getAll("upload")) {
    if (file instanceof File && file.size > 0 && file.size <= 2_000_000) uploads.push(new Uint8Array(await file.arrayBuffer()));
  }
  const productUrl = /^https:\/\//.test(parsed.data.productUrl) ? parsed.data.productUrl : null;
  const facts = parsed.data.facts.split(/\r?\n/).map(f => f.trim()).filter(Boolean).slice(0, 12);
  try {
    const { script } = await createProductClip(createAdminClient(), ownerId, { tiktokAccountId: parsed.data.tiktokAccountId, platform, source: "MANUAL_LINK",
      link: parseProductLink(parsed.data.link).link, productUrl, externalId: parsed.data.externalId || null, title: parsed.data.title, facts,
      lengthSeconds: parsed.data.lengthSeconds, imageUrls, uploads: uploads.slice(0, 4) });
    const dropped = script.dropped.length ? ` · ตัดข้อความเสี่ยงออก ${script.dropped.length} ข้อ` : "";
    done(`เข้าคิวแล้ว ${script.shots.length} ช็อต (${parsed.data.lengthSeconds} วิ) เครื่องสร้างคลิปจะเริ่มทำเอง เสร็จแล้วคลิปจะมารอตรวจด้านล่าง${dropped}`);
  } catch (error) {
    const message = label(error);
    if (message) done(message);
    throw error;
  }
}

const reviewSchema = z.object({ id: z.uuid(), decision: z.enum(["APPROVE", "REJECT"]) });
export async function reviewProductClipAction(formData: FormData) {
  const parsed = reviewSchema.safeParse({ id: formData.get("id"), decision: formData.get("decision") });
  if (!parsed.success) done("คำขอไม่ถูกต้อง");
  const ownerId = await owner();
  const targets = formData.getAll("target").map(String).filter((t): t is SocialPlatform => (SOCIAL_PLATFORMS as string[]).includes(t));
  try {
    const { posting } = await reviewProductClip(createAdminClient(), ownerId, parsed.data.id, { approved: parsed.data.decision === "APPROVE", targets });
    if (parsed.data.decision === "REJECT") done("ไม่ผ่าน: ทิ้งคลิปนี้แล้ว กด “ทำใหม่” ที่สินค้าเดิมได้ (ฉากและประโยคเปิดจะเปลี่ยน)");
    done(posting.length ? `อนุมัติแล้ว กำลังโพสต์ไป ${posting.map(p => SOCIAL_LABEL[p]).join(", ")} พร้อมคอมเมนต์ลิงก์ (ใช้เวลา 1–5 นาที)`
      : "อนุมัติแล้ว ยังไม่ได้ตั้งค่าแพลตฟอร์มให้โพสต์อัตโนมัติ ดาวน์โหลดหรือแชร์ไปโพสต์เองได้");
  } catch (error) { const message = label(error); if (message) done(message); throw error; }
}

const refSchema = z.object({ id: z.uuid() });
export async function remakeProductClipAction(formData: FormData) {
  const parsed = refSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) done("คำขอไม่ถูกต้อง");
  const ownerId = await owner();
  try { const { script } = await remakeProductClip(createAdminClient(), ownerId, parsed.data.id); done(`ทำใหม่แล้ว ${script.shots.length} ช็อต ฉาก “${script.setTh}”`); }
  catch (error) { const message = label(error); if (message) done(message); throw error; }
}
export async function deleteProductClipAction(formData: FormData) {
  const parsed = refSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) done("คำขอไม่ถูกต้อง");
  const ownerId = await owner();
  try { await deleteProductClip(createAdminClient(), ownerId, parsed.data.id); done("ลบแล้ว"); }
  catch (error) { const message = label(error); if (message) done(message); throw error; }
}
