import { describe, expect, it } from "vitest";
import { scanOperationalBatches } from "./scan";

const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ id: String(index).padStart(5, "0") }));

describe("bounded recovery scan", () => {
  it.each([200, 201, 2000])("visits %i candidates once across stable keyset pages", async (count) => {
    const input = rows(count);
    const cursors: Array<string | null> = [];
    const result = await scanOperationalBatches(async (after, size) => {
      cursors.push(after);
      return input.filter((row) => after === null || row.id > after).slice(0, size);
    });
    expect(result).toEqual(input);
    expect(new Set(result.map((row) => row.id)).size).toBe(count);
    expect(cursors.length).toBe(Math.floor(count / 200) + 1);
  });

  it("fails closed on a repeated scheduler cursor or a scan beyond its configured bound", async () => {
    await expect(scanOperationalBatches(async () => [{ id: "001" }], 1, 5)).rejects.toThrow("operations_scan_cursor_not_advancing");
    const input = rows(6);
    await expect(scanOperationalBatches(async (after, size) => input.filter((row) => after === null || row.id > after).slice(0, size), 2, 5))
      .rejects.toThrow("operations_scan_limit_reached");
  });
});
