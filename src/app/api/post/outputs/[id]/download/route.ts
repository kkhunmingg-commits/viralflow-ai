import { z } from "zod";
import { buildAuthorizedPostPackage } from "@/features/auto/export-package";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return Response.json({ error: "ไม่พบคลิปนี้" }, { status: 404, headers });
    const client = await createClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return Response.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401, headers });
    const zip = await buildAuthorizedPostPackage(client, data.user.id, id);
    return new Response(new Uint8Array(zip), { headers: { ...headers, "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=viralflow-ready-to-post.zip", "Content-Length": String(zip.byteLength) } });
  } catch {
    return Response.json({ error: "คลิปนี้ยังไม่พร้อมดาวน์โหลด" }, { status: 404, headers });
  }
}
