import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { contentRequestSchema } from "@/features/content-export/contracts";
import { listContentRuns, startContentRun, advanceContentRun, stopContentRun, reviewContentRun } from "@/features/content-export/service";
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
async function authenticated() {
  const client = await createClient(), auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) return null;
  return { client, owner: auth.data.user.id };
}
export async function GET() {
  const auth = await authenticated(); if (!auth) return Response.json({ message: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  try { return Response.json({ runs: await listContentRuns(auth.client, auth.owner) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return Response.json({ message: "ยังอ่านผลงานไม่ได้ กรุณาลองอีกครั้ง" }, { status: 503 }); }
}
export async function POST(request: Request) {
  // JSON mutation routes are not protected by the Server Action Origin check.
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ message: "คำขอไม่ถูกต้อง" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 10_000) return Response.json({}, { status: 413 });
  const auth = await authenticated(); if (!auth) return Response.json({ message: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  try {
    const raw = await request.text(); if (Buffer.byteLength(raw) > 10_000) return Response.json({}, { status: 413 });
    const input = JSON.parse(raw), command = z.enum(["START", "ADVANCE", "STOP", "REVIEW"]).parse(input.command);
    await enforceOwnerMutationRateLimit("auto", auth.owner);
    const admin = createAdminClient();
    if (command === "START") {
      const run = await startContentRun(admin, auth.owner, contentRequestSchema.parse(input));
      return Response.json({ run }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const id = z.uuid().parse(input.id);
    if (command === "STOP") await stopContentRun(admin, auth.owner, id);
    if (command === "REVIEW") {
      if (input.consent !== true) return Response.json({ message: "กรุณายืนยันว่าตรวจคลิปแล้ว" }, { status: 400 });
      await reviewContentRun(admin, auth.owner, id);
    }
    if (command === "ADVANCE") return Response.json({ run: await advanceContentRun(admin, auth.owner, id) });
    return Response.json({ runs: await listContentRuns(auth.client, auth.owner) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return Response.json({ message: code === "content_not_configured" ? "ระบบสร้างคลิปยังไม่พร้อม กรุณาติดต่อผู้ดูแล"
      : code === "content_product_required" ? "เลือกสินค้าจริงก่อนสร้างคลิปนายหน้า"
      : code === "content_product_image_required" ? "สินค้านี้ยังไม่มีภาพจริงที่บันทึกไว้ กรุณาเพิ่มภาพก่อนเริ่ม"
      : "ยังเริ่มงานไม่ได้ กรุณาตรวจบัญชี ข้อมูล และงบ แล้วลองอีกครั้ง" }, { status: 400 });
  }
}
