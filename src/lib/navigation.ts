export const navigation = [
  { href: "/auto", label: "Control Center", short: "CC" },
  { href: "/accounts", label: "Accounts", short: "AC" },
  { href: "/dashboard", label: "ภาพรวม", short: "OV" },
  { href: "/product-radar", label: "Product Radar", short: "PR" },
  { href: "/recommendations", label: "คำแนะนำวันนี้", short: "RC" },
  { href: "/categories", label: "หมวดหมู่", short: "CA" },
  { href: "/creative-studio", label: "Creative Studio", short: "CS" },
  { href: "/video-factory", label: "Video Factory", short: "VF" },
  { href: "/compliance", label: "Compliance", short: "CG" },
  { href: "/publishing", label: "Publishing", short: "PB" },
  { href: "/commerce", label: "Commerce", short: "CM" },
  { href: "/analytics", label: "Analytics", short: "AN" },
  { href: "/learning", label: "Learning Loop", short: "LL" },
  { href: "/growth", label: "Growth Engine", short: "GR" },
  { href: "/operations", label: "Operations", short: "OP" },
] as const;

export const primaryNavigation = navigation.slice(0, 2);
export const advancedNavigation = navigation.slice(2);

export const settingsNavigation = [
  { href: "/settings", label: "ตั้งค่า", short: "ST" },
  { href: "/settings/integrations", label: "การเชื่อมต่อ", short: "IN" },
] as const;
