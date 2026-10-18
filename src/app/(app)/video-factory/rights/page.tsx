import Link from "next/link";
import {redirect} from "next/navigation";
import {PageHeading} from "@/components/page-heading";
import {createClient} from "@/lib/supabase/server";
import {listRightsWorkspace} from "@/features/video/media-rights-service";
import {addContentEvidenceAction,recordMediaRightsAction,reviewMediaRightsAction,revokeContentEvidenceAction,revokeMediaRightsAction} from "./actions";
const ORIGINS={OWNER_CREATED:"ฉันถ่าย/ทำเอง",COMMISSIONED:"จ้างคนถ่ายและได้สิทธิ์",MERCHANT_LICENSED:"ร้านค้า/แบรนด์อนุญาต",LICENSED_STOCK:"สต็อกที่ซื้อสิทธิ์",ORIGINAL_GRAPHIC:"กราฟิกที่ทำเอง"};
const ROLES={REAL_FOOTAGE:"คลิปสินค้าจริง",REAL_IMAGE:"ภาพสินค้าจริง",COMPARISON_FOOTAGE:"คลิปเปรียบเทียบ",ORIGINAL_GRAPHIC:"กราฟิก",LICENSED_STOCK:"สต็อก",MUSIC:"เพลง",VOICE:"เสียงพากย์"};
const BLOCKERS:Record<string,string>={NO_RIGHTS_RECORD:"ยังไม่บันทึกสิทธิ์",NOT_APPROVED:"รอตรวจ",REVOKED:"ถอนสิทธิ์แล้ว",EXPIRED:"หมดอายุ",COMMERCIAL_NOT_ALLOWED:"ห้ามใช้เชิงพาณิชย์",EDIT_NOT_ALLOWED:"ห้ามตัดต่อ",PLATFORM_OUT_OF_SCOPE:"ไม่ครอบคลุม TikTok"};
export default async function MediaRightsPage(){
  const client=await createClient(),{data}=await client.auth.getUser();if(!data.user)redirect("/login");
  const {items,evidence}=await listRightsWorkspace(client,data.user.id),products=[...new Map(items.filter(i=>i.product_id).map(i=>[String(i.product_id),i.productTitle])).entries()];
  return <><PageHeading eyebrow="RIGHTS & EVIDENCE" title="สิทธิ์สื่อและหลักฐาน" description="AI ใช้ได้เฉพาะสื่อที่บันทึกสิทธิ์และตรวจแล้ว และอ้างได้เฉพาะข้อเท็จจริงที่มีแหล่งที่มา การอัปโหลดไฟล์อย่างเดียวไม่ถือว่ามีสิทธิ์"/>
    <Link className="secondary-action" href="/video-factory">← Video Factory</Link>
    {items.length?<section className="video-factory-grid">{items.map(item=>{const r=item.rights,cleared=!item.blockers.length;return <article className="panel" key={item.id}>
      <div className="panel-heading"><div><span className="phase-chip">{item.asset_type}</span><h2>{item.productTitle||"ไม่ระบุสินค้า"}</h2></div><span className={`status-badge ${cleared?"ready":"blocked"}`}>{cleared?"ใช้ได้":item.blockers.map(b=>BLOCKERS[b]??b).join(" · ")}</span></div>
      <p className="manual-muted">{String(item.storage_path).split("/").pop()}</p>
      {r&&<dl className="detail-list"><div><dt>ที่มา</dt><dd>{ORIGINS[r.origin_source as keyof typeof ORIGINS]??r.origin_source}</dd></div><div><dt>ผู้ถือสิทธิ์</dt><dd>{r.rightsholder}</dd></div><div><dt>สัญญา/ใบอนุญาต</dt><dd>{r.license_type}</dd></div>
        <div><dt>หลักฐาน</dt><dd>{r.proof_sha256?`SHA-256 ${r.proof_sha256.slice(0,12)}…`:"ไม่มีไฟล์ (ทำเอง)"}</dd></div><div><dt>หมดอายุ</dt><dd>{r.expires_at?new Date(r.expires_at).toLocaleDateString("th-TH"):"ไม่มี"}</dd></div>
        <div><dt>บัญชีที่ใช้ได้</dt><dd>{r.account_scope?.length?`${r.account_scope.length} บัญชี`:"ทุกบัญชีของฉัน"}</dd></div></dl>}
      {r?.review_state==="PENDING"&&!r.revoked_at&&<form action={reviewMediaRightsAction} className="content-form"><input type="hidden" name="rightsId" value={r.id}/>
        <label className="manual-check content-wide"><input name="confirmed" type="checkbox" required/>ฉันเปิดดูสื่อแล้ว เป็นสินค้ารุ่นนี้จริง และสิทธิ์ตรงกับหลักฐาน</label>
        <button className="manual-secondary" name="decision" value="APPROVED">อนุมัติ</button><button className="manual-secondary" name="decision" value="REJECTED">ไม่อนุมัติ</button></form>}
      {r&&!r.revoked_at&&r.review_state!=="REJECTED"&&<details><summary>ถอนสิทธิ์</summary><form action={revokeMediaRightsAction} className="content-form"><input type="hidden" name="rightsId" value={r.id}/>
        <label>เหตุผล<input name="reason" required minLength={3} maxLength={500}/></label><p className="manual-muted">ถอนแล้วย้อนไม่ได้ คิวโพสต์ที่ยังไม่ส่งจะถูกยกเลิก และวิดีโอที่ใช้สื่อนี้จะถูกปฏิเสธ</p><button className="manual-secondary">ยืนยันถอนสิทธิ์</button></form></details>}
      {(!r||r.revoked_at||r.review_state==="REJECTED")&&<details><summary>บันทึกสิทธิ์</summary><form action={recordMediaRightsAction} className="content-form"><input type="hidden" name="mediaAssetId" value={item.id}/>
        <label>ที่มาของสื่อ<select name="originSource" required>{Object.entries(ORIGINS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
        <label>ใช้เป็น<select name="assetRole" required defaultValue={item.asset_type==="VIDEO"?"REAL_FOOTAGE":"REAL_IMAGE"}>{Object.entries(ROLES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
        <label>แหล่งที่มา/ลิงก์<input name="sourceReference" required maxLength={2000}/></label><label>ผู้ถือสิทธิ์<input name="rightsholder" required maxLength={300}/></label>
        <label>ประเภทสิทธิ์<input name="licenseType" required maxLength={300} placeholder="เช่น ถ่ายเอง, หนังสืออนุญาตจากแบรนด์"/></label>
        <label>ไฟล์หลักฐาน (PDF/ภาพ ไม่เกิน 900 KB)<input name="proof" type="file" accept="application/pdf,image/jpeg,image/png,image/webp"/></label>
        <label>หมดอายุ<input name="expiresAt" type="date"/></label>
        <label className="manual-check"><input name="allowsCommercial" type="checkbox"/>ใช้เชิงพาณิชย์ได้</label><label className="manual-check"><input name="allowsEdit" type="checkbox"/>ตัดต่อได้</label>
        <label className="manual-check"><input name="allowsPromotion" type="checkbox"/>ใช้โฆษณาได้</label><label className="manual-check"><input name="depictsProductOperation" type="checkbox"/>แสดงการใช้งานสินค้าจริง</label>
        <label className="manual-check"><input name="platformScope" value="TIKTOK" type="checkbox" defaultChecked/>TikTok</label>
        <p className="manual-muted content-wide">สื่อจากคนอื่นต้องแนบหลักฐานเสมอ ห้ามใช้คลิปที่ดาวน์โหลดหรือดัดแปลงจากคนอื่นโดยไม่ได้รับอนุญาต</p><button className="manual-secondary">บันทึก (รอตรวจ)</button></form></details>}
    </article>})}</section>:<section className="empty-state"><span>R</span><h2>ยังไม่มีสื่อสินค้าจริง</h2><p>เพิ่มภาพหรือคลิปสินค้าจริงก่อน แล้วกลับมาบันทึกสิทธิ์ที่นี่</p></section>}
    <section className="panel radar-section"><div className="panel-heading"><div><p className="eyebrow">VERIFIED FACTS</p><h2>ข้อเท็จจริงที่ AI อ้างได้</h2></div><span className="phase-chip">{evidence.length} รายการ</span></div>
      <ul>{evidence.map(e=><li key={String(e.id)}>{String(e.statement)} <small>({String(e.source)} · {String(e.source_reference)})</small><form action={revokeContentEvidenceAction}><input type="hidden" name="evidenceId" value={String(e.id)}/><button className="manual-secondary">ถอน</button></form></li>)}</ul>
      {products.length>0&&<form action={addContentEvidenceAction} className="content-form"><label>สินค้า<select name="productId" required>{products.map(([id,title])=><option key={id} value={id}>{title||id}</option>)}</select></label>
        <label className="content-wide">ข้อเท็จจริง (ตามที่แหล่งระบุ ห้ามเกินจริง)<input name="statement" required maxLength={500}/></label>
        <label>แหล่ง<select name="source" required><option value="PDP">หน้าสินค้า</option><option value="LABEL">ฉลาก</option><option value="OWNER_FOOTAGE">คลิปที่ฉันถ่าย</option><option value="AUTHORIZED_SOURCE">แหล่งที่ได้รับอนุญาต</option></select></label>
        <label>ลิงก์/อ้างอิง<input name="sourceReference" required maxLength={2000}/></label><label>บทบาท<select name="role"><option value="">ไม่ระบุ</option><option value="PROBLEM">ปัญหา</option><option value="SELLING_POINT">จุดขาย</option><option value="OBSERVATION">สิ่งที่เห็น</option></select></label>
        <label>วันที่ตรวจ<input name="capturedAt" type="date" required/></label><button className="manual-secondary">เพิ่มข้อเท็จจริง</button></form>}
    </section></>;
}
