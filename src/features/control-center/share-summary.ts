import type { CustomerOverview } from "./customer-types";
export interface ShareSummary {
  title: string; period: string; currency: string | null;
  metrics: Array<{ label: string; value: number | null }>;
  ranking: Array<{ name: string; rank: number | null; sales: number | null; currency: string | null }>;
}
/** Sharing is an allowlist projection; record/action locators and diagnostics never enter the image. */
export function summaryForShare(view: CustomerOverview, selectedAccount = "all"): ShareSummary {
  const account = selectedAccount === "all" ? null : view.accounts.find((row) => row.id === selectedAccount);
  if (selectedAccount !== "all" && !account) throw new Error("share_account_not_found");
  const metrics = account?.metrics ?? view.summary;
  return { title: account ? account.name : "ทุกบัญชี", period: view.period === "7d" ? "7 วัน" : view.period === "30d" ? "30 วัน" : "วันนี้",
    currency: metrics.currency,
    metrics: [ { label: "ยอดขาย (GMV)", value: metrics.gmv }, { label: "ค่าคอมมิชชัน", value: metrics.commission },
      { label: "จำนวนสินค้าที่ขาย", value: metrics.units }, { label: "คลิปโพสต์", value: account ? account.postCount : view.summary.postCount },
      { label: "ชั่วโมง LIVE", value: metrics.liveHours }, { label: "ยอดขาย / ชั่วโมง", value: metrics.salesPerHour } ],
    ranking: (account ? [account] : [...view.accounts]).sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity)).map((row) => ({ name: row.name, rank: row.rank, sales: row.metrics.gmv, currency: row.metrics.currency })) };
}
