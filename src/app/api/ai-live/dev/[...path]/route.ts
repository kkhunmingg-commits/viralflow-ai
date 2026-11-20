import { createClient } from "@/lib/supabase/server";
import { handleDevWorkerRequest } from "@/features/ai-live/dev-http";
import { liveDevFallbackEnabled } from "@/features/ai-live/dev-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: Context) {
  if (!liveDevFallbackEnabled()) return new Response(null, { status: 404 });
  const { data, error } = await (await createClient()).auth.getUser();
  if (error || !data.user) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  return handleDevWorkerRequest(request, (await context.params).path, data.user.id);
}
export async function GET(request: Request, context: Context) { return handle(request, context); }
export async function POST(request: Request, context: Context) { return handle(request, context); }
