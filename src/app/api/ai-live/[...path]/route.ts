import { createClient } from "@/lib/supabase/server";
import { resolveLiveAction } from "@/features/ai-live/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

// Retired cloud media proxy: all presenter media stays on the customer's machine.
async function handle(request: Request, context: Context) {
  const { data, error } = await (await createClient()).auth.getUser();
  if (error || !data.user) return Response.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  const { path } = await context.params;
  const action = resolveLiveAction(request.method, path);
  if (!action) return Response.json({ error: "ไม่พบรายการนี้" }, { status: 404 });
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "ไม่สามารถทำรายการนี้ได้" }, { status: 403 });
  }
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  return action === "health"
    ? Response.json({ ready: false, localRequired: true }, { headers })
    : Response.json({ error: "กรุณาเชื่อมส่วนเสริมบนเครื่องเพื่อใช้ AI LIVE" }, { status: 410, headers });
}

export async function GET(request: Request, context: Context) { return handle(request, context); }
export async function POST(request: Request, context: Context) { return handle(request, context); }
