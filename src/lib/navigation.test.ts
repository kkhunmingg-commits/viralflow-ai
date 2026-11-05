import { describe, expect, it } from "vitest";
import { navigation, navigationGroups, primaryNavigation } from "./navigation";

describe("application navigation", () => {
  it("shows the everyday owner workflow without exposing internal feature pages", () => {
    const routes = navigation.map((item) => item.href);
    expect(routes).toEqual(["/auto", "/post", "/drama", "/ai-live", "/accounts", "/analytics/finance", "/profile"]);
    expect(primaryNavigation).toBe(navigation);
  });

  it("groups daily work apart from accounts and income", () => {
    expect(navigationGroups.map((group) => group.items.length)).toEqual([3, 3]);
  });

  it("puts promo clips and drama series under one clip menu", () => {
    const clip = navigationGroups[0].items.find((item) => item.label === "สร้างคลิป");
    expect(clip?.children?.map((child) => [child.href, child.label])).toEqual([["/post", "สร้างคลิปโปรโมท"], ["/drama", "ละครซีรีส์"]]);
  });
});
