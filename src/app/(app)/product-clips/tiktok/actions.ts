"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { pickTikTokProducts, setTikTokLive } from "@/features/tiktok-shop/catalog";
import { CLIP_LENGTHS, type ClipLength } from "@/features/product-links/script";

const HOME = "/product-clips/tiktok";
async function owner() {
  const client = await createClient(), { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect(`/login?next=${HOME}`);
  await enforceOwnerMutationRateLimit("tiktok-shop-pick", data.user.id);
  return data.user.id;
}
function done(message: string): never {
  revalidatePath(HOME);
  revalidatePath("/ai-live");
  redirect(`${HOME}?msg=${encodeURIComponent(message)}`);
}

const pickSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(20),
  tiktokAccountId: z.uuid(),
  lengthSeconds: z.coerce.number().refine((v): v is ClipLength => (CLIP_LENGTHS as readonly number[]).includes(v)),
  makeClips: z.boolean(),
});

/** The owner ticked best-sellers: make a clip of each (automatic) and put them in Praew's TikTok LIVE list. */
export async function pickTikTokProductsAction(formData: FormData) {
  const parsed = pickSchema.safeParse({ ids: formData.getAll("id").map(String), tiktokAccountId: formData.get("tiktokAccountId"),
    lengthSeconds: formData.get("lengthSeconds"), makeClips: formData.get("makeClips") === "on" });
  if (!parsed.success) done(formData.getAll("id").length ? "เลือกได้ครั้งละไม่เกิน 20 สินค้า และต้องเลือกบัญชี TikTok" : "ยังไม่ได้ติ๊กเลือกสินค้า");
  const ownerId = await owner();
  const result = await pickTikTokProducts(createAdminClient(), ownerId, { ids: parsed.data.ids, tiktokAccountId: parsed.data.tiktokAccountId,
    lengthSeconds: parsed.data.lengthSeconds as ClipLength, makeClips: parsed.data.makeClips });
  done([`ใส่ในไลฟ์แพรวแล้ว ${result.picked} สินค้า`, result.made ? `เข้าคิวทำคลิป ${result.made} คลิป (ตรวจคลิปที่แท็บคลิปสินค้า)` : "",
    result.failed.length ? `ทำคลิปไม่ได้ ${result.failed.length} ตัว (รูปสินค้าโหลดไม่ได้ กดดึงสินค้าใหม่แล้วลองอีกครั้ง): ${result.failed.join(", ")}` : ""].filter(Boolean).join(" · "));
}

export async function setLiveAction(formData: FormData) {
  const parsed = z.object({ id: z.uuid(), live: z.enum(["on", "off"]) }).safeParse({ id: formData.get("id"), live: formData.get("live") });
  if (!parsed.success) done("คำขอไม่ถูกต้อง");
  const ownerId = await owner();
  await setTikTokLive(createAdminClient(), ownerId, [parsed.data.id], parsed.data.live === "on");
  done(parsed.data.live === "on" ? "ใส่ในไลฟ์แพรวแล้ว" : "เอาออกจากไลฟ์แพรวแล้ว");
}
