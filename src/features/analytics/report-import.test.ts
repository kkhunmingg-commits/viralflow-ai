import { describe, expect, it } from "vitest";
import { buildReportPreview, channelRevenue, decodeReportFile, detectReportKind, externalVideoUuid, parseDelimited, parseOrderReport, parseVideoReport, rejectionMessage, reportChannel,
  reportDate, reportFileSha256, reportNumber, reportOrderEvent, tiktokVideoId, type ParsedOrderRow, type ParsedVideoRow } from "./report-import";
import { realSnapshotTotals } from "./services";
import type { VideoSnapshotRow } from "./types";
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

describe("owner report preview (nothing stored)", () => {
  const thaiVideo = ["\uFEFFลิงก์วิดีโอ,เวลาที่โพสต์,ยอดดู,ยอดไลก์,ความคิดเห็น,การแชร์,บันทึก,ผู้ติดตามใหม่,เวลาดูเฉลี่ย,อัตราการดูจนจบ,ภูมิภาค",
    ...Array.from({ length: 12 }, (_, i) => `https://www.tiktok.com/@a/video/74298765432109876${String(i).padStart(2, "0")},21/10/2569 18:30,"1,2${i}0",80,3,4,9,2,0:07,18.2%,TH`),
    "ไม่ใช่ลิงก์,21/10/2569 18:30,100,1,0,0,0,0,1s,1%,TH",
    "https://www.tiktok.com/@a/video/7429876543210987600,21/10/2569 18:30,1200,1,0,0,0,0,1s,1%,TH",
    "https://www.tiktok.com/@a/video/7429876543210987699,21/10/2569 18:30,-,1,0,0,0,0,1s,1%,TH"].join("\r\n");

  it("reads a BOM-prefixed Thai Studio export with Buddhist-era dates and lists bad rows with Thai reasons", () => {
    const p = buildReportPreview({ kind: "VIDEO_PERFORMANCE", text: thaiVideo });
    expect(p).toMatchObject({ detectedKind: "VIDEO_PERFORMANCE", format: "CSV", rowsRead: 15, rowsAccepted: 12, blocking: null, alreadyImported: null, linkedRows: null, channels: null });
    expect(p.sample).toHaveLength(10);
    expect(p.sample[0]).toMatchObject({ line: 2, externalVideoId: "7429876543210987600", publishedAt: "2026-10-21T11:30:00.000Z", views: 1200, averageWatchSeconds: 7, newFollowers: 2 });
    expect((p.sample[0] as ParsedVideoRow).fullWatchRate).toBeCloseTo(.182);
    expect(p.rejections.map(r => [r.line, r.reason])).toEqual([[14, "VIDEO_ID_MISSING"], [15, "DUPLICATE_VIDEO_IN_FILE"], [16, "VIEWS_MISSING"]]);
    expect(p.rejections.map(r => r.message)).toEqual(["ไม่พบลิงก์หรือรหัสวิดีโอ TikTok ที่ถูกต้อง", "วิดีโอนี้ซ้ำกับแถวก่อนหน้าในไฟล์เดียวกัน", "ไม่มียอดดู ระบบไม่เดาเป็น 0"]);
    expect(p.unknownColumns).toEqual(["ภูมิภาค"]);
  });
  it("identifies the exact file for duplicate detection and counts rows import would link", () => {
    const prior = { imported_at: "2026-10-21T12:00:00Z", file_name: "content.csv", rows_imported: 12 };
    const p = buildReportPreview({ kind: "VIDEO_PERFORMANCE", text: thaiVideo, prior, linkKeys: new Set(["7429876543210987600", "7429876543210987601", "999"]) });
    expect(p.fileSha256).toBe(reportFileSha256(thaiVideo));
    expect(p.fileSha256).not.toBe(reportFileSha256(thaiVideo + "\n"));
    expect(p.alreadyImported).toEqual({ importedAt: "2026-10-21T12:00:00Z", fileName: "content.csv", rowsImported: 12 });
    expect(p.linkedRows).toBe(2);
  });
  it("blocks a file of the other report kind or with no usable rows, and keeps VIDEO and LIVE apart in an order preview", () => {
    const orders = ["หมายเลขคำสั่งซื้อ\tรหัสสินค้า\tประเภทเนื้อหา\tยอดขาย\tค่าคอมมิชชันโดยประมาณ\tค่าคอมมิชชันจริง\tสถานะคำสั่งซื้อ\tเวลาสั่งซื้อ",
      "A1\tP1\tวิดีโอ\t฿199.00\t19.90\t\tรอดำเนินการ\t21/10/2569 10:00", "A2\tP1\tไลฟ์\t398\t39.80\t39.80\tสำเร็จ\t21/10/2569 11:00",
      "A3\tP2\tโชว์เคส\t100\t10\t\tรอดำเนินการ\t21/10/2569 11:00", "A4\tP2\t\t50\t5\t\tรอดำเนินการ\t", ""].join("\n");
    expect(detectReportKind(orders)).toBe("AFFILIATE_ORDERS");
    expect(buildReportPreview({ kind: "VIDEO_PERFORMANCE", text: orders }).blocking?.reason).toBe("KIND_MISMATCH");
    const p = buildReportPreview({ kind: "AFFILIATE_ORDERS", text: orders, linkKeys: new Set(["P1"]) });
    expect(p).toMatchObject({ format: "TSV", rowsRead: 4, rowsAccepted: 3, linkedRows: 2, blocking: null });
    expect(p.rejections).toEqual([{ line: 5, reason: "ORDER_TIME_MISSING", message: "ไม่มีเวลาสั่งซื้อ หรืออ่านรูปแบบวันที่ไม่ได้" }]);
    expect((p.sample[0] as ParsedOrderRow).occurredAt).toBe("2026-10-21T03:00:00.000Z");
    expect(p.channels).toEqual({ VIDEO: { orders: 1, gmv: 199, estimatedCommission: 19.9, settledCommission: 0, cancelled: 0 },
      LIVE: { orders: 1, gmv: 398, estimatedCommission: 39.8, settledCommission: 39.8, cancelled: 0 },
      SHOWCASE: { orders: 1, gmv: 100, estimatedCommission: 10, settledCommission: 0, cancelled: 0 } });
    expect(buildReportPreview({ kind: "AFFILIATE_ORDERS", text: "Title,Views\nx,1" }).blocking).toEqual({ reason: "NO_ORDER_ID_COLUMN", message: rejectionMessage("NO_ORDER_ID_COLUMN") });
    expect(buildReportPreview({ kind: "VIDEO_PERFORMANCE", text: "Video link,Views\n" }).blocking?.reason).toBe("NO_ROWS");
    expect(rejectionMessage("COLUMN_NOT_USED:Region")).toBe('ไม่ได้ใช้คอลัมน์ "Region"');
  });
  it("decodes UTF-8 with BOM, UTF-16 and Thai Windows-874 exports, and refuses Excel workbooks", () => {
    const utf8 = new TextEncoder().encode("\uFEFFVideo link,Views\n");
    expect(decodeReportFile(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8.slice(3)]))).toBe("Video link,Views\n");
    const utf16 = new Uint8Array([0xff, 0xfe, ...[..."ยอดดู\t1"].flatMap(c => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]);
    expect(decodeReportFile(utf16)).toBe("ยอดดู\t1");
    const tis620 = new Uint8Array([..."ยอดดู"].map(c => c.charCodeAt(0) - 0x0e01 + 0xa1));
    expect(decodeReportFile(tis620)).toBe("ยอดดู");
    expect(() => decodeReportFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]))).toThrow("REPORT_IS_EXCEL");
    expect(() => decodeReportFile(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0]))).toThrow("REPORT_IS_EXCEL");
    expect(() => decodeReportFile(new Uint8Array())).toThrow("REPORT_EMPTY");
  });
});

