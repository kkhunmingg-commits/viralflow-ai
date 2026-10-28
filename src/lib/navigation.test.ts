import { describe, expect, it } from "vitest";
import { navigation, navigationGroups, primaryNavigation } from "./navigation";

describe("application navigation", () => {
  it("shows the everyday owner workflow without exposing internal feature pages", () => {
    const routes = navigation.map((item) => item.href);
    expect(routes).toEqual(["/auto", "/library", "/post", "/ai-live", "/accounts", "/analytics/finance", "/profile"]);
    expect(primaryNavigation).toBe(navigation);
  });

  it("groups daily work apart from accounts and income", () => {
    expect(navigationGroups.map((group) => group.items.length)).toEqual([4, 3]);
  });
});
