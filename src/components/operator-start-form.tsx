"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
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
}

function StartButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <button className="operator-start-button" type="submit" disabled={disabled || pending}>{pending ? "กำลังบันทึกแผน…" : "START AUTO"}<span aria-hidden="true">↗</span></button>;
}

export function OperatorStartForm({ accounts, requestKey, disabled }: { accounts: AccountOption[]; requestKey: string; disabled: boolean }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [mode, setMode] = useState("AUTO");
  const account = accounts.find((item) => item.id === accountId);
  const ready = account?.status === "active" && account.authorization === "authorized";
  const affiliateBlocked = mode === "AFFILIATE" && account?.effectiveMode !== "AFFILIATE";
  const canStart = Boolean(account && ready && !affiliateBlocked && account.hardLimit > 0 && !disabled);

  return <form action={startOperatorAction} className="operator-form">
    <input type="hidden" name="requestKey" value={requestKey}/>
    <div className="operator-fields">
      <label>บัญชี TikTok<select name="accountId" value={accountId} onChange={(event) => setAccountId(event.target.value)} required disabled={disabled}>
        {accounts.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select></label>
      <label>โหมด<select name="mode" value={mode} onChange={(event) => setMode(event.target.value)} disabled={disabled}>
        <option value="AUTO">AUTO · เลือกตามความพร้อม</option><option value="GROWTH">GROWTH · เพิ่มการเติบโต</option><option value="AFFILIATE">AFFILIATE · คอนเทนต์สินค้า</option>
      </select></label>
      <label>เป้าหมายโพสต์ / วัน<input name="dailyTarget" type="number" min="1" max={account?.hardLimit || 1} defaultValue={Math.max(1, account?.target ?? 1)} key={`${accountId}-target`} required disabled={disabled}/></label>
      <label>งบวิดีโอ / วัน (USD)<input name="dailyBudgetUsd" type="number" min="0" max={Math.min(1000, account?.budget ?? 0)} step="0.01" defaultValue={account?.budget ?? 0} key={`${accountId}-budget`} required disabled={disabled}/></label>
    </div>
    <div className="operator-form-footer">
      <p role="status">{!account ? "เพิ่มบัญชีก่อนเริ่ม" : disabled ? "มีแผนที่ยังทำงานอยู่ หยุดแผนเดิมก่อนเริ่มใหม่" : !ready ? "SETUP REQUIRED · เชื่อมต่อและตรวจสถานะบัญชี" : affiliateBlocked ? "SETUP REQUIRED · บัญชีนี้ยังไม่มีสิทธิ์ Affiliate" : account.budget <= 0 ? "ตั้งงบในหน้าบัญชีและอนุมัติผู้ให้บริการก่อนสร้างวิดีโอจริง" : "ระบบจะตรวจงบ สิทธิ์ และการอนุมัติอีกครั้งก่อนลงมือจริง"}</p>
      <StartButton disabled={!canStart}/>
    </div>
  </form>;
}
