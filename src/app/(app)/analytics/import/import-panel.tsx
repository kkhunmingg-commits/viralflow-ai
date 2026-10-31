"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ParsedOrderRow, ParsedVideoRow, ReportKind, ReportPreview } from "@/features/analytics/report-import";

export type ImportAccount = { id: string; name: string; username: string | null; mock: boolean };
type ImportResult = { status: "IMPORTED" | "ALREADY_IMPORTED"; batch: Record<string, unknown>;
  parsed?: { rows: number; rejections: Array<{ line: number; reason: string }>; unknownColumns: string[] } };

const KINDS: Array<{ value: ReportKind; label: string; hint: string }> = [
  { value: "VIDEO_PERFORMANCE", label: "ผลวิดีโอจาก TikTok Studio", hint: "TikTok Studio → Analytics → Content → ดาวน์โหลดข้อมูล (CSV)" },
  { value: "AFFILIATE_ORDERS", label: "คำสั่งซื้อ Affiliate", hint: "TikTok Shop ศูนย์ Affiliate → คำสั่งซื้อ → ส่งออก (CSV)" },
];
const CHANNEL: Record<string, string> = { VIDEO: "วิดีโอ", LIVE: "ไลฟ์", SHOWCASE: "โชว์เคส", UNKNOWN: "ไม่ระบุช่องทาง" };
const EVENT: Record<string, string> = { ORDER_CREATED: "รอดำเนินการ", ORDER_SETTLED: "สำเร็จ", ORDER_CANCELLED: "ยกเลิก/คืนเงิน" };
const n = (v: number | null | undefined, digits = 0) => v === null || v === undefined ? "ไม่ทราบ" : v.toLocaleString("th-TH", { maximumFractionDigits: digits });
const pct = (v: number | null) => v === null ? "ไม่ทราบ" : `${(v * 100).toLocaleString("th-TH", { maximumFractionDigits: 1 })}%`;
const when = (v: string | null) => v ? new Date(v).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }) : "ไม่ทราบ";
const excel = (name: string) => /\.(xlsx|xlsm|xls)$/i.test(name);

