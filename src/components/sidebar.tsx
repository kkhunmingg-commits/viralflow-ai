import Link from "next/link";
import { SidebarNav } from "@/components/sidebar-nav";

export function Sidebar() {
  return (
    <aside className="sidebar">
      <Link href="/auto" className="brand sidebar-brand">
        <span className="brand-mark">V</span>
        <span>ViralFlow AI</span>
      </Link>
      <p className="nav-label">ใช้งานหลัก</p>
      <SidebarNav />
      <div className="sidebar-status">
        <span className="signal-dot" />
        <div>
          <strong>Operator Center</strong>
          <small>ตรวจความพร้อมก่อนเริ่มทุกครั้ง</small>
        </div>
      </div>
    </aside>
  );
}

