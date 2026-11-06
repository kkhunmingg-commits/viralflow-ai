import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { shotVideoUrl } from "@/features/drama/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Short-lived private link to one finished drama shot, to watch it before the episode is cut. Owner only. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return Response.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "ไม่พบช็อตนี้" }, { status: 404 });
  try {
    return Response.redirect(await shotVideoUrl(createAdminClient(), data.user.id, id), 302);
  } catch {
    return Response.json({ error: "ไฟล์ช็อตนี้ถูกลบไปแล้ว" }, { status: 404 });
  }
}