export function ReportImportPanel({ accounts }: { accounts: ImportAccount[] }) {
  const router = useRouter();
  const real = accounts.filter(a => !a.mock), mock = accounts.filter(a => a.mock);
  const [accountId, setAccountId] = useState(real[0]?.id ?? "");
  const [kind, setKind] = useState<ReportKind>("VIDEO_PERFORMANCE");
  const [file, setFile] = useState<File | null>(null);
  const [reportedAt, setReportedAt] = useState("");
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function reset() { setPreview(null); setResult(null); setError(""); }
  async function send(mode: "preview" | "import") {
    if (!file || !accountId || busy) return;
    const form = new FormData();
    form.set("file", file); form.set("kind", kind); form.set("accountId", accountId); form.set("mode", mode);
    // A datetime-local value is the owner's local time; empty means "just downloaded".
    form.set("reportedAt", (reportedAt ? new Date(reportedAt) : new Date()).toISOString());
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/analytics/import", { method: "POST", body: form, cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(typeof body.message === "string" ? body.message : "ทำรายการไม่ได้ กรุณาลองใหม่"); return; }
      if (mode === "preview") { setPreview(body as ReportPreview); setResult(null); }
      else { setResult(body as ImportResult); router.refresh(); }
    } catch { setError("เชื่อมต่อไม่ได้ กรุณาลองใหม่"); }
    finally { setBusy(false); }
  }
  function choose(next: File | null) {
    reset();
    if (next && excel(next.name)) {
      setFile(null); if (fileInput.current) fileInput.current.value = "";
      setError("ไฟล์ Excel (.xlsx/.xls) ยังอ่านไม่ได้ กรุณาดาวน์โหลดจาก TikTok เป็น CSV หรือเปิดใน Excel แล้วเลือก บันทึกเป็น → \"CSV UTF-8\" ก่อนอัปโหลด");
      return;
    }
    if (next && next.size > 5_000_000) { setFile(null); setError("ไฟล์ต้องไม่เกิน 5 MB"); return; }
    setFile(next);
  }
  const canImport = Boolean(preview && !preview.blocking && !preview.alreadyImported && preview.rowsAccepted > 0 && !result);

  return <>
    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">STEP 1</p><h2>เลือกบัญชี ประเภทรายงาน และไฟล์</h2></div></div>
      {!real.length && <p className="form-error">ยังไม่มีบัญชี TikTok จริงที่นำเข้ารายงานได้ เชื่อมต่อบัญชีจริงในหน้า <Link href="/accounts">บัญชี</Link> ก่อน</p>}
      <form className="account-form" onSubmit={e => { e.preventDefault(); void send("preview"); }}>
        <div className="account-form-grid">
          <label>บัญชี TikTok
            <select value={accountId} onChange={e => { setAccountId(e.target.value); reset(); }} required>
              {!real.length && <option value="">ไม่มีบัญชีจริง</option>}
              {real.map(a => <option key={a.id} value={a.id}>{a.name}{a.username ? ` (@${a.username})` : ""}</option>)}
              {mock.map(a => <option key={a.id} value={a.id} disabled>{a.name} · บัญชีทดลอง นำเข้าผลจริงไม่ได้</option>)}
            </select>
          </label>
          <label>ประเภทรายงาน
            <select value={kind} onChange={e => { setKind(e.target.value as ReportKind); reset(); }}>
              {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </label>
          <label className="wide">ไฟล์รายงาน (CSV หรือ TSV ตามที่ดาวน์โหลดมา ภาษาไทยหรืออังกฤษก็ได้)
            <input ref={fileInput} type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" onChange={e => choose(e.target.files?.[0] ?? null)} required />
          </label>
          <label className="wide">เวลาที่ดาวน์โหลดรายงาน (เว้นว่าง = ตอนนี้)
            <input type="datetime-local" value={reportedAt} onChange={e => { setReportedAt(e.target.value); setResult(null); }} />
          </label>
        </div>
        <p className="muted">{KINDS.find(k => k.value === kind)?.hint}. ตัวเลขในรายงานผลวิดีโอเป็นยอดสะสมจนถึงเวลาที่ดาวน์โหลด</p>
        {mock.length > 0 && <p className="muted">บัญชีทดลอง {mock.map(a => a.name).join(", ")} เลือกไม่ได้ เพราะตัวเลขของบัญชีทดลองแยกไม่ออกจากข้อมูลจำลอง</p>}
        <div className="form-actions">
          <button className="secondary-action" type="submit" disabled={busy || !file || !accountId}>{busy && !preview ? "กำลังตรวจไฟล์…" : "ตรวจไฟล์ก่อนนำเข้า"}</button>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
      </form>
    </section>

    {preview && <PreviewSection preview={preview} />}

    {preview && <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">STEP 3</p><h2>ยืนยันนำเข้า</h2></div><span className="phase-chip">OWNER_REPORT_IMPORT</span></div>
      {!result && <>
        <p className="radar-note">จะนำเข้า {n(preview.rowsAccepted)} แถวเป็นรายงานจริงของบัญชี {real.find(a => a.id === accountId)?.name ?? ""} แถวที่ถูกปฏิเสธจะไม่ถูกนำเข้า ไฟล์เดียวกันนำเข้าซ้ำไม่ได้</p>
        <div className="form-actions"><button className="primary-action" type="button" disabled={busy || !canImport} onClick={() => void send("import")}>{busy ? "กำลังนำเข้า…" : "ยืนยันนำเข้า"}</button></div>
        {!canImport && <p className="muted">{preview.alreadyImported ? "ไฟล์นี้เคยนำเข้าแล้ว" : preview.blocking ? preview.blocking.message : "ไม่มีแถวที่นำเข้าได้"}</p>}
      </>}
      {result?.status === "IMPORTED" && <div role="status">
        <p className="success-copy"><strong>นำเข้าแล้ว {n(Number(result.batch.rows_imported))} แถว</strong> · เชื่อมกับ{kind === "VIDEO_PERFORMANCE" ? "คลิปในคลังคอนเทนต์" : "สินค้าในระบบ"} {n(Number(result.batch.rows_linked))} แถว</p>
        {(result.parsed?.rejections.length ?? 0) > 0 && <p className="muted">ไม่ได้นำเข้า {n(result.parsed!.rejections.filter(r => r.line > 1).length)} แถว (ดูเหตุผลในตารางด้านบน)</p>}
      </div>}
      {result?.status === "ALREADY_IMPORTED" && <p className="form-error" role="status">ไฟล์นี้เคยนำเข้าแล้วเมื่อ {when(typeof result.batch.imported_at === "string" ? result.batch.imported_at : null)} ระบบไม่นับซ้ำ</p>}
    </section>}
  </>;
}

