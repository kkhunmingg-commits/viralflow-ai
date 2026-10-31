import { describe, expect, it, vi } from "vitest";
import { discoverTrendCandidates, googleSearchDiscoverySource, ownAccountPerformanceSource, ownPerformanceObservations, tikTokTrendDiscoverySource,
  type OwnPerformanceHistory, type TikTokBusinessDiscoveryGrant, type TrendDiscoverySource, type TrendDomain } from "./trend-discovery";
import { parseGoogleTrendsThailandRss } from "./trend-source";
import type { TrendObservation } from "./topics";

// All named topics, quantities and grants below are synthetic contract fixtures,
// not claims about live trends, actual TikTok permissions or account performance.
const now = new Date("2026-10-13T12:00:00Z");
const context = { accountId: "pilot", region: "TH", audienceSegments: ["home"] };
const tiktok: TrendObservation = { key: "home", name: "จัดบ้าน", source: "TIKTOK_CREATIVE_CENTER", authorized: true,
  capturedAt: "2026-10-13T11:00:00Z", provenance: { kind: "REAL", permittedUse: true,
    verifiedAt: now.toISOString(), reference: "https://ads.tiktok.com/business/creativecenter/pc/en",
    collection: "AUTHORIZED_REPORT", scope: { kind: "PUBLIC", regions: ["TH"] } },
  audience: { segments: ["home"], basis: "OBSERVED" }, metric: { name: "POSTS", aggregation: "CUMULATIVE",
    samples: [{ at: "2026-10-13T11:00:00Z", value: 500 }] } };
const own: TrendObservation = { ...tiktok, source: "TIKTOK_DISPLAY", provenance: { ...tiktok.provenance!,
  reference: "https://open.tiktokapis.com/v2/video/query/", collection: "OFFICIAL_API", scope: { kind: "ACCOUNT", accountId: "pilot" } },
  metric: { name: "VIEWS", aggregation: "CUMULATIVE", samples: [{ at: "2026-10-13T11:00:00Z", value: 200 }] } };
const xml = '<rss version="2.0"><channel><link>https://trends.google.com/trending/rss?geo=TH</link><item><title>จัดบ้าน</title>' +
  '<pubDate>Tue, 13 Oct 2026 11:00:00 GMT</pubDate><ht:approx_traffic>1K+</ht:approx_traffic></item></channel></rss>';
const google = () => googleSearchDiscoverySource({ read: async () => parseGoogleTrendsThailandRss(xml, now) });
const source = (id: string, domain: TrendDomain, rows: TrendObservation[]): TrendDiscoverySource => ({ id, domain,
  read: async () => ({ status: "REAL_OBSERVATIONS", observations: rows }) });

