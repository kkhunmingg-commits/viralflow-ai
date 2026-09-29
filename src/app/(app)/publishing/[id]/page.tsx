import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getPublishingDetail } from "@/features/publishing/services";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/server-env";
import { cancelPublishAction, consentPublishAction, fetchPublishStatusAction, preparePublishAction,
  retryPublishAction, schedulePublishAction, sendPublishAction } from "../actions";
import "../publishing.css";

function statusLabel(status: string) {
  if (status === "PUBLISHED") return "โพสต์สำเร็จ";
  if (status === "REVIEW_REQUIRED") return "รอคุณตรวจและยืนยัน";
  if (["FAILED", "REJECTED"].includes(status)) return "โพสต์ไม่สำเร็จ";
  if (status === "CANCELLED") return "ยกเลิกแล้ว";
  return "กำลังดำเนินการ";
}
function privacyLabel(value: string) {
  return value === "SELF_ONLY" ? "เฉพาะฉัน" : value === "MUTUAL_FOLLOW_FRIENDS" ? "เพื่อน" : value === "FOLLOWER_OF_CREATOR" ? "ผู้ติดตาม" : value === "PUBLIC_TO_EVERYONE" ? "สาธารณะ" : value;
}

export default async function PublishingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await createClient();
  const { data } = await client.auth.getUser();
  if (!data.user) redirect("/login");
  let detail; try { detail = await getPublishingDetail(client, data.user.id, id); } catch { return notFound(); }
  const { queue, account } = detail;
  const canCancel = !["UPLOADING", "PROCESSING", "DRAFT_DELIVERED", "PUBLISHED", "CANCELLED"].includes(queue.status);
  const postingEnabled = serverEnv.tiktokPublishingProvider === "official" && serverEnv.tiktokPublishingRealMode;
  return <div className="customer-publishing">
    <header><Link href="/publishing">← กลับรายการวิดีโอ</Link><h1>ตรวจวิดีโอก่อนโพสต์</h1>
      <p>{account.display_name} · {statusLabel(queue.status)}</p></header>
    <section className="customer-publishing-panel">
      <h2>{statusLabel(queue.status)}</h2>
      {!postingEnabled && <p className="customer-publishing-note">การโพสต์ยังไม่เปิดใช้งานในขณะนี้</p>}
      {queue.status === "REVIEW_REQUIRED" && !queue.eligibility_check_id && <form action={preparePublishAction.bind(null, id)}>
        <button type="submit" className="secondary-action">ตรวจความพร้อมอีกครั้ง</button></form>}
      {queue.status === "REVIEW_REQUIRED" && <form className="customer-publishing-form" action={consentPublishAction.bind(null, id)}>
        <label>คำบรรยาย<textarea name="caption" maxLength={2200} defaultValue={queue.caption_snapshot} /></label>
        <label>ใครดูวิดีโอนี้ได้<select name="privacy_level" defaultValue={queue.privacy_level ?? "SELF_ONLY"}>
          {(account.privacy_level_options as string[]).map((option) => <option key={option} value={option}>{privacyLabel(option)}</option>)}
        </select></label>
        <div className="customer-publishing-options">
          <label><input name="allow_comment" type="checkbox" defaultChecked={!account.comment_disabled} /> อนุญาตความคิดเห็น</label>
          <label><input name="allow_duet" type="checkbox" defaultChecked={!account.duet_disabled} /> อนุญาต Duet</label>
          <label><input name="allow_stitch" type="checkbox" defaultChecked={!account.stitch_disabled} /> อนุญาต Stitch</label>
          <label><input name="is_aigc" type="checkbox" defaultChecked={queue.is_aigc} /> ระบุว่าเนื้อหาสร้างด้วย AI</label>
          <label><input name="brand_organic_toggle" type="checkbox" /> โปรโมตแบรนด์ของฉัน</label>
          <label><input name="brand_content_toggle" type="checkbox" /> มีเนื้อหาที่ได้รับการสนับสนุน</label>
        </div>
        <button className="primary-action" type="submit">ยืนยันการเผยแพร่</button>
      </form>}
      <div className="customer-publishing-actions">
        {queue.publish_mode === "DIRECT_POST" && ["APPROVED", "QUEUED", "RETRYING"].includes(queue.status) && postingEnabled
          && <form action={sendPublishAction.bind(null, id, "DIRECT_POST")}><button className="primary-action">โพสต์วิดีโอ</button></form>}
        {queue.status === "APPROVED" && <form action={schedulePublishAction.bind(null, id)} className="customer-publishing-form">
          <label>กำหนดเวลาโพสต์<input name="scheduled_for" type="datetime-local" required /></label><button className="secondary-action">บันทึกเวลา</button></form>}
        {queue.provider_publish_id && ["PROCESSING", "UPLOADING"].includes(queue.status) && <form action={fetchPublishStatusAction.bind(null, id)}><button className="secondary-action">ตรวจสถานะอีกครั้ง</button></form>}
        {queue.publish_mode === "DIRECT_POST" && ["FAILED", "RETRYING"].includes(queue.status) && queue.retry_count < queue.max_retries && postingEnabled
          && <form action={retryPublishAction.bind(null, id)}><button className="secondary-action">ลองอีกครั้ง</button></form>}
        {canCancel && <form action={cancelPublishAction.bind(null, id)}><button className="danger-action">ยกเลิก</button></form>}
      </div>
    </section>
  </div>;
}
