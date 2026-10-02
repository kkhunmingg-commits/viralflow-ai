import { describe, expect, it, vi } from "vitest";

vi.mock("client-only", () => ({}));

import { LocalLiveClient } from "./local-client";
import { AI_LIVE_REALTIME_VALIDATED, LIVE_COMPONENT_VERSIONS, projectLocalComponents, projectLocalMachine } from "./local-contract";

const nowSeconds = 1_780_000_000;
const deviceId = "4b531890-5020-4273-b6fb-2cf6e3cb5f7a";
const accountId = "4d334044-44d6-427b-a44b-872243d58b93";
const productId = "9820f32b-5ff6-4fdc-a5b3-d4b223471b1e";
const token = "t".repeat(48);
const grant = { payload: { deviceId, accountId }, signature: "signed-component-grant" };
const initialComponents = { state: "NOT_CONFIGURED", bytesReceived: 0, totalBytes: 400, canPrepare: true };

async function pairedClient(extras: Record<string, unknown>[] = [], options: { authorized?: boolean; components?: unknown; active?: boolean } = {}) {
  const items = [
    { token, expiresAt: nowSeconds + 300, deviceId },
    { state: "STARTING", versions: LIVE_COMPONENT_VERSIONS, machineReady: false, sessionActive: options.active ?? false,
      deviceAuthorized: true, components: options.components ?? initialComponents },
    { device: { authorized: options.authorized ?? true }, entitled: true },
    ...extras,
  ];
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
    expect(_url).toBeDefined();
    expect(_init).toBeDefined();
    const next = items.shift();
    if (!next) throw new Error("Unexpected request");
    return Response.json(next);
  });
  const client = new LocalLiveClient(fetcher as typeof fetch, () => nowSeconds * 1000);
  await client.pair("ABCDEF");
  return { client, fetcher };
}

describe("managed component customer projection", () => {
  it("uses safe state labels and actual numeric progress while dropping implementation names and secrets", () => {
    const result = projectLocalComponents({ state: "DOWNLOADING", bytesReceived: 123, totalBytes: 456, canPrepare: true,
      message: "Download Python FFmpeg CUDA from private-host", path: "C:/private", componentId: "private-id", token: "private-secret" });
    expect(result).toEqual({ state: "DOWNLOADING", bytesReceived: 123, totalBytes: 456, canPrepare: false,
      message: "กำลังดาวน์โหลดส่วนประกอบ" });
    expect(JSON.stringify(result)).not.toMatch(/Python|FFmpeg|CUDA|private/);
  });

  it("rejects invalid progress, arbitrary states, and unsafe preparation claims", () => {
    expect(projectLocalComponents({ state: "READY", bytesReceived: -3, totalBytes: Infinity })).toMatchObject({ bytesReceived: 0, totalBytes: 0 });
    expect(projectLocalComponents({ state: "private-install-id", bytesReceived: "100", totalBytes: 1.5, canPrepare: true }))
      .toEqual({ state: "ERROR", bytesReceived: 0, totalBytes: 0, canPrepare: false, message: "เตรียมส่วนประกอบไม่สำเร็จ" });
    expect(projectLocalComponents(null).canPrepare).toBe(false);
  });

  it("does not treat component READY or a companion readiness claim as a validated LIVE release", () => {
    expect(AI_LIVE_REALTIME_VALIDATED).toBe(false);
    const input = { state: "READY", versions: LIVE_COMPONENT_VERSIONS, machineReady: true, canStart: true,
      components: { state: "READY", bytesReceived: 400, totalBytes: 400, canPrepare: false },
      hardwareAdvice: "DRIVER_UPDATE_REQUIRED" };
    const result = projectLocalMachine(input, true);
    expect(result).toMatchObject({ canStart: false, machineReady: true, components: { state: "READY", message: "ส่วนประกอบพร้อม" },
      hardwareAdvice: "DRIVER_UPDATE_REQUIRED" });
    expect(projectLocalMachine({ ...input, hardwareAdvice: "https://malicious.example/installer" }, true).hardwareAdvice).toBeUndefined();
    expect(projectLocalMachine(input, false).components).toBeUndefined();
    expect(projectLocalMachine(input, false).hardwareAdvice).toBeUndefined();
    expect(projectLocalMachine(input, false).machineReady).toBeUndefined();
  });
});

describe("signed managed component bridge", () => {
  it.each([false, true])("prepares with a fresh owner/account/device grant and exact repair=%s body", async (repair) => {
    const { client, fetcher } = await pairedClient([
      { challenge: "a".repeat(43), deviceProof: { signature: "device-proof" } }, grant,
      { state: "CHECKING", rawImplementation: "Python" },
      { state: "DOWNLOADING", bytesReceived: 100, totalBytes: 400, canPrepare: false },
    ]);
    expect(client.snapshot().canStart).toBe(false);
    const view = await client.prepareComponents({ accountId, productIds: [productId] }, repair);
    expect(view).toMatchObject({ machineReady: false, canStart: false, components: { state: "DOWNLOADING", bytesReceived: 100, totalBytes: 400 } });
    expect(fetcher.mock.calls[4][0]).toBe("/api/ai-live/local-grant");
    expect(JSON.parse(fetcher.mock.calls[4][1]?.body as string)).toEqual({ deviceId, accountId, productIds: [productId],
      challenge: "a".repeat(43), deviceProof: { signature: "device-proof" } });
    expect(fetcher.mock.calls[5][0]).toBe("http://127.0.0.1:8766/v1/components/prepare");
    expect(JSON.parse(fetcher.mock.calls[5][1]?.body as string)).toEqual({ grant, repair });
    expect(fetcher.mock.calls[5][1]).toMatchObject({ method: "POST", credentials: "omit", cache: "no-store", redirect: "error",
      headers: { Authorization: `Bearer ${token}` } });
    expect(fetcher.mock.calls[6][0]).toBe("http://127.0.0.1:8766/v1/components/status");
    client.dispose();
  });

  it.each([
    { authorized: false },
    { active: true },
    { components: { ...initialComponents, canPrepare: false } },
    { components: { ...initialComponents, state: "DOWNLOADING", canPrepare: true } },
  ])("blocks preparation when permission, hardware eligibility, or idle state is absent", async (options) => {
    const { client, fetcher } = await pairedClient([], options);
    await expect(client.prepareComponents({ accountId, productIds: [productId] })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(3);
    client.dispose();
  });

  it("requires valid selection and reads status only for a currently authorized device", async () => {
    const { client, fetcher } = await pairedClient();
    await expect(client.prepareComponents({ accountId: "invalid", productIds: [productId] })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(3);
    client.dispose();
    const { client: unauthorized, fetcher: guardedFetch } = await pairedClient([], { authorized: false });
    await unauthorized.checkComponents();
    expect(guardedFetch).toHaveBeenCalledTimes(3);
    unauthorized.dispose();
  });

  it("updates actual byte progress without changing machine or LIVE readiness and isolates snapshots", async () => {
    const { client } = await pairedClient([{ state: "VERIFYING", bytesReceived: 400, totalBytes: 400, canPrepare: false,
      message: "raw-private-path" }]);
    const view = await client.checkComponents();
    expect(view).toMatchObject({ state: "STARTING", canStart: false, components: { state: "VERIFYING", bytesReceived: 400, message: "กำลังตรวจสอบไฟล์" } });
    view.components!.state = "READY";
    expect(client.snapshot().components?.state).toBe("VERIFYING");
    expect(JSON.stringify(client.snapshot())).not.toContain("raw-private-path");
    client.dispose();
  });
});
