import { describe, expect, it } from "vitest";
import { LiveEventLog } from "./event-log";
import { inspectWatchdog, recoveryDisposition } from "./watchdog";

describe("AI LIVE customer events and watchdog", () => {
  it("keeps only bounded, customer-readable activity", () => {
    const log = new LiveEventLog(2);
    log.record("SESSION_STARTED", 1);
    log.record("PRODUCT_CHANGED", 2);
    log.record("SPEAKING", 3);
    expect(log.recent().map((event) => event.text)).toEqual(["เปลี่ยนสินค้า", "กำลังพูด"]);
    expect(log.recent().map((event) => event.sequence)).toEqual([2, 3]);
    expect(log.size).toBe(2);
  });

  it("spots stuck queues and stops recovery after the bounded attempt count", () => {
    expect(inspectWatchdog({
      nowMs: 20_000, sessionHeartbeatAt: 0, presenterHeartbeatAt: 19_000,
      oldestAudioQueuedAt: 0, oldestCommentQueuedAt: null, streamConnected: false,
    })).toEqual(["SESSION_STALE", "AUDIO_STUCK", "STREAM_DISCONNECTED"]);
    expect(recoveryDisposition(0)).toBe("RETRY_ALLOWED");
    expect(recoveryDisposition(1)).toBe("RETRY_ALLOWED");
    expect(recoveryDisposition(2)).toBe("STOP_REQUIRED");
  });
});
