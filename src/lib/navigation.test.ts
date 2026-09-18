import { describe, expect, it } from "vitest";
import { navigation, settingsNavigation } from "./navigation";

const requiredRoutes = [
  "/dashboard",
  "/accounts",
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
  "/auto-mode",
  "/settings",
  "/settings/integrations",
];

describe("application navigation", () => {
  it("contains every protected Phase 1 route exactly once", () => {
    const routes = [...navigation, ...settingsNavigation].map((item) => item.href);
    expect(routes).toEqual(requiredRoutes);
    expect(new Set(routes).size).toBe(routes.length);
  });
});
