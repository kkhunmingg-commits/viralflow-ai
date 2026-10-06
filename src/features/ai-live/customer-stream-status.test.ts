import { describe, expect, it } from "vitest";
import { AI_LIVE_REALTIME_VALIDATED, localMachineView } from "./local-contract";
import { customerConnectionQuality, customerLiveStatus, projectCustomerStreamStatus } from "./customer-stream-status";

describe("direct stream customer status boundary", () => {
  it("keeps an unvalidated active session from claiming LIVE or measured quality", () => {
    expect(AI_LIVE_REALTIME_VALIDATED).toBe(false);
    const view = { ...localMachineView("BUSY", true, [], true), deviceAuthorized: true,
      customerStream: { phase: "LIVE", connectionQuality: "GOOD" } as const };
    expect(customerLiveStatus(view)).toBe("กำลังเตรียม");
    expect(customerConnectionQuality(view)).toBe("ยังไม่มีข้อมูล");
  });

  it("does not infer LIVE from BUSY or from an unauthenticated stream claim", () => {
    expect(customerLiveStatus(localMachineView("BUSY", true, [], true))).not.toBe("กำลัง LIVE");
    const view = { ...localMachineView("BUSY", false, [], true),
      customerStream: { phase: "LIVE", connectionQuality: "GOOD" } as const };
    expect(customerLiveStatus(view)).toBe("ต้องตั้งค่าการ LIVE");
    expect(customerConnectionQuality(view)).toBe("ยังไม่มีข้อมูล");
  });

  it("requires setup when hardware, membership, or device authorization is not ready", () => {
    for (const state of ["GPU_REQUIRED", "NOT_INSTALLED", "OFFLINE", "UPDATE_REQUIRED", "READY"] as const) {
      expect(customerLiveStatus(localMachineView(state, true))).toBe("ต้องตั้งค่าการ LIVE");
    }
  });

  it("displays preparation, stopping, and an observed stop without inventing a broadcast", () => {
    const view = { ...localMachineView("READY", true),
      customerStream: { phase: "STOPPED", connectionQuality: "UNAVAILABLE" } as const };
    expect(customerLiveStatus(null)).toBe("กำลังเตรียม");
    expect(customerLiveStatus(view, "start")).toBe("กำลังเตรียม");
    expect(customerLiveStatus(view, "stop")).toBe("กำลังหยุด");
    expect(customerLiveStatus(view)).toBe("หยุดแล้ว");
    expect(customerLiveStatus({ ...view, paired: false })).toBe("ต้องตั้งค่าการ LIVE");
  });

  it("does not hide a failed active session behind an optimistic phase", () => {
    for (const state of ["ERROR", "OFFLINE"] as const) {
      expect(customerLiveStatus({ ...localMachineView(state, true, [], true),
        customerStream: { phase: "LIVE", connectionQuality: "GOOD" } })).toBe("ต้องตรวจสอบการ LIVE");
    }
    expect(customerLiveStatus({ ...localMachineView("PAUSED", true, [], true),
      customerStream: { phase: "LIVE", connectionQuality: "GOOD" } })).toBe("กำลังเตรียม");
  });

  it("drops technical messages, credentials, URLs, and unrecognized quality values", () => {
    const projection = projectCustomerStreamStatus({ phase: "LIVE", connectionQuality: "excellent",
      server: "rtmps://example.com/private", streamKey: "sensitive-key", engine: "FFmpeg",
      message: "CUDA failure on port 8766", sessionId: "technical-id" });
    expect(projection).toEqual({ phase: "LIVE", connectionQuality: "UNAVAILABLE" });
    expect(JSON.stringify(projection)).not.toMatch(/sensitive|rtmps|FFmpeg|CUDA|8766|technical-id/);
    expect(projectCustomerStreamStatus({ phase: "rtmp_reconnecting", connectionQuality: "GOOD" }).phase).toBe("IDLE");
    for (const input of [null, undefined, [], "LIVE"]) {
      expect(projectCustomerStreamStatus(input)).toEqual({ phase: "IDLE", connectionQuality: "UNAVAILABLE" });
    }
  });
});
