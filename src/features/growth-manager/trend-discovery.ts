import { createHash } from "node:crypto";
import { analyzeTrendIntelligence, type TrendContext, type TrendIntelligenceReport, type TrendObservation } from "./topics";
import { createGoogleTrendsThailandSource, type GoogleTrendsObservation } from "./trend-source";
import type { CreativeLearningHistory } from "../creative/self-learning";

export type TrendDomain = "GOOGLE_SEARCH" | "TIKTOK_TRENDS" | "OWN_ACCOUNT_PERFORMANCE";
export interface DiscoverySignal {
  domain: TrendDomain;
  metric: "APPROXIMATE_GOOGLE_SEARCH_VOLUME" | "SEARCH_INTEREST" | "VIEWS" | "POSTS" | "ENGAGEMENTS";
  aggregation: "APPROXIMATE_LOWER_BOUND" | "WINDOW_COUNT" | "CUMULATIVE" | "INDEX";
  latestValue: number | null;
  rawApproximation?: string;
  exact: boolean;
  windowHours: number | null;
}
export interface DiscoveryRead {
  status: "REAL_OBSERVATIONS" | "UNKNOWN";
  observations: TrendObservation[];
  reason?: string;
}
export interface TrendDiscoverySource {
  id: string;
  domain: TrendDomain;
  read(context: TrendContext, now: Date, signal: AbortSignal): Promise<DiscoveryRead>;
}
export interface DiscoveryCandidate {
  key: string; topic: string; sourceId: string; domain: TrendDomain; capturedAt: string;
  contextFit: "OWN_ACCOUNT" | "OBSERVED_AUDIENCE_MATCH" | "UNKNOWN";
  productFit: "MATCHED" | "UNKNOWN" | "MISMATCH";
  confidence: "OBSERVATION_ONLY" | "COMPARABLE_WINDOWS";
  sourceReference: string;
  signals: DiscoverySignal[];
  use: "HYPOTHESIS" | "ACCOUNT_OBSERVATION";
}
export interface TrendDiscoveryReport {
  accountId: string;
  status: "REAL_SOURCE_OBSERVATIONS" | "UNKNOWN";
  sources: Array<{ id: string; domain: TrendDomain; status: "REAL_OBSERVATIONS" | "UNKNOWN";
    reason?: string; intelligence: TrendIntelligenceReport }>;
  candidates: DiscoveryCandidate[];
  intelligence: TrendIntelligenceReport;
  candidatePoolFingerprint: string;
  globalTikTokTrendStatus: "REAL_OBSERVATIONS" | "UNKNOWN";
  viralOutcome: "UNKNOWN";
}
export type AuthorizedTrendReader = (context: TrendContext, now: Date, signal: AbortSignal) => Promise<TrendObservation[]>;
export type OwnPerformanceHistory = Pick<CreativeLearningHistory, "evidenceId" | "videoId" | "source" | "publishedAt" | "observedAt"> & {
  attribution: Pick<CreativeLearningHistory["attribution"], "ownerId" | "createdAt"> & {
    arm: Pick<CreativeLearningHistory["attribution"]["arm"], "ownerId" | "accountId" | "id" | "topic" | "mode" | "contextKey" | "introducedAt">;
  };
  metrics: Pick<CreativeLearningHistory["metrics"], "views">;
};
export interface OwnPerformanceObservation extends TrendObservation {
  ownPerformance: { publishedAt: string; observedAt: string; mode: "GROWTH" | "AFFILIATE"; contextKey: string };
}

/** Server-reviewed Business API grant, not a Login Kit scope or a user-body boolean.
 * Permission names must come from the actual approved Business integration; this
 * contract deliberately invents none. No token or account password belongs here. */
export interface TikTokBusinessDiscoveryGrant {
  endpoint: "https://business-api.tiktok.com/open_api/v1.3/discovery/trending_list/";
  approved: boolean;
  advertiserAuthorized: boolean;
  permittedUse: boolean;
  verifiedAt: string;
  officialPermission: { name: string; granted: boolean; reviewed: boolean; documentationUrl: string };
}
export const TIKTOK_DISCOVERY_DOCUMENTATION = "https://business-api.tiktok.com/portal/docs?id=1825119032526849";
export const TIKTOK_DISPLAY_DOCUMENTATION = "https://developers.tiktok.com/docs/en/display-api-get-started";
export const TIKTOK_RESEARCH_ELIGIBILITY = "https://developers.tiktok.com/docs/en/research-api-faq";
const MAX_SOURCE_ROWS = 500;
const failureReasons = new Set(["SOURCE_TIMEOUT", "SOURCE_UNAVAILABLE", "SOURCE_INVALID", "SOURCE_TOO_LARGE", "NO_VALID_ITEMS",
  "SOURCE_ROWS_EXCEED_BOUND", "BUSINESS_DISCOVERY_PERMISSION_UNVERIFIED", "AUTHORIZED_TIKTOK_SOURCE_NOT_CONFIGURED",
  "AUTHORIZED_ACCOUNT_ANALYTICS_NOT_CONFIGURED"]);
