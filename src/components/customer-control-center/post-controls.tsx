"use client";

import { useActionState, useId, useState } from "react";
import type { CustomerAccount, CustomerPostingMode } from "@/features/control-center/customer-types";
import { retryCustomerPostAction, saveCustomerPostScheduleAction, startCustomerPostAction, stopCustomerPostAction } from "@/app/(app)/post/actions";
import type { CustomerPostActionState } from "@/app/(app)/post/actions";

const initialState: CustomerPostActionState = { ok: false, message: "" };
const days = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

export function PostStartControls({ account, requestKey }: { account: CustomerAccount; requestKey: string }) {
  const [result, action, pending] = useActionState(startCustomerPostAction, initialState);
  const [saved, saveAction, saving] = useActionState(saveCustomerPostScheduleAction, initialState);
  const schedule = account.schedule;
  const [postingMode, setPostingMode] = useState<CustomerPostingMode>(schedule?.postingMode ?? "AUTO");
  const noteId = useId();
  const busy = pending || saving;
  const availability = account.postingAvailability?.[postingMode];
  const canStart = !(account.hasActiveRun ?? Boolean(account.activeRunId)) && account.hardLimit > 0 && (account.connected || postingMode === "EXPORT");
  return <form action={action} className="customer-post-form">
    <input type="hidden" name="accountId" value={account.id} />
    <input type="hidden" name="requestKey" value={requestKey} />
    <button type="submit" className="customer-primary-button customer-start-button" disabled={!canStart || busy}>
      <span aria-hidden="true">▶</span>{pending ? "กำลังเตรียมงาน…" : "START"}
    </button>
    <details className="customer-post-settings">
      <summary>ตั้งเวลาบัญชีนี้<span aria-hidden="true">⌄</span></summary>
      <div className="customer-post-settings-body">
        <div className="customer-control-fields">
          <label>วิธีโพสต์<select name="postingMode" value={postingMode} onChange={(event) => setPostingMode(event.target.value as CustomerPostingMode)} disabled={busy} aria-describedby={noteId}>
            <option value="AUTO">AUTO — โพสต์อัตโนมัติ</option><option value="DRAFT">DRAFT — ส่งให้คุณโพสต์</option><option value="EXPORT">EXPORT — ดาวน์โหลดไปโพสต์</option>
          </select></label>
          <label>แนวทางเนื้อหา<select name="creativeMode" defaultValue={schedule?.creativeMode ?? account.mode} disabled={busy}>
            <option value="AUTO">AUTO</option><option value="GROWTH">GROWTH</option><option value="AFFILIATE">AFFILIATE</option>
          </select></label>
          <label>คลิปต่อวัน<input name="clipsPerDay" type="number" inputMode="numeric" min={1} max={Math.min(20, account.hardLimit)} defaultValue={schedule?.clipsPerDay ?? account.target} required disabled={busy} /></label>
          <label>งบต่อวัน (USD)<input name="dailyBudgetUsd" type="number" inputMode="decimal" min={0} max={account.budget} step="0.01" defaultValue={schedule?.dailyBudgetUsd ?? account.budget} required disabled={busy} /></label>
          <label>เริ่มช่วงเวลา<input name="activeStart" type="time" defaultValue={schedule?.activeStart ?? "09:00"} required disabled={busy} /></label>
          <label>จบช่วงเวลา<input name="activeEnd" type="time" defaultValue={schedule?.activeEnd ?? "22:00"} required disabled={busy} /></label>
          <label>เขตเวลา<select name="timezone" defaultValue={schedule?.timezone ?? "UTC"} disabled={busy}>
            {[...new Set([schedule?.timezone ?? "UTC", "Asia/Bangkok", "Asia/Singapore", "Asia/Tokyo", "Europe/London", "America/New_York", "UTC"])].map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select></label>
          <label>เว้นระหว่างคลิป (นาที)<input name="minSpacingMinutes" type="number" inputMode="numeric" min={1} max={1440} defaultValue={schedule?.minSpacingMinutes ?? 60} required disabled={busy} /></label>
        </div>
        <fieldset className="customer-weekdays"><legend>วันทำงาน</legend>{days.map((label, day) => <label key={day}>
          <input type="checkbox" name="allowedDays" value={day} defaultChecked={(schedule?.allowedDays ?? [0, 1, 2, 3, 4, 5, 6]).includes(day)} disabled={busy} /><span>{label}</span>
        </label>)}</fieldset>
        <label className="customer-recurring"><input type="checkbox" name="enabled" defaultChecked={schedule?.enabled ?? false} disabled={busy} /><span>ทำงานต่อเนื่องตามเวลาของบัญชีนี้</span></label>
        <p className="customer-form-note" id={noteId}>{availability?.message ?? (postingMode === "EXPORT" ? "ดาวน์โหลดวิดีโอและคำบรรยายไปโพสต์เองได้ เมื่อคลิปผ่านการตรวจ" : postingMode === "DRAFT" ? "ส่งคลิปให้คุณโพสต์ได้เมื่อบัญชีได้รับสิทธิ์ที่จำเป็น" : "การโพสต์อัตโนมัติจะรอสิทธิ์เผยแพร่และการยืนยันคลิปตามจริง")}</p>
        <button type="submit" formAction={saveAction} className="customer-text-button customer-save-schedule" disabled={busy}>{saving ? "กำลังบันทึก…" : "บันทึกการตั้งเวลา"}</button>
      </div>
    </details>
    {!canStart && !account.actionRequired ? <p className="customer-form-note">บัญชีนี้มีงานอยู่แล้ว บัญชีอื่นยังเริ่มได้ตามปกติ</p> : null}
    {result.message || saved.message ? <p className={`customer-action-result ${(result.message ? result.ok : saved.ok) ? "good" : "attention"}`} role="status">{result.message || saved.message}</p> : null}
  </form>;
}

export function PostStopControl({ account }: { account: CustomerAccount }) {
  const [result, action, pending] = useActionState(stopCustomerPostAction, initialState);
  if (!account.canStop) return null;
  return <div className="customer-stop-control"><form action={action} onSubmit={(event) => {
    if (!window.confirm(`หยุดเฉพาะ ${account.name} ตอนนี้? บัญชีอื่นยังทำงานตามเดิม`)) event.preventDefault();
  }}>
    <input type="hidden" name="accountId" value={account.id} />
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
