"use client";
import { useState, useTransition } from "react";
import { createProductClipAction, previewLinkAction, startProductClipAction, type PreviewResult } from "./actions";

interface Account { id: string; name: string }
const LENGTHS = [
  { value: 8, label: "8 วิ", note: "1 ช็อต · ใช้เครดิต 1 คลิป" },
  { value: 16, label: "16 วิ", note: "2 ช็อต: เปิด → ปิดท้าย+ลิงก์" },
  { value: 32, label: "32 วิ", note: "4 ช็อต: เปิด → ซูม → มุมใช้งาน → ปิดท้าย" },
];

/** Photos from the computer are shrunk to ≤1080 px JPEG in the browser, so a few of them fit in one request. */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1080 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.88));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch { return file; }
}

/** The usual way: paste the link, pick the length, press once. Everything else (photos, details, script) is found automatically. */
export function ProductLinkForm({ accounts, initialAccount }: { accounts: Account[]; initialAccount: string }) {
  const [sending, setSending] = useState(false);
  return <div className="pl-form">
    <form action={async form => { setSending(true); try { await startProductClipAction(form); } finally { setSending(false); } }} className="pl-details pl-quick">
      <label className="manual-filter pl-link">ลิงก์สินค้า Shopee / Lazada (ลิงก์ affiliate ได้เลย)
        <input name="link" required placeholder="https://s.shopee.co.th/…" inputMode="url" maxLength={1500} autoComplete="off" /></label>
      <fieldset className="pl-lengths"><legend>ความยาวคลิป</legend>
        {LENGTHS.map(l => <label key={l.value} className="pl-length"><input type="radio" name="lengthSeconds" value={l.value} defaultChecked={l.value === 16} />
          <strong>{l.label}</strong><small>{l.note}</small></label>)}
      </fieldset>
      {accounts.length > 1 ? <label className="manual-filter">ใช้บัญชี Google Flow ของช่อง<select name="tiktokAccountId" defaultValue={initialAccount}>
        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        : <input type="hidden" name="tiktokAccountId" value={initialAccount} />}
      <label className="manual-check"><input type="checkbox" name="rights" defaultChecked required />ฉันเป็นนายหน้า (affiliate) ของสินค้านี้ ใช้รูปและข้อมูลจากหน้าร้านได้</label>
      <button className="manual-primary" type="submit" disabled={sending}>{sending ? "กำลังอ่านลิงก์…" : "ทำคลิปเลย"}</button>
      <p className="manual-muted">ระบบดึงชื่อ รูป และรายละเอียดจากหน้าสินค้าเอง (ถ้าร้านไม่ให้เซิร์ฟเวอร์อ่าน เครื่องสร้างคลิปในคอมจะเปิดหน้าสินค้าแทน) เลือกรูป 4 รูปแรกของร้าน
        เขียนสคริปต์เฉพาะสิ่งที่หน้าร้านบอก ตัดคำเกินจริง/ราคา/สรรพคุณออก แล้วสร้างคลิปต่อเลย คุณแค่ตรวจคลิปก่อนโพสต์</p>
    </form>
    <details className="pl-manual"><summary>อยากเลือกรูปหรือแก้ข้อมูลเองก่อนสร้าง</summary><ManualProductForm accounts={accounts} initialAccount={initialAccount} /></details>
  </div>;
}

