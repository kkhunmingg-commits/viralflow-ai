import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { saveContentProduct } from "@/features/content-export/product-input";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({}, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 1_000_000) return Response.json({ message: "ภาพต้องมีขนาดไม่เกิน 750 KB" }, { status: 413 });
  const auth = await (await createClient()).auth.getUser(); if (auth.error || !auth.data.user) return Response.json({}, { status: 401 });
  try {
    await enforceOwnerMutationRateLimit("auto", auth.data.user.id);
    const product = await saveContentProduct(createAdminClient(), auth.data.user.id, await request.formData());
    return Response.json({ product });
  } catch { return Response.json({ message: "ยังบันทึกสินค้าไม่ได้ กรุณาตรวจชื่อ ราคา และภาพจริง JPG/PNG/WebP ไม่เกิน 750 KB" }, { status: 400 }); }
}
