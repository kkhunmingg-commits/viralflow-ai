import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clipSignedUrl } from "@/features/flow-farm/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Short-lived private link to a library clip, for preview or download. Owner only. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return Response.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "ไม่พบคลิปนี้" }, { status: 404 });
  try {
    const download = new URL(request.url).searchParams.get("download") === "1";
    return Response.redirect(await clipSignedUrl(createAdminClient(), data.user.id, id, download), 302);
  } catch {
    return Response.json({ error: "ไม่พบคลิปนี้ในคลัง" }, { status: 404 });
  }
}
