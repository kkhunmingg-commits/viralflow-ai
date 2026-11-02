"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { closeSharedClipAction } from "./flow-actions";

/** Clipboard write with a fallback for browsers that block the async API (older iOS, in-app browsers). */
export async function copyToClipboard(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  try {
    const area = document.createElement("textarea");
    area.value = text; area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0";
    document.body.appendChild(area); area.select(); area.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch { return false; }
}

const files = new Map<string, Promise<File>>();
/** Downloads the clip once per page; the share sheet needs the bytes, not a link. */
function clipFile(clipId: string) {
  let file = files.get(clipId);
  if (!file) {
    file = fetch(`/api/library/${clipId}/video`, { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("download_failed");
      return new File([await response.blob()], `viralflow-${clipId.slice(0, 8)}.mp4`, { type: "video/mp4" });
    });
    file.catch(() => files.delete(clipId));
    files.set(clipId, file);
  }
  return file;
}

type State = "idle" | "loading" | "ready" | "shared" | "downloaded" | "error";

/**
 * Posting from the phone: one tap copies caption + hashtags and opens the phone's share sheet with the MP4,
 * so it goes straight into TikTok (or "Save video" to Photos). Browsers without file sharing get a download.
 */
export function ClipPhoneActions({ clipId, caption }: { clipId: string; caption: string }) {
  const [state, setState] = useState<State>("idle");
  const [copied, setCopied] = useState<boolean | null>(null);
  const [removed, setRemoved] = useState(false);
  const router = useRouter();

  /** The share sheet finished: the clip is in TikTok (or saved to the phone), so it leaves the library. */
  async function closeShared() {
    try {
      if (await closeSharedClipAction(clipId)) { setRemoved(true); setTimeout(() => router.refresh(), 4000); }
    } catch { /* keep the clip; "โพสต์แล้ว · ลบไฟล์" still works */ }
  }

  async function share(file: File) {
    if (!navigator.canShare?.({ files: [file] })) {
      const link = document.createElement("a");
      link.href = `/api/library/${clipId}/video?download=1`; link.download = file.name;
      document.body.appendChild(link); link.click(); link.remove();
      setState("downloaded");
      return;
    }
    try {
      await navigator.share({ files: [file] });
      setState("shared");
      void closeShared();
    } catch (error) {
      const name = (error as DOMException)?.name;
      // The download outlived the tap: the browser wants a fresh tap before opening the share sheet.
      if (name === "NotAllowedError") setState("ready");
      else setState(name === "AbortError" ? "idle" : "error");
    }
  }

  async function shareClip() {
    if (state === "loading") return;
    if (caption) setCopied(await copyToClipboard(caption));
    setState("loading");
    try { await share(await clipFile(clipId)); } catch { setState("error"); }
  }

  const status: Record<State, string> = {
    idle: "", loading: "กำลังโหลดคลิปลงมือถือ…", ready: "โหลดคลิปเสร็จแล้ว แตะปุ่มอีกครั้งเพื่อเปิดหน้าแชร์",
    shared: "✓ ส่งคลิปแล้ว เลือก TikTok แล้ววางคำบรรยายตอนโพสต์ หรือเลือก “บันทึกวิดีโอ” เพื่อเก็บลงคลังภาพ",
    downloaded: "✓ ดาวน์โหลดคลิปแล้ว", error: "โหลดคลิปไม่สำเร็จ ลองอีกครั้ง หรือกดดาวน์โหลด MP4",
  };

  return <div className="clip-phone-actions">
    <div className="clip-phone-buttons">
      <button type="button" className="manual-primary" onClick={shareClip} onPointerDown={() => { clipFile(clipId).catch(() => {}); }} disabled={state === "loading"}>
        <span aria-hidden="true">📲</span> {state === "loading" ? "กำลังโหลด…" : state === "ready" ? "แตะเพื่อแชร์คลิป" : "แชร์/บันทึกคลิป + คัดลอกคำบรรยาย"}
      </button>
    </div>
    {(copied !== null || state !== "idle") && <small role="status" aria-live="polite">
      {copied === true ? "✓ คัดลอกคำบรรยาย + แฮชแท็กแล้ว " : copied === false ? "คัดลอกอัตโนมัติไม่ได้ กดค้างที่กล่องคำบรรยายแล้วคัดลอกเอง " : ""}{status[state]}{removed ? " · ลบคลิปออกจากคลังแล้ว" : ""}</small>}
  </div>;
}
