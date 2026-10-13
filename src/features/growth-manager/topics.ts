import { buildGrowthRecommendation, recommendCategories } from "../growth/strategy";

export interface TopicEvidence {
  name: string; key: string; source: "TIKTOK_DISPLAY" | "tiktok_shop" | "MOCK";
  capturedAt: string; authorized: boolean; confidence: number; momentum: number;
  accountEffect: number | null;
}
/** Rank category hypotheses. A momentum proxy is not proof of a social trend. */
export function chooseGrowthTopics(rows: TopicEvidence[], now: Date): string[] {
  const real = rows.filter(r => r.source !== "MOCK" && r.authorized && r.name.trim() &&
    Number.isFinite(r.confidence) && r.confidence > 0 && r.confidence <= 1 &&
    Number.isFinite(r.momentum) && r.momentum >= 0 && r.momentum <= 100 &&
    Date.parse(r.capturedAt) <= now.getTime() && now.getTime() - Date.parse(r.capturedAt) <= 7 * 86400000);
  const categories = recommendCategories(real.map(r => ({ categoryKey: r.key, accountEffect: r.accountEffect ?? 0,
    categoryMomentum: r.momentum, confidence: r.confidence })), .75);
  return [...new Set(categories.filter(c => c.action !== "REDUCE").toSorted((a,b)=>b.score-a.score||b.confidence-a.confidence||a.categoryKey.localeCompare(b.categoryKey)).map(c => real.find(r => r.key === c.categoryKey)!.name))];
}

export interface TrendObservation extends Omit<TopicEvidence, "source" | "confidence" | "momentum" | "accountEffect"> {
  source: TopicEvidence["source"] | "TIKTOK_CREATIVE_CENTER" | "GOOGLE_TRENDS" | "AUTHORIZED_REPORT";
  /** Legacy category proxies are optional and never become a viral prediction. */
  confidence?: number;
  momentum?: number;
  accountEffect?: number | null;
  provenance?: {
    kind: "REAL" | "MOCK";
    reference: string;
    collection: "OFFICIAL_API" | "OFFICIAL_RSS" | "AUTHORIZED_REPORT" | "MANUAL_PUBLIC_OBSERVATION";
    permittedUse: boolean;
    verifiedAt: string;
    scope: { kind: "ACCOUNT"; accountId: string } | { kind: "PUBLIC"; regions: string[] };
  };
  audience?: { segments: string[]; basis: "OBSERVED" | "HYPOTHESIS" };
  hook?: { description: string; basis: "OBSERVED" | "HYPOTHESIS"; reference: string };
  story?: { description: string; basis: "OBSERVED" | "HYPOTHESIS"; reference: string };
  productCategories?: string[];
  visualUse?: "CLEARED" | "UNKNOWN" | "RESTRICTED";
  metric?: {
    name: "VIEWS" | "POSTS" | "ENGAGEMENTS" | "SEARCH_INTEREST";
    aggregation: "WINDOW_COUNT" | "CUMULATIVE" | "INDEX";
    /** Equal, non-overlapping windows are required for a growth comparison. */
    windowHours?: number;
    samples: Array<{ at: string; value: number }>;
  };
}

export interface TrendContext {
  accountId: string;
  region?: string;
  audienceSegments?: string[];
  productCategoryKey?: string;
  maxAgeHours?: number;
}

export interface TrendAssessment {
  key: string;
  topic: string;
  sourceReference: string;
  collection: NonNullable<TrendObservation["provenance"]>["collection"];
  capturedAt: string;
  freshnessHours: number;
  accountFit: "OWN_ACCOUNT" | "OBSERVED_AUDIENCE_MATCH" | "UNKNOWN";
  productFit: "MATCHED" | "UNKNOWN" | "MISMATCH";
  audience: string[] | "UNKNOWN";
  hookPattern: string | "UNKNOWN";
  storyPattern: string | "UNKNOWN";
  growth: {
    status: "RISING" | "FALLING" | "STABLE" | "UNKNOWN";
    metric: NonNullable<TrendObservation["metric"]>["name"] | null;
    previous: number | null;
    current: number | null;
    relativeChange: number | null;
    comparableWindows: number;
  };
  confidence: "OBSERVATION_ONLY" | "COMPARABLE_WINDOWS";
  visualUse: "CLEARED" | "UNKNOWN" | "RESTRICTED";
  reasons: string[];
}

export interface TrendIntelligenceReport {
  /** Observations support an experiment, never a promise of virality. */
  status: "REAL_OBSERVATIONS" | "UNKNOWN";
  observations: TrendAssessment[];
  excluded: Array<{ key: string; reason: string }>;
  hypotheses: Array<{ topic: string; basis: "CATEGORY_HYPOTHESIS" | "SOURCE_TOPIC_HYPOTHESIS"; reason: string }>;
  viralOutcome: "UNKNOWN";
  requiresHumanReview: true;
}

