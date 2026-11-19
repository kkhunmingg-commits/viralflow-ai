"use client";
import Link from "next/link";
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
    {state === "old" ? <>เปิด <code>chrome://extensions</code> แล้วกดปุ่มรีโหลด ⟳ ที่ ViralFlow ครั้งเดียว (ต่อไปอัปเดตเอง) ถ้ายังเป็นรุ่นเก่า <Link href="/post">ดาวน์โหลดตัวติดตั้งใหม่</Link> แล้วติดตั้งทับ</>
      : <>ติดตั้งครั้งเดียวด้วย <Link href="/post">ตัวติดตั้งเครื่องสร้างคลิป (Windows)</Link> ส่วนขยายมาในตัวเดียวกัน</>}</p>;
}
