import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { importOwnerReport } from "@/features/analytics/report-import";
export const runtime = "nodejs";
export const maxDuration = 60;
/** The owner uploads their own TikTok Studio or Affiliate Center export (CSV) for one of their accounts. */
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({}, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 5_500_000) return Response.json({ message: "ไฟล์ต้องไม่เกิน 5 MB" }, { status: 413 });
  const auth = await (await createClient()).auth.getUser(); if (auth.error || !auth.data.user) return Response.json({}, { status: 401 });
  try {
    await enforceOwnerMutationRateLimit("auto", auth.data.user.id);
    const form = await request.formData(), file = form.get("file"), kind = String(form.get("kind") ?? ""), reportedAt = new Date(String(form.get("reportedAt") ?? ""));
    if (!(file instanceof File) || !["VIDEO_PERFORMANCE", "AFFILIATE_ORDERS"].includes(kind)) return Response.json({ message: "เลือกไฟล์ CSV และประเภทรายงาน" }, { status: 400 });
    const result = await importOwnerReport(createAdminClient(), auth.data.user.id, { accountId: String(form.get("accountId") ?? ""), kind: kind as "VIDEO_PERFORMANCE" | "AFFILIATE_ORDERS",
      fileName: file.name, text: await file.text(), reportedAt });
    return Response.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const message = code === "REPORT_ACCOUNT_IS_MOCK" ? "บัญชีทดลองนำเข้าผลจริงไม่ได้" : code === "REPORT_TIME_INVALID" ? "ระบุเวลาที่ดาวน์โหลดรายงาน" : "ยังนำเข้ารายงานนี้ไม่ได้ กรุณาตรวจไฟล์และบัญชี";
    return Response.json({ message }, { status: 400 });
  }
}
