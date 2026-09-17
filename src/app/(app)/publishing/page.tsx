import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { listPublishingQueue } from "@/features/publishing/services";
import { createClient } from "@/lib/supabase/server";

export default async function PublishingPage() {
  const client = await createClient();
  const { data } = await client.auth.getUser();
  if (!data.user) redirect("/login");
  const items = await listPublishingQueue(client, data.user.id);
  const count = (statuses: string[]) => items.filter(item => statuses.includes(item.status)).length;
  return <>
    <PageHeading eyebrow="TIKTOK CONTENT POSTING" title="Publishing Queue" description="ตรวจ consent, Phase 6C, publish cap และสถานะ TikTok โดยไม่มี silent publish" />
    <section className="stats-grid compact-stats">
      <article className="stat-card amber"><p>Needs review</p><strong>{count(["DRAFT", "REVIEW_REQUIRED"])}</strong><small>รอการยืนยันจากเจ้าของ</small></article>
      <article className="stat-card blue"><p>Active</p><strong>{count(["APPROVED", "QUEUED", "UPLOADING", "PROCESSING", "RETRYING"])}</strong><small>อยู่ใน scheduler หรือ provider</small></article>
      <article className="stat-card green"><p>Delivered / published</p><strong>{count(["DRAFT_DELIVERED", "PUBLISHED"])}</strong><small>แยก draft ออกจาก published</small></article>
      <article className="stat-card violet"><p>Overflow</p><strong>{count(["WAITING_FOR_SLOT"])}</strong><small>เลื่อนไป slot ถัดไป</small></article>
    </section>
    <section className="panel radar-section">
      <div className="panel-heading"><div><p className="eyebrow">PRIORITY ORDER</p><h2>{items.length} รายการ</h2></div></div>
      {items.length ? <div className="data-list">{items.map(item => <div key={item.id}>
        <strong>{item.account?.display_name ?? "TikTok account"} · {item.publish_mode}</strong>
        <span className={`status-badge ${["FAILED", "REJECTED"].includes(item.status) ? "blocked" : ["PUBLISHED", "DRAFT_DELIVERED"].includes(item.status) ? "ready" : "disconnected"}`}>{item.status}</span>
        <small>Video {item.video_kind} · priority {item.priority} · source {item.source_method}</small>
        <small>Schedule {item.scheduled_for ? new Date(item.scheduled_for).toLocaleString("th-TH") : "ยังไม่กำหนด"} · consent {item.consent_id ? "RECORDED" : "REQUIRED"}</small>
        <Link href={`/publishing/${item.id}`}>เปิดรายละเอียด →</Link>
      </div>)}</div> : <p className="muted">ยังไม่มีรายการ เลือกวิดีโอที่ผ่าน Quality Gate ใน Video Factory เพื่อเพิ่มเข้าคิว</p>}
    </section>
  </>;
}
