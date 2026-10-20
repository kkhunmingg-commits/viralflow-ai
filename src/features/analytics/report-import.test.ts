import { describe, expect, it } from "vitest";
import { channelRevenue, externalVideoUuid, parseDelimited, parseOrderReport, parseVideoReport, reportChannel, reportDate, reportNumber, tiktokVideoId } from "./report-import";
import { createAdaptiveArm, decideAdaptiveExperiment, type AdaptiveOutcome } from "../growth/adaptive-experiments";

describe("owner report import", () => {
  it("reads quoted, BOM-prefixed and tab-separated exports", () => {
    expect(parseDelimited('﻿a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
    expect(parseDelimited("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("reads numbers, rates, durations and dates the way dashboards print them, and never invents zeros", () => {
    expect(reportNumber("12.5K")).toBe(12500); expect(reportNumber("1,234")).toBe(1234); expect(reportNumber("฿1,234.50", "money")).toBe(1234.5);
    expect(reportNumber("-")).toBeNull(); expect(reportNumber("")).toBeNull(); expect(reportNumber("abc")).toBeNull();
    expect(reportNumber("23.5%", "rate")).toBeCloseTo(.235); expect(reportNumber("0:12", "seconds")).toBe(12); expect(reportNumber("7.4s", "seconds")).toBe(7.4);
    expect(reportDate("21/10/2026 18:30")).toBe("2026-10-21T11:30:00.000Z");
    expect(reportDate("21/10/2569 18:30")).toBe("2026-10-21T11:30:00.000Z");
    expect(tiktokVideoId("https://www.tiktok.com/@shop/video/7429876543210987654?lang=th")).toBe("7429876543210987654");
    expect(reportChannel("LIVE")).toBe("LIVE"); expect(reportChannel("วิดีโอ")).toBe("VIDEO"); expect(reportChannel("")).toBe("UNKNOWN");
  });
  it("parses a Studio content export, rejects rows it cannot trust and lists columns it did not use", () => {
    const csv = ["Video link,Post time,Video views,Likes,Comments,Shares,Saves,New followers,Average watch time,Watched full video,Region",
      "https://www.tiktok.com/@a/video/7429876543210987654,2026-10-21 18:30,12.5K,820,31,40,95,22,6.1s,18.2%,TH",
      "https://www.tiktok.com/@a/video/7429876543210987654,2026-10-21 18:30,12.5K,820,31,40,95,22,6.1s,18.2%,TH",
      "not a link,2026-10-21 18:30,100,1,0,0,0,0,1s,1%,TH",
      "https://www.tiktok.com/@a/video/7429876543210987655,2026-10-22 18:30,-,1,0,0,0,0,1s,1%,TH"].join("\n");
    const r = parseVideoReport(csv);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ externalVideoId: "7429876543210987654", views: 12500, newFollowers: 22, averageWatchSeconds: 6.1, publishedAt: "2026-10-21T11:30:00.000Z" });
    expect(r.rows[0].fullWatchRate).toBeCloseTo(.182);
    expect(r.rejections.map(x => x.reason)).toEqual(["DUPLICATE_VIDEO_IN_FILE", "VIDEO_ID_MISSING", "VIEWS_MISSING"]);
    expect(r.unknownColumns).toEqual(["Region"]);
    expect(parseVideoReport("Title,Views\nx,1").rejections[0].reason).toBe("NO_VIDEO_LINK_OR_ID_COLUMN");
  });
  it("keeps VIDEO and LIVE orders apart and counts each order line once at its furthest state", () => {
    const csv = ["Order ID,Product ID,Content type,GMV,Estimated commission,Actual commission,Order status,Order created time",
      "A1,P1,Video,199,19.90,,Pending,2026-10-21 10:00", "A2,P1,LIVE,398,39.80,39.80,Completed,2026-10-21 11:00", "A3,P1,Video,199,19.90,,Cancelled,2026-10-21 12:00"].join("\n");
    const r = parseOrderReport(csv);
    expect(r.rows.map(o => [o.channel, o.eventType])).toEqual([["VIDEO", "ORDER_CREATED"], ["LIVE", "ORDER_SETTLED"], ["VIDEO", "ORDER_CANCELLED"]]);
    const events = r.rows.map(o => ({ channel: o.channel, event_type: o.eventType, external_order_id: o.orderId, external_event_id: `${o.orderId}:${o.productExternalId}:${o.eventType}`,
      gmv: o.gmv, estimated_commission: o.estimatedCommission, settled_commission: o.settledCommission }));
    // The same order exported again after it settled replaces its earlier state rather than adding to it.
    events.push({ ...events[0], event_type: "ORDER_SETTLED", external_event_id: "A1:P1:ORDER_SETTLED", settled_commission: 19.9 });
    expect(channelRevenue(events)).toEqual({ VIDEO: { orders: 1, gmv: 199, estimatedCommission: 19.9, settledCommission: 19.9, cancelled: 1 },
      LIVE: { orders: 1, gmv: 398, estimatedCommission: 39.8, settledCommission: 39.8, cancelled: 0 } });
  });
  it("gives posts made outside the system a stable id", () => {
    expect(externalVideoUuid("acc", "742")).toBe(externalVideoUuid("acc", "742"));
    expect(externalVideoUuid("acc", "742")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("learning from owner-imported results", () => {
  const now = new Date("2026-11-20T00:00:00Z"), day = 86_400_000;
  const context = { ownerId: "o", accountId: "a", mode: "GROWTH" as const, contextKey: "organic-growth", environment: "REAL" as const, optedIn: true, affiliateEligible: false };
  const arm = (hook: string) => createAdaptiveArm({ ownerId: "o", accountId: "a", mode: "GROWTH", contextKey: "organic-growth", hook, angle: "x", topic: "t",
    productionMethod: "ORIGINAL_GRAPHIC_STORY", introducedAt: "2026-10-01T00:00:00Z" });
  const quiz = arm("quiz"), list = arm("list");
  const row = (i: number, a: typeof quiz, followers: number, source: AdaptiveOutcome["source"] = "OWNER_REPORTED", hours = 72): AdaptiveOutcome => {
    const published = new Date(now.getTime() - (14 - i) * day), observed = new Date(published.getTime() + hours * 3_600_000);
    return { evidenceId: `e${a.hook}${i}`, ownerId: "o", accountId: "a", mode: "GROWTH", contextKey: "organic-growth", armId: a.id, videoId: `v${a.hook}${i}`, source, authorized: true,
      publishedAt: published.toISOString(), observedAt: observed.toISOString(), window: { startAt: published.toISOString(), endAt: observed.toISOString(), complete: true },
      views: 1000, likes: 50, comments: 5, shares: 5, attributedFollowers: followers, followerAttribution: "VIDEO", orders: null, commissionUsd: null, actualCostUsd: null,
      salesAttribution: "UNKNOWN", commerceVerified: false, costBasis: "UNKNOWN" };
  };
  const decide = (outcomes: AdaptiveOutcome[]) => decideAdaptiveExperiment({ context, cycleKey: "c", now, observationWindowHours: 24, availableSlots: 1, arms: [quiz, list], outcomes, ledger: [] });
  it("needs several posts over several days before it prefers anything", () => {
    expect(decide([row(0, quiz, 30), row(1, list, 2)]).preferredArmId).toBeNull();
  });
  it("prefers the pattern that earned more followers per view once the sample is credible", () => {
    const outcomes = [...[0, 2, 4, 6, 8, 10].map(i => row(i, quiz, 30)), ...[1, 3, 5, 7, 9, 11].map(i => row(i, list, 3))];
    expect(decide(outcomes).preferredArmId).toBe(quiz.id);
  });
  it("does not compare a fresh export or a 24-hour API window with lifetime exports", () => {
    const r = decide([row(0, quiz, 30, "OWNER_REPORTED", 30), row(1, list, 3, "TIKTOK_DISPLAY", 24), row(2, list, 3)]);
    expect(r.excludedEvidence.map(e => e.reason).sort()).toEqual(["INCOMPARABLE_EXPOSURE_WINDOW", "MIXED_WINDOW_CLASS_API_PREFERRED"]);
  });
});
