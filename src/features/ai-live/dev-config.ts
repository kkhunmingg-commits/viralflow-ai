import { devFallbackEnabled } from "./dev-mode";

export function liveDevFallbackEnabled(environment: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return devFallbackEnabled(environment) && !environment.VERCEL;
}

export function liveDevWorkerConfiguration(environment: Readonly<Record<string, string | undefined>> = process.env) {
  if (!liveDevFallbackEnabled(environment)) return null;
  const token = environment.AI_LIVE_WORKER_TOKEN;
  if (!token || token.length < 32) return null;
  try {
    const url = new URL(environment.AI_LIVE_WORKER_URL ?? "");
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return { origin: url.origin, token };
  } catch { return null; }
}
