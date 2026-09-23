import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { listOwnerOperations, ownerOperationsHealth } from "@/features/operations/services";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { parseOperationalPage } from "@/lib/pagination";
import { operatorAction } from "./actions";

const actionLabels = {
  ACKNOWLEDGE: "รับทราบ",
  RECHECK_STATUS: "ตรวจสถานะอีกครั้ง",
  MARK_CONFIRMED: "ยืนยันรหัสงานภายนอก",
  MARK_FAILED: "ยืนยันว่าล้มเหลว",
  RELEASE_SAFE_RESERVATION: "คืนงบเมื่อปลอดภัย",
  REQUEUE_SAFE_OPERATION: "จัดคิวใหม่เมื่อปลอดภัย",
  RESOLVE: "ปิดรายการ",
} as const;

export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/login");
  const page = parseOperationalPage((await searchParams).page);
  const [overview, health] = await Promise.all([
    listOwnerOperations(client, data.user.id, page),
    ownerOperationsHealth(createAdminClient(), data.user.id),
  ]);
  return <>
    <PageHeading eyebrow="OPERATIONS" title="Recovery & reconciliation" description="ตรวจงานค้างและผลลัพธ์ที่ไม่แน่นอนก่อนดำเนินการอย่างปลอดภัย" />
    <section className="stats-grid">
      {[["Scheduler", health.scheduler.healthy ? "Healthy" : health.scheduler.status], ["Stale jobs", health.stale_jobs], ["Reconciliation", health.reconciliation], ["Dead letter", health.dead_letter], ["Pending leases", health.pending_leases], ["Budget reservations", health.pending_budget_reservations]].map(([label, value]) =>
        <article className="stat-card violet" key={label}><p>{label}</p><strong>{value}</strong></article>)}
    </section>
    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">ACTIVE ALERTS</p><h2>สัญญาณที่ต้องติดตาม</h2></div></div>
      {!health.scheduler.healthy && <div className="data-list"><div><strong>SCHEDULER_NOT_RUNNING</strong><span>CRITICAL</span><small>รอบตรวจล่าสุด: {health.scheduler.status} · ต้องตรวจการตั้ง schedule และ token ฝั่งเซิร์ฟเวอร์</small></div></div>}
      {overview.alerts.length ? <div className="data-list">{overview.alerts.map(alert => <div key={alert.id}><strong>{alert.rule_code}</strong><span>{alert.severity}</span><small>พบล่าสุด {new Date(alert.last_seen_at).toLocaleString("th-TH")} · {alert.occurrence_count} ครั้ง</small></div>)}</div> : health.scheduler.healthy && <p className="muted">ไม่มีสัญญาณเตือนที่เปิดอยู่</p>}
    </section>
    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">RECOVERY QUEUE</p><h2>รายการสำหรับผู้ดูแล</h2></div></div>
      {overview.incidents.length ? <div className="data-list">{overview.incidents.map(item => <article key={item.id}>
        <strong>{item.subject_type} · {item.classification}</strong><span>{item.lifecycle}</span>
        <small>บัญชี: {item.account_name} · Provider: {item.provider ?? "—"} · เริ่ม {new Date(item.first_seen_at).toLocaleString("th-TH")} · Provider attempt ล่าสุด {item.last_publish_attempt ? `${new Date(item.last_publish_attempt.started_at).toLocaleString("th-TH")} (${item.last_publish_attempt.status})` : "ยังไม่มี"}</small>
        <small>เหตุผล: {item.reason_code} · คำแนะนำ: {item.recommended_action} · External ID: {item.provider_operation_id ?? "—"}</small>
        <small>Operation ID: {item.subject_id} · Budget: {item.subject_type === "BUDGET" ? item.reason_code : "ดูรายละเอียดใน Video Factory"}</small>
        {item.lifecycle !== "RESOLVED" && <form action={operatorAction} className="form-grid">
          <input type="hidden" name="incidentId" value={item.id}/><input type="hidden" name="idempotencyKey" value={randomUUID()}/>
          <label>หลักฐานหรือบันทึกการตรวจ<input name="evidence" maxLength={240} placeholder="ใช้เมื่อยืนยันผล ปล่อยงบ หรือปิดรายการ"/></label>
          {item.subject_type === "PUBLISH" && item.classification === "RECONCILIATION_REQUIRED" && <label>รหัสงานภายนอก<input name="externalId" maxLength={64} placeholder="รหัสที่ตรวจสอบกับผู้ให้บริการแล้ว"/></label>}
          <select name="action" defaultValue={item.recommended_action} aria-label="การดำเนินการ">
            {Object.entries(actionLabels).filter(([action]) => action === "ACKNOWLEDGE" ||
              (action === "RESOLVE" && item.classification === "FINAL_FAILURE") ||
              (action === "RECHECK_STATUS" && item.subject_type === "PUBLISH" && item.provider_operation_id) ||
              (action === "MARK_CONFIRMED" && item.subject_type === "PUBLISH" && item.classification === "RECONCILIATION_REQUIRED") ||
              (action === "MARK_FAILED" && item.subject_type === "PUBLISH" && item.classification === "RECONCILIATION_REQUIRED") ||
              (action === "RELEASE_SAFE_RESERVATION" && item.subject_type === "BUDGET" && item.classification === "AUTO_RECOVERABLE") ||
              (action === "REQUEUE_SAFE_OPERATION" && item.subject_type === "PUBLISH" && item.classification === "AUTO_RECOVERABLE")
            ).map(([action, label]) => <option key={action} value={action}>{label}</option>)}
          </select>
          <button type="submit" className="button">ดำเนินการ</button>
        </form>}
      </article>)}</div> : <p className="muted">ยังไม่มีรายการค้างที่พบจากรอบตรวจล่าสุด</p>}
      <nav className="form-actions" aria-label="Operations pages">{page > 1 && <Link href={`/operations?page=${page - 1}`}>← ก่อนหน้า</Link>}{overview.hasMore && <Link href={`/operations?page=${page + 1}`}>ถัดไป →</Link>}</nav>
    </section>
  </>;
}
