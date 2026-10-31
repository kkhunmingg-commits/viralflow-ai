"use client";

import { useFormStatus } from "react-dom";
import { transitionAutoAction } from "@/app/(app)/auto/actions";

function PendingButton({ label, className }: { label: string; className: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className={className} disabled={pending}>{pending ? "กำลังบันทึก…" : label}</button>;
}

export function OperatorRunControls({ runId, state }: { runId: string; state: string }) {
  if (["COMPLETED", "FAILED", "STOPPED"].includes(state)) return null;
  return <div className="operator-run-controls" aria-label="ควบคุมแผน">
    {state === "PAUSED" ? <form action={transitionAutoAction.bind(null, runId, "RESUME")}><PendingButton label="RESUME" className="primary-action"/></form>
      : <form action={transitionAutoAction.bind(null, runId, "PAUSE")}><PendingButton label="PAUSE" className="secondary-action"/></form>}
    <form action={transitionAutoAction.bind(null, runId, "STOP")} onSubmit={(event) => { if (!window.confirm("หยุดแผนนี้? ระบบจะไม่เริ่มงานใหม่จากแผนนี้ และจะเก็บหลักฐานงานที่ทำไปแล้ว")) event.preventDefault(); }}>
      <PendingButton label="STOP" className="danger-action"/>
    </form>
  </div>;
}
