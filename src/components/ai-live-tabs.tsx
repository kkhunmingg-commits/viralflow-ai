"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { aiLiveTabs } from "@/lib/navigation";

/** In-page switch between the main AI LIVE and LIVE Lite, shown at the top of both pages. */
export function AiLiveTabs() {
  const pathname = usePathname();
  return <nav className="clip-studio-tabs" aria-label="เลือกโหมด AI LIVE">
    {aiLiveTabs.map(tab => {
      const active = pathname === tab.href;
      return <Link key={tab.href} href={tab.href} className={active ? "clip-studio-tab active" : "clip-studio-tab"} aria-current={active ? "page" : undefined}>
        <span aria-hidden="true">{tab.short}</span>{tab.label}
      </Link>;
    })}
  </nav>;
}
