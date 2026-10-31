import { timingSafeEqual } from "node:crypto";

export function authorizedSchedulerToken(header: string | null, expected: string | undefined) {
  if (!expected || !header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7));
  const secret = Buffer.from(expected);
  return provided.length === secret.length && timingSafeEqual(provided, secret);
}

export async function executeSchedulerInvocation<T extends { claimed: boolean; windowKey: string; incidents: number; alerts: number }>(input: {
  authorization: string | null;
  expectedSecret: string | undefined;
  enabled: boolean;
  run: () => Promise<T>;
  notify: (result: T) => Promise<unknown>;
}) {
  if (!input.enabled) return { status: 503, body: { error: "scheduler_disabled" } } as const;
  if (!authorizedSchedulerToken(input.authorization, input.expectedSecret)) return { status: 401, body: { error: "unauthorized" } } as const;
  try {
    const result = await input.run();
    if (result.claimed) {
      try { await input.notify(result); } catch { /* Alert delivery must not change committed recovery state. */ }
    }
    return { status: 200, body: result } as const;
  } catch {
    return { status: 503, body: { error: "recovery_unavailable" } } as const;
  }
}
