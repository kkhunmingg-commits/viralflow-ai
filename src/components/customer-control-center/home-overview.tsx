import Link from "next/link";
import type { CustomerOverview } from "@/features/control-center/customer-types";
import { AccountActionRequired, AccountIdentity, CustomerBadge, CustomerEmptyAccounts, CustomerMetric, PeriodTabs } from "./shared";
import { customerTime, metricText } from "./presentation";
import {AccountSafetyCard} from "./account-safety";
import type {AccountSafetySummary} from "@/features/compliance-brain/presentation";

export function HomeOverview({ data, shareAction, safetyByAccount }: { data: CustomerOverview; shareAction?: React.ReactNode; safetyByAccount?:Record<string,AccountSafetySummary> }) {
  const needsAttention = data.accounts.filter((account) => account.actionRequired).length;
  return <div className="customer-center customer-home">
    <header className="customer-page-header">
      <div><p className="customer-eyebrow">ทุกบัญชี ในหน้าเดียว</p><h1>Home</h1><p>ดูผลงานและสิ่งที่กำลังทำของคุณ</p></div>
      <div className="customer-header-actions"><PeriodTabs period={data.period} href="/home" />{shareAction}</div>
    </header>

    <section className="customer-overview" aria-label="ภาพรวมผลงาน">
      <div className="customer-overview-heading"><span>ภาพรวม{data.period === "today" ? "วันนี้" : data.period === "7d" ? " 7 วัน" : " 30 วัน"}</span>
        <span className="customer-updated">อัปเดต {customerTime(data.updatedAt)}</span></div>
      <dl className="customer-summary-grid">
        <CustomerMetric label="ยอดขาย" value={data.summary.gmv} style="money" currency={data.summary.currency} />
        <CustomerMetric label="ค่าคอมมิชชัน" value={data.summary.commission} style="money" currency={data.summary.currency} />
        <CustomerMetric label="คลิปที่โพสต์" value={data.summary.postCount} />
        <CustomerMetric label="รอบ LIVE" value={data.summary.liveSessions} />
        <CustomerMetric label="เวลา LIVE" value={data.summary.liveHours} style="hours" />
        <CustomerMetric label="ยอดขาย / ชม." value={data.summary.salesPerHour} style="money" currency={data.summary.currency} />
      </dl>
      <p className="customer-data-note">{data.analyticsNotice}</p>
    </section>

    <section aria-labelledby="home-accounts-heading">
      <div className="customer-section-heading"><div><h2 id="home-accounts-heading">บัญชีของคุณ <span>{data.accounts.length}</span></h2>
        {needsAttention > 0 ? <p className="customer-attention-copy">{needsAttention} บัญชีต้องการการดำเนินการ</p> : null}</div>
        <Link className="customer-text-link" href="/accounts/connect/tiktok/qr">＋ เชื่อมบัญชีอื่น</Link></div>
      {data.accounts.length === 0 ? <CustomerEmptyAccounts /> : <div className="customer-account-grid">
        {data.accounts.map((account) => <article className="customer-account-card" key={account.id}>
          <AccountIdentity account={account} showRank />
          <div className="customer-channel-status"><div><span>POST</span><CustomerBadge label={account.postStatus} /></div>
            <div><span>AI LIVE</span><CustomerBadge label={account.liveStatus ?? "ยังไม่มีข้อมูล"} /></div></div>
          <dl className="customer-account-metrics">
            <CustomerMetric label="โพสต์วันนี้" value={account.today.published} />
            <CustomerMetric label="ยอดดู" value={account.metrics.views} />
            <CustomerMetric label="ขายได้" value={account.metrics.units} />
            <CustomerMetric label="ยอดขาย" value={account.metrics.gmv} style="money" currency={account.metrics.currency} />
            {account.metrics.commission != null ? <CustomerMetric label="ค่าคอมมิชชัน" value={account.metrics.commission} style="money" currency={account.metrics.currency} /> : null}
          </dl>
          <div className="customer-account-now"><span className="customer-live-dot" aria-hidden="true" /><div><strong>{account.currentActivity}</strong>
            <p>{account.nextActivity ?? "ยังไม่มีงานถัดไป"}</p></div></div>
          <AccountActionRequired account={account} />
          <AccountSafetyCard summary={safetyByAccount?.[account.id]} />
          <div className="customer-card-links"><Link className="customer-text-link" href={`/post/${account.id}?period=${data.period}`}>ดูคลิปและจัดการ POST →</Link>
            <Link className="customer-text-link customer-teal-link" href={`/ai-live?account=${account.id}`}>AI LIVE →</Link></div>
        </article>)}
      </div>}
    </section>

    {data.summary.views != null || data.summary.units != null ? <p className="customer-footnote">
      ยอดดูรวม {metricText(data.summary.views)} · จำนวนขาย {metricText(data.summary.units)}
    </p> : null}
  </div>;
}
