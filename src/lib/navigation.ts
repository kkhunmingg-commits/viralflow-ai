export interface NavigationItem { href: string; label: string; short: string }
/** A sidebar entry: a page, or a heading whose pages sit under it as sub-menus. */
export interface NavigationEntry extends NavigationItem { children?: readonly NavigationItem[] }

/** Everyday destinations, in the order an owner works through a day. Other feature routes remain reachable. */
export const navigationGroups: ReadonlyArray<{ label: string; items: readonly NavigationEntry[] }> = [
  {
    label: "งานประจำวัน",
    items: [
      { href: "/auto", label: "หน้าหลัก", short: "⌂" },
      { href: "/post", label: "สร้างคลิป", short: "▶", children: [
        { href: "/post", label: "สร้างคลิปโปรโมท", short: "▶" },
        { href: "/drama", label: "ละครซีรีส์", short: "🎬" },
      ] },
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

/** Every page in the sidebar, sub-menus included (a heading counts as its pages). */
export const navigation: readonly NavigationItem[] = navigationGroups.flatMap(group => group.items.flatMap(item => item.children ?? [item]));

export const primaryNavigation = navigation;
