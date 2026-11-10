import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { lookupErrorLabel } from "@/features/product-links/browser-lookup";
import { capturePlatform, captureSchema } from "@/features/product-links/capture";
import { captureProductPage, finishProductLookup } from "@/features/product-links/service";

/**
 * The ViralFlow Chrome extension posts here from ViralFlow's own /product-clips/fetch page (same site, so the owner's
 * sign-in comes with it): what the owner's Chrome read on the Shopee/Lazada product page, or why it could not.
 */
export const maxDuration = 120;
const MAX_BODY = 4_400_000;
const bodySchema = z.object({
  jobId: z.uuid().optional(),
  capture: captureSchema.optional(),
  error: z.enum(["PAGE_NOT_READY"]).optional(),
});
const answer = (ok: boolean, message: string, status = 200) => NextResponse.json({ ok, message }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return answer(false, "ส่งได้จากหน้า ViralFlow เท่านั้น", 403);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return answer(false, "ข้อมูลใหญ่เกินไป", 413);
  const { data, error } = await (await createClient()).auth.getUser();
  if (error || !data.user) return answer(false, "ล็อกอิน ViralFlow ใน Chrome นี้ก่อน", 401);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (!parsed.data.capture && !(parsed.data.error && parsed.data.jobId))) return answer(false, "ข้อมูลหน้าสินค้าไม่ครบ", 400);
  try { await enforceOwnerMutationRateLimit("product-capture", data.user.id); } catch { return answer(false, "ส่งถี่เกินไป รอสักครู่แล้วลองใหม่", 429); }
  const admin = createAdminClient(), { jobId, capture } = parsed.data;
  try {
    if (!capture) {
      await finishProductLookup(admin, data.user.id, { jobId: jobId!, ok: false, error: parsed.data.error });
      return answer(false, `ดึงข้อมูลไม่สำเร็จ: ${lookupErrorLabel(parsed.data.error)}`);
    }
    const platform = capturePlatform(capture.finalUrl);
    if (!platform) return answer(false, "ส่งได้เฉพาะหน้าสินค้า Shopee หรือ Lazada", 400);
    const result = await captureProductPage(admin, data.user.id, capture, platform, new Date(), jobId);
    if (result.status === "QUEUED") return answer(true, `ได้ข้อมูลสินค้าแล้ว: ${result.title} · เข้าคิว ${result.shots} ช็อต${result.created ? " (คลิปใหม่ 16 วิ)" : ""} เครื่องสร้างคลิปจะทำต่อเอง`);
    if (result.status === "IGNORED") return answer(false, "คลิปนี้ไม่ได้รอข้อมูลสินค้าแล้ว");
    return answer(false, "ดึงข้อมูลจากหน้านี้ไม่ครบ (ไม่มีชื่อหรือรูปสินค้า) ลองเลื่อนดูรูปสินค้าให้โหลดก่อน แล้วกดปุ่มอีกครั้ง");
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "";
    if (code === "account_not_found") return answer(false, "ยังไม่มีบัญชี TikTok ในระบบ เพิ่มบัญชีก่อนแล้วลองใหม่");
    return answer(false, `ส่งข้อมูลสินค้าไม่สำเร็จ: ${lookupErrorLabel(code) ?? "ลองใหม่อีกครั้ง"}`, 500);
  }
}
