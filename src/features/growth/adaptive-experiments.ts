import { createHash } from "node:crypto";
import { allocateExploreExploit, learnAccountPatterns, planGrowthExperiment } from "./strategy";
import type { GrowthExperimentPlan } from "./types";

export type AdaptiveMode = "GROWTH" | "AFFILIATE";
export type AdaptiveEnvironment = "REAL" | "SIMULATED";
export type AdaptiveObjective = "ATTRIBUTED_FOLLOWERS_PER_1000_VIEWS" | "ENGAGEMENT_PER_VIEW" | "VERIFIED_COMMISSION_ROI";
export interface AdaptiveContext {
  ownerId: string; accountId: string; mode: AdaptiveMode; contextKey: string;
  environment: AdaptiveEnvironment; optedIn: boolean; affiliateEligible: boolean;
}
/** Freeform creative candidates, not an enumerated catalogue of permissible hooks/topics. */
export interface AdaptiveArm {
  id: string; ownerId: string; accountId: string; mode: AdaptiveMode; contextKey: string;
  /** Stable freeform hook pattern/format, not the unique spoken text of one clip. */
  hook: string; angle: string; topic: string; productionMethod: string; introducedAt: string;
}
export interface AdaptiveOutcome {
  evidenceId: string; ownerId: string; accountId: string; mode: AdaptiveMode; contextKey: string;
  armId: string; videoId: string;
  source: "TIKTOK_DISPLAY" | "TIKTOK_SHOP_ANALYTICS" | "VERIFIED_MANUAL" | "SIMULATED";
  authorized: boolean; publishedAt: string | null; observedAt: string;
  /** Metrics must describe the same completed post-publication exposure window. */
  window: { startAt: string; endAt: string; complete: boolean } | null;
  views: number | null; likes: number | null; comments: number | null; shares: number | null;
  attributedFollowers: number | null; followerAttribution: "VIDEO" | "ACCOUNT_DELTA" | "UNKNOWN";
  orders: number | null; commissionUsd: number | null; actualCostUsd: number | null;
  salesAttribution: "VIDEO" | "ACCOUNT" | "UNKNOWN"; commerceVerified: boolean;
  costBasis: "ACTUAL" | "ESTIMATED" | "UNKNOWN";
}
/** Persist these proposal identities in existing immutable evidence/decision storage. */
export interface AdaptiveProposalRecord {
  decisionId: string; experimentKey: string; ownerId: string; accountId: string;
  mode: AdaptiveMode; contextKey: string; environment: AdaptiveEnvironment;
  cycleKey: string; selectedArmId: string;
}
export interface AdaptiveEvidencePolicy {
  /** Statistical evidence criteria only; these are not posting/account quotas. */
  minDistinctVideos: number; minSpanDays: number; minEffectiveVideos: number;
  halfLifeDays: number; maxEvidenceAgeDays: number; windowToleranceHours: number;
}
const DEFAULT_POLICY: AdaptiveEvidencePolicy = { minDistinctVideos: 6, minSpanDays: 3, minEffectiveVideos: 3,
  halfLifeDays: 7, maxEvidenceAgeDays: 56, windowToleranceHours: 1 };