describe("revenue and real/mock separation", () => {
  it("reads channels and order states from whole words, never guessing VIDEO or LIVE", () => {
    expect(reportChannel("Delivered")).toBe("UNKNOWN"); expect(reportChannel("Product card")).toBe("UNKNOWN"); expect(reportChannel("Short video")).toBe("VIDEO");
    expect(reportOrderEvent("Unpaid")).toBe("ORDER_CREATED"); expect(reportOrderEvent("Paid")).toBe("ORDER_SETTLED");
    expect(reportOrderEvent("ไม่สำเร็จ")).toBe("ORDER_CANCELLED"); expect(reportOrderEvent("Refunded")).toBe("ORDER_CANCELLED");
  });
  it("never counts MOCK orders and collapses a commission update into its order line", () => {
    const base = { channel: "VIDEO", external_order_id: "A1", gmv: 100, estimated_commission: 10, settled_commission: null, source: "OWNER_REPORT_IMPORT" };
    expect(channelRevenue([{ ...base, event_type: "ORDER_CREATED", external_event_id: "A1:P1:ORDER_CREATED" },
      { ...base, event_type: "COMMISSION_UPDATED", external_event_id: "A1:P1:COMMISSION_UPDATED" },
      { ...base, source: "MOCK", event_type: "ORDER_CREATED", external_event_id: "M1:P1:ORDER_CREATED" },
      { ...base, channel: "UNKNOWN", event_type: "ORDER_CREATED", external_event_id: "U1:P1:ORDER_CREATED" }]))
      .toEqual({ VIDEO: { orders: 1, gmv: 100, estimatedCommission: 10, settledCommission: 0, cancelled: 0 }, UNKNOWN: { orders: 1, gmv: 100, estimatedCommission: 10, settledCommission: 0, cancelled: 0 } });
  });
  it("adds only the newest real snapshot of each video and keeps MOCK out of the totals", () => {
    const snap = (id: string, video: string, at: string, views: number, source: VideoSnapshotRow["source"] = "OWNER_REPORT_IMPORT", gmv: number | null = null) =>
      ({ id, tiktok_account_id: "a", video_id: `v${video}`, video_kind: "EXTERNAL", external_video_id: video, product_id: null, category_id: null, source, source_snapshot_at: at,
        source_confidence: .8, views, likes: null, comments: null, shares: null, favorites: null, clicks: null, orders: null, gmv, commission: null }) as VideoSnapshotRow;
    expect(realSnapshotTotals([snap("1", "1", "2026-10-20T00:00:00Z", 100), snap("2", "1", "2026-10-21T00:00:00Z", 150, "TIKTOK_DISPLAY"),
      snap("3", "2", "2026-10-21T00:00:00Z", 40, "OWNER_REPORT_IMPORT", 99), snap("4", "3", "2026-10-21T00:00:00Z", 1_000_000, "MOCK", 5000)]))
      .toEqual({ views: 190, orders: 0, gmv: 99, commission: 0, realVideos: 2, mockSnapshotsExcluded: 1 });
  });
});
