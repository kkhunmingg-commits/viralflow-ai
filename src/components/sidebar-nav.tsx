"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavActive, navigationGroups, type NavigationEntry } from "@/lib/navigation";

function NavGroup({ items, label }: { items: readonly NavigationEntry[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label}>
      <p className="nav-label">{label}</p>
      {items.map(item => {
        const active = isNavActive(pathname, item);
        return (
          <Link key={item.href} href={item.href} className={active ? "nav-link active" : "nav-link"} aria-current={active ? "page" : undefined}>
            <span className="nav-icon" aria-hidden="true">{item.short}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function SidebarNav() {
  return <>{navigationGroups.map((group) => <NavGroup key={group.label} items={group.items} label={group.label} />)}</>;
}
