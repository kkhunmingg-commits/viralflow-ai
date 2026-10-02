import "server-only";
import { z } from "zod";
import { liveDevWorkerConfiguration } from "./dev-config";
import { liveRequestBody, resolveLiveAction } from "./proxy";

export function resolveDevAction(method: string, path: string[]) {
  if (method === "GET" && path.length === 3 && path[0] === "sessions" && z.uuid().safeParse(path[1]).success && path[2] === "frame") return "frame";
  return resolveLiveAction(method, path);
}

export async function handleDevWorkerRequest(request: Request, path: string[], ownerId: string) {
  const config = liveDevWorkerConfiguration();
  if (!config) return Response.json({ error: "DEV_WORKER_NOT_CONFIGURED" }, { status: 503 });
  const action = resolveDevAction(request.method, path);
  if (!action) return new Response(null, { status: 404 });
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "INVALID_ORIGIN" }, { status: 403 });
  }
  let input: { body?: BodyInit; contentType?: string } | Response = {};
  if (action === "start") {
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return Response.json({ error: "INVALID_DEV_SESSION_TYPE" }, { status: 415 });
    }
    // Read bounded JSON; the production parser deliberately retains its GPU FPS range.
    const reader = request.body?.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    if (reader) try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4096) { await reader.cancel(); return new Response(null, { status: 413 }); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    try {
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const parsed = z.object({ reference_id: z.uuid(), target_fps: z.number().int().min(2).max(5) })
        .strict().safeParse(JSON.parse(new TextDecoder().decode(bytes)));
      if (!parsed.success) return Response.json({ error: "INVALID_DEV_SESSION" }, { status: 400 });
      input = { body: JSON.stringify(parsed.data), contentType: "application/json" };
    } catch { return Response.json({ error: "INVALID_DEV_SESSION" }, { status: 400 }); }
  } else if (action !== "frame") input = await liveRequestBody(request, action);
  if (input instanceof Response) return input;
  try {
    const result = await fetch(`${config.origin}/${path.map(encodeURIComponent).join("/")}`, {
      method: request.method,
      headers: { Authorization: `Bearer ${config.token}`, "X-ViralFlow-Owner-Id": ownerId,
        ...(input.contentType ? { "Content-Type": input.contentType } : {}) },
      body: input.body,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(action === "preview" ? 600_000 : 60_000)]),
      cache: "no-store",
    });
    const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    for (const key of ["Content-Type", "X-Frame-Count"]) {
      const value = result.headers.get(key);
      if (value) headers.set(key, value);
    }
    return new Response(result.body, { status: result.status, headers });
  } catch { return Response.json({ error: "DEV_WORKER_UNAVAILABLE" }, { status: 503 }); }
}
