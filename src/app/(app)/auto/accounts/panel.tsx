"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import type { AccountView } from "@/features/multi-account/service";
import { accountAutomationSchema, reasonLabels, type AccountAutomation } from "@/features/multi-account/contracts";
import { localDay } from "@/features/multi-account/scheduler";
import { refreshAccountsAction, saveAccountAction } from "./actions";

type CalendarRow = { id: string; tiktok_account_id: string; due_at: string; kind: string; state: string; reason: string | null };
export interface AutomationView { installed: boolean; accounts: AccountView[]; calendar: Record<string, unknown>[]; health: string | null; workerActive?:boolean; }
const time = (value: string | null, zone: string) => value ? new Intl.DateTimeFormat("th-TH", { timeZone: zone, hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";
const clockMinute = (value: string) => Number(value.slice(0,2)) * 60 + Number(value.slice(3,5));
const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;

function AccountSettings({ account, onSaved }: { account: AccountView; onSaved: (view: AutomationView) => void }) {
  const c = accountAutomationSchema.parse(account.config ?? {});
  const [form, setForm] = useState(c), [pending, start] = useTransition(), [message, setMessage] = useState("");
  function field<K extends keyof AccountAutomation>(key: K, value: AccountAutomation[K]) { setForm(prior => ({ ...prior, [key]: value })); }
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    start(async () => { try { onSaved(await saveAccountAction(account.id, form)); setMessage("บันทึกแล้ว"); } catch { setMessage("บันทึกไม่ได้ กรุณาตรวจเป้าหมายและช่วงเวลา"); } });
  }
  return <details className="ma-settings"><summary>ตั้งค่าบัญชี</summary><form onSubmit={submit}>
    <label><input type="checkbox" checked={form.enabled} onChange={e => field("enabled",e.target.checked)} /> เปิดทำงาน</label>
    <label><input type="checkbox" checked={form.paused} onChange={e => field("paused",e.target.checked)} /> พักบัญชี</label>
    <p>จำนวนคลิปปรับตามผลลัพธ์ งบ และความพร้อม ไม่มีโควตาคลิปตายตัว</p>
    <label>เว้นระยะอย่างน้อย (นาที)<input type="number" min="1" step="1" value={form.minimumGapMinutes} onChange={e => field("minimumGapMinutes",Number(e.target.value))} /></label>
    <label>หมวดสินค้า<input value={form.categories.join(", ")} onChange={e => field("categories",e.target.value.split(",").map(s => s.trim()).filter(Boolean))} placeholder="แยกด้วยเครื่องหมาย ," /></label>
    <label>เขตเวลา<input value={form.timezone} onChange={e => field("timezone",e.target.value)} /></label>
    <label><input type="checkbox" checked={form.spreadFullDay} onChange={e => field("spreadFullDay",e.target.checked)} /> กระจายตลอด 24 ชั่วโมง</label>
    {!form.spreadFullDay && <><label>เริ่มเวลา<input type="time" value={clock(form.windows[0]?.start ?? 0)} onChange={e => field("windows",[{ start: clockMinute(e.target.value), end: form.windows[0]?.end ?? 1439 }])} /></label><label>สิ้นสุดเวลา<input type="time" value={clock(Math.min(1439,form.windows[0]?.end ?? 1439))} onChange={e => field("windows",[{ start: form.windows[0]?.start ?? 0, end: clockMinute(e.target.value) }])} /></label></>}
    <label>ความสำคัญ<input type="number" min="0" max="100" value={form.priority} onChange={e => field("priority",Number(e.target.value))} /></label>
    <label>งบสร้างของบัญชี / วัน (USD)<input type="number" min="0" step="0.01" value={form.dailyBudgetUsd} onChange={e => field("dailyBudgetUsd",Number(e.target.value))} /></label>
    <label>วิธีสร้าง<select value={form.providerPreference} onChange={e => field("providerPreference",e.target.value as AccountAutomation["providerPreference"])}><option value="AUTO">ตามการตั้งค่าระบบ</option><option value="GOOGLE_ONLY">สร้างแล้วนำเข้าด้วยตัวเอง</option><option value="FAL_ONLY">ใช้บริการสำรองที่อนุญาตไว้</option></select></label>
    <p>การตั้งงบนี้ไม่เปิดบริการเสียเงิน และไม่แทนการยืนยันรายละเอียดของแต่ละโพสต์</p>
    <button className="ma-primary" disabled={pending}>บันทึก</button><span role="status">{message}</span>
  </form></details>;
}

export function AutomationDashboard({ initial }: { initial: AutomationView }) {
  const [view, setView] = useState(initial), [error, setError] = useState(false), [pending, start] = useTransition();
  const [calendarDay, setCalendarDay] = useState(() => localDay(new Date(), "Asia/Bangkok"));
  useEffect(() => { let alive = true; const timer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    start(async () => { try { const next = await refreshAccountsAction(); if (alive) { setView(next); setError(false); } } catch { if (alive) setError(true); } });
  }, 20000); return () => { alive = false; clearInterval(timer); }; }, []);
  const accounts = view.accounts, enabled = accounts.filter(a => a.config?.enabled && !a.config.paused && a.connected);
  const generationTarget = enabled.reduce((n,a) => n + (a.recommendation?.generation ?? 0),0), publishingTarget = enabled.reduce((n,a) => n + (a.recommendation?.publishing ?? 0),0);
  const sum = (key: "produced" | "ready" | "published" | "waiting" | "failed") => accounts.reduce((n,a) => n + Number(a[key]),0);
  const calendar = view.calendar as unknown as CalendarRow[], labels = new Map(accounts.map(a => [a.id,a.name]));
  const working = view.workerActive === true;
  return <div className="ma-dashboard"><header className="ma-heading"><div><p>VIRAL FLOW AI</p><h1>ทุกบัญชี ในจังหวะของคุณ</h1><span>จำนวนคลิปตามข้อมูลจริง • เวลาของแต่ละบัญชี • คิวเดียวที่จัดลำดับให้</span></div><Link className="ma-primary" href="/accounts">เชื่อมบัญชีเพิ่ม</Link></header>
    <section className="ma-status" aria-live="polite"><strong>{working ? "ระบบเบื้องหลังตอบกลับแล้ว" : "ยังไม่พบการทำงานเบื้องหลังล่าสุด"}</strong><span>{error ? "อัปเดตข้อมูลไม่ได้ กำลังลองใหม่" : pending ? "กำลังอัปเดต" : "แสดงข้อมูลที่บันทึกจริง"}</span></section>
    <div className="ma-summary">{[["บัญชีทั้งหมด",accounts.length],["เปิดทำงาน",enabled.length],["แผนสร้างที่ประเมินได้",generationTarget],["แผนเผยแพร่ที่ประเมินได้",publishingTarget],["สร้างแล้ว",sum("produced")],["พร้อมตรวจเผยแพร่",sum("ready")],["โพสต์สำเร็จ",sum("published")],["งานรอ",sum("waiting")],["ทำต่อไม่ได้",sum("failed")]].map(([label,value]) => <div key={String(label)}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <div className="ma-capacity"><strong>ไม่มีโควตาคลิปตายตัว</strong><p>เมื่อข้อมูลยังไม่พอ ระบบจะรอหลักฐานแทนการตั้งเป้าขึ้นเอง การสร้างแบบนำเข้ายังต้องให้คุณช่วยทำ และจำนวนโพสต์จริงขึ้นกับสิทธิ์และข้อจำกัดของ TikTok</p><p>กันงบวันนี้ ${accounts.reduce((n,a) => n+Number(a.estimatedToday),0).toFixed(2)} • ยอดเรียกเก็บ {accounts.some(a => a.actualToday === null && a.estimatedToday > 0) ? "ยังยืนยันไม่ครบ" : `$${accounts.reduce((n,a) => n+Number(a.actualToday ?? 0),0).toFixed(2)}`}</p></div>
    <section aria-label="บัญชี"><div className="ma-account-grid">{accounts.map(account => <article className="ma-account" key={account.id}><header><div><h2>{account.name}</h2><span>{account.username ? `@${account.username}` : "บัญชี TikTok"}</span></div><span className="ma-pill">{!account.connected || !account.tokenReady ? "ต้องเชื่อมใหม่" : account.config?.paused ? "พักอยู่" : account.config?.enabled ? "เปิดทำงาน" : "ปิดอยู่"}</span></header>
      <p>{account.config?.categories.join(" · ") || "ทุกหมวดที่เลือกในระบบ"}</p><p>{reasonLabels[account.recommendation?.reason??"FREQUENCY_DATA_REQUIRED"]??"รอประเมิน"}</p><div className="ma-account-metrics"><span>แผนสร้าง <b>{account.recommendation?.generation ?? "รอข้อมูล"}</b></span><span>แผนเผยแพร่ <b>{account.recommendation?.publishing ?? "รอข้อมูล"}</b></span><span>พร้อม <b>{account.ready}</b></span><span>โพสต์แล้ว <b>{account.published}</b></span><span>จำนวนโพสต์ที่อนุญาต <b>{account.publishCap ?? "ยังไม่ทราบ"}</b></span><span>คงเหลือโดยประมาณ <b>{account.publishCap === null ? "ยังไม่ทราบ" : Math.max(0,account.publishCap-account.published)}</b></span><span>งานรอ <b>{account.waiting}</b></span></div>
      <p>ล่าสุด {time(account.lastPublish,account.config?.timezone ?? "Asia/Bangkok")} · ถัดไป {time(account.nextPublish,account.config?.timezone ?? "Asia/Bangkok")}</p><AccountSettings key={`${account.id}:${JSON.stringify(account.config)}`} account={account} onSaved={setView} /><Link href={`/accounts/${account.id}`}>เปิดบัญชี →</Link>
    </article>)}</div>{accounts.length === 0 && <p>เชื่อม TikTok แล้วเลือกเปิดทำงานให้แต่ละบัญชี</p>}</section>
    <section className="ma-calendar"><header><div><h2>ตาราง 24 ชั่วโมง</h2><p>เวลาแสดงตามกรุงเทพฯ • ตารางแผนงานยังไม่ใช่หลักฐานว่าโพสต์สำเร็จ</p><label>วันที่ <input type="date" value={calendarDay} onChange={e => setCalendarDay(e.target.value)} /></label></div><Link href="/publishing">ตรวจและยืนยันโพสต์ →</Link></header><div className="ma-hours">{Array.from({length:24},(_,hour) => <div className="ma-hour" key={hour}><strong>{String(hour).padStart(2,"0")}:00</strong>{calendar.filter(row => localDay(new Date(row.due_at),"Asia/Bangkok") === calendarDay && Number(new Date(row.due_at).toLocaleString("en-US",{timeZone:"Asia/Bangkok",hour:"numeric",hourCycle:"h23"})) === hour).map(row => <div key={row.id} className={row.state === "COMPLETE" ? "ma-event done" : "ma-event"}><b>{labels.get(row.tiktok_account_id) ?? "บัญชี"}</b><span>{time(row.due_at,"Asia/Bangkok")} · {row.kind === "GENERATE" ? "เตรียมคลิป" : row.kind === "PUBLISH" ? "เผยแพร่" : "ตรวจผล"}</span><small>{row.reason ? reasonLabels[row.reason] ?? "รอตรวจสถานะ" : row.state === "COMPLETE" ? "เสร็จแล้ว" : "ตามแผน"}</small></div>)}</div>)}</div></section>
  </div>;
}
