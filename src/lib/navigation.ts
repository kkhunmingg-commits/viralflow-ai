/** Everyday destinations. Existing feature routes remain available to the app. */
export const navigation = [
  { href: "/home", label: "Home", short: "HM" },
  { href: "/post", label: "POST", short: "PS" },
  { href: "/ai-live", label: "AI LIVE", short: "LV" },
  { href: "/accounts", label: "Accounts", short: "AC" },
] as const;

export const primaryNavigation = navigation;