export interface AdaptiveExperimentInput {
  context: AdaptiveContext; cycleKey: string; now: Date; observationWindowHours: number;
  /** Capacity already approved by the existing adaptive planner/budget gates. */
  availableSlots: number; objective?: AdaptiveObjective; policy?: Partial<AdaptiveEvidencePolicy>;
  arms: readonly AdaptiveArm[]; outcomes: readonly AdaptiveOutcome[]; ledger: readonly AdaptiveProposalRecord[];
}
export interface AdaptiveArmAssessment {
  armId: string; distinctVideos: number; objectiveSamples: number; spanDays: number; effectiveVideos: number;
  reward: number | null; eligibleForExploitation: boolean;
  metrics: { followersPer1000Views: number | null; engagementPerView: number | null; commissionRoi: number | null };
  evidenceIds: string[]; reason: "CREDIBLE_SAMPLE" | "INSUFFICIENT_SAMPLE" | "OBJECTIVE_UNKNOWN";
}
export interface AdaptiveExperimentDecision {
  status: "EXPLORE" | "EXPLOIT" | "WAIT" | "ALREADY_PROPOSED" | "REVIEW_REQUIRED";
  source: AdaptiveEnvironment; objective: AdaptiveObjective; decisionId: string;
  selectedArmId: string | null; preferredArmId: string | null;
  proposal: AdaptiveProposalRecord | null; controlledExperiment: GrowthExperimentPlan | null;
  assessments: AdaptiveArmAssessment[]; evidenceIds: string[]; rejectedEvidence: number;
  excludedEvidence: Array<{ evidenceId: string; reason: string }>;
  allocation: ReturnType<typeof allocateExploreExploit>; patterns: ReturnType<typeof learnAccountPatterns>;
  reason: string; confidenceBasis: "Decayed distinct-video sample coverage; not a viral or causal probability";
  viralOutcome: "UNKNOWN"; humanReviewRequired: true; rulesActivated: false; executionAuthorized: false;
}
const DAY = 86_400_000;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const nonnegative = (value: number | null): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const clean = (value: string) => value.normalize("NFKC").trim();
function identity(arm: Omit<AdaptiveArm, "id"> | AdaptiveArm) {
  return [arm.ownerId, arm.accountId, arm.mode, arm.contextKey, ...(["hook", "angle", "topic", "productionMethod"] as const).map(key => clean(arm[key]))];
}
export function createAdaptiveArm(input: Omit<AdaptiveArm, "id">): AdaptiveArm {
  if (![input.ownerId, input.accountId, input.contextKey, input.hook, input.angle, input.topic, input.productionMethod]
    .every(value => typeof value === "string" && clean(value).length > 0 && value.length <= 4000) ||
    !["GROWTH", "AFFILIATE"].includes(input.mode) || !Number.isFinite(Date.parse(input.introducedAt))) throw new Error("ADAPTIVE_ARM_INVALID");
  return { ...input, hook: clean(input.hook), angle: clean(input.angle), topic: clean(input.topic), productionMethod: clean(input.productionMethod),
    id: `arm:${digest(identity(input))}` };
}
function sameContext(row: Pick<AdaptiveContext, "ownerId" | "accountId" | "mode" | "contextKey">, context: AdaptiveContext) {
  return row.ownerId === context.ownerId && row.accountId === context.accountId && row.mode === context.mode && row.contextKey === context.contextKey;
}
function policyFor(input: AdaptiveExperimentInput): AdaptiveEvidencePolicy {
  const policy = { ...DEFAULT_POLICY, ...input.policy };
  if (!Object.values(policy).every(value => Number.isFinite(value) && value >= 0) || !Number.isSafeInteger(policy.minDistinctVideos) ||
      policy.minDistinctVideos < 3 || policy.minSpanDays < 1 || policy.minEffectiveVideos < 2 ||
      policy.minEffectiveVideos > policy.minDistinctVideos || policy.halfLifeDays <= 0 || policy.maxEvidenceAgeDays < policy.halfLifeDays ||
      policy.windowToleranceHours >= input.observationWindowHours)
    throw new Error("ADAPTIVE_EVIDENCE_POLICY_INVALID");
  return policy;
}
function metrics(row: AdaptiveOutcome, context: AdaptiveContext) {
  const views = nonnegative(row.views) && row.views > 0 ? row.views : null;
  const follower = views !== null && row.followerAttribution === "VIDEO" && nonnegative(row.attributedFollowers)
    ? row.attributedFollowers * 1000 / views : null;
  const engagement = views !== null && [row.likes, row.comments, row.shares].every(nonnegative)
    ? (row.likes! + row.comments! + row.shares!) / views : null;
  const commerce = context.mode === "AFFILIATE" && context.affiliateEligible && row.commerceVerified && row.salesAttribution === "VIDEO" &&
    (row.source === "TIKTOK_SHOP_ANALYTICS" || row.source === "VERIFIED_MANUAL" || context.environment === "SIMULATED" && row.source === "SIMULATED");
  const roi = commerce && nonnegative(row.orders) && nonnegative(row.commissionUsd) && row.costBasis === "ACTUAL" &&
    nonnegative(row.actualCostUsd) && row.actualCostUsd > 0 ? (row.commissionUsd - row.actualCostUsd) / row.actualCostUsd : null;
  return { followersPer1000Views: follower, engagementPerView: engagement, commissionRoi: roi };
}
function reward(row: AdaptiveOutcome, context: AdaptiveContext, objective: AdaptiveObjective): number | null {
  const values = metrics(row, context);
  return objective === "ATTRIBUTED_FOLLOWERS_PER_1000_VIEWS" ? values.followersPer1000Views :
    objective === "ENGAGEMENT_PER_VIEW" ? values.engagementPerView : values.commissionRoi;
}
function weightedMedian(values: Array<{ value: number; weight: number }>): number | null {
  if (!values.length) return null;
  const sorted = values.toSorted((a, b) => a.value - b.value), half = sorted.reduce((sum, row) => sum + row.weight, 0) / 2;
  let weight = 0;
  for (const row of sorted) { weight += row.weight; if (weight >= half) return row.value; }
  return null;
}
const fingerprint = (row: AdaptiveOutcome) => digest([row.ownerId, row.accountId, row.mode, row.contextKey, row.videoId, row.armId,
  row.source, row.authorized, Date.parse(row.publishedAt ?? ""), Date.parse(row.observedAt),
  Date.parse(row.window?.startAt ?? ""), Date.parse(row.window?.endAt ?? ""), row.window?.complete,
  row.views, row.likes, row.comments, row.shares, row.attributedFollowers, row.followerAttribution, row.orders,
  row.commissionUsd, row.actualCostUsd, row.salesAttribution, row.commerceVerified, row.costBasis]);