const unavailable = (reason: string): DiscoveryRead => ({ status: "UNKNOWN", observations: [], reason });

export function googleSearchDiscoverySource(reader = createGoogleTrendsThailandSource()): TrendDiscoverySource {
  return { id: "google-trends-th", domain: "GOOGLE_SEARCH", async read(_context, now) {
    const feed = await reader.read(now);
    return { status: feed.status, observations: feed.observations, ...(feed.reason ? { reason: feed.reason } : {}) };
  } };
}

function reviewedBusinessGrant(grant: TikTokBusinessDiscoveryGrant | undefined, now: Date): boolean {
  if (!grant || grant.endpoint !== "https://business-api.tiktok.com/open_api/v1.3/discovery/trending_list/" ||
      !grant.approved || !grant.advertiserAuthorized || !grant.permittedUse ||
      !grant.officialPermission.granted || !grant.officialPermission.reviewed || !grant.officialPermission.name.trim() ||
      /^(?:user\.info\.|video\.|research\.)/.test(grant.officialPermission.name)) return false;
  const verified = Date.parse(grant.verifiedAt);
  if (!Number.isFinite(verified) || verified > now.getTime() || now.getTime() - verified > 7 * 86_400_000) return false;
  try {
    const url = new URL(grant.officialPermission.documentationUrl);
    return url.protocol === "https:" && url.hostname === "business-api.tiktok.com" && !url.username && !url.password;
  } catch { return false; }
}

/** Imports normalized permitted Creative Center reports, or uses an existing
 * approved Business API reader only after a separately reviewed endpoint grant.
 * No global TikTok endpoint, scope, token access or transport is created here.
 * Research API authorization is not a commercial trends permission. */
export function tikTokTrendDiscoverySource(input: { reportReader?: AuthorizedTrendReader;
  apiReader?: AuthorizedTrendReader; grant?: TikTokBusinessDiscoveryGrant } = {}): TrendDiscoverySource {
  return { id: "tiktok-authorized-discovery", domain: "TIKTOK_TRENDS", async read(context, now, signal) {
    if (input.apiReader && reviewedBusinessGrant(input.grant, now)) {
      return { status: "REAL_OBSERVATIONS", observations: await input.apiReader(context, now, signal) };
    }
    if (input.reportReader) return { status: "REAL_OBSERVATIONS", observations: await input.reportReader(context, now, signal) };
    return unavailable(input.apiReader ? "BUSINESS_DISCOVERY_PERMISSION_UNVERIFIED" : "AUTHORIZED_TIKTOK_SOURCE_NOT_CONFIGURED");
  } };
}

/** Reuses normalized owner/account analytics; never labels one account's views
 * or follower outcomes as population-wide TikTok trend evidence. */
export function ownAccountPerformanceSource(reader?: AuthorizedTrendReader): TrendDiscoverySource {
  return { id: "own-account-performance", domain: "OWN_ACCOUNT_PERFORMANCE", async read(context, now, signal) {
    return reader ? { status: "REAL_OBSERVATIONS", observations: await reader(context, now, signal) }
      : unavailable("AUTHORIZED_ACCOUNT_ANALYTICS_NOT_CONFIGURED");
  } };
}

/** Adapt already validated immutable attribution/history, not mutable current
 * scripts or account-wide follower deltas. Upstream owner/RLS and automation
 * permission checks are required; this pure mapping grants no account access. */
