"use client";

import { useActionState, useId, useState } from "react";
import type { CustomerAccount } from "@/features/control-center/customer-types";
import { retryCustomerPostAction, startCustomerPostAction, stopCustomerPostAction } from "@/app/(app)/post/actions";
import type { CustomerPostActionState } from "@/app/(app)/post/actions";
import { categoryName } from "./presentation";

const initialState: CustomerPostActionState = { ok: false, message: "" };

export function PostStartControls({ account, requestKey }: { account: CustomerAccount; requestKey: string }) {
  const [result, action, pending] = useActionState(startCustomerPostAction, initialState);
  const [mode, setMode] = useState(account.mode);
  const modeNoteId = useId();
  const maxTarget = Math.max(1, Math.min(20, account.hardLimit));
  return <form action={action} className="customer-post-form">
    <input type="hidden" name="accountId" value={account.id} />
    <input type="hidden" name="requestKey" value={requestKey} />
    <button type="submit" className="customer-primary-button customer-start-button" disabled={!account.canStart || pending}>
      <span aria-hidden="true">▶</span>{pending ? "กำลังเตรียมงาน…" : "START AUTO"}
    </button>
    <details className="customer-post-settings">
      <summary>ตั้งค่างาน<span aria-hidden="true">⌄</span></summary>
      <div className="customer-post-settings-body">
      <div className="customer-control-fields">
        <label>โหมดบัญชี<select name="mode" value={mode} onChange={(event) => setMode(event.target.value as CustomerAccount["mode"])} disabled={pending}>
          <option value="AUTO">AUTO</option><option value="GROWTH">GROWTH</option><option value="AFFILIATE">AFFILIATE</option>
        </select></label>
        <label>เป้าหมายคลิปต่อวัน<input name="dailyTarget" type="number" inputMode="numeric" min={1} max={maxTarget}
          defaultValue={Math.max(1, Math.min(account.target, maxTarget))} required disabled={pending} /></label>
        <label>งบต่อวัน (USD)<input name="dailyBudgetUsd" type="number" inputMode="decimal" min={0} max={Math.max(0, account.budget)} step="0.01"
          defaultValue={account.budget} required disabled={pending} /></label>
        <label>วิธีเผยแพร่<select defaultValue="AUTO" disabled aria-describedby={modeNoteId}>
          <option value="AUTO">AUTO</option><option value="DRAFT" disabled>DRAFT — ยังไม่เปิดใช้งาน</option><option value="EXPORT" disabled>EXPORT — ยังไม่เปิดใช้งาน</option>
        </select></label>
      </div>
      <p className="customer-form-note" id={modeNoteId}>เป้าหมายและโหมดนี้ใช้กับงานที่กำลังจะเริ่ม การเผยแพร่ยังต้องผ่านการตรวจและสิทธิ์ของบัญชี</p>
      <div className="customer-post-preferences">
        <div><span>หมวดสินค้าที่สนใจ</span><strong>{account.categories.length ? account.categories.map(categoryName).join(" · ") : "ยังไม่ได้กำหนด"}</strong></div>
        <div><span>ช่วงเวลาโพสต์</span><strong>ดูเวลาของแต่ละคลิป</strong></div>
        <p>ยังไม่เปิดให้เปลี่ยนหมวดสินค้า ช่วงเวลา หรือเปิดงานอัตโนมัติประจำจากหน้านี้</p>
      </div>
      </div>
    </details>
    {!account.canStart && !account.actionRequired ? <p className="customer-form-note">รอให้งานที่กำลังทำอยู่เสร็จก่อนเริ่มงานใหม่</p> : null}
    {result.message ? <p className={`customer-action-result ${result.ok ? "good" : "attention"}`} role="status">{result.message}</p> : null}
  </form>;
}

export function PostStopControl({ account }: { account: CustomerAccount }) {
  const [result, action, pending] = useActionState(stopCustomerPostAction, initialState);
  if (!account.canStop || !account.activeRunId || !account.isSingleAccountRun) return null;
  return <div className="customer-stop-control"><form action={action} onSubmit={(event) => {
    if (!window.confirm(`หยุดงานของ ${account.name} ตอนนี้? ผลงานที่ผ่านมาเก็บไว้ตามเดิม`)) event.preventDefault();
  }}>
    <input type="hidden" name="accountId" value={account.id} /><input type="hidden" name="runId" value={account.activeRunId} />
    <button className="customer-stop-button" type="submit" disabled={pending}>{pending ? "กำลังหยุด…" : "STOP"}</button>
  </form>{result.message ? <p role="status" className={`customer-action-result ${result.ok ? "good" : "attention"}`}>{result.message}</p> : null}</div>;
}

export function PostRetryControl({ accountId, queueId }: { accountId: string; queueId: string }) {
  const [result, action, pending] = useActionState(retryCustomerPostAction, initialState);
  return <div><form action={action} onSubmit={(event) => {
    if (!window.confirm("ตรวจและดำเนินการคลิปนี้อีกครั้ง? ระบบจะตรวจความพร้อมก่อนเผยแพร่")) event.preventDefault();
  }}>
    <input type="hidden" name="accountId" value={accountId} /><input type="hidden" name="queueId" value={queueId} />
    <button className="customer-text-button" type="submit" disabled={pending}>{pending ? "กำลังตรวจ…" : "ลองอีกครั้ง"}</button>
  </form>{result.message ? <p role="status" className={`customer-action-result ${result.ok ? "good" : "attention"}`}>{result.message}</p> : null}</div>;
}
