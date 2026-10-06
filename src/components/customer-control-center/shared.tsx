import Image from "next/image";
import Link from "next/link";
import type { CustomerAccount, CustomerPeriod } from "@/features/control-center/customer-types";
import { friendlyTone, metricText } from "./presentation";

export function PeriodTabs({ period, href }: { period: CustomerPeriod; href: string }) {
  const periods: Array<{ value: CustomerPeriod; label: string }> = [
    { value: "today", label: "วันนี้" }, { value: "7d", label: "7 วัน" }, { value: "30d", label: "30 วัน" },
  ];
  return <nav className="customer-periods" aria-label="ช่วงเวลาของข้อมูล">
    {periods.map((item) => <Link key={item.value} href={`${href}?period=${item.value}`}
      aria-current={period === item.value ? "page" : undefined}>{item.label}</Link>)}
  </nav>;
}

export function CustomerBadge({ label }: { label: string }) {
  return <span className={`customer-badge ${friendlyTone(label)}`}><span aria-hidden="true" />{label}</span>;
}

export function AccountIdentity({ account, showRank = false }: { account: CustomerAccount; showRank?: boolean }) {
  return <div className="customer-account-identity">
    <span className="customer-account-avatar">
      {account.avatarUrl ? <Image src={account.avatarUrl} alt="" width={48} height={48} unoptimized />
        : <span aria-hidden="true">{account.name.slice(0, 1).toUpperCase()}</span>}
    </span>
    <div className="customer-account-name"><h2>{account.name}</h2><p>{account.username ? `@${account.username.replace(/^@/, "")}` : "บัญชี TikTok"}</p></div>
    {showRank && account.rank != null ? <span className="customer-account-rank" title="อันดับยอดขายในช่วงเวลาที่เลือก">#{account.rank}</span> : null}
  </div>;
}

export function CustomerMetric({ label, value, style = "number", help, currency = null }: {
  label: string; value: number | null; style?: "number" | "money" | "hours"; help?: string; currency?: string | null;
}) {
  return <div className="customer-metric"><dt>{label}</dt><dd>{metricText(value, style, currency)}</dd>
    {value == null ? <small>ยังไม่มีข้อมูล</small> : style === "money" && !currency ? <small>ยังไม่ระบุสกุลเงิน</small> : help ? <small>{help}</small> : null}</div>;
}

export function AccountActionRequired({ account }: { account: CustomerAccount }) {
  return account.actionRequired ? <div className="customer-account-attention">
    <span aria-hidden="true">!</span><p>{account.actionRequired.label}</p>
    <Link href={account.actionRequired.href}>แก้ไข →</Link>
  </div> : null;
}

export function CustomerEmptyAccounts() {
  return <section className="customer-empty"><span className="customer-empty-symbol" aria-hidden="true">＋</span>
    <h2>เริ่มจากบัญชี TikTok ของคุณ</h2><p>เชื่อมบัญชีเพื่อดูผลงานและจัดการแต่ละบัญชีในหน้าเดียว</p>
    <Link className="customer-primary-button" href="/accounts/connect/tiktok/qr">เชื่อม TikTok</Link>
  </section>;
}