export function ownPerformanceObservations(history: readonly OwnPerformanceHistory[], ownerId: string,
  accountId: string, now: Date): OwnPerformanceObservation[] {
  if (!ownerId.trim() || !accountId.trim() || !Number.isFinite(now.getTime())) return [];
  const latest = new Map<string, OwnPerformanceObservation>(), conflicts = new Set<string>();
  for (const row of history) {
    const arm = row.attribution.arm, observed = Date.parse(row.observedAt), published = Date.parse(row.publishedAt ?? "");
    if (row.source !== "TIKTOK_DISPLAY" || row.attribution.ownerId !== ownerId || arm.ownerId !== ownerId || arm.accountId !== accountId ||
        !row.evidenceId.trim() || !row.videoId.trim() || !arm.id.trim() || !arm.topic.trim() || arm.topic.length > 4000 ||
        !["GROWTH", "AFFILIATE"].includes(arm.mode) || !Number.isFinite(observed) || !Number.isFinite(published) ||
        observed > now.getTime() || published > observed || Date.parse(row.attribution.createdAt) > published ||
        Date.parse(arm.introducedAt) > published || !Number.isFinite(Date.parse(row.attribution.createdAt)) ||
        !Number.isFinite(Date.parse(arm.introducedAt))) continue;
    const key = `own-performance:${createHash("sha256").update(JSON.stringify([ownerId, accountId, row.videoId, arm.id])).digest("hex")}`;
    const views = typeof row.metrics.views === "number" && Number.isSafeInteger(row.metrics.views) && row.metrics.views >= 0
      ? row.metrics.views : null;
    const observation: OwnPerformanceObservation = { key, name: arm.topic, source: "TIKTOK_DISPLAY", authorized: true,
      capturedAt: row.observedAt, provenance: { kind: "REAL", reference: "https://open.tiktokapis.com/v2/video/query/",
        collection: "OFFICIAL_API", permittedUse: true, verifiedAt: row.observedAt, scope: { kind: "ACCOUNT", accountId } },
      visualUse: "UNKNOWN", ...(views === null ? {} : { metric: { name: "VIEWS", aggregation: "CUMULATIVE",
        samples: [{ at: row.observedAt, value: views }] } as const }),
      ownPerformance: { publishedAt: row.publishedAt!, observedAt: row.observedAt, mode: arm.mode, contextKey: arm.contextKey } };
    const prior = latest.get(key);
    if (!prior || Date.parse(prior.capturedAt) < observed) { latest.set(key, observation); conflicts.delete(key); }
    else if (Date.parse(prior.capturedAt) === observed && JSON.stringify(prior.metric) !== JSON.stringify(observation.metric)) conflicts.add(key);
  }
  const rows = [...latest.values()].filter(row => !conflicts.has(row.key));
  const accepted = new Set(analyzeTrendIntelligence(rows, { accountId }, now).observations.map(row => row.key));
  return rows.filter(row => accepted.has(row.key));
}

function belongsToDomain(row: TrendObservation, domain: TrendDomain) {
  if (row.source === "MOCK" || row.provenance?.kind === "MOCK") return false;
  if (domain === "GOOGLE_SEARCH") return row.source === "GOOGLE_TRENDS" && (!row.metric || row.metric.name === "SEARCH_INTEREST");
  if (domain === "TIKTOK_TRENDS") return ["TIKTOK_CREATIVE_CENTER", "AUTHORIZED_REPORT"].includes(row.source) &&
    row.provenance?.scope.kind === "PUBLIC" && (!row.metric || row.metric.name !== "SEARCH_INTEREST");
  return row.source === "TIKTOK_DISPLAY" && row.provenance?.scope.kind === "ACCOUNT" &&
    (!row.metric || row.metric.name !== "SEARCH_INTEREST");
}
function signalsFor(row: TrendObservation, domain: TrendDomain): DiscoverySignal[] {
  if (domain === "GOOGLE_SEARCH" && "sourceMetrics" in row) {
    const metric = (row as GoogleTrendsObservation).sourceMetrics;
    if (metric?.name === "APPROXIMATE_GOOGLE_SEARCH_VOLUME" && metric.exact === false &&
        (metric.lowerBound === null || Number.isSafeInteger(metric.lowerBound) && metric.lowerBound >= 0)) {
      return [{ domain, metric: metric.name, aggregation: "APPROXIMATE_LOWER_BOUND", latestValue: metric.lowerBound,
        rawApproximation: metric.raw, exact: false, windowHours: null }];
    }
  }
  const metric = row.metric;
  if (!metric || !metric.samples.length) return [];
  if (metric.samples.some(sample => !Number.isFinite(Date.parse(sample.at)) || Date.parse(sample.at) > Date.parse(row.capturedAt) ||
      !Number.isFinite(sample.value) || sample.value < 0)) return [];
  const latest = metric.samples.toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1)!;
  if (!Number.isFinite(latest.value) || latest.value < 0) return [];
  return [{ domain, metric: metric.name, aggregation: metric.aggregation, latestValue: latest.value,
    exact: true, windowHours: metric.aggregation === "WINDOW_COUNT" ? metric.windowHours ?? null : null }];
}

