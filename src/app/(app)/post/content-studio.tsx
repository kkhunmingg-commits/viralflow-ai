"use client";
import { useEffect, useRef, useState } from "react";
import { statusLabels, type ContentView } from "@/features/content-export/contracts";
import { ProductInput } from "./product-input";

type Account = { id: string; display_name: string };
type Product = { id: string; title: string };
const active = (run: ContentView) => !["READY", "REVIEW_REQUIRED", "FAILED", "CANCELLED"].includes(run.status);
async function send(input: Record<string, unknown>) {
  const response = await fetch("/api/post/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const body = await response.json(); if (!response.ok) throw new Error(body.message ?? "ยังดำเนินการไม่ได้"); return body;
}
export function ContentStudio({ accounts, products, configured, initialRuns, initialAccount, initialMode }: {
  accounts: Account[]; products: Product[]; configured: boolean; initialRuns: ContentView[]; initialAccount?: string; initialMode?: string;
}) {
  const [mode, setMode] = useState(["GROWTH", "AFFILIATE"].includes(initialMode ?? "") ? initialMode! : "AUTO"), [runs, setRuns] = useState(initialRuns), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  const requestKey = useRef<string | null>(null);
  const pumping = useRef(false);
  useEffect(() => {
    let disposed = false;
    const pump = async () => {
      if (pumping.current) return;
      pumping.current = true;
      try {
        const result = await fetch("/api/post/create", { cache: "no-store" });
        if (!result.ok) return;
        const data = await result.json() as { runs: ContentView[] };
        if (disposed) return; setRuns(data.runs);
        const next = data.runs.find(active);
        if (next) {
          const updated = await send({ command: "ADVANCE", id: next.id });
          if (!disposed && updated.run) setRuns(previous => previous.map(run => run.id === updated.run.id ? updated.run : run));
        }
      } catch (error) { if (!disposed) setMessage(error instanceof Error ? error.message : "ยังเชื่อมต่อไม่ได้"); }
      finally { pumping.current = false; }
    };
    const timer = setInterval(pump, 8000); void pump();
    return () => { disposed = true; clearInterval(timer); };
  }, []);
  async function start(formData: FormData) {
    if (busy) return; setBusy(true); setMessage("");
    requestKey.current ??= crypto.randomUUID();
    try {
      const result = await send({ command: "START", accountId: formData.get("accountId"), mode,
        topic: formData.get("topic") ?? "", productId: formData.get("productId") || undefined,
        budgetUsd: Number(formData.get("budgetUsd")), consent: formData.get("consent") === "on", requestKey: requestKey.current });
      setRuns(previous => [result.run, ...previous.filter(run => run.id !== result.run.id)]); requestKey.current = null;
    } catch (error) { setMessage(error instanceof Error ? error.message : "ยังเริ่มไม่ได้"); }
    finally { setBusy(false); }
  }
  async function action(command: "STOP" | "REVIEW", id: string) {
    setBusy(true);
    try { const data = await send({ command, id, consent: reviewed[id] === true }); setRuns(data.runs); }
    catch (error) { setMessage(error instanceof Error ? error.message : "ยังดำเนินการไม่ได้"); }
    finally { setBusy(false); }
  }
  return <section className="manual-panel content-studio" aria-labelledby="content-title">
    <div className="manual-section-head"><div><p className="manual-eyebrow">สร้างด้วย Viral Flow AI</p><h2 id="content-title">ให้ระบบคิดและสร้างคลิปให้</h2>
      <p>เลือกบัญชีและแนวทาง ระบบเตรียมเนื้อหา ภาพ เสียง และวิดีโอแนวตั้งให้ คุณตรวจแล้วดาวน์โหลดไปโพสต์เอง</p></div></div>
    <form action={start} className="content-form">
      <label>บัญชี TikTok<select required name="accountId" defaultValue={initialAccount ?? accounts[0]?.id} disabled={busy}>
        {accounts.map(account => <option key={account.id} value={account.id}>{account.display_name}</option>)}</select></label>
      <label>แนวทาง<select name="mode" value={mode} onChange={event => setMode(event.target.value)} disabled={busy}>
        <option value="AUTO">AUTO — เลือกแนวทางตามบัญชี</option><option value="GROWTH">GROWTH — ปั้นบัญชี</option><option value="AFFILIATE">AFFILIATE — เนื้อหานายหน้า</option></select></label>
      <label className="content-wide">แนวบัญชีหรือสิ่งที่อยากให้สร้าง <span className="manual-muted">เว้นว่างให้ระบบคิดเอง</span>
        <textarea name="topic" maxLength={400} rows={2} placeholder="เช่น เรื่องน่ารู้ในชีวิตประจำวัน เล่าให้น่าสนใจสำหรับคนวัยทำงาน" /></label>
      {mode !== "GROWTH" && <label className="content-wide">สินค้า {mode === "AUTO" && "(ไม่เลือกจะเริ่มปั้นบัญชี)"}<select name="productId" required={mode === "AFFILIATE"}>
        <option value="">ไม่เลือกสินค้า</option>{products.map(product => <option key={product.id} value={product.id}>{product.title}</option>)}</select>
        {mode === "AFFILIATE" && products.length === 0 && <span className="manual-warning">ยังไม่มีสินค้าจริงในบัญชี เพิ่มสินค้าและภาพจริงด้านล่างก่อนใช้แนวทางนี้</span>}</label>}
      <label>วงเงินสูงสุดต่อคลิป (USD)<input name="budgetUsd" type="number" min="0.3" max="1" step="0.1" defaultValue="0.5" required /></label>
      <p className="manual-muted">คลิปยาว 8 วินาที พร้อมเสียงไทย ค่าใช้จ่ายขึ้นกับการใช้จริง ไม่ใช่ราคาเหมาจ่าย ระบบจำกัดรวม $5/วัน และ $30/เดือน งานนี้เริ่มเมื่อคุณกดเท่านั้น</p>
      <label className="manual-check content-wide"><input type="checkbox" name="consent" required />ฉันยืนยันวงเงินสำหรับการสร้างคลิปนี้ และจะตรวจภาพ เสียง และเนื้อหาก่อนโพสต์</label>
      <button type="submit" className="manual-primary" disabled={busy || !configured || !accounts.length || (mode === "AFFILIATE" && !products.length)}>{busy ? "กำลังเตรียม…" : "สร้างคลิปให้ฉัน"}</button>
      {!configured && <p className="manual-warning">ระบบสร้างคลิปยังไม่พร้อมเปิดใช้งาน</p>}
    </form>
    {message && <p role="alert" className="manual-warning">{message}</p>}
    <ProductInput configured={configured} />
    <div className="content-results">{runs.map(run => <article key={run.id} className="content-result">
      <div className="manual-section-head"><h3>{run.title || "คอนเทนต์ใหม่"}</h3><span className="content-status" aria-live="polite">{statusLabels[run.status]}</span></div>
      <p className="manual-muted">{accounts.find(account => account.id === run.accountId)?.display_name ?? "บัญชีของคุณ"} · {run.mode}</p>
      {run.rationale && <p>{run.rationale}</p>}{run.script && <p><strong>เสียงบรรยาย:</strong> {run.script}</p>}
      {run.caption && <p className="manual-caption">{run.caption}</p>}
      <p className="manual-muted">วงเงิน ${run.budgetUsd.toFixed(2)} · ยอดกันไว้/ประมาณการ ${run.reservedUsd.toFixed(2)} (ไม่ใช่ใบแจ้งหนี้)</p>
      {run.message && <p>{run.message}</p>}
      {["REVIEW_REQUIRED", "READY"].includes(run.status) && <video controls preload="metadata" playsInline src={`/api/post/create/${run.id}/media`} />}
      {active(run) && <button type="button" className="manual-secondary" disabled={busy} onClick={() => action("STOP", run.id)}>หยุดการสร้าง</button>}
      {run.status === "REVIEW_REQUIRED" && <><label className="manual-check"><input type="checkbox" checked={reviewed[run.id] ?? false} onChange={event => setReviewed(previous => ({ ...previous, [run.id]: event.target.checked }))} />ฉันตรวจภาพ เสียง คำบรรยาย และสิทธิ์ใช้งานแล้ว</label>
        <button type="button" className="manual-primary" disabled={busy || !reviewed[run.id]} onClick={() => action("REVIEW", run.id)}>ยืนยันผลตรวจ</button></>}
      {run.status === "READY" && <a className="manual-primary" href={`/api/post/create/${run.id}/media?download=1`} download>ดาวน์โหลดคลิปและคำบรรยาย</a>}
    </article>)}</div>
  </section>;
}
