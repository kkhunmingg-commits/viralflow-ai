import Link from "next/link";
import { BrandIcon } from "@/components/brand-icon";
import { SidebarNav } from "@/components/sidebar-nav";

export function Sidebar() {
  return (
    <aside className="sidebar">
      <Link href="/auto" className="brand sidebar-brand">
        <BrandIcon size={36} className="brand-mark" />
        <span>Viral Flow AI</span>
      </Link>
      <p className="nav-label">เมนูหลัก</p>
      <SidebarNav />
    </aside>
  );
}

