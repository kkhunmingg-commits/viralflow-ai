import { describe, expect, it } from "vitest";
import { summaryForShare } from "./share-summary";
import type { CustomerOverview, CustomerAccount } from "./customer-types";
const account: CustomerAccount = { id: "private-locator", name: "ร้านของฉัน", username: "shop", avatarUrl: null, rank: 1,
  connected: true, postStatus: "พร้อมเริ่ม", liveStatus: null, mode: "AUTO", target: 5, hardLimit: 7, budget: 0,
  postCount: 12, categories: [], today: { generated: 2, ready: 1, published: 1, waiting: 0, failed: 0, review: 0 },
  metrics: { views: 100, units: 3, gmv: 300, commission: 30, currency: "THB", liveSessions: null, liveHours: null, salesPerHour: null },
  currentActivity: "ยังไม่มีงาน", nextActivity: null, actionRequired: null, nextScheduledPost: null, topProduct: null,
  activeRunId: null, isSingleAccountRun: false, canStart: true, canStop: false };
const view: CustomerOverview = { period: "7d", updatedAt: "2026-10-06T12:00:00.000Z", startDate: "2026-09-30", endDate: "2026-10-07", accounts: [account],
  summary: { currency: "THB", gmv: 300, commission: 30, postCount: 12, units: 3, views: 100, liveSessions: null, liveHours: null, salesPerHour: null }, analyticsNotice: "ข้อมูลจริง" };
describe("customer summary image projection", () => {
  it("shares actual selected-period counts, GMV and commission separately without identifiers", () => {
    const result = summaryForShare(view, account.id);
    expect(result.metrics.find((row) => row.label === "คลิปโพสต์")?.value).toBe(12);
    expect(result.metrics.find((row) => row.label === "ชั่วโมง LIVE")?.value).toBeNull();
    expect(result.metrics.find((row) => row.label === "ค่าคอมมิชชัน")?.value).toBe(30);
    expect(JSON.stringify(result)).not.toMatch(/private-locator|activeRunId|budget|provider|open_id/);
  });
  it("does not reorder application data or accept another owner's account", () => {
    const other = { ...account, id: "two", name: "สอง", rank: 2 };
    const source = { ...view, accounts: [other, account] };
    expect(summaryForShare(source).ranking[0].name).toBe("ร้านของฉัน");
    expect(source.accounts[0].id).toBe("two");
    expect(() => summaryForShare(source, "wrong-owner")).toThrow();
  });
});
