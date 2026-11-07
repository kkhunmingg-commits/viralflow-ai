"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavActive, navigation } from "@/lib/navigation";

/** Phone navigation: a thumb-reach tab bar at the bottom instead of the sidebar. Profile stays on the avatar. */
const tabs = navigation.filter(item => item.href !== "/profile");
const shortLabels: Record<string, string> = { "/auto": "หน้าหลัก", "/post": "สร้างคลิป", "/ai-live": "LIVE", "/accounts": "บัญชี", "/analytics/finance": "รายได้" };

export function MobileNav() {
  const pathname = usePathname();
  return <nav className="mobile-tabbar" aria-label="เมนูหลัก">
    {tabs.map(item => {
      const active = isNavActive(pathname, item);
      return <Link key={item.href} href={item.href} className={active ? "mobile-tab active" : "mobile-tab"} aria-current={active ? "page" : undefined}>
        <span aria-hidden="true">{item.short}</span>{shortLabels[item.href] ?? item.label}
      </Link>;
    })}
  </nav>;
}
