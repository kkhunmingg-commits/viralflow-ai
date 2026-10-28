import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { getFinanceLedger } from "@/features/analytics/finance-service";
import { createClient } from "@/lib/supabase/server";

const n = (v: number) => v.toLocaleString("th-TH", { maximumFractionDigits: 2 });

export default async function FinancePage() {
  const client = await createClient(); const { data } = await client.auth.getUser(); if (!data.user) redirect("/login");
  const ledger = await getFinanceLedger(client, data.user.id);
  const total = ledger.video.settledCommission + ledger.live.settledCommission + ledger.other.settledCommission;
  const lines = [["คลิป (VIDEO)", ledger.video], ["ไลฟ์ (LIVE)", ledger.live], ["ไม่ระบุช่องทาง", ledger.other]] as const;
  return <>
    <PageHeading eyebrow="รายได้" title="รายได้จากคลิปและไลฟ์" description="คำนวณจากรายงานออเดอร์ Affiliate ที่นำเข้าเท่านั้น ไม่รวมข้อมูลจำลอง และนับแต่ละออเดอร์ครั้งเดียว" action={<Link className="primary-action" href="/analytics/import">นำเข้ารายงาน TikTok</Link>} />
    <section className="stats-grid dashboard-stats" aria-label="สรุปตามช่องทาง"><article className="stat-card green"><p>ค่าคอมได้รับจริงทั้งหมด</p><strong>{n(total)} ฿</strong><small>รวมคลิป ไลฟ์ และที่ไม่ระบุช่องทาง</small></article>{lines.map(([label, l]) => <article className="stat-card blue" key={label}><p>{label}</p><strong>{n(l.settledCommission)} ฿</strong><small>ค่าคอมได้รับจริง · ประมาณการ {n(l.estimatedCommission)} ฿ · GMV {n(l.gmv)} ฿ · {l.orders} ออเดอร์ · ยกเลิก {l.cancelled}</small></article>)}</section>
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">PER CLIP</p><h2>รายได้รายคลิป</h2></div></div>
      {ledger.clips.length ? <div className="radar-table-wrap"><table className="radar-table"><thead><tr><th>คลิป</th><th>ออเดอร์</th><th>ยกเลิก</th><th>GMV</th><th>ค่าคอมประมาณการ</th><th>ค่าคอมได้รับ</th></tr></thead><tbody>
        {ledger.clips.map(c => <tr key={`${c.accountId}:${c.videoId}`}><td>{c.videoId}</td><td>{c.orders}</td><td>{c.cancelled}</td><td>{n(c.gmv)}</td><td>{n(c.estimatedCommission)}</td><td>{n(c.settledCommission)}</td></tr>)}
      </tbody></table></div> : <p className="muted">ยังไม่มีออเดอร์จากคลิปที่ระบุรหัสวิดีโอ ดาวน์โหลดรายงานออเดอร์ Affiliate จาก TikTok Shop แล้วกด “นำเข้ารายงาน TikTok” ด้านบน</p>}
      {ledger.videoWithoutClipId.orders > 0 && <p className="muted">มี {ledger.videoWithoutClipId.orders} ออเดอร์จากคลิปที่รายงานไม่ได้ระบุรหัสวิดีโอ นับรวมในยอดคลิปแต่ไม่แยกรายคลิป</p>}
    </section>
  </>;
}
