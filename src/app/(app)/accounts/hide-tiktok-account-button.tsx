"use client";

import { useActionState, useId, useState } from "react";
import { hideDisconnectedTikTokAccount } from "./tiktok-actions";

export function HideTikTokAccountButton({ accountId, accountName }: { accountId: string; accountName: string }) {
  const [confirming, setConfirming] = useState(false);
  const confirmationId = useId();
  const [state, action, pending] = useActionState(
    hideDisconnectedTikTokAccount.bind(null, accountId),
    { error: null as string | null },
  );

  return <div className="accounts-hide-control">
    <button
      className="accounts-hide-button"
      type="button"
      aria-label={`เอาบัญชี ${accountName} ออกจากรายการ`}
      aria-expanded={confirming}
      aria-controls={confirmationId}
      onClick={() => setConfirming((value) => !value)}
      disabled={pending}
    ><span aria-hidden="true">×</span></button>
    {confirming ? <form id={confirmationId} className="accounts-hide-confirm" action={action}>
      <p>เอา {accountName} ออกจากรายการ?</p>
      <small>ประวัติยังอยู่ และบัญชีจะกลับมาเมื่อเชื่อม TikTok ใหม่</small>
      {state.error ? <p className="accounts-hide-error" role="alert">{state.error}</p> : null}
      <div className="accounts-hide-confirm-actions">
        <button className="accounts-disconnect-cancel" type="button" onClick={() => setConfirming(false)} disabled={pending}>กลับ</button>
        <button className="accounts-disconnect" type="submit" disabled={pending}>{pending ? "กำลังนำออก…" : "เอาออกจากรายการ"}</button>
      </div>
    </form> : null}
  </div>;
}
