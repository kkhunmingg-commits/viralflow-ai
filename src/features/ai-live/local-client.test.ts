import { describe, expect, it, vi } from "vitest";

vi.mock("client-only", () => ({}));

import { LocalLiveClient } from "./local-client";
import { AI_LIVE_REALTIME_VALIDATED, LIVE_COMPONENT_VERSIONS, projectLocalMachine } from "./local-contract";

const nowSeconds = 1_780_000_000;
const accountId = "4d334044-44d6-427b-a44b-872243d58b93";
const productId = "9820f32b-5ff6-4fdc-a5b3-d4b223471b1e";
const deviceId = "4b531890-5020-4273-b6fb-2cf6e3cb5f7a";
const sessionId = "7774a04a-683c-4c85-9c6c-16457d63a369";
const token = "t".repeat(48);
const renewedToken = "r".repeat(48);
const ready = { state: "READY", versions: LIVE_COMPONENT_VERSIONS, reasons: [], sessionActive: false };

function responseSequence(...items: (Record<string, unknown> | Error)[]) {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    expect(_input).toBeDefined();
    expect(_init).toBeDefined();
    const next = items.shift();
    if (!next) throw new Error("Unexpected network request");
    if (next instanceof Error) throw next;
    return Response.json(next);
  });
  return { mock: fetcher, fetcher: fetcher as unknown as typeof fetch };
}

