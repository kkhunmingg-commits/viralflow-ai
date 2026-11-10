"use client";
import { useEffect, useRef } from "react";

/**
 * The "ส่งเข้า ViralFlow" bookmark. React refuses javascript: links in JSX, so the link gets its code after it mounts.
 * The owner drags it to Chrome's bookmarks bar once, then presses it on any Shopee/Lazada product page.
 */
export function CaptureButton({ href }: { href: string }) {
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => { link.current?.setAttribute("href", href); }, [href]);
  return <div className="pl-capture">
    <a ref={link} className="pl-capture-link" draggable onClick={event => event.preventDefault()}>⚡ ส่งเข้า ViralFlow</a>
    <ol>
      <li>ลากปุ่มนี้ไปวางบนแถบบุ๊กมาร์กของ Chrome (ทำครั้งเดียว · ไม่เห็นแถบกด Ctrl+Shift+B)</li>
      <li>เปิดหน้าสินค้า Shopee/Lazada ใน Chrome ของคุณ (ล็อกอินค้างไว้ตามปกติ)</li>
      <li>กดปุ่ม ⚡ ส่งเข้า ViralFlow · ชื่อ รูป รายละเอียดเข้าคลิปที่รออยู่ทันที (ไม่มีคลิปรอ ระบบเริ่มคลิป 16 วิให้)</li>
    </ol>
  </div>;
}
