"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cutRestoreTicketAction, finishCutRestoreAction } from "./actions";

/** Lets the owner put back a posted episode's file from the copy they saved; the server keeps it only if it is the same cut. */
export function RestoreCut({ clipId }: { clipId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [note, setNote] = useState<string | null>(null);
  async function restore(file: File | undefined) {
    if (!file) return;
    setBusy(true); setNote("กำลังอัปโหลด…");
    try {
      const ticket = await cutRestoreTicketAction(clipId, file.size);
      if (!ticket.ok) { setNote(ticket.message); return; }
      const sent = await createClient().storage.from("video-assets").uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: "video/mp4" });
      if (sent.error) { setNote("อัปโหลดไม่สำเร็จ ลองใหม่อีกครั้ง"); return; }
      const error = await finishCutRestoreAction(clipId);
      setNote(error ?? "ใส่ไฟล์กลับแล้ว");
      if (!error) router.refresh();
    } catch { setNote("อัปโหลดไม่สำเร็จ ลองใหม่อีกครั้ง"); }
    finally { setBusy(false); }
  }
  return <label className="drama-restore">มีไฟล์ตอนนี้เก็บไว้? ใส่กลับเพื่อดูย้อนหลัง
    <input type="file" accept="video/mp4,.mp4" disabled={busy} onChange={e => restore(e.target.files?.[0])} />
    {note && <span className="manual-muted">{note}</span>}</label>;
}