function assertLoopbackCall(call: [RequestInfo | URL, RequestInit?], path: string, authenticated: boolean, expectedToken = token) {
  expect(call[0]).toBe(`http://127.0.0.1:8766${path}`);
  expect(call[1]).toMatchObject({ credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
  const headers = call[1]?.headers as Record<string, string>;
  expect(headers.Authorization).toBe(authenticated ? `Bearer ${expectedToken}` : undefined);
  expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
}

describe("AI LIVE customer projection", () => {
  it("keeps a ready companion blocked until realtime GPU validation passes", () => {
    expect(AI_LIVE_REALTIME_VALIDATED).toBe(false);
    const view = projectLocalMachine(ready, true);
    expect(view).toMatchObject({ state: "READY", paired: true, canStart: false, sessionActive: false });
    expect(view.reasons).toContain("กำลังรอการทดสอบการแสดงสดบนเครื่องที่รองรับ");
  });

  it("rejects incompatible versions before trusting readiness", () => {
    const view = projectLocalMachine({ ...ready, versions: { ...LIVE_COMPONENT_VERSIONS, agent: "0.0.1" } }, true);
    expect(view).toMatchObject({ state: "UPDATE_REQUIRED", paired: true, canStart: false });
  });

  it("preserves a paused session as active without enabling another Start", () => {
    const view = projectLocalMachine({ ...ready, state: "PAUSED", sessionActive: true }, true);
    expect(view).toMatchObject({ state: "PAUSED", sessionActive: true, canStart: false });
  });

  it("keeps Stop possible for an owned active session when an update is required", () => {
    const view = projectLocalMachine({ ...ready, versions: { ...LIVE_COMPONENT_VERSIONS, agent: "old" }, sessionActive: true }, true);
    expect(view).toMatchObject({ state: "UPDATE_REQUIRED", sessionActive: true, canStart: false });
    expect(projectLocalMachine({ ...ready, versions: {}, sessionActive: true }, false).sessionActive).toBe(false);
  });

  it("does not expose arbitrary companion messages, diagnostics, or reason text", () => {
    const view = projectLocalMachine({ ...ready,
      message: "Run Python on port 8766 with CUDA enabled",
      diagnostics: { secret: "private-token", command: "launch.exe --unsafe" },
      reasons: ["driver_internal_error:CUDA", "ไม่พบการ์ดจอที่รองรับ"],
    }, true);
    expect(Object.keys(view).sort()).toEqual(["canStart", "message", "paired", "reasons", "sessionActive", "state"]);
    expect(view.reasons).toContain("ไม่พบการ์ดจอที่รองรับ");
    expect(view.reasons).toContain("ต้องตรวจสอบความพร้อมของเครื่องเพิ่มเติม");
    expect(JSON.stringify(view)).not.toMatch(/Python|CUDA|8766|private-token|launch\.exe|driver_internal_error/);
  });
});

describe("browser to local companion boundary", () => {
  it("reports an absent companion without a cloud or mock fallback", async () => {
    const { mock, fetcher } = responseSequence(new Error("connection refused"));
    const client = new LocalLiveClient(fetcher, () => nowSeconds * 1000);
    expect(await client.discover()).toMatchObject({ state: "NOT_INSTALLED", paired: false, canStart: false });
    expect(mock).toHaveBeenCalledTimes(1);
    assertLoopbackCall(mock.mock.calls[0], "/v1/discovery", false);
    client.dispose();
  });

  it("pairs once, authenticates subsequent loopback requests, and drops expired credentials", async () => {
    let clock = nowSeconds * 1000;
    const { mock, fetcher } = responseSequence(
      { token, expiresAt: nowSeconds + 120, deviceId }, ready,
      { ...ready, reasons: ["ไม่พบอุปกรณ์เสียง"] }, ready,
    );
    const client = new LocalLiveClient(fetcher, () => clock);
    expect(await client.pair("ABCDEF")).toMatchObject({ paired: true, state: "READY" });
    assertLoopbackCall(mock.mock.calls[0], "/v1/pair", false);
    expect(JSON.parse((mock.mock.calls[0][1]?.body ?? "") as string)).toEqual({ code: "ABCDEF" });
    assertLoopbackCall(mock.mock.calls[1], "/v1/status", true);
    expect((await client.checkHardware()).reasons).toContain("ไม่พบอุปกรณ์เสียง");
    assertLoopbackCall(mock.mock.calls[2], "/v1/hardware", true);

    clock += 121_000;
    expect(await client.discover()).toMatchObject({ paired: false, canStart: false });
    assertLoopbackCall(mock.mock.calls[3], "/v1/discovery", false);
    client.dispose();
  });

  it("renews a nearly expired pairing before a protected machine request", async () => {
    let clock = nowSeconds * 1000;
    const { mock, fetcher } = responseSequence(
      { token, expiresAt: nowSeconds + 90, deviceId }, ready,
      { token: renewedToken, expiresAt: nowSeconds + 300, deviceId }, ready,
    );
    const client = new LocalLiveClient(fetcher, () => clock);
    await client.pair("ABCDEF");
    clock += 40_000;
    expect((await client.checkHardware()).state).toBe("READY");
    expect(mock).toHaveBeenCalledTimes(4);
    assertLoopbackCall(mock.mock.calls[2], "/v1/renew", true);
    assertLoopbackCall(mock.mock.calls[3], "/v1/hardware", true, renewedToken);
    client.dispose();
  });

  it("restores a paused session from paired status and stops that same session", async () => {
    const { mock, fetcher } = responseSequence(
      { token, expiresAt: nowSeconds + 120, deviceId },
      { ...ready, state: "PAUSED", sessionActive: true, sessionId },
      ready,
    );
    const client = new LocalLiveClient(fetcher, () => nowSeconds * 1000);
    expect(await client.pair("ABCDEF")).toMatchObject({ state: "PAUSED", sessionActive: true, canStart: false });
    expect(await client.stop()).toMatchObject({ state: "READY", sessionActive: false });
    expect(mock).toHaveBeenCalledTimes(3);
    assertLoopbackCall(mock.mock.calls[2], `/v1/sessions/${sessionId}/stop`, true);
    expect(mock.mock.calls[2][1]?.method).toBe("POST");
    client.dispose();
  });

  it("blocks Start before any grant, presenter upload, or local session request", async () => {
    const { mock, fetcher } = responseSequence(ready);
    const client = new LocalLiveClient(fetcher, () => nowSeconds * 1000);
    expect((await client.discover()).canStart).toBe(false);
    const image = new File(["image"], "presenter.png", { type: "image/png" });
    await expect(client.start({ accountId, productIds: [productId], presenter: image, microphoneId: "default" }))
      .rejects.toThrow();
    expect(mock).toHaveBeenCalledTimes(1);
    assertLoopbackCall(mock.mock.calls[0], "/v1/discovery", false);
    client.dispose();
  });

  it("aborts outstanding local work when disposed", async () => {
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    });
    const client = new LocalLiveClient(fetcher as unknown as typeof fetch, () => nowSeconds * 1000);
    const discovery = client.discover();
    expect(requestSignal).toBeInstanceOf(AbortSignal);
    client.dispose();
    expect(requestSignal?.aborted).toBe(true);
    await discovery;
    expect(client.snapshot().canStart).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