describe("separate permitted sources for trend discovery", () => {
  it("retains Google searches, actual TikTok observations and own-account performance in distinct candidate namespaces", async () => {
    const result = await discoverTrendCandidates([google(), tikTokTrendDiscoverySource({ reportReader: async () => [tiktok] }),
      ownAccountPerformanceSource(async () => [own])], context, now);
    expect(result.status).toBe("REAL_SOURCE_OBSERVATIONS"); expect(result.candidates).toHaveLength(3);
    expect(result.accountId).toBe(context.accountId);
    expect(new Set(result.candidates.map(candidate => candidate.key)).size).toBe(3);
    const searches = result.candidates.find(candidate => candidate.domain === "GOOGLE_SEARCH")!;
    expect(searches.signals).toMatchObject([{ metric: "APPROXIMATE_GOOGLE_SEARCH_VOLUME", latestValue: 1000, exact: false }]);
    expect(searches.contextFit).toBe("UNKNOWN"); expect(searches.use).toBe("HYPOTHESIS");
    const ownResult = result.candidates.find(candidate => candidate.domain === "OWN_ACCOUNT_PERFORMANCE")!;
    expect(ownResult.signals).toMatchObject([{ metric: "VIEWS", latestValue: 200, aggregation: "CUMULATIVE" }]);
    expect(ownResult.use).toBe("ACCOUNT_OBSERVATION");
    expect(result.candidates.find(candidate => candidate.domain === "TIKTOK_TRENDS")!.signals).toMatchObject([{ metric: "POSTS", latestValue: 500 }]);
    expect(result.viralOutcome).toBe("UNKNOWN");
  });

  it("never turns Google interest or own-account views into a population TikTok trend", async () => {
    const result = await discoverTrendCandidates([google(), ownAccountPerformanceSource(async () => [own])], context, now);
    expect(result.globalTikTokTrendStatus).toBe("UNKNOWN");
    expect(result.intelligence.hypotheses).toMatchObject([{ basis: "SOURCE_TOPIC_HYPOTHESIS" }]);
    expect(result.candidates.every(candidate => candidate.confidence === "OBSERVATION_ONLY")).toBe(true);
  });

  it("rejects mocked, unauthorized, stale, cross-account and wrong-domain observations without a mock fallback", async () => {
    const result = await discoverTrendCandidates([
      source("mocked", "TIKTOK_TRENDS", [{ ...tiktok, source: "MOCK" }, { ...tiktok, provenance: { ...tiktok.provenance!, kind: "MOCK" } }]),
      source("unauthorized", "TIKTOK_TRENDS", [{ ...tiktok, authorized: false }]),
      source("stale", "TIKTOK_TRENDS", [{ ...tiktok, capturedAt: "2026-09-01T00:00:00Z" }]),
      source("other-account", "OWN_ACCOUNT_PERFORMANCE", [{ ...own, provenance: { ...own.provenance!, scope: { kind: "ACCOUNT", accountId: "sales-account" } } }]),
      source("google-labeled-as-tiktok", "TIKTOK_TRENDS", parseGoogleTrendsThailandRss(xml, now).observations),
      source("own-labeled-as-tiktok", "TIKTOK_TRENDS", [own]),
      source("google-with-views", "GOOGLE_SEARCH", [{ ...parseGoogleTrendsThailandRss(xml, now).observations[0], metric: own.metric }]),
    ], context, now);
    expect(result.status).toBe("UNKNOWN"); expect(result.candidates).toEqual([]);
    expect(result.sources.every(item => item.status === "UNKNOWN")).toBe(true);
  });

  it("preserves source unavailability rather than replacing missing TikTok reports with Google data", async () => {
    const failed: TrendDiscoverySource = { id: "failed-tiktok", domain: "TIKTOK_TRENDS", read: async () => { throw new Error("private error must not escape"); } };
    const result = await discoverTrendCandidates([google(), failed, ownAccountPerformanceSource()], context, now);
    expect(result.sources.find(item => item.id === "failed-tiktok")).toMatchObject({ status: "UNKNOWN", reason: "SOURCE_UNAVAILABLE" });
    expect(result.globalTikTokTrendStatus).toBe("UNKNOWN"); expect(result.candidates).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("private error");
  });

  it("requires a separate reviewed Business discovery grant and never confuses ordinary video or Research scopes", async () => {
    const apiReader = vi.fn(async () => [tiktok]);
    const grant: TikTokBusinessDiscoveryGrant = { endpoint: "https://business-api.tiktok.com/open_api/v1.3/discovery/trending_list/",
      approved: true, advertiserAuthorized: true, permittedUse: true, verifiedAt: now.toISOString(),
      officialPermission: { name: "synthetic-reviewed-business-permission", granted: true, reviewed: true,
        documentationUrl: "https://business-api.tiktok.com/portal/docs?id=1825119032526849" } };
    for (const value of [undefined, { ...grant, approved: false }, { ...grant, advertiserAuthorized: false },
      { ...grant, officialPermission: { ...grant.officialPermission, name: "video.list" } },
      { ...grant, officialPermission: { ...grant.officialPermission, name: "research.data.basic" } },
      { ...grant, officialPermission: { ...grant.officialPermission, reviewed: false } }]) {
      const result = await discoverTrendCandidates([tikTokTrendDiscoverySource({ apiReader, grant: value })], context, now);
      expect(result.status).toBe("UNKNOWN");
    }
    expect(apiReader).not.toHaveBeenCalled();
    const result = await discoverTrendCandidates([tikTokTrendDiscoverySource({ apiReader, grant })], context, now);
    expect(result.sources[0].status).toBe("REAL_OBSERVATIONS"); expect(apiReader).toHaveBeenCalledOnce();
  });

  it("allows a permitted normalized Creative Center report without implying an automated API grant", async () => {
    const apiReader = vi.fn(async () => [tiktok]), reportReader = vi.fn(async () => [tiktok]);
    const result = await discoverTrendCandidates([tikTokTrendDiscoverySource({ apiReader, reportReader })], context, now);
    expect(reportReader).toHaveBeenCalledOnce(); expect(apiReader).not.toHaveBeenCalled();
    expect(result.globalTikTokTrendStatus).toBe("REAL_OBSERVATIONS");
  });

  it("refreshing the source changes the candidate pool without manufacturing a trend score", async () => {
    let rows = [tiktok];
    const provider = source("refreshable", "TIKTOK_TRENDS", []); provider.read = async () => ({ status: "REAL_OBSERVATIONS", observations: rows });
    const first = await discoverTrendCandidates([provider], context, now);
    rows = [{ ...tiktok, key: "new-topic", name: "หัวข้อใหม่ที่สังเกตได้" }];
    const second = await discoverTrendCandidates([provider], context, now);
    expect(second.candidatePoolFingerprint).not.toBe(first.candidatePoolFingerprint);
    expect(second.candidates.map(candidate => candidate.topic)).toEqual(["หัวข้อใหม่ที่สังเกตได้"]);
    expect(second.candidates[0]).not.toHaveProperty("viralScore");
    expect(second.viralOutcome).toBe("UNKNOWN");
  });

  it("times out a stalled source, cancels it, and never starts an unbounded retry", async () => {
    let aborted = false;
    const stalled: TrendDiscoverySource = { id: "stalled", domain: "TIKTOK_TRENDS", read: vi.fn<TrendDiscoverySource["read"]>(async (_context, _now, signal) => {
      signal.addEventListener("abort", () => { aborted = true; }); return new Promise(() => {});
    }) };
    const result = await discoverTrendCandidates([stalled], context, now, { sourceTimeoutMs: 15 });
    expect(result.sources[0]).toMatchObject({ status: "UNKNOWN", reason: "SOURCE_TIMEOUT" });
    expect(stalled.read).toHaveBeenCalledOnce(); expect(aborted).toBe(true);
  });

  it("bounds parallel source reads and rejects ambiguous duplicate source identities", async () => {
    let active = 0, maximum = 0;
    const providers = Array.from({ length: 9 }, (_, index): TrendDiscoverySource => ({ id: `source-${index}`, domain: "TIKTOK_TRENDS",
      read: async () => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 2)); active--;
        return { status: "UNKNOWN", observations: [] }; } }));
    await discoverTrendCandidates(providers, context, now, { concurrency: 2 });
    expect(maximum).toBeLessThanOrEqual(2);
    await expect(discoverTrendCandidates([providers[0], providers[0]], context, now)).rejects.toThrow("DISCOVERY_SOURCE_ID_INVALID");
  });
  it("bounds source payloads and never forwards arbitrary provider diagnostics", async () => {
    const tooLarge = source("oversized", "TIKTOK_TRENDS", Array.from({ length: 501 }, () => tiktok));
    const unsafe: TrendDiscoverySource = { id: "unsafe-diagnostic", domain: "TIKTOK_TRENDS", read: async () => ({
      status: "UNKNOWN", observations: [], reason: "fixture-secret-do-not-report" }) };
    const result = await discoverTrendCandidates([tooLarge, unsafe], context, now);
    expect(result.sources[0]).toMatchObject({ status: "UNKNOWN", reason: "SOURCE_ROWS_EXCEED_BOUND" });
    expect(JSON.stringify(result)).not.toContain("fixture-secret-do-not-report");
    expect(result.candidates).toEqual([]);
  });
});

