import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { contentMedia } from "@/features/content-export/service";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await (await createClient()).auth.getUser();
  if (auth.error || !auth.data.user) return new Response(null, { status: 401 });
  const parsed = z.uuid().safeParse((await context.params).id); if (!parsed.success) return new Response(null, { status: 404 });
  const download = new URL(request.url).searchParams.get("download") === "1";
  try {
    const bytes = await contentMedia(createAdminClient(), auth.data.user.id, parsed.data, download);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": download ? "application/zip" : "video/mp4",
      "Content-Length": String(bytes.byteLength), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      ...(download ? { "Content-Disposition": 'attachment; filename="viralflow-content.zip"' } : {}) } });
  } catch { return new Response(null, { status: 404 }); }
}
