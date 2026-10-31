"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Receipt = { receipt: string; status: string };
const labels: Record<string, string> = {
  RESERVED: "กำลังเตรียมการส่ง", INITIALIZED: "กำลังส่งวิดีโอ", UPLOADED: "TikTok กำลังเตรียมวิดีโอ",
  SEND_TO_USER_INBOX: "TikTok แจ้งว่าส่งวิดีโอเข้า Inbox แล้ว เปิดการแจ้งเตือนระบบในแอป TikTok เพื่อตรวจและแก้ไขวิดีโอ",
  PUBLISH_COMPLETE: "คุณเผยแพร่วิดีโอผ่าน TikTok แล้ว", FAILED: "TikTok ไม่สามารถเตรียมวิดีโอนี้ได้",
  RECONCILIATION_REQUIRED: "ยังยืนยันการส่งไม่ได้ กรุณาตรวจสถานะเดิมก่อนส่งอีกครั้ง",
};
const terminal = (status: string) => ["SEND_TO_USER_INBOX", "PUBLISH_COMPLETE", "FAILED"].includes(status);

export function InboxUpload({ accountId }: { accountId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [consent, setConsent] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const receiptKey = `viralflow-inbox-receipt:${accountId}`;

  useEffect(() => {
    const timer = setTimeout(() => { try {
      const saved = sessionStorage.getItem(receiptKey);
      if (saved) { const value = JSON.parse(saved); if (typeof value.receipt === "string" && labels[value.status]) setReceipt(value); }
    } catch { /* Storage is optional; the server reservation remains authoritative. */ } }, 0);
    return () => clearTimeout(timer);
  }, [receiptKey]);
  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);

  const checkStatus = useCallback(async (current: Receipt, signal?: AbortSignal) => {
    const response = await fetch(`/api/tiktok/inbox-upload?account=${encodeURIComponent(accountId)}&receipt=${encodeURIComponent(current.receipt)}`, { cache: "no-store", signal });
    if (!response.ok) throw new Error("status_unavailable");
    const next: Receipt = await response.json();
    setReceipt(next);
    try { sessionStorage.setItem(receiptKey, JSON.stringify(next)); } catch { /* Optional storage. */ }
    return next;
  }, [accountId, receiptKey]);
  const currentId = receipt?.receipt;
  const finished = receipt ? terminal(receipt.status) : false;
  useEffect(() => {
    if (!currentId || finished) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    let current: Receipt = { receipt: currentId, status: "UPLOADED" };
    const poll = async () => {
      try { current = await checkStatus(current, controller.signal); }
      catch { if (!controller.signal.aborted) setMessage("ตรวจสถานะไม่ได้ในขณะนี้ คุณตรวจรายการเดิมอีกครั้งได้โดยไม่ต้องส่งใหม่"); }
      if (!controller.signal.aborted && !terminal(current.status) && ++attempts < 8) timer = setTimeout(poll, Math.min(3000 * 2 ** attempts, 30000));
    };
    timer = setTimeout(poll, 3000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [currentId, finished, checkStatus]);

  async function send() {
    if (!file || !consent || inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const hashBytes = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const hash = Array.from(new Uint8Array(hashBytes), n => n.toString(16).padStart(2, "0")).join("");
      const storageKey = `viralflow-inbox-key:${accountId}:${hash}`;
      let key = sessionStorage.getItem(storageKey);
      if (!key) { key = crypto.randomUUID(); sessionStorage.setItem(storageKey, key); }
      const body = new FormData();
      body.set("account", accountId); body.set("key", key); body.set("video", file); body.set("consent", "yes");
      const response = await fetch("/api/tiktok/inbox-upload", { method: "POST", body });
      if (!response.ok) throw new Error("send_unavailable");
      const saved: Receipt = await response.json(); setReceipt(saved);
      sessionStorage.setItem(receiptKey, JSON.stringify(saved));
    } catch { setMessage("ยังยืนยันการส่งไม่ได้ ลองตรวจสถานะหรือเลือกไฟล์เดิมอีกครั้ง ระบบจะไม่ส่งไฟล์เดิมซ้ำ"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function refresh() {
    if (!receipt || inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try { await checkStatus(receipt); }
    catch { setMessage("ยังตรวจสถานะไม่ได้ กรุณาลองอีกครั้งภายหลัง"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div style={{ display: "grid", gap: 20, marginTop: 24 }}>
    <label>เลือก MP4 ขนาดไม่เกิน 4 MB <input aria-label="เลือกวิดีโอ MP4" type="file" accept="video/mp4" disabled={busy} onChange={event => {
      const chosen = event.target.files?.[0];
      if (!chosen || chosen.size > 4_000_000 || chosen.type !== "video/mp4") { setMessage("กรุณาเลือก MP4 ขนาดไม่เกิน 4 MB"); setFile(null); return; }
      setFile(chosen); setPreview(URL.createObjectURL(chosen)); setMessage(""); setConsent(false);
    }} /></label>
    {file && preview && <video controls playsInline src={preview} style={{ width: "100%", maxHeight: 360, borderRadius: 16 }} />}
    <label style={{ display: "flex", gap: 12, alignItems: "start" }}><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />
      ฉันมีสิทธิ์ใช้ภาพและเสียงในวิดีโอนี้ และยินยอมส่งไปยังบัญชี TikTok ที่เลือก โดยยังไม่เผยแพร่อัตโนมัติ</label>
    <button className="accounts-connect" disabled={!file || !consent || busy} onClick={send}>{busy ? "กำลังส่ง…" : "ส่งเข้า TikTok"}</button>
    <p role="status" aria-live="polite">{message || (receipt ? labels[receipt.status] ?? "กำลังตรวจสถานะ" : "ตรวจตัวอย่างและบัญชีก่อนส่ง")}</p>
    {receipt && !["PUBLISH_COMPLETE", "FAILED"].includes(receipt.status) && <button className="accounts-detail-link" disabled={busy} onClick={refresh}>{busy ? "กำลังตรวจ…" : "ตรวจสถานะรายการเดิม"}</button>}
  </div>;
}