const HOURS_MS = 3_600_000;
const normalized = (value: string) => value.trim().toLocaleLowerCase();
const knownSources = new Set<TrendObservation["source"]>([
  "TIKTOK_DISPLAY", "tiktok_shop", "TIKTOK_CREATIVE_CENTER", "GOOGLE_TRENDS", "AUTHORIZED_REPORT",
]);
function freshTimestamp(value: string, now: Date, maxAgeHours: number): boolean {
  const at = Date.parse(value);
  return Number.isFinite(at) && at <= now.getTime() && now.getTime() - at <= maxAgeHours * HOURS_MS;
}

function sourceReference(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      !/^(localhost|127\.|0\.|10\.|192\.168\.|\[|example\.)/.test(url.hostname) &&
      !/\.(local|localhost|test|invalid)$/.test(url.hostname) &&
      ![...url.searchParams.keys()].some(key => /token|secret|password|authorization|api.?key|signature/i.test(key));
  } catch { return false; }
}

function measuredGrowth(row: TrendObservation, now: Date, maxAgeHours: number): TrendAssessment["growth"] {
  const unknown: TrendAssessment["growth"] = { status: "UNKNOWN", metric: row.metric?.name ?? null,
    previous: null, current: null, relativeChange: null, comparableWindows: 0 };
  const metric = row.metric;
  // A growing lifetime counter does not establish that attention is accelerating.
  if (!metric || metric.aggregation !== "WINDOW_COUNT" || !Number.isFinite(metric.windowHours) ||
      metric.windowHours! <= 0 || metric.samples.length < 2) return unknown;
  const samples = metric.samples.toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const seen = new Set<number>();
  for (const sample of samples) {
    const at = Date.parse(sample.at);
    if (!freshTimestamp(sample.at, now, maxAgeHours) || at > Date.parse(row.capturedAt) ||
        !Number.isFinite(sample.value) || sample.value < 0 || seen.has(at)) return unknown;
    seen.add(at);
  }
  if (samples.some((sample, index) => index > 0 &&
      Date.parse(sample.at) - Date.parse(samples[index - 1].at) < metric.windowHours! * HOURS_MS)) return unknown;
  const previous = samples.at(-2)!.value, current = samples.at(-1)!.value;
  return { status: current > previous ? "RISING" : current < previous ? "FALLING" : "STABLE",
    metric: metric.name, previous, current,
    relativeChange: previous === 0 ? null : (current - previous) / previous,
    comparableWindows: samples.length };
}

/**
 * Evaluate normalized, authorized observations supplied by existing ingestion paths.
 * No scraping, source fetching, or authorization grant occurs here. Upstream server
 * ingestion must establish permitted use; a URL or confidence number alone is not proof.
 * Legacy category scores remain hypotheses, and MOCK rows never enter this report.
 */
