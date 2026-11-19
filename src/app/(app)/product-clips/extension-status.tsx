"use client";
import { useEffect, useState } from "react";

/** The extension version that can post clips from the user's Chrome (workers/flow-browser/extension.mjs). */
const POSTING_VERSION = [1, 2, 0];
const atLeast = (version: string) => {
  const parts = version.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((parts[i] ?? 0) !== POSTING_VERSION[i]) return (parts[i] ?? 0) > POSTING_VERSION[i];
  return true;
};

/** Whether this Chrome has the ViralFlow extension that posts approved clips (it marks the page as soon as it runs). */
export function ExtensionPostingStatus() {
  const [state, setState] = useState<"checking" | "ready" | "old" | "missing">("checking");
  useEffect(() => {
    const read = () => {
      const root = document.documentElement.dataset;
      return root.vfExtension !== "1" ? "missing" : atLeast(root.vfVersion ?? "1.0.0") ? "ready" : "old";
    };
    const first = setTimeout(() => setState(s => s === "checking" && read() === "ready" ? "ready" : s), 800);
    const timer = setTimeout(() => setState(read()), 4000);
    return () => { clearTimeout(first); clearTimeout(timer); };
  }, []);
  if (state === "checking") return <p className="manual-muted">กำลังตรวจส่วนขยาย ViralFlow ใน Chrome นี้…</p>;
  if (state === "ready") return <p className="pl-ext-ok">✓ Chrome นี้พร้อมโพสต์ออโต้แล้ว (ส่วนขยาย ViralFlow)</p>;
  return <p className="manual-warning">{state === "old" ? "ส่วนขยาย ViralFlow ใน Chrome นี้เป็นรุ่นเก่า ยังโพสต์ไม่ได้: " : "Chrome นี้ยังไม่มีส่วนขยาย ViralFlow: "}
    <a href="/downloads/viralflow-chrome-extension.zip" download>ดาวน์โหลดรุ่นใหม่</a>
    {state === "old" ? " แตกไฟล์ทับโฟลเดอร์เดิม แล้วกดปุ่มรีโหลด ⟳ ของ ViralFlow ใน chrome://extensions" : " แล้วติดตั้งตามขั้นตอนในหัวข้อ “ตัวเชื่อม Shopee/Lazada” ด้านบน"}</p>;
}
