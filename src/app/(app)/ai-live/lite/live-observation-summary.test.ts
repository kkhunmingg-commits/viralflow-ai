import { describe, expect, it } from "vitest";
import { liveObservationSummary } from "./live-observation-summary";

const a = { accountId: "A", liveSeconds: 3600, sales: 120, units: 2, scheduled: true };
const b = { accountId: "B", liveSeconds: 0, sales: 0, units: 0, scheduled: false };
describe("truthful all-account LIVE observations", () => {
  it("keeps measured zero and sums only one observation per actual account", () => {
    expect(liveObservationSummary(["A", "B"], [a, b])).toEqual({ hours: 1, sales: 120, units: 2, salesPerHour: 120, scheduled: 1 });
    expect(liveObservationSummary(["B"], [b])).toEqual({ hours: 0, sales: 0, units: 0, salesPerHour: null, scheduled: 0 });
  });
  it("does not label missing, duplicate, or foreign account totals as complete", () => {
    for (const observed of [[], [a], [a, a], [a, { ...b, accountId: "Other" }]]) {
      expect(liveObservationSummary(["A", "B"], observed)).toEqual({ hours: null, sales: null, units: null, salesPerHour: null, scheduled: null });
    }
  });
  it("does not invent schedules from drafts or derive rates from unmeasured sales", () => {
    const result = liveObservationSummary(["A", "B"], [a, { ...b, sales: null, scheduled: null }]);
    expect(result.hours).toBe(1); expect(result.sales).toBeNull(); expect(result.salesPerHour).toBeNull(); expect(result.scheduled).toBeNull();
    expect(liveObservationSummary(["A"], [{ ...a, sales: -1 }]).sales).toBeNull();
  });
});