const history = (): OwnPerformanceHistory => ({ evidenceId: "fixture-snapshot", videoId: "fixture-video", source: "TIKTOK_DISPLAY",
  publishedAt: "2026-10-12T11:00:00Z", observedAt: "2026-10-13T11:00:00Z", metrics: { views: 234 },
  attribution: { ownerId: "owner", createdAt: "2026-10-11T11:00:00Z", arm: { ownerId: "owner", accountId: "pilot",
    id: "fixture-immutable-arm", topic: "หัวข้อจากการระบุที่มาตอนสร้างจริง", mode: "GROWTH", contextKey: "organic-growth",
    introducedAt: "2026-10-11T11:00:00Z" } } });

describe("own performance from validated immutable history", () => {
  it("preserves the immutable topic and actual capture/publication times without invented audience or trend acceleration", async () => {
    const record = history(), rows = ownPerformanceObservations([record], "owner", "pilot", now);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: record.attribution.arm.topic, source: "TIKTOK_DISPLAY", capturedAt: record.observedAt,
      provenance: { reference: "https://open.tiktokapis.com/v2/video/query/", verifiedAt: record.observedAt,
        scope: { kind: "ACCOUNT", accountId: "pilot" } },
      metric: { name: "VIEWS", aggregation: "CUMULATIVE", samples: [{ at: record.observedAt, value: 234 }] },
      ownPerformance: { publishedAt: record.publishedAt, observedAt: record.observedAt, mode: "GROWTH" } });
    expect(rows[0].audience).toBeUndefined();
    const report = await discoverTrendCandidates([ownAccountPerformanceSource(async () => rows)], context, now);
    expect(report.intelligence.observations[0]).toMatchObject({ audience: "UNKNOWN", growth: { status: "UNKNOWN" } });
    expect(report.globalTikTokTrendStatus).toBe("UNKNOWN");
    expect(rows[0].provenance!.reference).not.toContain(record.videoId);
  });
  it("labels the owner's own imported Studio report as an account-scoped report, not as API data", () => {
    const rows = ownPerformanceObservations([{ ...history(), source: "OWNER_REPORT_IMPORT" }], "owner", "pilot", now);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "AUTHORIZED_REPORT", provenance: { collection: "AUTHORIZED_REPORT", reference: "https://www.tiktok.com/tiktokstudio", scope: { kind: "ACCOUNT" } } });
  });
  it("excludes other owners/accounts, mocks, Shop data, future observations, unpublished and stale posts", () => {
    const row = history();
    const invalid: OwnPerformanceHistory[] = [{ ...row, source: "MOCK" }, { ...row, source: "TIKTOK_SHOP_ANALYTICS" },
      { ...row, attribution: { ...row.attribution, ownerId: "other-owner" } },
      { ...row, attribution: { ...row.attribution, arm: { ...row.attribution.arm, ownerId: "other-owner" } } },
      { ...row, attribution: { ...row.attribution, arm: { ...row.attribution.arm, accountId: "sales-account" } } },
      { ...row, publishedAt: null }, { ...row, observedAt: "2026-10-14T11:00:00Z" },
      { ...row, observedAt: "2026-10-04T11:00:00Z", publishedAt: "2026-10-03T11:00:00Z",
        attribution: { ...row.attribution, createdAt: "2026-10-02T11:00:00Z", arm: { ...row.attribution.arm, introducedAt: "2026-10-02T11:00:00Z" } } }];
    expect(ownPerformanceObservations(invalid, "owner", "pilot", now)).toEqual([]);
  });
  it("keeps missing views unknown and only one latest cumulative snapshot per actual video/arm", () => {
    const row = history();
    expect(ownPerformanceObservations([{ ...row, metrics: { views: null } }], "owner", "pilot", now)[0].metric).toBeUndefined();
    const later = { ...row, evidenceId: "later", observedAt: "2026-10-13T11:30:00Z", metrics: { views: 456 } };
    const rows = ownPerformanceObservations([later, row], "owner", "pilot", now);
    expect(rows).toHaveLength(1); expect(rows[0].metric!.samples).toEqual([{ at: later.observedAt, value: 456 }]);
    expect(ownPerformanceObservations([row, { ...row, evidenceId: "conflict", metrics: { views: 999 } }], "owner", "pilot", now)).toEqual([]);
  });
  it("binds otherwise empty discovery reports and fingerprints to their account", async () => {
    const one = await discoverTrendCandidates([], context, now);
    const two = await discoverTrendCandidates([], { ...context, accountId: "other-account" }, now);
    expect(one.accountId).toBe("pilot"); expect(two.accountId).toBe("other-account");
    expect(one.candidatePoolFingerprint).not.toBe(two.candidatePoolFingerprint);
  });
});
