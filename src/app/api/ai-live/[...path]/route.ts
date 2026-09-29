import { createClient } from "@/lib/supabase/server";
import { liveRequestBody, liveWorkerConfig, resolveLiveAction } from "@/features/ai-live/proxy";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { securityErrorResponse } from "@/lib/security/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: Context) {
  const { data, error } = await (await createClient()).auth.getUser();
  if (error || !data.user) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const { path } = await context.params;
  const action = resolveLiveAction(request.method, path);
  if (!action) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "INVALID_ORIGIN" }, { status: 403 });
  }

  const worker = liveWorkerConfig();
  if (!worker) return Response.json(
    action === "health" ? { ready: false } : { error: "WORKER_UNAVAILABLE" },
    { status: action === "health" ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );

  if (action === "reference" || action === "start") {
    try {
      await enforceOwnerMutationRateLimit("ai-live", data.user.id);
    } catch (error) {
      const response = securityErrorResponse(error);
      if (response) return response;
      throw error;
    }
  }

  const payload = await liveRequestBody(request, action);
  if (payload instanceof Response) return payload;
  try {
    const upstream = await fetch(`${worker.origin}/${path.join("/")}`, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${worker.token}`,
        "X-ViralFlow-Owner-Id": data.user.id,
        ...(payload.contentType ? { "Content-Type": payload.contentType } : {}),
      },
      body: payload.body,
      cache: "no-store",
      signal: action === "preview" ? request.signal : AbortSignal.timeout(15_000),
    });
    const headers = new Headers({ "Cache-Control": "no-store, no-transform", "X-Content-Type-Options": "nosniff" });
    headers.set("Content-Type", upstream.headers.get("content-type") ?? "application/json");
    if (action === "health") {
      const status = await upstream.json().catch(() => null) as { ready?: unknown } | null;
      return Response.json({ ready: upstream.ok && status?.ready === true },
        { status: upstream.ok ? 200 : 502, headers: { "Cache-Control": "no-store" } });
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return Response.json({ error: "WORKER_UNREACHABLE" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

export async function GET(request: Request, context: Context) { return handle(request, context); }
export async function POST(request: Request, context: Context) { return handle(request, context); }
