"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clipStudioTabs } from "@/lib/navigation";

/** In-page switch between the clip studios (promo clips / product links / drama series), shown at the top of each studio page. */
export function ClipStudioTabs() {
  const pathname = usePathname();
  // The most specific tab wins (/product-clips/tiktok is not the Shopee tab).
  const current = clipStudioTabs.filter(tab => pathname === tab.href || pathname.startsWith(tab.href + "/")).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return <nav className="clip-studio-tabs" aria-label="เลือกประเภทคลิป">
    {clipStudioTabs.map(tab => {
      const active = tab.href === current;
      return <Link key={tab.href} href={tab.href} className={active ? "clip-studio-tab active" : "clip-studio-tab"} aria-current={active ? "page" : undefined}>
        <span aria-hidden="true">{tab.short}</span>{tab.label}
      </Link>;
    })}
  </nav>;
}
