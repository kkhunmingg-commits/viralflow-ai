"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { localPostPackage, MAX_EXPORT_BYTES, postCaption } from "@/features/manual-post/package";

export function LocalPreparation({ accounts }: { accounts: { name: string }[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [caption, setCaption] = useState(""), [hashtags, setHashtags] = useState("");
  const [accountName, setAccountName] = useState(accounts[0]?.name ?? "");
  const [reviewed, setReviewed] = useState(false), [rights, setRights] = useState(false), [aiGenerated, setAiGenerated] = useState(false);
  const [playable, setPlayable] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  function choose(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    setReviewed(false); setRights(false); setPlayable(false); setMessage(""); setPreview("");
    if (next && (next.type !== "video/mp4" || next.size > MAX_EXPORT_BYTES || next.size < 1000)) {
      setFile(null); event.target.value = ""; setMessage("เลือกไฟล์ MP4 ขนาดไม่เกิน 50 MB"); return;
    }
    setFile(next);
    if (next) setPreview(URL.createObjectURL(next));
  }
  async function download() {
    if (!file || !playable || busy) return;
    setBusy(true); setMessage("");
    try {
      const zip = localPostPackage({ bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type, caption,
        hashtags: hashtags.split(/\s+/), reviewed, rightsConfirmed: rights, accountName, aiGenerated });
      const url = URL.createObjectURL(new Blob([new Uint8Array(zip)], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = url; link.download = "viralflow-ready-to-post.zip"; link.click();
      // Give the browser time to start the download; always release its URL.
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMessage("เตรียมไฟล์แล้ว แตกไฟล์ ZIP แล้วเปิด video.mp4 ใน TikTok พร้อมคัดลอกคำบรรยายจาก caption.txt");
    } catch {
      setMessage("ยังดาวน์โหลดไม่ได้ ตรวจไฟล์ สิทธิ์ใช้งาน และคำบรรยายรวมแฮชแท็กไม่เกิน 2,200 ตัวอักษร");
    } finally { setBusy(false); }
  }
  let captionLength = 0, captionValid = true;
  try { captionLength = postCaption(caption, hashtags.split(/\s+/)).text.length; } catch { captionValid = false; }
  return <section className="manual-panel" aria-labelledby="local-title">
    <div className="manual-section-head"><div><p className="manual-eyebrow">ใช้คลิปที่คุณมี</p><h2 id="local-title">เตรียมคลิปไปโพสต์เอง</h2></div><span className="manual-private">อยู่บนเครื่องคุณ</span></div>
    <p className="manual-muted">เลือกไฟล์ ใส่คำบรรยาย และตรวจให้เรียบร้อย ไฟล์นี้จะไม่ถูกอัปโหลดและไม่เรียกบริการสร้างวิดีโอ</p>
    <div className="manual-local-grid">
      <div className="manual-preview-column">
        <label className="manual-file-label">เลือกวิดีโอ MP4<input type="file" accept="video/mp4" onChange={choose} disabled={busy} /></label>
        <small className="manual-muted">ขนาดไม่เกิน 50 MB · แนวตั้ง 9:16 เหมาะกับ TikTok</small>
        {file && preview ? <video key={preview} className="manual-video" src={preview} controls playsInline preload="metadata"
          onLoadedData={() => setPlayable(true)} onError={() => { setPlayable(false); setMessage("ไฟล์นี้เล่นไม่ได้ กรุณาเลือก MP4 ที่เปิดเล่นได้"); }} aria-label="ตรวจวิดีโอก่อนดาวน์โหลด" /> : <div className="manual-preview-empty">ตัวอย่างวิดีโอจะแสดงที่นี่</div>}
      </div>
      <div className="manual-fields">
        {accounts.length > 0 && <label>บัญชีที่จะโพสต์<select value={accountName} onChange={e => setAccountName(e.target.value)} disabled={busy}>
          {accounts.map((account, index) => <option key={index} value={account.name}>{account.name}</option>)}
        </select></label>}
        <label>คำบรรยาย<textarea value={caption} onChange={e => { setCaption(e.target.value); setReviewed(false); }} maxLength={2200} rows={4} disabled={busy} placeholder="เล่าเกี่ยวกับคลิปหรือสินค้า โดยใช้ข้อมูลที่ตรวจสอบได้" /></label>
        <label>แฮชแท็ก<input value={hashtags} onChange={e => { setHashtags(e.target.value); setReviewed(false); }} maxLength={1000} disabled={busy} placeholder="#สินค้า #รีวิว" /></label>
        <small className={captionValid ? "manual-muted" : "manual-warning"}>{captionValid ? captionLength : "เกินขีดจำกัด"} / 2,200 ตัวอักษร รวมแฮชแท็ก</small>
        <p className="manual-warning">ไฟล์ของคุณยังไม่ผ่านการตรวจเนื้อหาอัตโนมัติ กรุณาตรวจภาพ เสียง คำกล่าวอ้าง และข้อมูลส่วนตัวก่อนโพสต์</p>
        <label className="manual-check"><input type="checkbox" checked={rights} onChange={e => setRights(e.target.checked)} disabled={busy} />ฉันมีสิทธิ์ใช้วิดีโอ ภาพ และเสียงนี้</label>
        <label className="manual-check"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} disabled={busy || !playable} />ฉันเปิดดูและตรวจเนื้อหาแล้ว พร้อมนำไปโพสต์เอง</label>
        <label className="manual-check"><input type="checkbox" checked={aiGenerated} onChange={e => setAiGenerated(e.target.checked)} disabled={busy} />คลิปนี้สร้างหรือดัดแปลงด้วย AI — ฉันจะระบุใน TikTok ตามข้อกำหนด</label>
        <button className="manual-primary" onClick={download} disabled={busy || !playable || !reviewed || !rights || !captionValid}>
          {busy ? "กำลังเตรียมไฟล์…" : "ดาวน์โหลดชุดพร้อมโพสต์"}</button>
        {message && <p className="manual-result" role="status">{message}</p>}
      </div>
    </div>
  </section>;
}