/** The hand-checked way (pick photos, edit the facts) for owners who want control. */
function ManualProductForm({ accounts, initialAccount }: { accounts: Account[]; initialAccount: string }) {
  const [link, setLink] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [reading, startReading] = useTransition();
  const [sending, setSending] = useState(false);

  function read() {
    startReading(async () => { setPreview(await previewLinkAction(link)); });
  }
  async function submit(form: FormData) {
    setSending(true);
    try {
      const files = form.getAll("upload").filter((f): f is File => f instanceof File && f.size > 0);
      form.delete("upload");
      for (const file of files.slice(0, 4)) form.append("upload", await shrink(file));
      await createProductClipAction(form);
    } finally { setSending(false); }
  }

  const details = preview?.ok ? preview.details : null;
  return <div className="pl-form">
    <div className="pl-link-row">
      <label className="manual-filter pl-link">ลิงก์สินค้า Shopee / Lazada (ลิงก์ affiliate ได้เลย)
        <input value={link} onChange={e => { setLink(e.target.value); setPreview(null); }} placeholder="https://s.shopee.co.th/…" inputMode="url" maxLength={1500} /></label>
      <button className="manual-primary" type="button" onClick={read} disabled={reading || link.trim().length < 8}>{reading ? "กำลังอ่านลิงก์…" : "ดึงข้อมูลสินค้า"}</button>
    </div>
    {preview && !preview.ok && <p className="manual-warning" role="alert">{preview.message}</p>}

    {details && <form action={submit} className="pl-details">
      <input type="hidden" name="link" value={details.link} />
      <input type="hidden" name="productUrl" value={details.productUrl ?? ""} />
      <input type="hidden" name="externalId" value={details.externalId ?? ""} />
      <p className={details.readError ? "manual-warning" : "manual-muted"}>
        {details.platform === "SHOPEE" ? "Shopee" : "Lazada"} · {details.readError
          ? "ร้านค้าไม่ให้เซิร์ฟเวอร์อ่านหน้าสินค้า (ปกติของ Shopee/Lazada) ก๊อปชื่อสินค้าและรายละเอียดจากแอปมาวาง แล้วอัปโหลดรูปสินค้า 1–4 รูป"
          : details.missing.length ? "ดึงข้อมูลได้บางส่วน ตรวจและเติมให้ครบ" : "ดึงข้อมูลได้แล้ว ตรวจให้ตรงกับหน้าสินค้าก่อนกดสร้าง"}
      </p>

      <label className="manual-filter">ชื่อสินค้า (ตามหน้าร้าน)<input name="title" required minLength={2} maxLength={300} defaultValue={details.title} /></label>
      <label className="manual-filter">ข้อมูลสินค้าที่ใช้ในคลิป (1 บรรทัด = 1 ข้อ เอาเฉพาะที่หน้าร้านเขียนไว้จริง)
        <textarea name="facts" rows={5} maxLength={4000} defaultValue={preview?.ok ? preview.facts.join("\n") : ""}
          placeholder={"เช่น\nความจุ 500 ml\nวัสดุสแตนเลส 304\nมี 3 สี"} /></label>
      <p className="manual-muted">ระบบจะตัดเองถ้าเจอคำเกินจริง (ดีที่สุด, อันดับ 1, 100%, ขายดี), ราคา/โปร หรือการอ้างสรรพคุณ/ผลลัพธ์ ราคาให้คนดูที่ลิงก์เสมอ เพราะเปลี่ยนได้</p>

      <fieldset className="pl-images"><legend>รูปสินค้าที่ใช้เป็นต้นแบบ (สูงสุด 4 รูป แต่ละช็อตใช้คนละรูปเพื่อให้เห็นหลายมุม)</legend>
        {details.images.length > 0 && <div className="pl-image-grid">{details.images.map((src, i) => <label key={src} className="pl-image">
          <input type="checkbox" name="imageUrl" value={src} defaultChecked={i < 4} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={`รูปสินค้า ${i + 1}`} loading="lazy" referrerPolicy="no-referrer" />
        </label>)}</div>}
        <label className="manual-filter">อัปโหลดรูปจากเครื่อง (JPG/PNG/WebP){details.images.length ? " ถ้าอยากเพิ่ม" : ""}
          <input name="upload" type="file" accept="image/jpeg,image/png,image/webp" multiple /></label>
        <p className="manual-muted">เลือกรูปตัวสินค้าชัด ๆ พื้นหลังเรียบ หลีกเลี่ยงรูปที่มีตัวหนังสือโฆษณาหรือราคาบนรูป (AI จะลอกตัวหนังสือมา)</p>
      </fieldset>

      <fieldset className="pl-lengths"><legend>ความยาวคลิป</legend>
        {LENGTHS.map(l => <label key={l.value} className="pl-length"><input type="radio" name="lengthSeconds" value={l.value} defaultChecked={l.value === 16} />
          <strong>{l.label}</strong><small>{l.note}</small></label>)}
      </fieldset>

      {accounts.length > 1 ? <label className="manual-filter">ใช้บัญชี Google Flow ของช่อง<select name="tiktokAccountId" defaultValue={initialAccount}>
        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        : <input type="hidden" name="tiktokAccountId" value={initialAccount} />}

      <label className="manual-check"><input type="checkbox" name="rights" required />ฉันเป็นนายหน้า (affiliate) ของสินค้านี้ รูปมาจากหน้าร้านหรือถ่ายเอง และข้อมูลตรงกับหน้าสินค้า</label>
      <button className="manual-primary" type="submit" disabled={sending}>{sending ? "กำลังเข้าคิว…" : "เขียนสคริปต์ + สร้างคลิป"}</button>
    </form>}
  </div>;
}
