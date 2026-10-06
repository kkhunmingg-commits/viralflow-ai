import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CustomerAccount, CustomerOverview } from "@/features/control-center/customer-types";

vi.mock("@/app/(app)/post/actions", () => ({
  startCustomerPostAction: async () => ({ ok: true, message: "" }),
  stopCustomerPostAction: async () => ({ ok: true, message: "" }),
  retryCustomerPostAction: async () => ({ ok: true, message: "" }),
}));

import { HomeOverview } from "./home-overview";
import { PostOverview } from "./post-overview";
import { PostAccountDetail } from "./post-account-detail";
import { customerPeriod, customerTime, metricText } from "./presentation";

function account(id: string, name: string, patch: Partial<CustomerAccount> = {}): CustomerAccount {
  return {
    id, name, username: name.toLowerCase(), avatarUrl: null, rank: null, connected: true,
    postStatus: "พร้อมทำงาน", liveStatus: null, mode: "AUTO", target: 5, hardLimit: 10, budget: 1,
    categories: ["beauty"], postCount: 0,
    today: { generated: 0, ready: 0, published: 0, waiting: 0, failed: 0, review: 0 },
    metrics: { currency: null, views: null, units: null, gmv: null, commission: null, liveSessions: null, liveHours: null, salesPerHour: null },
    currentActivity: "พร้อมเริ่มงาน", nextActivity: null, actionRequired: null, nextScheduledPost: null, topProduct: null,
    activeRunId: null, isSingleAccountRun: false, canStart: true, canStop: false,
    ...patch,
  };
}
function overview(accounts: CustomerAccount[]): CustomerOverview {
  return {
    period: "today", updatedAt: "2026-10-06T03:00:00Z", startDate: "2026-10-06", endDate: "2026-10-06", accounts,
    summary: { currency: null, gmv: null, commission: null, postCount: 0, units: null, views: null, liveSessions: null, liveHours: null, salesPerHour: null },
    analyticsNotice: "แสดงเฉพาะข้อมูลที่บันทึกไว้ ยอดขายไม่ใช่กำไร",
  };
}
function visibleText(html: string) {
  return html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]*>/g, " ");
}

