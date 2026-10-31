"use client";

import { useState } from "react";
import { disconnectTikTokAccount } from "./tiktok-actions";

export function DisconnectTikTokButton({ accountId, accountName }: { accountId: string; accountName: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return <button className="accounts-disconnect" type="button" onClick={() => setConfirming(true)}>ยกเลิกการเชื่อมต่อ</button>;
  }

  return <form className="accounts-disconnect-confirm" action={disconnectTikTokAccount.bind(null, accountId)}>
    <p>ยกเลิกการเชื่อมต่อ {accountName}?</p>
    <button className="accounts-disconnect-cancel" type="button" onClick={() => setConfirming(false)}>กลับ</button>
    <button className="accounts-disconnect" type="submit">ยืนยันการยกเลิก</button>
  </form>;
}
