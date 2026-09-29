import Link from "next/link";
import { SidebarNav } from "@/components/sidebar-nav";

export function Sidebar() {
  return (
    <aside className="sidebar">
      <Link href="/auto" className="brand sidebar-brand">
        <span className="brand-mark">V</span>
        <span>ViralFlow AI</span>
      </Link>
      <p className="nav-label">เมนูหลัก</p>
      <SidebarNav />
    </aside>
  );
}