describe("customer Home and POST", () => {
  it("shows all accounts, period navigation and honest missing observations", () => {
    const html = renderToStaticMarkup(<HomeOverview data={overview([account("account-a", "Alice"), account("account-b", "Bob")])} />);
    expect(html).toContain("Alice"); expect(html).toContain("Bob");
    expect(html.match(/class="customer-account-card"/g)).toHaveLength(2);
    expect(html).toContain('href="/home?period=7d"'); expect(html).toContain('href="/home?period=30d"');
    expect(html).toContain('href="/post/account-a?period=today"'); expect(html).toContain('href="/post/account-b?period=today"');
    expect(html).toContain("ยังไม่มีข้อมูล"); expect(html).not.toMatch(/฿0|\$0|LIVE สูงสุด [1-9]/);
  });
  it("formats measured values in their actual currency without inventing one", () => {
    expect(metricText(null, "money", "THB")).toBe("—");
    expect(metricText(125.5, "money", null)).not.toMatch(/฿|\$/);
    expect(metricText(125.5, "money", "USD")).toContain("US$");
    const data = overview([account("account-a", "Alice", { metrics: { currency: "THB", gmv: 1800, commission: 90, views: 6000, units: 3, liveSessions: null, liveHours: null, salesPerHour: null }, rank: 1 })]);
    const html = renderToStaticMarkup(<HomeOverview data={data} />);
    expect(html).toContain("฿1,800.00"); expect(html).toContain("6,000"); expect(html).toContain("#1");
  });
  it("keeps each POST control bound to its account and does not imply unsupported modes work", () => {
    const a = account("account-a", "Alice", { today: { generated: 3, ready: 2, published: 1, waiting: 1, failed: 0, review: 0 } });
    const b = account("account-b", "Bob", { canStart: false, connected: false, postStatus: "ต้องเชื่อมบัญชีใหม่", actionRequired: { label: "ต้องเชื่อม TikTok บัญชีนี้ใหม่", href: "/accounts/account-b" } });
    const html = renderToStaticMarkup(<PostOverview data={overview([a, b])} requestKeys={{ "account-a": "request-a", "account-b": "request-b" }} />);
    expect(html).toContain('name="accountId" value="account-a"'); expect(html).toContain('name="accountId" value="account-b"');
    expect(html).toContain('value="DRAFT" disabled=""'); expect(html).toContain('value="EXPORT" disabled=""');
    expect(html).toContain("ต้องเชื่อม TikTok บัญชีนี้ใหม่");
    expect(html.match(/class="customer-primary-button customer-start-button" disabled=""/g)).toHaveLength(1);
    expect(html).toContain("3"); expect(html).toContain("1 / 5 คลิป");
    expect(visibleText(html)).not.toMatch(/account-a|account-b|request-a|request-b|scope|provider|Supabase|FFmpeg|queue_id|open_id|raw JSON/);
  });
  it("does not offer per-account STOP for a shared run", () => {
    const html = renderToStaticMarkup(<PostOverview data={overview([account("account-a", "Alice", { activeRunId: "shared-run", canStop: true, isSingleAccountRun: false })])} requestKeys={{ "account-a": "request-a" }} />);
    expect(html).not.toContain('class="customer-stop-button"');
  });
  it("keeps START visible before metrics and collapses every account's settings by default", () => {
    const data = overview(Array.from({ length: 10 }, (_, index) => account(`account-${index}`, `บัญชี ${index + 1}`)));
    const html = renderToStaticMarkup(<PostOverview data={data} requestKeys={Object.fromEntries(data.accounts.map((row) => [row.id, "request"]))} />);
    expect(html.match(/class="customer-post-settings"/g)).toHaveLength(10);
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html.match(/class="customer-primary-button customer-start-button"/g)).toHaveLength(10);
    const firstCard = html.slice(html.indexOf('class="customer-account-card customer-post-account-card"'));
    expect(firstCard.indexOf("START AUTO")).toBeLessThan(firstCard.indexOf('class="customer-post-settings"'));
    expect(firstCard.indexOf("START AUTO")).toBeLessThan(firstCard.indexOf('class="customer-post-counts"'));
  });
  it("drills into only the supplied account's clips and enables Retry only when authorized", () => {
    const html = renderToStaticMarkup(<PostAccountDetail requestKey="request-b" data={{ account: account("account-b", "Bob"), period: "today", updatedAt: "2026-10-06T03:00:00Z", clips: [
      { currency: null, key: "clip-b", title: "คลิปสินค้าของ Bob", product: "สินค้า B", thumbnail: null, status: "ต้องตรวจอีกครั้ง", scheduledAt: null, postedAt: null, views: null, sales: null, canRetry: false, queueId: "queue-b" },
    ] }} />);
    expect(html).toContain("สินค้า B"); expect(html).not.toContain("Alice"); expect(html).not.toContain("ลองอีกครั้ง");
    expect(visibleText(html)).not.toMatch(/queue-b|clip-b|account-b|request-b|MuseTalk|CUDA|API|model|provider/);
  });
  it("keeps the main surfaces responsive without a horizontal grid or forced card width", () => {
    const css = readFileSync(new URL("./customer-control-center.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.customer-account-grid\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).toContain("@media (max-width: 1050px)"); expect(css).toContain("@media (max-width: 480px)");
    expect(css).toMatch(/\.customer-account-grid\s*\{ grid-template-columns: 1fr;/);
    expect(css).not.toContain("overflow-x: auto");
  });
  it("validates period and display dates without leaking technical values", () => {
    expect(customerPeriod("7d")).toBe("7d"); expect(customerPeriod(["30d"])).toBe("today");
    expect(customerPeriod("all")).toBe("today"); expect(customerTime("bad date")).toBe("ยังไม่ได้กำหนด");
  });
});
