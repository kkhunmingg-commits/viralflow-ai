import { describe, expect, it } from "vitest";
import { customerMetric, customerRoomRuntime } from "./customer-room-view";
import { localMachineView, projectLocalMachine, LIVE_COMPONENT_VERSIONS } from "./local-contract";

describe("customer room evidence boundary", () => {
  it("keeps unavailable live metrics unknown and preserves measured zero", () => {
    expect(customerMetric(null)).toBe("ยังไม่มีข้อมูล");
    expect(customerMetric(undefined)).toBe("ยังไม่มีข้อมูล");
    expect(customerMetric(Number.NaN)).toBe("ยังไม่มีข้อมูล");
    expect(customerMetric(-1)).toBe("ยังไม่มีข้อมูล");
    expect(customerMetric(0)).toBe("0");
    expect(customerMetric(12.5, " นาที")).toBe("12.5 นาที");
  });
  it("a configured pack and selected microphone never bypass production readiness", () => {
    const machine = projectLocalMachine({ versions: LIVE_COMPONENT_VERSIONS, state: "READY", canStart: true,
      sessionActive: false, customerStream: { phase: "LIVE", connectionQuality: "GOOD" } }, true);
    machine.deviceAuthorized = true; machine.membershipStatus = "SUPPORTED";
    const room = customerRoomRuntime({ accountId: "account-a", machine, imageReady: true,
      microphoneReady: true, productsReady: true, busy: false });
    expect(room.canStart).toBe(false);
    expect(room.status).not.toBe("กำลัง LIVE");
    expect(room.readiness.backupVoice).toBe("UNAVAILABLE");
    expect(room.readiness.image).toBe("READY");
    expect(room.canManagePresenters).toBe(true);
  });
  it("an active session retains its own account and does not imply connected transport", () => {
    const machine = localMachineView("BUSY", true, [], true);
    const room = customerRoomRuntime({ accountId: "account-b", machine, imageReady: true,
      microphoneReady: true, productsReady: true, busy: false });
    expect(room.accountId).toBe("account-b");
    expect(room.sessionActive).toBe(true);
    expect(room.status).toBe("กำลังเตรียม");
    expect(room.canStart).toBe(false);
  });
  it("recovered sessions never replace a newly selected account with another room", () => {
    const machine = localMachineView("BUSY", true, [], true);
    machine.activeAccountId = "account-a"; machine.currentProductId = "product-a"; machine.sessionStartedAt = 1_720_000_000_000;
    const room = customerRoomRuntime({ accountId: "account-b", machine, imageReady: false,
      microphoneReady: false, productsReady: false, busy: false });
    expect(room.accountId).toBe("account-b");
    expect(room.sessionActive).toBe(false);
    expect(room.currentProductId).toBeNull();
    expect(room.sessionStartedAt).toBeNull();
    expect(room).not.toHaveProperty("reasons");
    expect(room).not.toHaveProperty("token");
  });
});
