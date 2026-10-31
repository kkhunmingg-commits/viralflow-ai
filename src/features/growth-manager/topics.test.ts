import { describe, expect, it } from "vitest";
import { analyzeTrendIntelligence, chooseGrowthTopics, type TrendObservation } from "./topics";

// Synthetic records test validation; they are not evidence of current real trends.
const now = new Date("2026-10-13T12:00:00Z");
const context = { accountId: "pilot", region: "TH", audienceSegments: ["home care"], productCategoryKey: "home" };
const reference = "https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en";
const base: TrendObservation = {
  name: "วิธีดูแลพื้น", key: "home-care", source: "TIKTOK_CREATIVE_CENTER", capturedAt: "2026-10-13T11:00:00Z", authorized: true,
  provenance: { kind: "REAL", reference, collection: "MANUAL_PUBLIC_OBSERVATION", permittedUse: true,
    verifiedAt: now.toISOString(), scope: { kind: "PUBLIC", regions: ["TH"] } },
  audience: { segments: ["Home Care"], basis: "OBSERVED" }, productCategories: ["home"],
  hook: { description: "แสดงปัญหาก่อนสาธิต", basis: "OBSERVED", reference },
  story: { description: "ปัญหา → สาธิต → ข้อสรุป", basis: "OBSERVED", reference },
};
const analyze = (rows: TrendObservation[]) => analyzeTrendIntelligence(rows, context, now);
const windowMetric: NonNullable<TrendObservation["metric"]> = { name: "VIEWS", aggregation: "WINDOW_COUNT", windowHours: 24,
  samples: [{ at: "2026-10-11T11:00:00Z", value: 100 }, { at: "2026-10-12T11:00:00Z", value: 150 }, { at: "2026-10-13T11:00:00Z", value: 200 }] };

describe("real trend evidence and hypotheses", () => {
  it("keeps category recommendations compatible while declining to call a proxy a real trend", () => {
    const category = { name: "จัดบ้าน", key: "home", source: "tiktok_shop" as const,
      capturedAt: now.toISOString(), authorized: true, confidence: .8, momentum: 80, accountEffect: null };
    expect(chooseGrowthTopics([category], now)).toEqual(["จัดบ้าน"]);
    expect(analyze([category])).toMatchObject({ status: "UNKNOWN", observations: [], viralOutcome: "UNKNOWN",
      hypotheses: [{ topic: "จัดบ้าน", basis: "CATEGORY_HYPOTHESIS" }], requiresHumanReview: true });
    expect(analyze([]).status).toBe("UNKNOWN");
  });

  it("rejects mock, unauthorized, stale and future evidence even when real provenance is attached", () => {
    const result = analyze([{ ...base, source: "MOCK" }, { ...base, authorized: false },
      { ...base, provenance: { ...base.provenance!, kind: "MOCK" } },
      { ...base, capturedAt: "2026-10-01T00:00:00Z" }, { ...base, capturedAt: "2026-10-14T00:00:00Z" }]);
    expect(result.status).toBe("UNKNOWN");
    expect(result.observations).toEqual([]);
    expect(result.hypotheses).toEqual([]);
    expect(result.excluded).toHaveLength(5);
  });

  it("requires permission, a usable public reference and verification after capture", () => {
    for (const provenance of [{ ...base.provenance!, permittedUse: false },
      { ...base.provenance!, reference: "http://ads.tiktok.com/" },
      { ...base.provenance!, reference: "https://user:password@ads.tiktok.com/" },
      { ...base.provenance!, reference: "https://ads.tiktok.com/?access_token=not-a-real-token" },
      { ...base.provenance!, reference: "https://example.com/fixture" },
      { ...base.provenance!, verifiedAt: "2026-10-13T10:00:00Z" }]) {
      expect(analyze([{ ...base, provenance }])).toMatchObject({ status: "UNKNOWN", observations: [] });
    }
  });

  it("accepts applicable authorized public evidence without predicting a viral outcome", () => {
    const result = analyze([base]);
    expect(result).toMatchObject({ status: "REAL_OBSERVATIONS", viralOutcome: "UNKNOWN", requiresHumanReview: true,
      observations: [{ topic: base.name, freshnessHours: 1, accountFit: "OBSERVED_AUDIENCE_MATCH", productFit: "MATCHED",
        audience: ["home care"], hookPattern: base.hook!.description, storyPattern: base.story!.description,
        growth: { status: "UNKNOWN" }, confidence: "OBSERVATION_ONLY", visualUse: "UNKNOWN" }] });
    expect(result.observations[0].reasons).toContain("Reference media must not be reused until its rights are confirmed.");
  });

  it("keeps a real region observation with unknown audience distinct from an account-applicable trend", () => {
    const result = analyze([{ ...base, source: "GOOGLE_TRENDS", audience: undefined,
      provenance: { ...base.provenance!, collection: "OFFICIAL_RSS", reference: "https://trends.google.com/trending/rss?geo=TH" } }]);
    expect(result.status).toBe("UNKNOWN");
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({ accountFit: "UNKNOWN", audience: "UNKNOWN", growth: { status: "UNKNOWN" } });
    expect(result.hypotheses).toMatchObject([{ topic: base.name, basis: "SOURCE_TOPIC_HYPOTHESIS" }]);
  });

  it("does not transfer other accounts' evidence or an unmatched public audience into pilot decisions", () => {
    expect(analyze([{ ...base, provenance: { ...base.provenance!, scope: { kind: "ACCOUNT", accountId: "sales-account" } } }]).observations).toEqual([]);
    expect(analyze([{ ...base, audience: { segments: ["unrelated"], basis: "OBSERVED" } }]).observations).toEqual([]);
    expect(analyze([{ ...base, provenance: { ...base.provenance!, scope: { kind: "PUBLIC", regions: ["US"] } } }]).observations).toEqual([]);
    const own = analyze([{ ...base, audience: undefined,
      provenance: { ...base.provenance!, scope: { kind: "ACCOUNT", accountId: "pilot" } } }]);
    expect(own.observations[0]).toMatchObject({ accountFit: "OWN_ACCOUNT", audience: "UNKNOWN" });
  });

  it("reports missing or hypothetical hooks and story structures as unknown", () => {
    const row = analyze([{ ...base, hook: { ...base.hook!, basis: "HYPOTHESIS" }, story: undefined,
      productCategories: undefined }]).observations[0];
    expect(row).toMatchObject({ hookPattern: "UNKNOWN", storyPattern: "UNKNOWN", productFit: "UNKNOWN" });
    expect(analyze([{ ...base, productCategories: ["beauty"] }]).observations[0].productFit).toBe("MISMATCH");
  });

  it("deduplicates a topic by actual time, independently of category momentum and timezone notation", () => {
    const older = { ...base, capturedAt: "2026-10-13T18:00:00+07:00", name: "older", momentum: 100 };
    const newer = { ...base, capturedAt: "2026-10-13T11:30:00Z", name: "newer", momentum: 0 };
    expect(analyze([newer, older]).observations.map(row => row.topic)).toEqual(["newer"]);
  });
});

