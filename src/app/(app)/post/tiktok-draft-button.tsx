"use client";
import { useCallback, useEffect, useState } from "react";

export interface DraftReceipt { receipt: string; status: string }
const labels: Record<string, string> = {
  RESERVED: "กำลังเตรียมส่ง…", INITIALIZED: "กำลังส่งวิดีโอเข้า TikTok…", UPLOADED: "ส่งแล้ว TikTok กำลังเตรียมวิดีโอ…",
  SEND_TO_USER_INBOX: "✓ อยู่ในแบบร่าง TikTok แล้ว เปิดแอป TikTok ดูการแจ้งเตือน (Inbox) แล้วกดโพสต์",
  PUBLISH_COMPLETE: "✓ โพสต์ผ่าน TikTok แล้ว", FAILED: "TikTok รับวิดีโอนี้ไม่ได้ กดส่งใหม่ได้",
  RECONCILIATION_REQUIRED: "ยังยืนยันการส่งไม่ได้ กดตรวจสถานะ",
};
const errors: Record<string, string> = {
  inbox_reconnect_required: "บัญชีนี้ยังไม่ได้อนุญาตให้ส่งวิดีโอเข้า TikTok กด “อนุญาตส่งเข้า TikTok” ก่อน",
  inbox_not_available: "แอป TikTok ของเรายังไม่ได้รับอนุมัติให้ส่งแบบร่างเข้าบัญชีนี้ (ตอนนี้ใช้ได้เฉพาะบัญชีทดสอบ Sandbox)",
  account_unavailable: "บัญชี TikTok นี้ยังไม่ได้เชื่อมแบบจริง หรือหมดอายุ เชื่อมบัญชีใหม่ก่อน",
  CLIP_NOT_IN_LIBRARY: "คลิปนี้ไม่อยู่ในคลังแล้ว", invalid_mp4: "ไฟล์คลิปนี้ไม่ใช่ MP4 ที่ TikTok รับได้",
};
const settled = (status: string) => ["SEND_TO_USER_INBOX", "PUBLISH_COMPLETE", "FAILED"].includes(status);

/** One click: the server sends the library MP4 into the TikTok inbox as a draft. Nothing is published. */
export function TikTokDraftButton({ clipId, accountId, initial }: { clipId: string; accountId: string; initial: DraftReceipt | null }) {
  const [receipt, setReceipt] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const check = useCallback(async (current: DraftReceipt, signal?: AbortSignal) => {
    const response = await fetch(`/api/tiktok/inbox-upload?account=${encodeURIComponent(accountId)}&receipt=${encodeURIComponent(current.receipt)}`, { cache: "no-store", signal });
    if (!response.ok) throw new Error("status_unavailable");
    const next: DraftReceipt = await response.json();
    setReceipt(next);
    return next;
  }, [accountId]);

  const currentId = receipt?.receipt, done = receipt ? settled(receipt.status) : true;
  useEffect(() => {
    if (!currentId || done) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>, attempts = 0, current: DraftReceipt = { receipt: currentId, status: "UPLOADED" };
    const poll = async () => {
      try { current = await check(current, controller.signal); } catch { /* The button below can check again. */ }
      if (!controller.signal.aborted && !settled(current.status) && ++attempts < 8) timer = setTimeout(poll, Math.min(3000 * 2 ** attempts, 30000));
    };
    timer = setTimeout(poll, 3000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [currentId, done, check]);

  async function send() {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/library/${clipId}/tiktok-draft`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(errors[body.error] ?? "ส่งเข้า TikTok ไม่สำเร็จ ลองอีกครั้ง"); return; }
      setReceipt({ receipt: body.receipt, status: body.status });
    } catch { setMessage("ส่งเข้า TikTok ไม่สำเร็จ ลองอีกครั้ง"); }
    finally { setBusy(false); }
  }
  async function refresh() {
    if (!receipt || busy) return;
    setBusy(true); setMessage("");
    try { await check(receipt); } catch { setMessage("ยังตรวจสถานะไม่ได้ ลองอีกครั้งภายหลัง"); }
    finally { setBusy(false); }
  }

  const canSend = !receipt || receipt.status === "FAILED" || receipt.status === "RECONCILIATION_REQUIRED";
  return <div className="library-draft">
    {canSend && <button className="manual-primary" type="button" disabled={busy} onClick={send}>{busy ? "กำลังส่ง…" : "ส่งเข้า TikTok (แบบร่าง)"}</button>}
    {receipt && !settled(receipt.status) && <button className="library-link" type="button" disabled={busy} onClick={refresh}>ตรวจสถานะ</button>}
    <small role="status" aria-live="polite">{message || (receipt ? labels[receipt.status] ?? "กำลังตรวจสถานะ" : "ส่งเข้าแบบร่างใน TikTok ยังไม่โพสต์ คุณเปิดแอปแล้วกดโพสต์เอง")}</small>
  </div>;
}
