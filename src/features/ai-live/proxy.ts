import "server-only";
import { z } from "zod";

const sessionId = z.uuid();
const startRequest = z.object({
  reference_id: z.uuid(),
  target_fps: z.number().int().min(10).max(30),
});

export type LiveAction = "health" | "reference" | "start" | "audio" | "metrics" | "preview" | "stop";

export function resolveLiveAction(method: string, path: string[]): LiveAction | null {
  if (method === "GET" && path.length === 1 && path[0] === "health") return "health";
  if (method === "POST" && path.length === 1 && path[0] === "references") return "reference";
  if (method === "POST" && path.length === 1 && path[0] === "sessions") return "start";
  if (path.length !== 3 || path[0] !== "sessions" || !sessionId.safeParse(path[1]).success) return null;
  if (method === "POST" && path[2] === "audio") return "audio";
  if (method === "POST" && path[2] === "stop") return "stop";
  if (method === "GET" && path[2] === "metrics") return "metrics";
  if (method === "GET" && path[2] === "preview") return "preview";
  return null;
}

export function liveWorkerConfig(environment: Record<string, string | undefined> = process.env) {
  const raw = environment.AI_LIVE_WORKER_URL;
  const token = environment.AI_LIVE_WORKER_TOKEN;
  if (!raw || !token || token.length < 32) return null;
  try {
    const url = new URL(raw);
    const local = environment.APP_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    return { origin: url.origin, token };
  } catch {
    return null;
  }
}

async function boundedBytes(request: Request, maximum: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function liveRequestBody(request: Request, action: LiveAction): Promise<{ body?: BodyInit; contentType?: string } | Response> {
  if (action === "reference" || action === "audio") {
    const maximum = action === "reference" ? 4 * 1024 * 1024 : 32_000;
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maximum) return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
    const bytes = await boundedBytes(request, maximum);
    if (!bytes || !bytes.length) return Response.json({ error: "INVALID_PAYLOAD_SIZE" }, { status: 413 });
    const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (action === "audio") {
      if (contentType !== "application/octet-stream" || bytes.length % 2 !== 0) return Response.json({ error: "INVALID_AUDIO_CHUNK" }, { status: 400 });
    } else {
      const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
      const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
      if (!((contentType === "image/jpeg" && jpeg) || (contentType === "image/png" && png))) return Response.json({ error: "INVALID_PRESENTER_IMAGE" }, { status: 400 });
    }
    return { body: bytes.buffer, contentType: contentType! };
  }
  if (action === "start") {
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return Response.json({ error: "INVALID_START_REQUEST" }, { status: 415 });
    }
    const bytes = await boundedBytes(request, 4096);
    if (!bytes) return Response.json({ error: "INVALID_START_REQUEST" }, { status: 413 });
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return Response.json({ error: "INVALID_START_REQUEST" }, { status: 400 }); }
    const input = startRequest.safeParse(parsed);
    if (!input.success) return Response.json({ error: "INVALID_START_REQUEST" }, { status: 400 });
    return { body: JSON.stringify(input.data), contentType: "application/json" };
  }
  return {};
}
