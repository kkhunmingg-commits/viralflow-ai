import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { createClient } from "@/lib/supabase/server";
import { getVideoDetail } from "@/features/video/services";
import { customerVideoStatus } from "@/features/video/customer-presentation";
import { getLatestVideoGate } from "@/features/compliance/services";
import { cancelVideoGenerationAction, createVariationsAction, renderVariationAction, retryMasterAction, setVideoStatusAction, uploadVideoSourceAction } from "../actions";
import { queueVideoAction } from "../../publishing/actions";
const money = (value: number | string) => new Intl.NumberFormat("th-TH", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(Number(value));
export default async function VideoDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ asset?: string }> }) {
  const { id } = await params, client = await createClient(), { data } = await client.auth.getUser();
  if (!data.user) redirect("/login");
  let detail;
  try { detail = await getVideoDetail(client, data.user.id, id); } catch { return notFound(); }
  const { master, product, account, variations, jobs, costs, signedUrl } = detail;
  const gate = await getLatestVideoGate(client, data.user.id, id), status = customerVideoStatus(master);
  const query = await searchParams;
  const spent = costs.reduce((sum, cost) => sum + Number(cost.total_cost_usd), 0), passing = master.quality_status === "PASS";
  const generating = ["QUEUED", "PROCESSING", "RETRYING"].includes(String(jobs[0]?.status));
  const gateLabel = gate.eligibility?.final_status === "READY_TO_PUBLISH" ? "พร้อมเผยแพร่" : gate.eligibility?.final_status === "READY_FOR_REVIEW" ? "พร้อมส่งตรวจ" : "ต้องตรวจสอบก่อนเผยแพร่";
  return <>
    <PageHeading eyebrow="วิดีโอของคุณ" title={String(product?.title ?? "Video")} description={`${account?.display_name ?? "Account"} · ${status}`} action={<Link className="secondary-action" href="/video-factory">← Video Factory</Link>} />
    <section className="video-detail-grid">
      <article className="panel video-preview-panel">{signedUrl ? <video controls playsInline src={signedUrl} /> : <div className="video-placeholder">{status}</div>}
        <div className="form-actions">
          <form action={setVideoStatusAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="masterId" value={id} /><input type="hidden" name="kind" value="master" /><input type="hidden" name="status" value="APPROVED" /><button className="primary-action" disabled={!passing}>อนุมัติ</button></form>
          <form action={setVideoStatusAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="masterId" value={id} /><input type="hidden" name="kind" value="master" /><input type="hidden" name="status" value="REJECTED" /><button className="danger-action">ไม่อนุมัติ</button></form>
          {status === "REVIEW_REQUIRED" && <form action={retryMasterAction}><input type="hidden" name="masterId" value={id} /><input type="hidden" name="projectId" value={String(master.creative_project_id)} /><button className="secondary-action">ตรวจสอบอีกครั้ง</button></form>}
          {generating && <form action={cancelVideoGenerationAction}><input type="hidden" name="masterId" value={id} /><button className="danger-action">ยกเลิกการสร้าง</button></form>}
          <form action={queueVideoAction}><input type="hidden" name="account_id" value={String(master.tiktok_account_id)} /><input type="hidden" name="video_id" value={id} /><input type="hidden" name="video_kind" value="MASTER" /><button className="secondary-action" disabled={!passing}>เพิ่มเข้าคิวเผยแพร่</button></form>
        </div>
      </article>
      <article className="panel"><h2>สถานะและค่าใช้จ่าย</h2><dl className="detail-list">
        <div><dt>สถานะ</dt><dd>{status}</dd></div><div><dt>ความยาวคลิป</dt><dd>{Number(master.duration_seconds).toFixed(0)} วินาที</dd></div>
        <div><dt>ค่าใช้จ่ายประมาณการ</dt><dd>{money(Number(master.estimated_cost_usd))}</dd></div><div><dt>ค่าใช้จ่ายที่บันทึกไว้</dt><dd>{money(spent)}</dd></div>
      </dl>{status === "REVIEW_REQUIRED" && <p>คลิปนี้ต้องได้รับการตรวจสอบก่อนใช้งาน ระบบหยุดสร้างเพิ่มเติมแล้ว</p>}</article>
    </section>
    {!passing && !generating && <section className="panel radar-section">
      <h2>รูปสินค้าและเสียงบรรยาย</h2>
      <p>แนบไฟล์จริงสำหรับคลิปนี้ แล้วกดตรวจสอบอีกครั้ง จำกัดไฟล์ละ 750 KB</p>
      {query.asset === "ready" && <p role="status">บันทึกไฟล์แล้ว</p>}
      {query.asset === "error" && <p role="alert">แนบไฟล์ไม่สำเร็จ กรุณาตรวจชนิดไฟล์และขนาด แล้วลองอีกครั้ง</p>}
      <div className="detail-summary-grid">
        <form action={uploadVideoSourceAction} className="grid min-w-0 gap-3">
          <input type="hidden" name="masterId" value={id} /><input type="hidden" name="kind" value="PRODUCT_IMAGE" />
          <label htmlFor="product-photo">รูปสินค้า</label>
          <input className="min-w-0 w-full max-w-full" id="product-photo" name="file" type="file" accept="image/jpeg,image/png,image/webp" required />
          <button className="secondary-action">บันทึกรูปสินค้า</button>
        </form>
        <form action={uploadVideoSourceAction} className="grid min-w-0 gap-3">
          <input type="hidden" name="masterId" value={id} /><input type="hidden" name="kind" value="VOICE" />
          <label htmlFor="narration-audio">เสียงบรรยาย</label>
          <input className="min-w-0 w-full max-w-full" id="narration-audio" name="file" type="file" accept="audio/wav,audio/x-wav,audio/mpeg,audio/mp4,audio/ogg" required />
          <button className="secondary-action">บันทึกเสียงบรรยาย</button>
        </form>
      </div>
    </section>}
    <section className="panel radar-section"><div className="panel-heading"><h2>{gateLabel}</h2><Link href="/compliance">เปิดการตรวจสอบเนื้อหา →</Link></div><p>ตรวจสอบคุณภาพและอนุมัติก่อนส่งวิดีโอเข้าคิวเผยแพร่</p></section>
    <section className="panel radar-section"><div className="panel-heading"><h2>คลิปเพิ่มเติม</h2><form action={createVariationsAction}><input type="hidden" name="masterId" value={id} /><button className="primary-action" disabled={!passing}>สร้างคลิปเพิ่มเติม</button></form></div>
      <div className="variation-list">{variations.map((variation, index) => <article className="variation-row" key={variation.id}>
        <div><span className="phase-chip">คลิปที่ {index + 1} จาก {variations.length}</span><h3>{variation.hook_variant}</h3><p>{variation.cta_variant}</p><small>{customerVideoStatus(variation)} · {money(variation.estimated_cost_usd)}</small></div>
        {variation.signed_url ? <video controls playsInline src={variation.signed_url} /> : <div className="variation-placeholder">{customerVideoStatus(variation)}</div>}
        <div className="video-actions">
          {["QUEUED", "FAILED"].includes(variation.status) && <form action={renderVariationAction}><input type="hidden" name="masterId" value={id} /><input type="hidden" name="variationId" value={variation.id} /><button className="secondary-action">สร้างคลิป</button></form>}
          <form action={setVideoStatusAction}><input type="hidden" name="id" value={variation.id} /><input type="hidden" name="masterId" value={id} /><input type="hidden" name="kind" value="variation" /><input type="hidden" name="status" value="APPROVED" /><button className="primary-action" disabled={variation.quality_status !== "PASS"}>อนุมัติ</button></form>
          <form action={setVideoStatusAction}><input type="hidden" name="id" value={variation.id} /><input type="hidden" name="masterId" value={id} /><input type="hidden" name="kind" value="variation" /><input type="hidden" name="status" value="REJECTED" /><button className="danger-action">ไม่อนุมัติ</button></form>
          <form action={queueVideoAction}><input type="hidden" name="account_id" value={String(variation.tiktok_account_id)} /><input type="hidden" name="video_id" value={variation.id} /><input type="hidden" name="video_kind" value="VARIATION" /><button className="secondary-action" disabled={variation.quality_status !== "PASS"}>เพิ่มเข้าคิวเผยแพร่</button></form>
        </div>
      </article>)}</div>
    </section>
  </>;
}
