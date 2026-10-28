import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/** The local Flow worker signs in with one long secret and acts for exactly one owner. Both must be set. */
export function flowWorkerConfig() {
  const token = process.env.FLOW_WORKER_TOKEN ?? "", owner = process.env.FLOW_WORKER_OWNER_ID ?? "";
  return { enabled: token.length >= 32 && /^[0-9a-f-]{36}$/i.test(owner), token, owner };
}

export function authorizeFlowWorker(request: Request) {
  const config = flowWorkerConfig();
  if (!config.enabled) return { ok: false as const, status: 503 };
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!presented || !timingSafeEqual(digest(presented), digest(config.token))) return { ok: false as const, status: 401 };
  return { ok: true as const, owner: config.owner };
}
