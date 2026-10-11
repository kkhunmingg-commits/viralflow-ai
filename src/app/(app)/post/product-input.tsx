"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function ProductInput({ configured }: { configured: boolean }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""); const router = useRouter();
  async function save(form: FormData) {
    setBusy(true); setMessage("");
    try {
      const file = form.get("image"); if (!(file instanceof File) || file.size > 750_000) throw new Error("เลือกภาพจริงไม่เกิน 750 KB");
      const response = await fetch("/api/post/create/product", { method: "POST", body: form });
      const body = await response.json(); if (!response.ok) throw new Error(body.message ?? "ยังบันทึกไม่ได้");
      setMessage("เพิ่มสินค้าและภาพจริงแล้ว เลือกสินค้าในช่องด้านบนได้เลย"); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "ยังบันทึกไม่ได้"); }
    finally { setBusy(false); }
  }
  return <details className="content-product-input"><summary>เพิ่มสินค้าจริงสำหรับเนื้อหานายหน้า</summary>
    <form action={save} className="content-form"><label>ชื่อสินค้า<input name="title" required maxLength={300} /></label>
      <label>หมวดสินค้า<input name="category" required maxLength={80} placeholder="เช่น ของใช้ในบ้าน" /></label>
      <label>ราคาปัจจุบัน (บาท)<input name="price" type="number" min="0" max="1000000" step="0.01" required /></label>
      <label>ภาพสินค้าจริง<input name="image" type="file" accept="image/jpeg,image/png,image/webp" required /></label>
      <label className="manual-check content-wide"><input name="rights" type="checkbox" required />ภาพนี้เป็นสินค้าจริง ฉันมีสิทธิ์ใช้ และข้อมูลที่กรอกตรงกับสินค้า</label>
      <p className="manual-muted">ระบบใช้ภาพจริง ไม่สร้างแพ็กเกจหรือสรรพคุณแทน หลักฐานผลลัพธ์และสรรพคุณยังไม่ได้รับการยืนยัน</p>
      <button className="manual-secondary" disabled={busy || !configured}>{busy ? "กำลังบันทึก…" : "เพิ่มสินค้า"}</button>
    </form>{message && <p role="status">{message}</p>}
  </details>;
}
