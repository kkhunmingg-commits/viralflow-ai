"use client";
import { useEffect, useState } from "react";

/** The ViralFlow extension marks the page as soon as it runs; without it, say how to install it. */
export function ExtensionCheck() {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setMissing(document.documentElement.dataset.vfExtension !== "1"), 5000);
    return () => clearTimeout(timer);
  }, []);
  if (!missing) return null;
  return <p className="manual-warning">ยังไม่ได้ติดตั้งส่วนขยาย ViralFlow ใน Chrome นี้: ดูวิธีติดตั้งในหน้าคลิปสินค้า (หัวข้อ “ส่วนขยาย Chrome”)</p>;
}
