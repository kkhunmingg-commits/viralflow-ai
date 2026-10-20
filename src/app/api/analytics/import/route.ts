import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { decodeReportFile, importOwnerReport, previewOwnerReport, type ReportKind } from "@/features/analytics/report-import";
export const runtime = "nodejs";
export const maxDuration = 60;
const MESSAGES: Record<string, string> = {
  REPORT_ACCOUNT_IS_MOCK: "บัญชีทดลองนำเข้าผลจริงไม่ได้",
  REPORT_ACCOUNT_NOT_FOUND: "ไม่พบบัญชี TikTok นี้ในระบบของคุณ",
  REPORT_TIME_INVALID: "ระบุเวลาที่ดาวน์โหลดรายงาน (ต้องไม่เป็นเวลาในอนาคต)",
  REPORT_TOO_LARGE: "ไฟล์ต้องไม่เกิน 5 MB",
  REPORT_EMPTY: "ไฟล์ว่างเปล่า",
  REPORT_IS_EXCEL: "ไฟล์นี้เป็น Excel (.xlsx/.xls) กรุณาดาวน์โหลดจาก TikTok เป็น CSV หรือเปิดใน Excel แล้วบันทึกเป็น \"CSV UTF-8\" ก่อนอัปโหลด",
};
/** The owner uploads their own TikTok Studio or Affiliate Center export (CSV) for one of their accounts.
 * `mode=preview` parses and checks the file without storing anything; any other mode imports it. */
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({}, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 5_500_000) return Response.json({ message: MESSAGES.REPORT_TOO_LARGE }, { status: 413 });
  const auth = await (await createClient()).auth.getUser(); if (auth.error || !auth.data.user) return Response.json({}, { status: 401 });
  try {
    const form = await request.formData(), file = form.get("file"), kind = String(form.get("kind") ?? ""), preview = form.get("mode") === "preview";
    await enforceOwnerMutationRateLimit(preview ? "report-preview" : "auto", auth.data.user.id);
    if (!(file instanceof File) || !["VIDEO_PERFORMANCE", "AFFILIATE_ORDERS"].includes(kind)) return Response.json({ message: "เลือกไฟล์ CSV และประเภทรายงาน" }, { status: 400 });
    if (file.size > 5_000_000) throw new Error("REPORT_TOO_LARGE");
    const text = decodeReportFile(new Uint8Array(await file.arrayBuffer())), accountId = String(form.get("accountId") ?? "");
    if (preview) return Response.json(await previewOwnerReport(createAdminClient(), auth.data.user.id, { accountId, kind: kind as ReportKind, text }));
    const result = await importOwnerReport(createAdminClient(), auth.data.user.id, { accountId, kind: kind as ReportKind,
      fileName: file.name, text, reportedAt: new Date(String(form.get("reportedAt") ?? "")) });
    return Response.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return Response.json({ message: MESSAGES[code] ?? "ยังนำเข้ารายงานนี้ไม่ได้ กรุณาตรวจไฟล์และบัญชี" }, { status: 400 });
  }
}
