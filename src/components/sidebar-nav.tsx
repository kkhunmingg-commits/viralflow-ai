"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { advancedNavigation, primaryNavigation, settingsNavigation } from "@/lib/navigation";

function NavGroup({
  items,
  label,
}: {
  items: ReadonlyArray<{ href: string; label: string; short: string }>;
  label: string;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label={label}>
      {items.map((item) => {
        const active =
          pathname === item.href ||
          (item.href !== "/settings" && pathname.startsWith(item.href + "/"));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? "nav-link active" : "nav-link"}
            aria-current={active ? "page" : undefined}
          >
            <span className="nav-icon" aria-hidden="true">
              {item.short}
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <>
      <NavGroup items={primaryNavigation} label="ใช้งานหลัก" />
      <details className="advanced-nav" key={pathname.startsWith("/auto") || pathname.startsWith("/accounts") ? "primary" : "advanced"} open={!pathname.startsWith("/auto") && !pathname.startsWith("/accounts")}>
        <summary>เครื่องมือขั้นสูง <span aria-hidden="true">⌄</span></summary>
        <NavGroup items={advancedNavigation} label="เครื่องมือขั้นสูง" />
        <NavGroup items={settingsNavigation} label="การตั้งค่า" />
      </details>
    </>
  );
}

