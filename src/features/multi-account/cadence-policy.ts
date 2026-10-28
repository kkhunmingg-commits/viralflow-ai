/**
 * Owner cadence targets tempered by TikTok anti-spam guidance.
 *
 * - Growth (below 1,000 followers / no verified Shop permission): 3–5 clips a day, ramping only on healthy days.
 * - Affiliate: the owner's target (default 15 a day) reached gradually from a small start, never above the
 *   per-creator posting volume TikTok's Content Sharing Guidelines describe as typical (~15/day), and never
 *   above a cap TikTok actually returned for the creator.
 * - At least 60 minutes between clips on one account; risk signals (warnings, restrictions) drop to the floor or pause.
 * These are ceilings, not promises: TikTok can restrict any account and the real cap from creator_info wins.
 */
export type CadencePhase = "GROWTH" | "AFFILIATE";
export type CadenceRisk = "NONE" | "WARNING" | "BLOCKED";

export const CADENCE_POLICY = {
  growth: { min: 3, max: 5, healthyDaysPerStep: 3 },
  affiliate: { defaultTarget: 15, start: 5, stepPerHealthyDay: 2 },
  // https://developers.tiktok.com/doc/content-sharing-guidelines — posting volume per creator is capped (typically ~15/day).
  platformTypicalCreatorCap: 15,
  minimumGapMinutes: 60,
} as const;

export interface CadenceInput {
  phase: CadencePhase;
  ownerTarget?: number | null;
  /** Consecutive recent observed days with posts and no restriction. */
  healthyDays: number;
  risk?: CadenceRisk;
  /** Real per-creator cap returned by TikTok; null = unknown (the typical cap still applies). */
  publishCap?: number | null;
}
export interface CadenceCeiling { target: number; reason: string }

export function cadenceCeiling(input: CadenceInput): CadenceCeiling {
  const days = Math.max(0, Math.floor(Number.isFinite(input.healthyDays) ? input.healthyDays : 0));
  if (input.risk === "BLOCKED") return { target: 0, reason: "CADENCE_PAUSED_RISK" };
  let target: number, reason: string;
  if (input.phase === "GROWTH") {
    const g = CADENCE_POLICY.growth;
    target = input.risk === "WARNING" ? g.min : Math.min(g.max, g.min + Math.floor(days / g.healthyDaysPerStep));
    reason = input.risk === "WARNING" ? "CADENCE_GROWTH_FLOOR_RISK" : "CADENCE_GROWTH";
  } else {
    const a = CADENCE_POLICY.affiliate;
    const wanted = Math.max(0, Math.floor(input.ownerTarget ?? a.defaultTarget));
    const ramp = input.risk === "WARNING" ? CADENCE_POLICY.growth.min : a.start + a.stepPerHealthyDay * days;
    target = Math.min(wanted, ramp, CADENCE_POLICY.platformTypicalCreatorCap);
    reason = input.risk === "WARNING" ? "CADENCE_AFFILIATE_FLOOR_RISK" : target < wanted ? "CADENCE_AFFILIATE_RAMP" : "CADENCE_AFFILIATE_TARGET";
  }
  if (input.publishCap !== null && input.publishCap !== undefined && Number.isFinite(input.publishCap) && input.publishCap < target) {
    target = Math.max(0, Math.floor(input.publishCap)); reason = "PLATFORM_CAP";
  }
  return { target, reason };
}

/** Days at the end of history with at least one post, counted back until the first gap. */
export function healthyStreak(history: readonly { posts: number }[]) {
  let n = 0;
  for (let i = history.length - 1; i >= 0 && history[i].posts > 0; i--) n++;
  return n;
}

/**
 * Minute offsets that interleave accounts so that, with N accounts posting hourly, one account posts
 * every 60/N minutes instead of all of them at once. Order is stable for the same account ids.
 */
export function accountStaggerMinutes(accountIds: readonly string[], gapMinutes: number = CADENCE_POLICY.minimumGapMinutes) {
  const sorted = [...new Set(accountIds)].sort();
  const step = sorted.length ? gapMinutes / sorted.length : 0;
  return new Map(sorted.map((id, i) => [id, Math.floor(i * step)]));
}
