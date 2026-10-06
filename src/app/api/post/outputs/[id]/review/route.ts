import { z } from "zod";
import { approvePostOutput, postReviewSettingsSchema, readPostReview } from "@/features/auto/post-review";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { readJsonBodyWithLimit, RequestSecurityError } from "@/lib/security/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const failure = (status: number, error: string) => Response.json({ error }, { status, headers });
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return failure(404, "ไม่พบคลิปนี้");
    const client = await createClient(), user = await client.auth.getUser();
    if (user.error || !user.data.user) return failure(401, "กรุณาเข้าสู่ระบบ");
    return Response.json((await readPostReview(client, user.data.user.id, id)).customer, { headers });
  } catch { return failure(409, "คลิปนี้ยังไม่พร้อมให้ยืนยัน"); }
}
export async function POST(request: Request, context: Context) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return failure(403, "คำขอไม่ถูกต้อง");
  try {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return failure(404, "ไม่พบคลิปนี้");
    const client = await createClient(), user = await client.auth.getUser();
    if (user.error || !user.data.user) return failure(401, "กรุณาเข้าสู่ระบบ");
    await enforceOwnerMutationRateLimit("post-review", user.data.user.id);
    const settings = postReviewSettingsSchema.safeParse(JSON.parse(await readJsonBodyWithLimit(request, 8192)));
    if (!settings.success) return failure(400, "ข้อมูลการโพสต์ไม่ถูกต้อง");
    await approvePostOutput(client, createAdminClient(), user.data.user.id, id, settings.data);
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    if (error instanceof RequestSecurityError) return failure(error.status, "คำขอไม่ถูกต้อง");
    if (error instanceof SyntaxError) return failure(400, "ข้อมูลการโพสต์ไม่ถูกต้อง");
    return failure(409, "ยังยืนยันคลิปนี้ไม่ได้ กรุณาตรวจสถานะการเชื่อมบัญชีแล้วลองใหม่");
  }
}
