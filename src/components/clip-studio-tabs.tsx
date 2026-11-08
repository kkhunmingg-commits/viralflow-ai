"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clipStudioTabs } from "@/lib/navigation";

/** In-page switch between the clip studios (promo clips / drama series), shown at the top of each studio page. */
export function ClipStudioTabs() {
  const pathname = usePathname();
  return <nav className="clip-studio-tabs" aria-label="เลือกประเภทคลิป">
    {clipStudioTabs.map(tab => {
      const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
      return <Link key={tab.href} href={tab.href} className={active ? "clip-studio-tab active" : "clip-studio-tab"} aria-current={active ? "page" : undefined}>
        <span aria-hidden="true">{tab.short}</span>{tab.label}
      </Link>;
    })}
  </nav>;
}
