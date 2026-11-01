"use client";
import { useEffect, useState } from "react";

const errors: Record<string, string> = {
  publish_reconnect_required: "บัญชีนี้ยังไม่ได้อนุญาตให้โพสต์ กด “อนุญาตส่งเข้า TikTok” อีกครั้ง",
  publish_not_available: "แอป TikTok ของเรายังไม่ได้รับอนุมัติให้โพสต์เข้าบัญชีนี้ (ตอนนี้ใช้ได้เฉพาะบัญชีทดสอบ Sandbox)",
  account_unavailable: "บัญชี TikTok นี้ยังไม่ได้เชื่อมแบบจริง หรือหมดอายุ เชื่อมบัญชีใหม่ก่อน",
  CLIP_NOT_IN_LIBRARY: "คลิปนี้ไม่อยู่ในคลังแล้ว", CLIP_BUSY_OR_GONE: "คลิปนี้กำลังโพสต์อยู่ หรือไม่อยู่ในคลังแล้ว รีโหลดหน้า",
  invalid_mp4: "ไฟล์คลิปนี้ไม่ใช่ MP4 ที่ TikTok รับได้", self_only_not_available: "บัญชีนี้โพสต์แบบ “เฉพาะฉัน” ไม่ได้",
  video_too_long: "คลิปยาวเกินที่บัญชีนี้โพสต์ได้", affiliate_use_draft: "คลิปขายของต้องส่งแบบร่าง เพื่อเปิดป้ายเนื้อหาแบรนด์ในแอป",
  spam_risk_too_many_posts: "วันนี้โพสต์ผ่านแอปครบโควตาของ TikTok แล้ว ลองพรุ่งนี้",
  spam_risk_user_banned_from_posting: "TikTok ระงับการโพสต์ของบัญชีนี้ชั่วคราว",
  unaudited_client_can_only_post_to_private_accounts: "บัญชี TikTok นี้เป็นสาธารณะ ซึ่ง TikTok ยังไม่ให้แอปเราโพสต์ตรงได้ (ต้องเป็นบัญชีส่วนตัวจนกว่าแอปผ่านการตรวจ)",
  post_uncertain: "ไม่แน่ใจว่า TikTok ได้คลิปแล้วหรือยัง เปิดโปรไฟล์ในแอปดูก่อน ถ้าไม่มีค่อยกดใหม่",
};
const labels: Record<string, string> = {
  PROCESSING_UPLOAD: "TikTok กำลังรับไฟล์…", PROCESSING_DOWNLOAD: "TikTok กำลังรับไฟล์…", SEND_TO_USER_INBOX: "TikTok กำลังเตรียมโพสต์…",
  PUBLISH_COMPLETE: "✓ โพสต์แบบ “เฉพาะฉัน” แล้ว เปิดโปรไฟล์ในแอป TikTok → เปิดคลิป → ⋯ → ความเป็นส่วนตัว → เลือก “ทุกคน”",
  FAILED: "TikTok โพสต์คลิปนี้ไม่สำเร็จ",
};

/** One click: the clip is posted to the owner's TikTok profile as "only me" with its caption; they make it public in the app. */
export function TikTokPrivatePostButton({ clipId, caption }: { clipId: string; caption: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [post, setPost] = useState<{ publishId: string; account: string } | null>(null);

  useEffect(() => {
    if (!post) return;
    let timer: ReturnType<typeof setTimeout>, attempts = 0;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await fetch(`/api/library/${clipId}/tiktok-private-post?account=${encodeURIComponent(post.account)}&publish_id=${encodeURIComponent(post.publishId)}`,
          { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (response.ok) {
          setMessage(labels[body.status] ?? "TikTok กำลังเตรียมโพสต์…");
          if (body.status === "PUBLISH_COMPLETE" || body.status === "FAILED") return;
        }
      } catch { /* Try again below. */ }
      if (!controller.signal.aborted && ++attempts < 10) timer = setTimeout(poll, Math.min(3000 * 2 ** attempts, 30000));
    };
    timer = setTimeout(poll, 3000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [post, clipId]);

  async function send() {
    if (busy || post) return;
    setBusy(true); setMessage("");
    // Copy now, while the click still allows clipboard writes, in case the post has to fall back to a draft.
    const copied = caption ? await navigator.clipboard.writeText(caption).then(() => true, () => false) : false;
    try {
      const response = await fetch(`/api/library/${clipId}/tiktok-private-post`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok && body.error === "unaudited_client_can_only_post_to_private_accounts") { await sendDraft(copied); return; }
      if (!response.ok) { setMessage(errors[body.error] ?? "โพสต์ไม่สำเร็จ ลองอีกครั้ง"); return; }
      setPost({ publishId: body.publishId, account: body.account });
      setMessage("ส่งแล้ว TikTok กำลังเตรียมโพสต์…");
    } catch { setMessage("โพสต์ไม่สำเร็จ ลองอีกครั้ง"); }
    finally { setBusy(false); }
  }

  /** TikTok refuses direct posts to a public account until the app is audited, so the same click delivers a draft instead. */
  async function sendDraft(copied: boolean) {
    const response = await fetch(`/api/library/${clipId}/tiktok-draft`, { method: "POST" }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    const reason = errors.unaudited_client_can_only_post_to_private_accounts;
    if (!response?.ok) { setMessage(`${reason} และส่งเป็นแบบร่างแทนไม่สำเร็จ (${body.error ?? "ลองอีกครั้ง"})`); return; }
    setMessage(`${reason} จึงส่งเข้าแบบร่างใน TikTok แทนแล้ว เปิดแอป TikTok ดูการแจ้งเตือน (Inbox)${copied ? " วางคำบรรยายที่คัดลอกไว้แล้ว" : " คัดลอกคำบรรยายจากกล่องด้านบน"} แล้วกดโพสต์`);
  }

  return <div className="library-draft">
    {!post && <button className="manual-primary" type="button" disabled={busy} onClick={send}>{busy ? "กำลังโพสต์…" : "โพสต์แบบส่วนตัว (มีคำบรรยาย)"}</button>}
    <small role="status" aria-live="polite">{message || "โพสต์พร้อมคำบรรยาย แฮชแท็ก และป้าย AI เป็น “เฉพาะฉัน” แล้วไปเปลี่ยนเป็น “ทุกคน” ในแอป"}</small>
  </div>;
}
