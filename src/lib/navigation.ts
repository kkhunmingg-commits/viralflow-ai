/** Everyday destinations. Existing feature routes remain available to the app. */
export const navigation = [
  { href: "/auto", label: "Home", short: "HM" },
  { href: "/accounts", label: "Accounts", short: "AC" },
  { href: "/ai-live", label: "AI LIVE", short: "LV" },
  { href: "/profile", label: "Profile", short: "ME" },
] as const;

export const primaryNavigation = navigation;
