"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navigationGroups, type NavigationEntry, type NavigationItem } from "@/lib/navigation";

const isActive = (pathname: string, href: string) => pathname === href || (href !== "/settings" && pathname.startsWith(href + "/"));

function NavLink({ item, sub }: { item: NavigationItem; sub?: boolean }) {
  const active = isActive(usePathname(), item.href);
  return (
    <Link href={item.href} className={`nav-link${sub ? " nav-sublink" : ""}${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
      <span className="nav-icon" aria-hidden="true">{item.short}</span>
      <span>{item.label}</span>
    </Link>
  );
}

/** A heading with its pages under it, always open, so each page is one click away. */
function NavParent({ item }: { item: NavigationEntry }) {
  const pathname = usePathname();
  const open = (item.children ?? []).some(child => isActive(pathname, child.href));
  return (
    <div className={open ? "nav-parent open" : "nav-parent"} role="group" aria-label={item.label}>
      <p className="nav-parent-label"><span className="nav-icon" aria-hidden="true">{item.short}</span><span>{item.label}</span></p>
      <div className="nav-children">{item.children!.map(child => <NavLink key={child.href} item={child} sub />)}</div>
    </div>
  );
}

function NavGroup({ items, label }: { items: readonly NavigationEntry[]; label: string }) {
  return (
    <nav aria-label={label}>
      <p className="nav-label">{label}</p>
      {items.map(item => item.children?.length ? <NavParent key={item.label} item={item} /> : <NavLink key={item.href} item={item} />)}
    </nav>
  );
}

export function SidebarNav() {
  return <>{navigationGroups.map((group) => <NavGroup key={group.label} items={group.items} label={group.label} />)}</>;
}
