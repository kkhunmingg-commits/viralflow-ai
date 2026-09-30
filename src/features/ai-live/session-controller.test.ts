import { describe, expect, it, vi } from "vitest";
import {
  LiveSessionController, type LiveSessionSnapshot, type LiveSessionSnapshotStore,
  type PresenterHealthCode, type PresenterRuntimePort,
} from "./session-controller";

const selection = {
  ownerId: "owner-a", tiktokAccountId: "account-a", productIds: ["product-a", "product-b"],
  presenterReferenceId: "reference-a",
};

function fixture(kind: PresenterRuntimePort["kind"], health: PresenterHealthCode = "READY") {
  const records = new Map<string, LiveSessionSnapshot>();
  const store: LiveSessionSnapshotStore = {
    load: async (id) => records.get(id) ?? null,
    save: async (snapshot) => { records.set(snapshot.id, structuredClone(snapshot)); },
  };
  const runtime: PresenterRuntimePort = {
    kind, health: vi.fn(async () => health), start: vi.fn(async () => {}),
    pause: vi.fn(async () => {}), resume: vi.fn(async () => {}), stop: vi.fn(async () => {}),
  };
  const controller = new LiveSessionController(runtime, store, {
    allowMock: true, now: () => 1000, newId: () => "session-a",
  });
  return { controller, runtime, store, records };
}

describe("non-GPU AI LIVE session control", () => {
  it("starts, pauses, resumes, stops and persists only selected context", async () => {
    const { controller, runtime, records } = fixture("mock");
    expect((await controller.start(selection)).state).toBe("RUNNING");
    expect((await controller.pause()).state).toBe("PAUSED");
    expect((await controller.pause()).state).toBe("PAUSED");
    expect((await controller.resume()).state).toBe("RUNNING");
    await controller.updateContext({ productId: "product-b", lastComment: "สนใจราคา", currentResponse: "ดูรายละเอียดสินค้าได้ค่ะ" });
    expect((await controller.stop()).state).toBe("STOPPED");
    expect((await controller.stop()).state).toBe("STOPPED");
    expect(runtime.pause).toHaveBeenCalledTimes(1);
    expect(runtime.stop).toHaveBeenCalledTimes(1);
    expect(records.get("session-a")?.currentProductId).toBe("product-b");
    expect(records.get("session-a")?.lastComment).toBe("สนใจราคา");
    expect(controller.events.recent().map((event) => event.kind)).toContain("PRODUCT_CHANGED");
  });

  it("fails closed at GPU_REQUIRED without starting MuseTalk or switching to mock", async () => {
    const { controller, runtime } = fixture("musetalk", "GPU_REQUIRED");
    const result = await controller.start(selection);
    expect(result).toMatchObject({ state: "BLOCKED", runtimeStatus: "GPU_REQUIRED", presenterKind: "musetalk" });
    expect(runtime.start).not.toHaveBeenCalled();
    await expect(controller.start(selection)).rejects.toThrow("session_already_active");
  });

  it("turns a restored active session into RECOVERY_REQUIRED, never auto-restarts", async () => {
    const { controller, runtime, store } = fixture("mock");
    await controller.start(selection);
    const afterCrash = new LiveSessionController(runtime, store, { allowMock: true, now: () => 2000 });
    expect((await afterCrash.recover("session-a"))?.state).toBe("RECOVERY_REQUIRED");
    expect(runtime.start).toHaveBeenCalledTimes(1);
    await expect(afterCrash.resume()).rejects.toThrow("session_not_paused");
    expect((await afterCrash.stop()).state).toBe("STOPPED");
  });

  it("marks a stale live session for manual recovery without restart loops", async () => {
    const { controller, runtime } = fixture("mock");
    await controller.start(selection);
    const result = await controller.inspect({
      nowMs: 30_000, sessionHeartbeatAt: 0, presenterHeartbeatAt: 0,
      oldestAudioQueuedAt: 0, oldestCommentQueuedAt: null, streamConnected: false,
    });
    expect(result).toMatchObject({ state: "RECOVERY_REQUIRED", recoveryAttempts: 1 });
    expect(runtime.start).toHaveBeenCalledTimes(1);
  });

  it("fails closed on an execution boundary error without restarting the presenter", async () => {
    const { controller, runtime, records } = fixture("mock");
    await controller.start(selection);
    expect((await controller.requireRecovery()).state).toBe("RECOVERY_REQUIRED");
    expect(records.get("session-a")?.state).toBe("RECOVERY_REQUIRED");
    expect((await controller.requireRecovery()).state).toBe("RECOVERY_REQUIRED");
    expect(runtime.start).toHaveBeenCalledTimes(1);
  });
});
