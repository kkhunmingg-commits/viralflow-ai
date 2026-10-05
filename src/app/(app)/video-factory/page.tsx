import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { createClient } from "@/lib/supabase/server";
import { listVideoFactory, videoFactorySpend } from "@/features/video/services";
import { customerVideoStatus } from "@/features/video/customer-presentation";
import { OPERATIONAL_PAGE_SIZE, parseOperationalPage } from "@/lib/pagination";

const money = (value: number | string) => new Intl.NumberFormat("th-TH", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(Number(value));
export default async function VideoFactoryPage({ searchParams }: { searchParams: Promise<{ page?: string; status?: string }> }) {
  const client = await createClient(), { data } = await client.auth.getUser();
  if (!data.user) redirect("/login");
  const query = await searchParams, page = parseOperationalPage(query.page);
  const [{ items: masters, hasMore, totalCount }, spend] = await Promise.all([listVideoFactory(client, data.user.id, page), videoFactorySpend(client, data.user.id)]);
  return <>
    <PageHeading eyebrow="วิดีโอของคุณ" title="Video Factory" description="คลิปสินค้าแนวตั้ง 8–10 วินาที พร้อมตรวจคุณภาพก่อนเผยแพร่" />
    {query.status === "pending" && <p className="panel" role="status">กำลังสร้างวิดีโอ กรุณากลับมาตรวจสถานะอีกครั้ง</p>}
    {query.status === "review" && <p className="panel" role="status">REVIEW_REQUIRED · วิดีโอนี้ต้องได้รับการตรวจสอบก่อนสร้างต่อ</p>}
    <section className="detail-summary-grid" aria-label="ค่าใช้จ่ายวิดีโอวันนี้">
      <article className="panel"><h2>ค่าใช้จ่ายวันนี้</h2><p>{money(spend.spent)}</p></article>
      <article className="panel"><h2>งบคงเหลือวันนี้</h2><p>{money(spend.remaining)}</p>{spend.held > 0 && <small>งบที่กันไว้สำหรับคลิปกำลังสร้าง {money(spend.held)}</small>}</article>
    </section>
    {masters.length ? <section className="video-factory-grid">{masters.map((master, index) => {
      const status = customerVideoStatus(master);
      return <Link className="panel video-master-card" href={`/video-factory/${master.id}`} key={master.id}>
        <div className="panel-heading"><div><span className="phase-chip">คลิปที่ {(page - 1) * OPERATIONAL_PAGE_SIZE + index + 1} จาก {totalCount}</span><h2>{master.product_title}</h2></div><span className="quality-badge">{status}</span></div>
        <p>{master.account_name} · {Number(master.duration_seconds).toFixed(0)} วินาที</p>
        <dl className="detail-list"><div><dt>สถานะ</dt><dd>{status}</dd></div><div><dt>ค่าใช้จ่ายประมาณการ</dt><dd>{money(master.estimated_cost_usd)}</dd></div></dl>
      </Link>;
    })}</section> : <section className="empty-state"><span>VF</span><h2>ยังไม่มีวิดีโอในหน้านี้</h2><p>เลือกแนวคิดและรูปสินค้าจริงใน Creative Studio เพื่อเริ่มสร้างคลิป</p><Link className="primary-action" href="/creative-studio">ไปที่ Creative Studio</Link></section>}
    <nav className="form-actions" aria-label="Video Factory pages">{page > 1 && <Link href={`/video-factory?page=${page - 1}`}>← ก่อนหน้า</Link>}{hasMore && <Link href={`/video-factory?page=${page + 1}`}>ถัดไป →</Link>}</nav>
  </>;
}

