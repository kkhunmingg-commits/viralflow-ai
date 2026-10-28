import { LIVE_POLICY, liveRunOfShow, type LiveCandidate, type LiveLineup } from "@/features/ai-live/live-director";

const time = (iso: string) => new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });

/** Which best-sellers go live now, the pin order for the next 4 hours, and what TikTok does not let the app do. */
export function LivePlan({ lineup, candidates, blockStart }: { lineup: LiveLineup; candidates: LiveCandidate[]; blockStart: Date }) {
  const byId = new Map(candidates.map(c => [c.productId, c]));
  const show = liveRunOfShow(lineup, blockStart);
  const next = new Date(blockStart.getTime() + LIVE_POLICY.refreshHours * 3600000);
  return <section className="panel" aria-label="แผนไลฟ์">
    <div className="panel-heading"><div><p className="eyebrow">LIVE LINEUP</p><h2>สินค้าที่จะไลฟ์ตอนนี้</h2></div><span className="phase-chip">เลือกใหม่ {time(next.toISOString())}</span></div>
    {lineup.reason === "WAIT_FOR_DATA"
      ? <p className="muted">ยังมีสินค้าที่ขายได้จริงจากคลิป (พร้อมข้อมูลสินค้าที่ยืนยันแล้ว) ไม่ถึง {LIVE_POLICY.minProducts} ตัวใน {LIVE_POLICY.salesWindowDays} วันล่าสุด นำเข้ารายงานออเดอร์ Affiliate ก่อน ระบบจะเลือกให้เอง</p>
      : <>
        <div className="data-list">{lineup.productIds.map((id, i) => { const c = byId.get(id)!; return <div key={id}><strong>{i + 1}. {c.title}</strong><span>{c.videoOrders} ออเดอร์จากคลิป · ค่าคอมได้รับ {c.settledCommission.toLocaleString("th-TH")} บาท</span><small>ข้อมูลที่ยืนยันแล้ว {c.facts.length} ข้อ ใช้ตอบแชท</small></div>; })}</div>
        <h3>ลำดับปักตะกร้า (ทุก {LIVE_POLICY.segmentMinutes} นาที)</h3>
        <div className="data-list">{show.slice(0, 8).map(s => <div key={s.startsAt}><strong>{time(s.pinAt)}</strong><span>{byId.get(s.productId)?.title}</span></div>)}</div>
      </>}
    <h3>สิ่งที่ TikTok ยังไม่เปิดให้แอปทำเอง</h3>
    <ul className="muted">
      <li>ไลฟ์ตรงเข้า TikTok: ไม่ใช้ OBS และไม่ใช้ Stream key ระบบรอ TikTok อนุมัติสิทธิ์ LIVE API ให้แอปก่อน เมื่ออนุมัติแล้วจะต่อจากเครื่องไลฟ์เข้า TikTok โดยตรง</li>
      <li>อ่านคอมเมนต์ในไลฟ์: ไม่มี API ทางการสำหรับแอปภายนอก ต้องมีแหล่งคอมเมนต์ที่ได้รับอนุญาตก่อน ระบบตอบแชทจึงพร้อมใช้เมื่อมีคอมเมนต์เข้ามา</li>
      <li>ปักตะกร้าอัตโนมัติ: ไม่มี API สาธารณะ ระบบให้ลำดับและเวลาปักด้านบน ปักใน LIVE Producer หรือแอป TikTok</li>
    </ul>
  </section>;
}
