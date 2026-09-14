"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navigation, settingsNavigation } from "@/lib/navigation";

function NavGroup({
  items,
}: {
  items: ReadonlyArray<{ href: string; label: string; short: string }>;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="เมนูหลัก">
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
  return (
    <>
      <NavGroup items={navigation} />
      <div className="nav-divider" />
      <NavGroup items={settingsNavigation} />
    </>
  );
}

