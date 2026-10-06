"use client";
import { useState } from "react";
import type { CustomerOverview, CustomerPeriod } from "@/features/control-center/customer-types";
import { summaryForShare } from "@/features/control-center/share-summary";

export function ShareSummaryButton({ overview }: { overview: CustomerOverview }) {
  const [open, setOpen] = useState(false), [account, setAccount] = useState("all"), [period, setPeriod] = useState<CustomerPeriod>(overview.period);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function download() {
    setBusy(true); setError("");
    try {
      let view = overview;
      if (period !== overview.period) {
        const response = await fetch(`/api/customer/overview?period=${period}`, { cache: "no-store" });
        if (!response.ok) throw new Error("unavailable");
        view = await response.json() as CustomerOverview;
      }
      const summary = summaryForShare(view, account);
      await document.fonts.ready;
      const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 1030 + Math.min(summary.ranking.length, 10) * 64;
      const context = canvas.getContext("2d"); if (!context) throw new Error("unavailable");
      const bg = context.createLinearGradient(0, 0, 1200, canvas.height); bg.addColorStop(0, "#17142d"); bg.addColorStop(.6, "#0d1420"); bg.addColorStop(1, "#102928");
      context.fillStyle = bg; context.fillRect(0, 0, 1200, canvas.height);
      function text(value: string, x: number, y: number, size: number, color = "#eef1ff") {
        context!.fillStyle = color; context!.font = `600 ${size}px "Noto Sans Thai", sans-serif`;
        context!.fillText(value, x, y, 1060);
      }
      function metric(value: number | null, currency?: string | null) {
        if (value === null) return "—";
        return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(value) + (currency ? ` ${currency}` : "");
      }
      text("VIRALFLOW AI", 70, 100, 28, "#a59cff"); text("สรุปผลงานของคุณ", 70, 183, 57);
      text(`${summary.title} · ${summary.period}`, 70, 250, 29, "#a7b2c8");
      summary.metrics.forEach((item, index) => {
        const x = 70 + (index % 2) * 540, y = 330 + Math.floor(index / 2) * 190;
        context!.fillStyle = "#ffffff09"; context!.beginPath(); context!.roundRect(x, y, 510, 162, 24); context!.fill();
        text(item.label, x + 25, y + 48, 22, "#acb8cf");
        text(metric(item.value, [0, 1, 5].includes(index) ? summary.currency : null), x + 25, y + 117, 39);
      });
      text("อันดับบัญชีตามยอดขายที่มีข้อมูล", 70, 952, 25, "#9ddbd3");
      summary.ranking.slice(0, 10).forEach((row, i) => {
        text(`${row.rank ?? "—"}   ${row.name}`, 70, 1020 + i * 64, 25);
        text(metric(row.sales, row.currency), 790, 1020 + i * 64, 24, "#9ddbd3");
      });
      text("— ยังไม่มีข้อมูลที่ยืนยันได้ · GMV ไม่ใช่กำไร · ช่วงวันตาม UTC", 70, canvas.height - 38, 17, "#a7b2c8");
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("unavailable")), "image/png"));
      const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = `viralflow-summary-${period}.png`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError("สร้างภาพไม่สำเร็จ กรุณาลองอีกครั้ง"); } finally { setBusy(false); }
  }
  return <div className="cc-share">
    <button className="secondary-button" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>สร้างภาพสรุป ↗</button>
    {open && <section className="cc-share-panel" aria-label="สร้างภาพสรุป">
      <label>บัญชี<select value={account} onChange={(event) => setAccount(event.target.value)}><option value="all">ทุกบัญชี</option>{overview.accounts.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label>
      <label>ช่วงเวลา<select value={period} onChange={(event) => setPeriod(event.target.value as CustomerPeriod)}><option value="today">วันนี้</option><option value="7d">7 วัน</option><option value="30d">30 วัน</option></select></label>
      <button type="button" className="primary-button" disabled={busy} onClick={download}>{busy ? "กำลังสร้างภาพ…" : "ดาวน์โหลดภาพ PNG"}</button>
      {error && <p role="alert">{error}</p>}
    </section>}
  </div>;
}