/** Bounded source collection and shared evidence evaluation. Sources remain
 * separate in candidates and metrics: cross-platform quantities are never added,
 * averaged or scored together. No paid provider or TikTok publisher exists here. */
export async function discoverTrendCandidates(sources: readonly TrendDiscoverySource[], context: TrendContext,
  now: Date, options: { sourceTimeoutMs?: number; concurrency?: number } = {}): Promise<TrendDiscoveryReport> {
  const timeoutMs = options.sourceTimeoutMs ?? 12_000, concurrency = options.concurrency ?? 3;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000 ||
      !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8 || !Number.isFinite(now.getTime())) throw new Error("DISCOVERY_OPTIONS_INVALID");
  const ids = new Set<string>();
  for (const source of sources) {
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(source.id) || ids.has(source.id)) throw new Error("DISCOVERY_SOURCE_ID_INVALID");
    ids.add(source.id);
  }
  const results: Array<{ source: TrendDiscoverySource; read: DiscoveryRead }> = new Array(sources.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++; if (index >= sources.length) return;
      const source = sources[index], controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const read = await Promise.race([source.read(context, now, controller.signal), new Promise<DiscoveryRead>(resolve => {
          timer = setTimeout(() => { controller.abort(); resolve(unavailable("SOURCE_TIMEOUT")); }, timeoutMs);
        })]);
        results[index] = { source, read: read.observations.length > MAX_SOURCE_ROWS ? unavailable("SOURCE_ROWS_EXCEED_BOUND") : read };
      } catch { results[index] = { source, read: unavailable("SOURCE_UNAVAILABLE") }; }
      finally { if (timer) clearTimeout(timer); controller.abort(); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker));
  const candidates: DiscoveryCandidate[] = [], evaluated: TrendDiscoveryReport["sources"] = [], mergedRows: TrendObservation[] = [];
  for (const { source, read } of results) {
    const rows = read.status === "REAL_OBSERVATIONS" ? read.observations.filter(row => belongsToDomain(row, source.domain)) : [];
    const namespaced = rows.map(row => ({ ...row, key: `${source.id}:${row.key}` }));
    const intelligence = analyzeTrendIntelligence(namespaced, context, now);
    const real = intelligence.observations.length > 0;
    evaluated.push({ id: source.id, domain: source.domain, status: real ? "REAL_OBSERVATIONS" : "UNKNOWN", intelligence,
      ...(!real ? { reason: read.reason && failureReasons.has(read.reason) ? read.reason
        : rows.length ? "NO_APPLICABLE_FRESH_EVIDENCE" : "NO_REAL_DOMAIN_EVIDENCE" } : {}) });
    for (const assessment of intelligence.observations) {
      const row = namespaced.find(candidate => candidate.key === assessment.key && candidate.capturedAt === assessment.capturedAt)!;
      candidates.push({ key: assessment.key, topic: assessment.topic, sourceId: source.id, domain: source.domain,
        capturedAt: assessment.capturedAt, contextFit: assessment.accountFit, productFit: assessment.productFit,
        confidence: assessment.confidence, sourceReference: assessment.sourceReference, signals: signalsFor(row, source.domain),
        use: source.domain === "OWN_ACCOUNT_PERFORMANCE" ? "ACCOUNT_OBSERVATION" : "HYPOTHESIS" });
    }
    mergedRows.push(...namespaced);
  }
  const intelligence = analyzeTrendIntelligence(mergedRows, context, now);
  candidates.sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.key.localeCompare(b.key));
  return { accountId: context.accountId, status: candidates.length ? "REAL_SOURCE_OBSERVATIONS" : "UNKNOWN", sources: evaluated, candidates, intelligence,
    candidatePoolFingerprint: createHash("sha256").update(JSON.stringify({ accountId: context.accountId, candidates })).digest("hex"),
    globalTikTokTrendStatus: candidates.some(candidate => candidate.domain === "TIKTOK_TRENDS") ? "REAL_OBSERVATIONS" : "UNKNOWN",
    viralOutcome: "UNKNOWN" };
}
