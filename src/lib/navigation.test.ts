import { describe, expect, it } from "vitest";
import { advancedNavigation, navigation, primaryNavigation, settingsNavigation } from "./navigation";

const requiredRoutes = [
  "/auto",
  "/ai-live",
  "/settings",
  "/accounts",
  "/dashboard",
  "/product-radar",
  "/recommendations",
  "/categories",
  "/creative-studio",
    "/video-factory",
    "/compliance",
  "/publishing",
  "/commerce",
  "/analytics",
  "/learning",
  "/growth",
    "/operations",
  "/settings/integrations",
];

describe("application navigation", () => {
  it("keeps daily navigation focused and every existing route reachable exactly once", () => {
    const routes = [...navigation, ...settingsNavigation].map((item) => item.href);
    expect(routes).toEqual(requiredRoutes);
    expect(new Set(routes).size).toBe(routes.length);
    expect(primaryNavigation.map((item) => item.href)).toEqual(["/auto", "/ai-live", "/settings"]);
    expect(advancedNavigation[0].href).toBe("/accounts");
  });
});
