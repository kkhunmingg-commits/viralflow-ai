import { describe, expect, it } from "vitest";
import { navigation, primaryNavigation } from "./navigation";

describe("application navigation", () => {
  it("shows only four member destinations without exposing internal feature pages", () => {
    const routes = navigation.map((item) => item.href);
    expect(routes).toEqual(["/home", "/post", "/ai-live", "/accounts"]);
    expect(primaryNavigation).toBe(navigation);
  });
});
