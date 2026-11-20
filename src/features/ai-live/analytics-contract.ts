/** Common POST/LIVE learning input. Null means unobserved, never an invented zero. */
export interface UnifiedAccountPerformance {
  accountId: string;
  observedAtMs: number;
  post: {
    status: "IDLE" | "RUNNING" | "QUEUED" | "PUBLISHED" | "FAILED" | null;
    clipsToday: number | null;
    views: number | null;
    sales: number | null;
  };
  live: {
    status: "READY" | "LIVE" | "PAUSED" | "STOPPED" | "ERROR" | null;
    durationSecondsToday: number | null;
    viewers: number | null;
    sales: number | null;
    units: number | null;
    revenuePerHour: number | null;
  };
  commission: number | null;
  currency: string | null;
  topProductId: string | null;
  source: "OBSERVED";
}

export function unifiedAccountPerformance(value: UnifiedAccountPerformance): UnifiedAccountPerformance {
  if (!value.accountId || !Number.isSafeInteger(value.observedAtMs) || value.observedAtMs < 0 || value.source !== "OBSERVED") throw new Error("invalid_account_observation");
  const amounts = [value.post.clipsToday, value.post.views, value.post.sales, value.live.durationSecondsToday,
    value.live.viewers, value.live.sales, value.live.units, value.live.revenuePerHour, value.commission];
  if (amounts.some((amount) => amount !== null && (!Number.isFinite(amount) || amount < 0))) throw new Error("invalid_account_observation");
  for (const count of [value.post.clipsToday, value.post.views, value.live.viewers, value.live.units]) {
    if (count !== null && !Number.isSafeInteger(count)) throw new Error("invalid_account_observation");
  }
  if (value.currency !== null && !/^[A-Z]{3}$/u.test(value.currency)) throw new Error("invalid_account_currency");
  return structuredClone(value);
}
