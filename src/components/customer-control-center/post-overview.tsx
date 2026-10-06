import Link from "next/link";
import type { CustomerAccount, CustomerOverview } from "@/features/control-center/customer-types";
import { AccountActionRequired, AccountIdentity, CustomerBadge, CustomerEmptyAccounts, CustomerMetric, PeriodTabs } from "./shared";
import { PostStartControls, PostStopControl } from "./post-controls";
import { customerTime, metricText } from "./presentation";

export function PostAccountCard({ account, period, requestKey }: {
  account: CustomerAccount; period: CustomerOverview["period"]; requestKey: string;
}) {
  const progress = account.target > 0 ? Math.min(100, account.today.generated / account.target * 100) : 0;
  return <article className="customer-account-card customer-post-account-card">
    <AccountIdentity account={account} />
    <div className="customer-post-status-row"><CustomerBadge label={account.postStatus} /><span>{account.schedule?.postingMode ?? "AUTO"}</span>
      <span>{account.schedule?.enabled ? "เปิดงานประจำ" : "ปิดงานประจำ"}</span><PostStopControl account={account} /></div>
    <AccountActionRequired account={account} />
    <PostStartControls account={account} requestKey={requestKey} />
    <div className="customer-account-now"><span className="customer-live-dot" aria-hidden="true" /><div><strong>{account.currentActivity}</strong>
      <p>{account.nextActivity ?? "ยังไม่มีงานถัดไป"}</p></div></div>
    <div className="customer-target-progress"><div><span>คลิปวันนี้</span><strong>{metricText(account.today.generated)} / {metricText(account.target)} คลิป</strong></div>
      <progress value={progress} max={100} aria-label={`เป้าหมายการสร้างคลิปวันนี้ของ ${account.name}`} /></div>
    <dl className="customer-post-counts">
      <CustomerMetric label="สร้างแล้ว" value={account.today.generated} /><CustomerMetric label="พร้อมโพสต์" value={account.today.ready} />
      <CustomerMetric label="กำลังสร้าง" value={account.today.generating ?? 0} /><CustomerMetric label="ตั้งเวลาแล้ว" value={account.today.scheduled ?? 0} />
      <CustomerMetric label="โพสต์แล้ว" value={account.today.published} />
      <CustomerMetric label="รอคุณโพสต์" value={account.today.waiting} /><CustomerMetric label="มีปัญหา" value={account.today.failed} />
    </dl>
    {account.today.review > 0 ? <Link className="customer-review-link" href={`/post/${account.id}`}>มี {account.today.review} คลิปที่ต้องตรวจ →</Link> : null}
    <dl className="customer-post-performance">
      <CustomerMetric label="ยอดดู" value={account.metrics.views} /><CustomerMetric label="จำนวนขาย" value={account.metrics.units} />
      <CustomerMetric label="ยอดขาย" value={account.metrics.gmv} style="money" currency={account.metrics.currency} /><CustomerMetric label="ค่าคอมมิชชัน" value={account.metrics.commission} style="money" currency={account.metrics.currency} />
    </dl>
    <div className="customer-scheduled"><div><span>โพสต์ถัดไป</span><strong>{customerTime(account.nextScheduledPost, true)}</strong></div>
      <div><span>งานประจำครั้งถัดไป</span><strong>{account.schedule?.enabled ? customerTime(account.schedule.nextRunAt, true) : "ยังไม่ได้เปิด"}</strong></div>
      <div><span>สินค้าขายดี</span><strong>{account.topProduct ?? "—"}</strong></div></div>
    <Link className="customer-post-detail-link" href={`/post/${account.id}?period=${period}`}>คลิปและผลลัพธ์ของบัญชีนี้ <span aria-hidden="true">→</span></Link>
  </article>;
}

export function PostOverview({ data, requestKeys }: { data: CustomerOverview; requestKeys: Record<string, string> }) {
  return <div className="customer-center customer-post">
    <header className="customer-page-header"><div><p className="customer-eyebrow">สร้างเนื้อหา เติบโตไปด้วยกัน</p><h1>POST</h1><p>แยกงานและผลลัพธ์ของทุกบัญชีอย่างชัดเจน</p></div>
      <div className="customer-header-actions"><PeriodTabs period={data.period} href="/post" /><Link className="customer-text-link" href="/accounts">จัดการบัญชี →</Link></div></header>
    <div className="customer-post-guide"><span aria-hidden="true">✦</span><p>ตั้งเวลาแล้วกด START แต่ละบัญชีทำงานแยกกัน</p><span className="customer-updated">อัปเดต {customerTime(data.updatedAt)}</span></div>
    {data.accounts.length === 0 ? <CustomerEmptyAccounts /> : <div className="customer-account-grid">
      {data.accounts.map((account) => <PostAccountCard key={account.id} account={account} period={data.period} requestKey={requestKeys[account.id]} />)}
    </div>}
    <p className="customer-data-note">{data.analyticsNotice}</p>
  </div>;
}