function PreviewSection({ preview }: { preview: ReportPreview }) {
  const rejectedRows = preview.rejections.filter(r => r.line > 1), headerNotes = preview.rejections.filter(r => r.line === 1);
  const video = preview.kind === "VIDEO_PERFORMANCE";
  return <section className="panel">
    <div className="panel-heading"><div><p className="eyebrow">STEP 2</p><h2>ตัวอย่างก่อนนำเข้า (ยังไม่บันทึก)</h2></div>
      <span className={`quality-badge ${preview.blocking || preview.alreadyImported ? "reject" : rejectedRows.length ? "retry" : "pass"}`}>{preview.blocking ? "นำเข้าไม่ได้" : preview.alreadyImported ? "เคยนำเข้าแล้ว" : "พร้อมนำเข้า"}</span></div>
    <div className="data-list">
      <div><strong>ไฟล์</strong><span>{preview.format} · {preview.detectedKind ? KINDS.find(k => k.value === preview.detectedKind)?.label : "ไม่รู้จักรูปแบบหัวตาราง"}</span></div>
      <div><strong>แถวทั้งหมด</strong><span>{n(preview.rowsRead)} แถว · นำเข้าได้ {n(preview.rowsAccepted)} · ถูกปฏิเสธ {n(rejectedRows.length)}</span></div>
      {preview.linkedRows !== null && <div><strong>{video ? "ตรงกับคลิปในคลังคอนเทนต์" : "ตรงกับสินค้าในระบบ"}</strong><span>{n(preview.linkedRows)} แถว</span><small>{video ? "แถวอื่นจะถูกเก็บเป็นวิดีโอภายนอก" : "แถวอื่นยังเก็บได้แต่ไม่ผูกสินค้า"}</small></div>}
      {preview.unknownColumns.length > 0 && <div><strong>คอลัมน์ที่ไม่ได้ใช้</strong><span>{preview.unknownColumns.join(", ")}</span></div>}
    </div>
    {preview.blocking && <p className="form-error">{preview.blocking.message}</p>}
    {preview.alreadyImported && <p className="form-error">ไฟล์นี้เคยนำเข้าแล้ว{preview.alreadyImported.importedAt ? `เมื่อ ${when(preview.alreadyImported.importedAt)}` : ""}{preview.alreadyImported.fileName ? ` (${preview.alreadyImported.fileName})` : ""} ระบบจะไม่นับซ้ำ</p>}
    {headerNotes.filter(r => r.reason.startsWith("NO_")).map(r => <p className="form-error" key={r.reason}>{r.message}</p>)}

    {preview.channels && Object.keys(preview.channels).length > 0 && <>
      <h3>ยอดตามช่องทาง (แยกวิดีโอกับไลฟ์ ไม่รวมกัน)</h3>
      <div className="radar-table-wrap"><table className="radar-table"><thead><tr><th>ช่องทาง</th><th>คำสั่งซื้อ</th><th>ยกเลิก</th><th>GMV (฿)</th><th>ค่าคอมโดยประมาณ (฿)</th><th>ค่าคอมที่ได้รับจริง (฿)</th></tr></thead>
        <tbody>{Object.entries(preview.channels).map(([channel, c]) => <tr key={channel}><td>{CHANNEL[channel] ?? channel}</td><td>{n(c.orders)}</td><td>{n(c.cancelled)}</td><td>{n(c.gmv, 2)}</td><td>{n(c.estimatedCommission, 2)}</td><td>{n(c.settledCommission, 2)}</td></tr>)}</tbody></table></div>
      <p className="muted">โชว์เคสและไม่ระบุช่องทางแยกไว้ต่างหาก ไม่ถูกนับเป็นยอดวิดีโอหรือไลฟ์</p>
    </>}

    {preview.sample.length > 0 && <>
      <h3>ตัวอย่าง {n(preview.sample.length)} แถวแรกที่อ่านได้</h3>
      <div className="radar-table-wrap">{video
        ? <table className="radar-table"><thead><tr><th>แถว</th><th>รหัสวิดีโอ</th><th>โพสต์เมื่อ</th><th>ยอดดู</th><th>ไลก์</th><th>คอมเมนต์</th><th>แชร์</th><th>บันทึก</th><th>ผู้ติดตามใหม่</th><th>ดูเฉลี่ย (วิ)</th><th>ดูจนจบ</th></tr></thead>
          <tbody>{(preview.sample as ParsedVideoRow[]).map(r => <tr key={r.line}><td>{r.line}</td><td>{r.externalVideoId}</td><td>{when(r.publishedAt)}</td><td>{n(r.views)}</td><td>{n(r.likes)}</td><td>{n(r.comments)}</td><td>{n(r.shares)}</td><td>{n(r.favorites)}</td><td>{n(r.newFollowers)}</td><td>{n(r.averageWatchSeconds, 1)}</td><td>{pct(r.fullWatchRate)}</td></tr>)}</tbody></table>
        : <table className="radar-table"><thead><tr><th>แถว</th><th>คำสั่งซื้อ</th><th>สินค้า</th><th>ช่องทาง</th><th>สถานะ</th><th>เวลาสั่งซื้อ</th><th>GMV (฿)</th><th>ค่าคอมประมาณ (฿)</th><th>ค่าคอมจริง (฿)</th></tr></thead>
          <tbody>{(preview.sample as ParsedOrderRow[]).map(r => <tr key={r.line}><td>{r.line}</td><td>{r.orderId}</td><td>{r.productName ?? r.productExternalId ?? "ไม่ทราบ"}</td><td>{CHANNEL[r.channel]}</td><td>{EVENT[r.eventType]}{r.status ? ` (${r.status})` : ""}</td><td>{when(r.occurredAt)}</td><td>{n(r.gmv, 2)}</td><td>{n(r.estimatedCommission, 2)}</td><td>{n(r.settledCommission, 2)}</td></tr>)}</tbody></table>}
      </div>
    </>}

    {rejectedRows.length > 0 && <>
      <h3>แถวที่จะไม่ถูกนำเข้า ({n(rejectedRows.length)})</h3>
      <div className="radar-table-wrap"><table className="radar-table"><thead><tr><th>แถวในไฟล์</th><th>เหตุผล</th></tr></thead>
        <tbody>{rejectedRows.slice(0, 100).map(r => <tr key={`${r.line}:${r.reason}`}><td>{r.line}</td><td>{r.message}</td></tr>)}</tbody></table></div>
      {rejectedRows.length > 100 && <p className="muted">แสดง 100 แถวแรก</p>}
    </>}
  </section>;
}
