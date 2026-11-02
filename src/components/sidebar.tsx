import Link from "next/link";
import { SidebarNav } from "@/components/sidebar-nav";
import { BrandIcon } from "@/components/brand-icon";

export function Sidebar() {
  return (
    <aside className="sidebar">
      <Link href="/auto" className="brand sidebar-brand">
        <BrandIcon className="brand-mark" size={36} />
        <span>ViralFlow AI</span>
      </Link>
      <SidebarNav />
    </aside>
  );
}

