import { z } from "zod";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ownsVideoStoragePath, videoStorageBucket } from "@/features/video/storage";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const kind = new URL(request.url).searchParams.get("kind");
  if (!z.uuid().safeParse(id).success || !["MASTER", "VARIATION"].includes(kind ?? "")) {
    return NextResponse.json({ message: "ไม่พบคลิปนี้" }, { status: 404, headers });
  }
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return NextResponse.json({ message: "กรุณาเข้าสู่ระบบ" }, { status: 401, headers });
    const media = await client.from(kind === "MASTER" ? "master_videos" : "video_variations").select("storage_path")
      .eq("owner_id", data.user.id).eq("id", id).maybeSingle();
    if (media.error || !media.data?.storage_path || !ownsVideoStoragePath(data.user.id, media.data.storage_path)) {
      return NextResponse.json({ message: "ยังไม่มีวิดีโอให้เปิดดู" }, { status: 404, headers });
    }
    const signed = await client.storage.from(videoStorageBucket).createSignedUrl(media.data.storage_path, 300);
    if (signed.error || !signed.data?.signedUrl) throw new Error("preview_unavailable");
    const response = NextResponse.redirect(signed.data.signedUrl, 307);
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    return response;
  } catch { return NextResponse.json({ message: "ยังเปิดวิดีโอไม่ได้ กรุณาลองใหม่" }, { status: 503, headers }); }
}
