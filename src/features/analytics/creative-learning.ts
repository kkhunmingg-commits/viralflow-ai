import type { AnalyticsMode, AnalyticsSource, VideoMetrics } from "./types";

/** Input is joined from owner-scoped analytics + selected creative records, not model estimates. */
export interface CreativeOutcome {
  evidenceId: string; ownerId: string; accountId: string; videoId: string;
  mode: AnalyticsMode; source: AnalyticsSource; authorized: boolean; observedAt: string;
  hook: string; angle: string; metrics: VideoMetrics;
  attributedFollowers: number | null; retention: number | null; completionRate: number | null;
}
export interface CreativeLearningContext {
  ownerId: string; accountId: string; mode: AnalyticsMode; optedIn: boolean; affiliateEligible: boolean;
}
export interface CreativeCohort {
  dimension: "HOOK" | "ANGLE"; value: string; videos: number; evidenceIds: string[];
  medianViews: number | null; engagementRate: number | null; followersPerThousandViews: number | null;
  retention: number | null; completionRate: number | null; orders: number | null; gmv: number | null; commission: number | null;
  recommendation: "CONTROLLED_TEST" | "OBSERVE";
}
const valid = (n: number | null): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const median = (ns: number[]) => {
  const sorted = ns.toSorted((a, b) => a - b), n = sorted.length;
  return n ? n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : null;
};
const completeSum = (rows: CreativeOutcome[], get: (row: CreativeOutcome) => number | null) => {
  const ns = rows.map(get); return ns.length && ns.every(valid) ? ns.reduce((sum, n) => sum + n, 0) : null;
};
const completeAverage = (rows: CreativeOutcome[], get: (row: CreativeOutcome) => number | null) => {
  const sum = completeSum(rows, get); return sum === null ? null : sum / rows.length;
};
const observationFingerprint = (row: CreativeOutcome) => JSON.stringify([row.videoId, row.mode, row.source,
  Date.parse(row.observedAt), row.hook, row.angle,
  ...(["views", "likes", "comments", "shares", "favorites", "clicks", "orders", "gmv", "commission"] as const).map(key => row.metrics[key]),
  row.attributedFollowers, row.retention, row.completionRate]);

