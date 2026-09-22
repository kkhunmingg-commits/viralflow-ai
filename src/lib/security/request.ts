import { createHash } from "node:crypto";

export class RequestSecurityError extends Error {
  constructor(
    readonly code:
      | "unsupported_media_type"
      | "payload_too_large"
      | "invalid_content_length"
      | "invalid_text_encoding"
      | "rate_limited"
      | "rate_limit_unavailable",
    readonly status: number,
  ) {
    super(code);
    this.name = "RequestSecurityError";
  }
}

export function requestFingerprint(request: Request, subject = "") {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const address =
    request.headers.get("cf-connecting-ip")?.trim()
    ?? request.headers.get("x-real-ip")?.trim()
    ?? forwarded
    ?? "unknown";
  return createHash("sha256").update(address + ":" + subject).digest("hex");
}

export async function readJsonBodyWithLimit(request: Request, maxBytes: number) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (contentType !== "application/json") {
    throw new RequestSecurityError("unsupported_media_type", 415);
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new RequestSecurityError("invalid_content_length", 400);
    }
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new RequestSecurityError("invalid_content_length", 400);
    }
    if (parsed > maxBytes) {
      throw new RequestSecurityError("payload_too_large", 413);
    }
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new RequestSecurityError("payload_too_large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RequestSecurityError("invalid_text_encoding", 400);
  }
}

export function securityErrorResponse(error: unknown) {
  if (!(error instanceof RequestSecurityError)) return null;
  const headers = error.code === "rate_limited" ? { "Retry-After": "60" } : undefined;
  return Response.json({ error: error.code }, { status: error.status, headers });
}

export function assertRateLimitResult(data: unknown, error: unknown) {
  if (error) throw new RequestSecurityError("rate_limit_unavailable", 503);
  if (data !== true) throw new RequestSecurityError("rate_limited", 429);
}
