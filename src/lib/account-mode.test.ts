import { describe, expect, it } from "vitest";
import { detectAccountMode } from "./account-mode";

describe("detectAccountMode", () => {
  it.each([
    [{ followerCount: 999, ecommercePermission: true }, "growth"],
    [{ followerCount: 1_000, ecommercePermission: false }, "growth"],
    [{ followerCount: 1_000, ecommercePermission: null }, "growth"],
    [{ followerCount: null, ecommercePermission: true }, "growth"],
    [{ followerCount: 1_000, ecommercePermission: true }, "affiliate"],
  ] as const)("resolves %o as %s", (input, expected) => {
    expect(detectAccountMode(input)).toBe(expected);
  });
});