function acceptedEvidence(input: AdaptiveExperimentInput, arms: Map<string, AdaptiveArm>, policy: AdaptiveEvidencePolicy) {
  const evidence = new Map<string, AdaptiveOutcome>(), byVideo = new Map<string, AdaptiveOutcome>(), conflicts = new Set<string>();
  const excluded: Array<{ evidenceId: string; reason: string }> = [];
  for (const row of input.outcomes) {
    const reject = (reason: string) => excluded.push({ evidenceId: row.evidenceId, reason });
    const observed = Date.parse(row.observedAt), published = Date.parse(row.publishedAt ?? ""), start = Date.parse(row.window?.startAt ?? ""), end = Date.parse(row.window?.endAt ?? "");
    const source = input.context.environment === "SIMULATED" ? row.source === "SIMULATED" : ["TIKTOK_DISPLAY", "TIKTOK_SHOP_ANALYTICS", "VERIFIED_MANUAL"].includes(row.source);
    if (!sameContext(row, input.context) || !row.authorized || !source) { reject("SOURCE_OR_CONTEXT_NOT_AUTHORIZED"); continue; }
    if (!arms.has(row.armId) || !row.evidenceId || !row.videoId) { reject("ARM_OR_IDENTITY_UNKNOWN"); continue; }
    if (!row.publishedAt || !row.window || ![observed, published, start, end].every(Number.isFinite)) {
      reject("PUBLICATION_OR_OBSERVATION_WINDOW_UNKNOWN"); continue;
    }
    // Preserve the real elapsed exposure; never relabel an older lifetime counter as a 24-hour window.
    if (start !== published || end <= start || Math.abs((end - start) / 3_600_000 - input.observationWindowHours) > policy.windowToleranceHours) {
      reject("INCOMPARABLE_EXPOSURE_WINDOW"); continue;
    }
    if (observed > input.now.getTime() || observed < end || !row.window.complete ||
      input.now.getTime() - end > policy.maxEvidenceAgeDays * DAY || Date.parse(arms.get(row.armId)!.introducedAt) > published) {
      reject("IMMATURE_STALE_OR_INVALID_TIMELINE"); continue;
    }
    const priorEvidence = evidence.get(row.evidenceId);
    if (priorEvidence && fingerprint(priorEvidence) !== fingerprint(row)) {
      conflicts.add(priorEvidence.videoId); conflicts.add(row.videoId);
    }
    evidence.set(row.evidenceId, row);
    const prior = byVideo.get(row.videoId);
    if (prior && (prior.armId !== row.armId || Date.parse(prior.publishedAt ?? "") !== published)) conflicts.add(row.videoId);
    if (!prior || observed > Date.parse(prior.observedAt)) byVideo.set(row.videoId, row);
    else if (observed === Date.parse(prior.observedAt) && fingerprint(prior) !== fingerprint(row)) conflicts.add(row.videoId);
  }
  const accepted = [...byVideo.values()].filter(row => !conflicts.has(row.videoId));
  for (const row of evidence.values()) if (conflicts.has(row.videoId)) excluded.push({ evidenceId: row.evidenceId, reason: "IMMUTABLE_EVIDENCE_OR_VIDEO_ASSIGNMENT_CONFLICT" });
  return { rows: accepted, excluded };
}
function assess(armId: string, rows: AdaptiveOutcome[], input: AdaptiveExperimentInput, policy: AdaptiveEvidencePolicy): AdaptiveArmAssessment {
  const weight = (row: AdaptiveOutcome) => Math.pow(.5, (input.now.getTime() - Date.parse(row.window!.endAt)) / (policy.halfLifeDays * DAY));
  const usable = rows.filter(row => reward(row, input.context, input.objective ?? (input.context.mode === "GROWTH" ? "ATTRIBUTED_FOLLOWERS_PER_1000_VIEWS" : "VERIFIED_COMMISSION_ROI")) !== null);
  const times = usable.map(row => Date.parse(row.publishedAt!)), spanDays = times.length ? (Math.max(...times) - Math.min(...times)) / DAY : 0;
  const effectiveVideos = usable.reduce((sum, row) => sum + weight(row), 0);
  const credible = usable.length >= policy.minDistinctVideos && spanDays >= policy.minSpanDays && effectiveVideos >= policy.minEffectiveVideos;
  const objective = input.objective ?? (input.context.mode === "GROWTH" ? "ATTRIBUTED_FOLLOWERS_PER_1000_VIEWS" : "VERIFIED_COMMISSION_ROI");
  const aggregate = (key: keyof ReturnType<typeof metrics>) => {
    const values = rows.map(row => ({ row, value: metrics(row, input.context)[key] }));
    // A known subset is not silently presented as the full cohort's metric.
    return values.length && values.every(row => row.value !== null)
      ? weightedMedian(values.map(({ row, value }) => ({ value: value!, weight: weight(row) }))) : null;
  };
  return { armId, distinctVideos: rows.length, objectiveSamples: usable.length, spanDays, effectiveVideos,
    reward: credible ? weightedMedian(usable.map(row => ({ value: reward(row, input.context, objective)!, weight: weight(row) }))) : null,
    eligibleForExploitation: credible, metrics: { followersPer1000Views: aggregate("followersPer1000Views"),
      engagementPerView: aggregate("engagementPerView"), commissionRoi: aggregate("commissionRoi") },
    evidenceIds: rows.map(row => row.evidenceId).sort(), reason: !usable.length ? "OBJECTIVE_UNKNOWN" : credible ? "CREDIBLE_SAMPLE" : "INSUFFICIENT_SAMPLE" };
}
function seedRandom(id: string) {
  let state = parseInt(digest(id).slice(0, 8), 16);
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x1_0000_0000; };
}
function sample<T>(rows: T[], weights: number[], rng: () => number): T {
  const random = rng(); if (!Number.isFinite(random) || random < 0 || random >= 1) throw new Error("ADAPTIVE_RNG_INVALID");
  const total = weights.reduce((sum, value) => sum + value, 0); let cursor = random * total;
  for (let i = 0; i < rows.length; i++) { cursor -= weights[i]; if (cursor < 0) return rows[i]; }
  return rows.at(-1)!;
}
function controlledPair(control: AdaptiveArm | undefined, variant: AdaptiveArm | undefined): GrowthExperimentPlan | null {
  if (!control || !variant || control.id === variant.id) return null;
  const keys = ["hook", "angle", "topic", "productionMethod"] as const, changed = keys.filter(key => control[key] !== variant[key]);
  if (changed.length !== 1) return null;
  const axis = changed[0], plan = planGrowthExperiment({ ownerId: control.ownerId, accountId: control.accountId,
    topic: control.topic, axis, control: control[axis], variant: variant[axis] });
  return plan ? { ...plan, hypothesis: `Compare ${axis} on the explicitly selected account objective; an observational preference is not causal proof.` } : null;
}