describe("measured attention growth", () => {
  it("compares measured equal non-overlapping windows and explains the evidence coverage", () => {
    expect(analyze([{ ...base, metric: windowMetric }]).observations[0]).toMatchObject({ confidence: "COMPARABLE_WINDOWS",
      growth: { status: "RISING", metric: "VIEWS", previous: 150, current: 200, relativeChange: 1 / 3, comparableWindows: 3 } });
  });

  it("never mistakes cumulative counters, a search index, or a momentum proxy for measured growth", () => {
    for (const metric of [undefined, { ...windowMetric, aggregation: "CUMULATIVE" as const },
      { ...windowMetric, aggregation: "INDEX" as const }]) {
      expect(analyze([{ ...base, momentum: 100, confidence: 1, metric }]).observations[0].growth.status).toBe("UNKNOWN");
    }
  });

  it("rejects overlapping, duplicated, negative, future and non-finite samples", () => {
    for (const samples of [[{ at: base.capturedAt, value: 100 }, { at: base.capturedAt, value: 200 }],
      [{ at: "2026-10-13T10:30:00Z", value: 100 }, { at: base.capturedAt, value: 200 }],
      [{ at: "2026-10-12T11:00:00Z", value: -1 }, { at: base.capturedAt, value: 200 }],
      [{ at: "2026-10-12T11:00:00Z", value: 100 }, { at: "2026-10-14T11:00:00Z", value: 200 }],
      [{ at: "2026-10-12T11:00:00Z", value: 100 }, { at: base.capturedAt, value: NaN }]]) {
      expect(analyze([{ ...base, metric: { ...windowMetric, samples } }]).observations[0].growth.status).toBe("UNKNOWN");
    }
  });

  it("does not fabricate a percent change from a zero denominator", () => {
    const result = analyze([{ ...base, metric: { ...windowMetric,
      samples: [{ at: "2026-10-12T11:00:00Z", value: 0 }, { at: base.capturedAt, value: 100 }] } }]);
    expect(result.observations[0].growth).toMatchObject({ status: "RISING", relativeChange: null });
    expect(result.viralOutcome).toBe("UNKNOWN");
  });
});
