export interface NavigationItem { href: string; label: string; short: string }
/** A sidebar entry. `also` lists other pages that keep this entry highlighted (its in-page tabs). */
export interface NavigationEntry extends NavigationItem { also?: readonly string[] }

/** Clip studios: one sidebar entry, switched with tabs inside the page. */
/** 16 Nov owner: the AI girl replaces the old warm-up clips; drama series stays. Product-link clips are off the menu
 * (the page still opens by address). */
export const clipStudioTabs: readonly NavigationItem[] = [
  { href: "/girl", label: "สาว AI ประจำช่อง", short: "💃" },
  { href: "/post", label: "สร้างคลิป · คลังคลิป", short: "▶" },
  { href: "/drama", label: "ละครซีรีส์", short: "🎬" },
];

/** Everyday destinations, in the order an owner works through a day. Other feature routes remain reachable. */
export const navigationGroups: ReadonlyArray<{ label: string; items: readonly NavigationEntry[] }> = [
  {
    label: "งานประจำวัน",
    items: [
      { href: "/auto", label: "หน้าหลัก", short: "⌂" },
      { href: "/girl", label: "สร้างคลิป", short: "▶", also: [...clipStudioTabs.map(tab => tab.href), "/product-clips"] },
      { href: "/ai-live", label: "AI LIVE", short: "●" },
    ],
  },
  {
    label: "บัญชีและรายได้",
    items: [
      { href: "/accounts", label: "บัญชี TikTok", short: "♪" },
      { href: "/analytics/finance", label: "รายได้", short: "฿" },
      { href: "/profile", label: "โปรไฟล์", short: "☺" },
    ],
  },
];

export const navigation: readonly NavigationEntry[] = navigationGroups.flatMap(group => group.items);

export const primaryNavigation = navigation;

const onPage = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + "/");

/** Whether a sidebar/tab-bar entry is the current page (its in-page tabs included). */
export const isNavActive = (pathname: string, item: NavigationEntry) =>
  [item.href, ...(item.also ?? [])].some(href => onPage(pathname, href));
