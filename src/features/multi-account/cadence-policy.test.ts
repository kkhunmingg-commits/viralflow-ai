import { describe, expect, it } from "vitest";
import { accountStaggerMinutes, cadenceCeiling, healthyStreak } from "./cadence-policy";

describe("cadence policy", () => {
  it("keeps Growth accounts at 3-5 clips a day", () => {
    expect(cadenceCeiling({ phase: "GROWTH", healthyDays: 0 }).target).toBe(3);
    expect(cadenceCeiling({ phase: "GROWTH", healthyDays: 3 }).target).toBe(4);
    expect(cadenceCeiling({ phase: "GROWTH", healthyDays: 30 }).target).toBe(5);
    expect(cadenceCeiling({ phase: "GROWTH", healthyDays: 30, risk: "WARNING" }).target).toBe(3);
  });
  it("ramps Affiliate toward the owner's target and never past the typical creator cap", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(d => cadenceCeiling({ phase: "AFFILIATE", ownerTarget: 15, healthyDays: d }).target)).toEqual([5, 7, 9, 11, 13, 15, 15]);
    expect(cadenceCeiling({ phase: "AFFILIATE", ownerTarget: 40, healthyDays: 30 })).toEqual({ target: 15, reason: "CADENCE_AFFILIATE_RAMP" });
    expect(cadenceCeiling({ phase: "AFFILIATE", ownerTarget: 15, healthyDays: 30, publishCap: 8 })).toEqual({ target: 8, reason: "PLATFORM_CAP" });
    expect(cadenceCeiling({ phase: "AFFILIATE", healthyDays: 30, risk: "BLOCKED" }).target).toBe(0);
  });
  it("counts only the unbroken recent posting streak", () => {
    expect(healthyStreak([{ posts: 3 }, { posts: 0 }, { posts: 2 }, { posts: 4 }])).toBe(2);
  });
  it("interleaves 10 accounts six minutes apart within each hour", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `acc-${i}`);
    const offsets = accountStaggerMinutes(ids);
    expect([...offsets.values()]).toEqual([0, 6, 12, 18, 24, 30, 36, 42, 48, 54]);
  });
});