/** Pure contextual proposal; existing policy/health/budget/consent gates still authorize execution. */
export function decideAdaptiveExperiment(input: AdaptiveExperimentInput, simulationRandom?: () => number): AdaptiveExperimentDecision {
  const { context } = input, objective = input.objective ?? (context.mode === "GROWTH" ? "ATTRIBUTED_FOLLOWERS_PER_1000_VIEWS" : "VERIFIED_COMMISSION_ROI");
  if (!context.ownerId || !context.accountId || !context.contextKey || !input.cycleKey || input.cycleKey.length > 300 ||
    !Number.isFinite(input.now.getTime()) || !Number.isFinite(input.observationWindowHours) || input.observationWindowHours <= 0 ||
    !Number.isSafeInteger(input.availableSlots) || input.availableSlots < 0 || !["REAL", "SIMULATED"].includes(context.environment) ||
    !["GROWTH", "AFFILIATE"].includes(context.mode) || !["ATTRIBUTED_FOLLOWERS_PER_1000_VIEWS", "ENGAGEMENT_PER_VIEW", "VERIFIED_COMMISSION_ROI"].includes(objective))
    throw new Error("ADAPTIVE_CONTEXT_INVALID");
  if (simulationRandom && context.environment !== "SIMULATED") throw new Error("ADAPTIVE_SIMULATION_RNG_REAL_CONTEXT");
  const policy = policyFor(input), decisionId = `decision:${digest([context.ownerId, context.accountId, context.mode, context.contextKey, context.environment, input.cycleKey])}`;
  const output: AdaptiveExperimentDecision = { status: "WAIT", source: context.environment, objective, decisionId, selectedArmId: null,
    preferredArmId: null, proposal: null, controlledExperiment: null, assessments: [], evidenceIds: [], rejectedEvidence: 0, excludedEvidence: [],
    allocation: allocateExploreExploit(input.availableSlots, .5), patterns: [], reason: "NO_CAPACITY_OR_CONSENT",
    confidenceBasis: "Decayed distinct-video sample coverage; not a viral or causal probability", viralOutcome: "UNKNOWN",
    humanReviewRequired: true, rulesActivated: false, executionAuthorized: false };
  if (!context.optedIn || !input.availableSlots || context.mode === "AFFILIATE" && !context.affiliateEligible) return output;
  if (context.mode === "GROWTH" && objective === "VERIFIED_COMMISSION_ROI" || context.mode === "AFFILIATE" && objective !== "VERIFIED_COMMISSION_ROI")
    return { ...output, reason: "OBJECTIVE_MODE_MISMATCH" };
  const ledger = input.ledger.filter(row => sameContext(row, context) && row.environment === context.environment);
  const prior = ledger.filter(row => row.decisionId === decisionId || row.cycleKey === input.cycleKey);
  if (prior.length) {
    const signatures = new Set(prior.map(row => digest(row)));
    return signatures.size > 1 ? { ...output, status: "REVIEW_REQUIRED", reason: "IMMUTABLE_PROPOSAL_CONFLICT" } :
      { ...output, status: "ALREADY_PROPOSED", selectedArmId: prior[0].selectedArmId, reason: "RESUME_EXISTING_PROPOSAL_NO_NEW_EXPERIMENT" };
  }
  const arms = new Map<string, AdaptiveArm>();
  for (const arm of input.arms) {
    if (!sameContext(arm, context) || Date.parse(arm.introducedAt) > input.now.getTime()) continue;
    try { if (createAdaptiveArm(arm).id === arm.id) arms.set(arm.id, arm); } catch { /* Invalid/freeform-arm identities never enter decisions. */ }
  }
  if (!arms.size) return { ...output, reason: "NO_VALID_CANDIDATE_ARMS" };
  const accepted = acceptedEvidence(input, arms, policy);
  output.excludedEvidence = accepted.excluded; output.rejectedEvidence = accepted.excluded.length; output.evidenceIds = accepted.rows.map(row => row.evidenceId).sort();
  output.assessments = [...arms.keys()].sort().map(id => assess(id, accepted.rows.filter(row => row.armId === id), input, policy));
  const credible = output.assessments.filter(row => row.eligibleForExploitation && row.reward !== null)
    .toSorted((a, b) => b.reward! - a.reward! || a.armId.localeCompare(b.armId));
  output.preferredArmId = credible[0]?.armId ?? null;
  output.allocation = allocateExploreExploit(input.availableSlots, .5 + .4 * credible.length / arms.size);
  const baseline = weightedMedian(credible.map(row => ({ value: row.reward!, weight: 1 }))) ?? 0;
  output.patterns = learnAccountPatterns(context.accountId, credible.map(row => ({ accountId: context.accountId, dimension: "ARM", value: row.armId,
    effect: Math.max(-1, Math.min(1, (row.reward! - baseline) / Math.max(Math.abs(baseline), 1))),
    confidence: Math.min(1, row.effectiveVideos / policy.minDistinctVideos), decay: 1, sampleSize: row.objectiveSamples, scope: "ACCOUNT" })));
  const rng = simulationRandom ?? seedRandom(decisionId), draw = rng();
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new Error("ADAPTIVE_RNG_INVALID");
  const explore = !credible.length || draw < output.allocation.explorationRatio;
  let selected: string;
  if (explore) {
    // New/uncertain arms and previously weak arms stay eligible for resampling.
    const pool = output.assessments.filter(row => arms.size === 1 || row.armId !== output.preferredArmId);
    selected = sample(pool, pool.map(row => (row.eligibleForExploitation ? 1 : 2) /
      (1 + ledger.filter(record => record.selectedArmId === row.armId).length)), rng).armId;
  } else selected = output.preferredArmId!;
  const experimentKey = `experiment:${digest([decisionId, output.preferredArmId, selected, objective])}`;
  output.status = explore ? "EXPLORE" : "EXPLOIT"; output.selectedArmId = selected;
  output.proposal = { decisionId, experimentKey, ownerId: context.ownerId, accountId: context.accountId, mode: context.mode,
    contextKey: context.contextKey, environment: context.environment, cycleKey: input.cycleKey, selectedArmId: selected };
  output.controlledExperiment = controlledPair(arms.get(output.preferredArmId ?? ""), arms.get(selected));
  output.reason = !credible.length ? "COLD_START_SAFE_EXPLORATION_WITH_EXISTING_PLANNER_CAPACITY" : explore
    ? "RESAMPLE_NEW_UNCERTAIN_OR_PREVIOUSLY_WEAK_CANDIDATE" : "RECENT_COMPARABLE_ATTRIBUTED_RESULTS_PREFER_THIS_CANDIDATE";
  return output;
}
