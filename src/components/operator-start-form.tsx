"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { startOperatorAction } from "@/app/(app)/auto/actions";

interface AccountOption {
  id: string;
  name: string;
  status: string;
  authorization: string;
  effectiveMode: string;
  target: number;
  hardLimit: number;
  budget: number;
  /** Plain-language phase from accountPhase(); shown instead of asking the owner to pick a mode. */
  phase?: { label: string; plan: string; clipsPerDay: string };
}

function StartButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <button className="operator-start-button" type="submit" disabled={disabled || pending}><span aria-hidden="true">▶</span>{pending ? "กำลังเริ่มแผน…" : "START AUTO"}</button>;
}

export function OperatorStartForm({ accounts, requestKey, disabled, selectedAccountId, exportOnly = false }: { accounts: AccountOption[]; requestKey: string; disabled: boolean; selectedAccountId?: string; exportOnly?: boolean }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(selectedAccountId ?? accounts[0]?.id ?? "");
  const [mode, setMode] = useState("AUTO");
  const account = accounts.find((item) => item.id === accountId);
  const ready = account?.status === "active" && account.authorization === "authorized";
  const affiliateBlocked = mode === "AFFILIATE" && account?.effectiveMode !== "AFFILIATE";
  const canStart = Boolean(account && ready && !affiliateBlocked && account.hardLimit > 0 && !disabled);

  if (exportOnly) return <div className="operator-form">
    <div className="operator-fields"><label>บัญชี TikTok<select value={accountId} onChange={event => { setAccountId(event.target.value); router.replace(`/auto?account=${encodeURIComponent(event.target.value)}`, { scroll: false }); }}>
      {accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {account?.phase && <div className="operator-phase-note" aria-live="polite"><strong>{account.phase.label} · {account.phase.clipsPerDay}</strong><span>{account.phase.plan}</span></div>}</div>
    <details className="operator-advanced"><summary>เลือกแนวคลิปเอง (ไม่บังคับ)</summary>
      <label>แนวคลิป<select value={mode} onChange={event => setMode(event.target.value)}><option value="AUTO">ให้ระบบเลือกตามบัญชี (แนะนำ)</option>
        <option value="GROWTH">ปั้นช่อง · คลิปให้คนกดติดตาม</option><option value="AFFILIATE">ขายสินค้า · ต้องมีสิทธิ์ TikTok Shop</option></select></label></details>
    <div className="operator-form-footer"><p>สร้างฟรีด้วยบัญชี Google Flow ที่ผูกไว้ คลิปเข้าคลังรอโพสต์</p>
      <Link className="operator-start-button" href={`/post?account=${encodeURIComponent(accountId)}&mode=${mode}`}>▶ สร้างคลิป</Link></div></div>;

  return <form action={startOperatorAction} className="operator-form">
    <input type="hidden" name="requestKey" value={requestKey}/>
    <div className="operator-fields">
      <label>บัญชี TikTok<select name="accountId" value={accountId} onChange={(event) => { const next = event.target.value; setAccountId(next); router.replace(`/auto?account=${encodeURIComponent(next)}`, { scroll: false }); }} required disabled={disabled}>
        {accounts.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select></label>
      <label>โหมด<select name="mode" value={mode} onChange={(event) => setMode(event.target.value)} disabled={disabled}>
        <option value="AUTO">AUTO · เลือกตามความพร้อม</option><option value="GROWTH">GROWTH · เพิ่มการเติบโต</option><option value="AFFILIATE">AFFILIATE · คอนเทนต์สินค้า</option>
      </select></label>
      <label>จำนวนคลิปสำหรับรอบนี้<input name="dailyTarget" type="number" min="1" defaultValue={Math.max(1, account?.target ?? 1)} key={`${accountId}-target`} required disabled={disabled}/></label>
      <label>งบต่อวัน (USD)<input name="dailyBudgetUsd" type="number" min="0" max={Math.min(1000, account?.budget ?? 0)} step="0.01" defaultValue={account?.budget ?? 0} key={`${accountId}-budget`} required disabled={disabled}/></label>
    </div>
    <div className="operator-form-footer">
      <p role="status">{!account ? "เพิ่มบัญชีก่อนเริ่ม" : disabled ? "มีงานที่กำลังทำอยู่ หยุดงานเดิมก่อนเริ่มใหม่" : !ready ? "บัญชีนี้ต้องเชื่อมต่อใหม่" : affiliateBlocked ? "บัญชีนี้ยังใช้โหมด Affiliate ไม่ได้" : account.budget <= 0 ? "กรุณาตั้งงบรายวันก่อนเริ่ม" : "ระบบจะตรวจความพร้อมก่อนเริ่มงาน"}</p>
      <StartButton disabled={!canStart}/>
    </div>
  </form>;
}
