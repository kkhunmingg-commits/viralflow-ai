export interface NavigationItem { href: string; label: string; short: string }

/** Everyday destinations, in the order an owner works through a day. Other feature routes remain reachable. */
export const navigationGroups = [
  {
    label: "งานประจำวัน",
    items: [
      { href: "/auto", label: "หน้าหลัก", short: "⌂" },
      { href: "/post", label: "สร้างคลิปฟรี & คลัง", short: "▶" },
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
] as const;

export const navigation: readonly NavigationItem[] = navigationGroups.flatMap((group): readonly NavigationItem[] => group.items);

export const primaryNavigation = navigation;
