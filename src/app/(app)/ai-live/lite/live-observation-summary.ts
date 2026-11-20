type Observation = { accountId: string; liveSeconds: number | null; sales: number | null; units: number | null; scheduled?: boolean | null };

/** An all-account total is unknown if any account lacks a verified observation. */
export function liveObservationSummary(accountIds: string[], observations: Observation[]) {
  const complete = accountIds.length > 0 && observations.length === accountIds.length
    && new Set(observations.map((item) => item.accountId)).size === accountIds.length
    && observations.every((item) => accountIds.includes(item.accountId));
  const sum = (key: "liveSeconds" | "sales" | "units") => complete && observations.every((item) =>
    typeof item[key] === "number" && Number.isFinite(item[key]) && item[key]! >= 0)
    ? observations.reduce((total, item) => total + item[key]!, 0) : null;
  const seconds = sum("liveSeconds");
  const sales = sum("sales");
  const hours = seconds === null ? null : seconds / 3600;
  return { hours, sales, units: sum("units"), salesPerHour: sales !== null && hours !== null && hours > 0 ? sales / hours : null,
    scheduled: complete && observations.every((item) => typeof item.scheduled === "boolean")
      ? observations.filter((item) => item.scheduled).length : null };
}
