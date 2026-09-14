import Link from "next/link";
import { SidebarNav } from "@/components/sidebar-nav";

export function Sidebar() {
  return (
    <aside className="sidebar">
      <Link href="/dashboard" className="brand sidebar-brand">
        <span className="brand-mark">V</span>
        <span>ViralFlow AI</span>
      </Link>
      <p className="nav-label">WORKSPACE</p>
      <SidebarNav />
      <div className="sidebar-status">
        <span className="signal-dot" />
        <div>
          <strong>ระบบพร้อมใช้งาน</strong>
          <small>Phase 1 foundation</small>
        </div>
      </div>
    </aside>
  );
}

