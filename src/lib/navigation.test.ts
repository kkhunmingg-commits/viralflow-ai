import { describe, expect, it } from "vitest";
import { clipStudioTabs, isNavActive, navigation, navigationGroups, primaryNavigation } from "./navigation";

describe("application navigation", () => {
  it("shows the everyday owner workflow without exposing internal feature pages", () => {
    const routes = navigation.map((item) => item.href);
    expect(routes).toEqual(["/auto", "/post", "/ai-live", "/accounts", "/analytics/finance", "/profile"]);
    expect(primaryNavigation).toBe(navigation);
  });

  it("groups daily work apart from accounts and income", () => {
    expect(navigationGroups.map((group) => group.items.length)).toEqual([3, 3]);
  });

  it("keeps one clip entry; promo clips and drama series are tabs inside the page", () => {
    const clip = navigationGroups[0].items.find((item) => item.label === "สร้างคลิป")!;
    expect(clipStudioTabs.map((tab) => [tab.href, tab.label])).toEqual([["/post", "สร้างคลิปโปรโมท"], ["/product-clips", "คลิปสินค้าจากลิงก์"], ["/drama", "ละครซีรีส์"]]);
    for (const path of ["/post", "/drama", "/drama/abc"]) expect(isNavActive(path, clip)).toBe(true);
    expect(isNavActive("/postx", clip)).toBe(false);
    expect(isNavActive("/drama", navigation[0])).toBe(false);
  });
});