/** Describes observed associations only. Does not authorize posting, promise virality or install learned rules. */
export function analyzeCreativeLearning(outcomes: CreativeOutcome[], context: CreativeLearningContext, now: Date) {
  const byVideo = new Map<string, CreativeOutcome>();
  const evidence = new Map<string, CreativeOutcome>();
  const conflictedEvidenceVideos = new Set<string>(), latestSnapshotConflicts = new Set<string>();
  if (context.optedIn && Number.isFinite(now.getTime())) for (const row of outcomes) {
    const at = Date.parse(row.observedAt);
    if (row.ownerId !== context.ownerId || row.accountId !== context.accountId || row.mode !== context.mode ||
        !row.authorized || !["TIKTOK_DISPLAY", "TIKTOK_SHOP_ANALYTICS"].includes(row.source) ||
        !row.evidenceId || !row.videoId || !Number.isFinite(at) || at > now.getTime() || now.getTime() - at > 30 * 86400000) continue;
    const previousEvidence = evidence.get(row.evidenceId);
    if (previousEvidence && observationFingerprint(previousEvidence) !== observationFingerprint(row)) {
      // One immutable source observation cannot describe two videos or contradictory values.
      conflictedEvidenceVideos.add(previousEvidence.videoId); conflictedEvidenceVideos.add(row.videoId);
    }
    evidence.set(row.evidenceId, row);
    const prior = byVideo.get(row.videoId), priorAt = prior ? Date.parse(prior.observedAt) : null;
    // Updates of the same post are observations of one sample, never extra successful clips.
    if (!prior || priorAt! < at) {
      byVideo.set(row.videoId, row); latestSnapshotConflicts.delete(row.videoId);
    } else if (priorAt === at && observationFingerprint(prior) !== observationFingerprint(row)) {
      latestSnapshotConflicts.add(row.videoId);
    } else if (priorAt === at && row.evidenceId < prior.evidenceId) byVideo.set(row.videoId, row);
  }
  const accepted = [...byVideo.values()].filter(row => !conflictedEvidenceVideos.has(row.videoId) && !latestSnapshotConflicts.has(row.videoId));
  const cohorts: CreativeCohort[] = [];
  for (const dimension of ["HOOK", "ANGLE"] as const) {
    const groups = new Map<string, CreativeOutcome[]>();
    for (const row of accepted) {
      const key = (dimension === "HOOK" ? row.hook : row.angle).trim(); if (!key) continue;
      const rows = groups.get(key) ?? []; rows.push(row); groups.set(key, rows);
    }
    for (const [value, rows] of groups) {
      const views = completeSum(rows, r => r.metrics.views);
      const engagements = completeSum(rows, r => [r.metrics.likes, r.metrics.comments, r.metrics.shares].every(valid)
        ? r.metrics.likes! + r.metrics.comments! + r.metrics.shares! : null);
      const followers = completeSum(rows, r => r.attributedFollowers);
      const commerce = context.mode === "AFFILIATE" && context.affiliateEligible && rows.every(r => r.source === "TIKTOK_SHOP_ANALYTICS");
      cohorts.push({dimension, value, videos: rows.length, evidenceIds: rows.map(r => r.evidenceId).sort(),
        medianViews: rows.every(row => valid(row.metrics.views)) ? median(rows.map(r => r.metrics.views!)) : null,
        engagementRate: views && engagements !== null ? engagements / views : null,
        followersPerThousandViews: views && followers !== null ? followers * 1000 / views : null,
        retention: completeAverage(rows, r => r.retention !== null && r.retention <= 1 ? r.retention : null),
        completionRate: completeAverage(rows, r => r.completionRate !== null && r.completionRate <= 1 ? r.completionRate : null),
        orders: commerce ? completeSum(rows, r => r.metrics.orders) : null,
        gmv: commerce ? completeSum(rows, r => r.metrics.gmv) : null,
        commission: commerce ? completeSum(rows, r => r.metrics.commission) : null,
        recommendation: rows.length >= 3 && views !== null ? "CONTROLLED_TEST" : "OBSERVE"});
    }
  }
  const eligible = cohorts.filter(c => c.recommendation === "CONTROLLED_TEST");
  // No cross-objective fallback: missing attributed followers/orders does not turn views into sales or follower growth.
  const metric = (c: CreativeCohort) => context.mode === "GROWTH" ? c.followersPerThousandViews : c.orders;
  const ranked = eligible.filter(c => metric(c) !== null).toSorted((a, b) => metric(b)! - metric(a)! || a.value.localeCompare(b.value));
  return {accountId: context.accountId, mode: context.mode, source: "REAL_OBSERVATIONS" as const,
    status: accepted.length ? "OBSERVED" as const : "UNKNOWN" as const,
    evidenceIds: accepted.map(r => r.evidenceId).sort(), sampleSize: accepted.length, cohorts,
    conflictingVideosExcluded: new Set([...conflictedEvidenceVideos, ...latestSnapshotConflicts]).size,
    preferredHook: ranked.find(c => c.dimension === "HOOK")?.value ?? null,
    preferredAngle: ranked.find(c => c.dimension === "ANGLE")?.value ?? null,
    confidence: ranked.length ? Math.min(.8, accepted.length / 20) : 0,
    confidenceBasis: "Sample coverage rubric; not a probability of virality or a causal estimate",
    action: ranked.length ? "PROPOSE_CONTROLLED_TEST" as const : "WAIT_FOR_ATTRIBUTABLE_RESULTS" as const,
    humanReviewRequired: true as const, rulesActivated: false as const,
    limitations: ["Cumulative post metrics may have different exposure windows", "Observational associations do not establish causality", "Missing permissions/metrics remain UNKNOWN; account follower delta is not attributed to a video"]};
}