export function analyzeTrendIntelligence(rows: TrendObservation[], context: TrendContext, now: Date): TrendIntelligenceReport {
  const maxAgeHours = context.maxAgeHours ?? 7 * 24;
  const report: TrendIntelligenceReport = { status: "UNKNOWN", observations: [], excluded: [], hypotheses: [],
    viralOutcome: "UNKNOWN", requiresHumanReview: true };
  const validContext = context.accountId.trim() && Number.isFinite(now.getTime()) &&
    Number.isFinite(maxAgeHours) && maxAgeHours > 0;
  const latest = new Map<string, TrendAssessment>();
  const hypothesisKeys = new Set<string>();
  for (const row of rows) {
    const exclude = (reason: string) => report.excluded.push({ key: row.key, reason });
    if (!validContext) { exclude("CONTEXT_UNKNOWN"); continue; }
    if (!knownSources.has(row.source) || row.provenance?.kind === "MOCK") { exclude("MOCK_OR_UNSUPPORTED_SOURCE"); continue; }
    if (!row.authorized || !row.name.trim() || !row.key.trim() ||
        (row.confidence !== undefined && (!Number.isFinite(row.confidence) || row.confidence <= 0 || row.confidence > 1))) {
      exclude("UNAUTHORIZED_OR_INVALID_OBSERVATION"); continue;
    }
    if (!freshTimestamp(row.capturedAt, now, maxAgeHours)) { exclude("STALE_OR_INVALID_OBSERVATION"); continue; }
    const provenance = row.provenance;
    if (!provenance || provenance.kind !== "REAL") {
      exclude("PROVENANCE_UNKNOWN");
      if (!hypothesisKeys.has(row.key)) {
        report.hypotheses.push({ topic: row.name, basis: "CATEGORY_HYPOTHESIS",
          reason: "Authorized category context may inform an experiment; current social popularity is unknown." });
        hypothesisKeys.add(row.key);
      }
      continue;
    }
    if (!provenance.permittedUse || !sourceReference(provenance.reference) ||
        !["OFFICIAL_API", "OFFICIAL_RSS", "AUTHORIZED_REPORT", "MANUAL_PUBLIC_OBSERVATION"].includes(provenance.collection) ||
        !freshTimestamp(provenance.verifiedAt, now, maxAgeHours) ||
        Date.parse(provenance.verifiedAt) < Date.parse(row.capturedAt)) {
      exclude("PROVENANCE_NOT_VERIFIED"); continue;
    }
    const audience = row.audience?.basis === "OBSERVED"
      ? [...new Set(row.audience.segments.map(normalized).filter(Boolean))] : [];
    let accountFit: TrendAssessment["accountFit"];
    if (provenance.scope.kind === "ACCOUNT") {
      if (provenance.scope.accountId !== context.accountId) { exclude("OTHER_ACCOUNT"); continue; }
      accountFit = "OWN_ACCOUNT";
    } else if (provenance.scope.kind === "PUBLIC") {
      if (!context.region || !provenance.scope.regions.some(region => normalized(region) === normalized(context.region!))) {
        exclude("REGION_UNKNOWN_OR_MISMATCH"); continue;
      }
      if (audience.length && context.audienceSegments?.length &&
          !context.audienceSegments.some(segment => audience.includes(normalized(segment)))) {
        exclude("AUDIENCE_MISMATCH"); continue;
      }
      accountFit = context.audienceSegments?.some(segment => audience.includes(normalized(segment)))
        ? "OBSERVED_AUDIENCE_MATCH" : "UNKNOWN";
    } else { exclude("SCOPE_UNKNOWN"); continue; }
    const categories = row.productCategories?.map(normalized).filter(Boolean) ?? [];
    const productFit = context.productCategoryKey && categories.length
      ? categories.includes(normalized(context.productCategoryKey)) ? "MATCHED" : "MISMATCH" : "UNKNOWN";
    const observedPattern = (pattern: TrendObservation["hook"]): string | "UNKNOWN" =>
      pattern?.basis === "OBSERVED" && pattern.description.trim() && sourceReference(pattern.reference)
        ? pattern.description.trim() : "UNKNOWN";
    const growth = measuredGrowth(row, now, maxAgeHours);
    const assessment: TrendAssessment = { key: row.key, topic: row.name, sourceReference: provenance.reference,
      collection: provenance.collection, capturedAt: row.capturedAt,
      freshnessHours: (now.getTime() - Date.parse(row.capturedAt)) / HOURS_MS,
      accountFit, productFit, audience: audience.length ? audience : "UNKNOWN",
      hookPattern: observedPattern(row.hook), storyPattern: observedPattern(row.story), growth,
      confidence: growth.status === "UNKNOWN" ? "OBSERVATION_ONLY" : "COMPARABLE_WINDOWS",
      visualUse: row.visualUse ?? "UNKNOWN",
      reasons: ["Observed source context supports a test, not a viral prediction.",
        ...(accountFit === "UNKNOWN" ? ["Audience applicability to this account is unknown; use only as an experiment hypothesis."] : []),
        ...(growth.status === "UNKNOWN" ? ["Comparable attention growth is unknown; category momentum is not substituted."] : []),
        ...(productFit !== "MATCHED" ? ["Product relevance requires review before producing an advertisement."] : []),
        ...(row.visualUse !== "CLEARED" ? ["Reference media must not be reused until its rights are confirmed."] : [])] };
    if (accountFit === "UNKNOWN" && !hypothesisKeys.has(row.key)) {
      report.hypotheses.push({ topic: row.name, basis: "SOURCE_TOPIC_HYPOTHESIS",
        reason: "The public source observed this topic; suitability and growth potential for this account are unverified." });
      hypothesisKeys.add(row.key);
    }
    const previous = latest.get(row.key);
    if (!previous || Date.parse(assessment.capturedAt) > Date.parse(previous.capturedAt)) latest.set(row.key, assessment);
  }
  // Deterministic fit/freshness ordering; never label this a virality probability.
  report.observations = [...latest.values()].toSorted((a, b) =>
    Number(b.productFit === "MATCHED") - Number(a.productFit === "MATCHED") ||
    a.freshnessHours - b.freshnessHours || a.key.localeCompare(b.key));
  if (report.observations.some(row => row.accountFit !== "UNKNOWN")) report.status = "REAL_OBSERVATIONS";
  return report;
}
/** An evidence-bound draft brief, not a claim that an LLM or video provider has run. */
export function growthCreativeBrief(topic: string) {
  const strategy = buildGrowthRecommendation({ state: "NEW", patterns: [], categories: [], confidence: 0 });
  return `Topic: ${JSON.stringify(topic)}. Hook: สิ่งที่ควรรู้เกี่ยวกับ ${topic}. ` +
    `Script plan: introduce the topic, explain one point supported by the selected source, then ${strategy.cta}. ` +
    `Use original vertical visuals with a clear opening, one demonstration and a short closing. ` +
    `Do not invent facts, testimonials, guarantees, medical claims or personal product experience. ` +
    `Verify the factual script and originality before export. Google Vids is assisted; no video has been generated.`;
}
