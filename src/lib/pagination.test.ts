import { describe, expect, it } from "vitest";
import { operationalPage, operationalWindow, parseOperationalPage } from "./pagination";

describe("operational pagination", () => {
  it("accepts only bounded positive page numbers", () => {
    expect([undefined, "0", "-1", "1.5", "bad"].map(parseOperationalPage)).toEqual([1, 1, 1, 1, 1]);
    expect(parseOperationalPage("2")).toBe(2);
    expect(parseOperationalPage("999999999999999999999")).toBe(1000);
  });

  it("uses one lookahead row without showing a duplicate at the page boundary", () => {
    const rows = Array.from({ length: 51 }, (_, index) => index);
    expect(operationalWindow(1)).toEqual({ from: 0, to: 50, size: 50 });
    expect(operationalWindow(2)).toEqual({ from: 50, to: 100, size: 50 });
    expect(operationalPage(rows, 1)).toMatchObject({ page: 1, hasMore: true });
    expect(operationalPage(rows, 1).items).toEqual(rows.slice(0, 50));
    expect(operationalPage(rows.slice(50), 2)).toEqual({ items: [50], page: 2, hasMore: false });
  });

  it("keeps a large operational result bounded to the visible page", () => {
    const page = operationalPage(Array.from({ length: 10_000 }, (_, index) => index), 1);
    expect(page.items).toHaveLength(50);
    expect(page.hasMore).toBe(true);
  });
});
