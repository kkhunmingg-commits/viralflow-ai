import { describe, expect, it } from "vitest";
import { observedPostEvents, validatePerformanceEvent, forwardObservedEvents } from "./performance-events";
import type { SnapshotRecord } from "./customer-mapping";
const row: SnapshotRecord = { id: "record", tiktok_account_id: "account", video_id: "v", video_kind: "MASTER", product_id: "p",
  source: "TIKTOK_DISPLAY", source_snapshot_at: "2026-10-06T12:00:00.000Z", published_at: null, views: 10, comments: 2, clicks: null,
  orders: 1, items_sold: null, currency: null, gmv: null, commission: null };
const ids = new Set(["account"]);
describe("observed POST/LIVE learning boundary", () => {
  it("reads actual POST observations once and retains creative/script/hook references", () => {
    const input = { ...row, published_at: "2026-10-06T11:00:00.000Z", creative_project_id: "creative", script_id: "script", creative_angle_id: "angle" };
    const events = observedPostEvents("owner", ids, [input, input, { ...row, source: "MOCK" }, { ...row, tiktok_account_id: "other" }]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ source: "POST", creativeReference: "creative", scriptReference: "script", hookReference: "angle", clipReference: "v", postingTime: input.published_at, units: null, measurement: "CUMULATIVE_SNAPSHOT" });
    expect(events[0].liveDurationSeconds).toBeNull();
  });
  it("refuses wrong owners, wrong devices' account sets and development observations", () => {
    const event = observedPostEvents("owner", ids, [row])[0];
    expect(() => validatePerformanceEvent(event, "other", ids)).toThrow(/owner_mismatch/);
    expect(() => validatePerformanceEvent(event, "owner", new Set(["other"]))).toThrow(/owner_mismatch/);
    expect(() => validatePerformanceEvent({ ...event, evidence: "INTERNAL_TEST" }, "owner", ids)).toThrow(/not_observed/);
    expect(() => validatePerformanceEvent({ ...event, access_token: "secret" }, "owner", ids)).toThrow();
  });
  it("accepts observed session totals but never relabels POST as live history", () => {
    const event = observedPostEvents("owner", ids, [row])[0];
    expect(() => validatePerformanceEvent({ ...event, source: "LIVE" }, "owner", ids)).toThrow(/source_mismatch/);
    expect(validatePerformanceEvent({ ...event, source: "LIVE", measurement: "SESSION_TOTAL", liveDurationSeconds: 60,
      audienceQuestions: ["ส่งเมื่อไร"] }, "owner", ids).liveDurationSeconds).toBe(60);
    expect(() => validatePerformanceEvent({ ...event, sales: 100 }, "owner", ids)).toThrow(/currency_required/);
  });
  it("passes the same event key to durable sinks for idempotent resume", async () => {
    const events = observedPostEvents("owner", ids, [row]), stored = new Set<string>();
    const sink = { async appendObserved(event: typeof events[number]): Promise<"APPENDED" | "DUPLICATE"> {
      if (stored.has(event.eventKey)) return "DUPLICATE";
      stored.add(event.eventKey); return "APPENDED";
    } };
    await forwardObservedEvents(events, "owner", ids, sink); await forwardObservedEvents(events, "owner", ids, sink);
    expect(stored.size).toBe(1);
  });
});
