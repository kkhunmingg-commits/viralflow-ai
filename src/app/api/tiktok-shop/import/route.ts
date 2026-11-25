import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { importTikTokProducts } from "@/features/tiktok-shop/catalog";
import { importSchema } from "@/features/tiktok-shop/items";

/**
 * The ViralFlow Chrome extension posts here from ViralFlow's own /product-clips/tiktok page (same site, so the owner's
 * sign-in comes with it): the best-sellers it read on TikTok Shop's web pages (shop.tiktok.com) in the owner's Chrome.
 */
export const maxDuration = 60;
const MAX_BODY = 3_000_000;
const answer = (ok: boolean, message: string, status = 200, saved = 0) =>
  NextResponse.json({ ok, message, saved }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return answer(false, "ส่งได้จากหน้า ViralFlow เท่านั้น", 403);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return answer(false, "ข้อมูลใหญ่เกินไป", 413);
  const { data, error } = await (await createClient()).auth.getUser();
  if (error || !data.user) return answer(false, "ล็อกอิน ViralFlow ใน Chrome นี้ก่อน", 401);
  const parsed = importSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return answer(false, "ข้อมูลสินค้าไม่ถูกต้อง", 400);
  try { await enforceOwnerMutationRateLimit("tiktok-shop-import", data.user.id); } catch { return answer(false, "ส่งถี่เกินไป รอสักครู่แล้วลองใหม่", 429); }
  try {
    const { saved } = await importTikTokProducts(createAdminClient(), data.user.id, parsed.data.items);
    return answer(saved > 0, saved ? `ได้สินค้าขายดีจาก TikTok Shop ${saved} รายการ` : "หน้านี้ไม่มีรายการสินค้าให้ดึง", 200, saved);
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "";
    return answer(false, code === "TIKTOK_TABLE_MISSING" ? "ฐานข้อมูลยังไม่มีตารางสินค้า TikTok" : "บันทึกสินค้าไม่สำเร็จ ลองใหม่อีกครั้ง", 500);
  }
}
