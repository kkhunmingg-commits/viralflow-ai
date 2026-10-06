import Image from "next/image";
import Link from "next/link";
import type { CustomerPostAccount } from "@/features/control-center/customer-types";
import { AccountActionRequired, AccountIdentity, CustomerBadge, CustomerMetric, PeriodTabs } from "./shared";
import { PostRetryControl, PostStartControls, PostStopControl } from "./post-controls";
import { PostReviewControl } from "./post-review-controls";
import { customerTime, metricText } from "./presentation";

export function PostAccountDetail({ data, requestKey }: { data: CustomerPostAccount; requestKey: string }) {
  const { account } = data;
  return <div className="customer-center customer-post-detail">
    <Link className="customer-text-link" href={`/post?period=${data.period}`}>← POST ทุกบัญชี</Link>
    <header className="customer-page-header"><div><p className="customer-eyebrow">คลิปและผลลัพธ์</p><h1>{account.name}</h1>
      <p>{account.username ? `@${account.username.replace(/^@/, "")}` : "บัญชี TikTok"}</p></div>
      <div className="customer-header-actions"><PeriodTabs period={data.period} href={`/post/${account.id}`} /><PostStopControl account={account} /></div></header>
    <AccountActionRequired account={account} />
    <section className="customer-overview"><div className="customer-overview-heading"><CustomerBadge label={account.postStatus} />
      <span className="customer-updated">อัปเดต {customerTime(data.updatedAt)}</span></div>
      <p className="customer-current-copy">{account.currentActivity}</p>
      <dl className="customer-summary-grid">
        <CustomerMetric label="สร้างวันนี้" value={account.today.generated} /><CustomerMetric label="โพสต์วันนี้" value={account.today.published} />
        <CustomerMetric label="รอคุณโพสต์" value={account.today.waiting} /><CustomerMetric label="ยอดดู" value={account.metrics.views} />
        <CustomerMetric label="ยอดขาย" value={account.metrics.gmv} style="money" currency={account.metrics.currency} /><CustomerMetric label="ค่าคอมมิชชัน" value={account.metrics.commission} style="money" currency={account.metrics.currency} />
      </dl>
    </section>
    <section aria-labelledby="post-clips-heading">
      <div className="customer-section-heading"><div><h2 id="post-clips-heading">คลิปในช่วงเวลาที่เลือก <span>{data.clips.length}</span></h2>
        {account.today.review > 0 ? <p className="customer-attention-copy">วันนี้มี {account.today.review} คลิปที่ต้องตรวจ</p> : null}</div></div>
      {data.clips.length === 0 ? <div className="customer-empty customer-clips-empty"><h2>ยังไม่มีคลิปในช่วงเวลานี้</h2><p>ผลงานของบัญชีนี้จะแสดงเมื่อมีคลิปที่บันทึกไว้</p></div>
        : <div className="customer-clip-list">{data.clips.map((clip) => <article className="customer-clip-card" key={clip.key}>
          <div className="customer-clip-thumbnail">{clip.videoUrl ? <video src={clip.videoUrl} poster={clip.thumbnail ?? undefined} controls preload="none" aria-label={`วิดีโอ ${clip.title}`} />
            : clip.thumbnail ? <Image src={clip.thumbnail} alt={clip.product ?? clip.title} width={90} height={120} unoptimized />
            : <span aria-label="ยังไม่มีภาพตัวอย่าง">▶</span>}</div>
          <div className="customer-clip-info"><CustomerBadge label={clip.status} /><h3>{clip.title}</h3><p>{clip.product ?? "ยังไม่ได้ระบุสินค้า"}</p>
            {clip.caption ? <p className="customer-caption-preview">{clip.caption}</p> : null}
            {clip.hashtags?.length ? <p className="customer-hashtags">{clip.hashtags.map((tag) => tag.startsWith("#") ? tag : `#${tag}`).join(" ")}</p> : null}
            {clip.result ? <p className="customer-clip-result">{clip.result}</p> : null}
            <span className="customer-clip-time">{clip.postedAt ? `โพสต์แล้ว ${customerTime(clip.postedAt, true)}` : clip.scheduledAt ? `ตั้งเวลา ${customerTime(clip.scheduledAt, true)}` : "ยังไม่ได้กำหนดเวลาโพสต์"}</span></div>
          <dl className="customer-clip-metrics"><div><dt>ยอดดู</dt><dd>{metricText(clip.views)}</dd></div><div><dt>ยอดขาย</dt><dd>{metricText(clip.sales, "money", clip.currency)}</dd></div></dl>
          <div className="customer-clip-action">
            {clip.canRetry && clip.queueId ? <PostRetryControl accountId={account.id} queueId={clip.queueId} /> : null}
            {clip.reviewRequired && clip.reviewUrl ? <PostReviewControl reviewUrl={clip.reviewUrl} /> : clip.reviewRequired ? <span className="customer-form-note">คลิปนี้รอการตรวจสอบ</span> : null}
            {clip.downloadUrl ? <a className="customer-text-button" href={clip.downloadUrl} download>ดาวน์โหลดไปโพสต์</a> : null}
          </div>
        </article>)}</div>}
    </section>
    <section className="customer-account-card customer-detail-start"><AccountIdentity account={account} />
      <PostStartControls account={account} requestKey={requestKey} /></section>
  </div>;
}
