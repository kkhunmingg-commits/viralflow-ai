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
const unregistered = { device: { authorized: false }, entitled: true };

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
    expect(Object.keys(view).sort()).toEqual(["aiReadiness", "canStart", "capacity", "customerStream", "deviceAuthorized", "deviceRegistered", "deviceStatus", "membershipStatus", "message", "paired", "reasons", "rooms", "sessionActive", "state", "updateCanApply", "updateCanRepair", "updateStatus"]);
    expect(view.reasons).toContain("ไม่พบการ์ดจอที่รองรับ");
    expect(view.reasons).toContain("ต้องตรวจสอบความพร้อมของเครื่องเพิ่มเติม");
    expect(JSON.stringify(view)).not.toMatch(/Python|CUDA|8766|private-token|launch\.exe|driver_internal_error/);
  });
});

describe("customer release and membership bridge", () => {
  it("checks membership without treating an absent agent as installed or ready", async () => {
    const { mock, fetcher } = responseSequence(new Error("not installed"), { supported: true });
    const client = new LocalLiveClient(fetcher, () => nowSeconds * 1000);
    expect(await client.refresh()).toMatchObject({ state: "NOT_INSTALLED", membershipStatus: "SUPPORTED", canStart: false });
    expect(mock.mock.calls[1][0]).toBe("/api/ai-live/entitlement");
    expect(mock.mock.calls[1][1]).toMatchObject({ credentials: "same-origin", cache: "no-store", redirect: "error" });
    client.dispose();
  });

  it("blocks an authorized device when fresh server membership is inactive", async () => {
    const { fetcher } = responseSequence(
      { token, expiresAt: nowSeconds + 300, deviceId }, { ...ready, deviceAuthorized: true },
      { device: { authorized: true }, entitled: true },
      { ...ready, deviceAuthorized: true }, { device: { authorized: true }, entitled: true }, { supported: false },
    );
    const client = new LocalLiveClient(fetcher, () => nowSeconds * 1000);
    await client.pair("ABCDEF");
    expect(await client.refresh()).toMatchObject({ membershipStatus: "UNSUPPORTED", deviceAuthorized: false, canStart: false });
    client.dispose();
  });

  it("does not trust client entitlement when the fresh server check is unavailable", async () => {
    const { fetcher } = responseSequence(ready, { supported: "true", signingSecret: "not-for-customers" });
    const client = new LocalLiveClient(fetcher, () => nowSeconds * 1000);
    expect(await client.refresh()).toMatchObject({ membershipStatus: "UNAVAILABLE", deviceAuthorized: false });
    expect(JSON.stringify(client.snapshot())).not.toContain("not-for-customers");
    client.dispose();
  });

  it("passes signed manifest through fixed boundaries then starts one confirmed local install", async () => {
    const manifest = { payload: { v: 2, package: { url: "https://downloads.example/viralflow/ai-live/releases/0.3.0/package.zip", sha256: "a".repeat(64) } }, signature: "signed-release", keyId: "release-1" };
    const available = { ...ready, updateStatus: "AVAILABLE", updateCanApply: true, updateCanRepair: false };
    const { mock, fetcher } = responseSequence(
      { token, expiresAt: nowSeconds + 300, deviceId }, ready, unregistered,
      manifest, { updateStatus: "AVAILABLE" }, available, unregistered, { supported: true },
      { updateStatus: "UPDATING" }, { ...ready, updateStatus: "UPDATING" }, unregistered, { supported: true },
    );
    const client = new LocalLiveClient(fetcher, () => nowSeconds * 1000);
    await client.pair("ABCDEF");
    expect(await client.checkUpdates()).toMatchObject({ updateCanApply: true, updateStatus: "AVAILABLE" });
    expect(mock.mock.calls[3][0]).toBe("/api/ai-live/updates/manifest");
    expect(mock.mock.calls[3][1]?.credentials).toBe("same-origin");
    assertLoopbackCall(mock.mock.calls[4], "/v1/updates/check", true);
    expect(JSON.parse(mock.mock.calls[4][1]?.body as string)).toEqual({ manifest });
    expect(await client.installUpdate()).toMatchObject({ updateCanApply: false, updateStatus: "UPDATING" });
    assertLoopbackCall(mock.mock.calls[8], "/v1/updates/apply", true);
    expect(JSON.parse(mock.mock.calls[8][1]?.body as string)).toEqual({ confirmed: true });
    await expect(client.installUpdate()).rejects.toThrow();
    expect(mock).toHaveBeenCalledTimes(12);
    expect(JSON.stringify(client.snapshot())).not.toMatch(/downloads.example|signed-release|release-1|sha256/);
    client.dispose();
  });

  it("keeps confirmed repair on the same fixed installer boundary", async () => {
    const { mock, fetcher } = responseSequence(
      { token, expiresAt: nowSeconds + 300, deviceId }, { ...ready, updateCanRepair: true }, unregistered,
      { updateStatus: "UPDATING" }, { ...ready, updateStatus: "UPDATING" }, unregistered, { supported: true },
    );
    const client = new LocalLiveClient(fetcher, () => nowSeconds * 1000);
    await client.pair("ABCDEF");
    await client.installUpdate(true);
    assertLoopbackCall(mock.mock.calls[3], "/v1/updates/repair", true);
    expect(JSON.parse(mock.mock.calls[3][1]?.body as string)).toEqual({ confirmed: true });
    client.dispose();
  });

  it("blocks update actions without pairing or while a session is active", async () => {
    const { mock, fetcher } = responseSequence(
      { token, expiresAt: nowSeconds + 300, deviceId }, { ...ready, sessionActive: true, updateCanApply: true, updateCanRepair: true }, unregistered,
    );
    const client = new LocalLiveClient(fetcher, () => nowSeconds * 1000);
    await expect(client.checkUpdates()).rejects.toThrow();
    await client.pair("ABCDEF");
    await expect(client.installUpdate()).rejects.toThrow();
    await expect(client.installUpdate(true)).rejects.toThrow();
    expect(mock).toHaveBeenCalledTimes(3);
    client.dispose();
  });
});

describe("browser to local companion boundary", () => {
  it("warms the selected room using signed server facts and the paired local reference only", async () => {
    const context = { payload: { purpose: "AI_LIVE_PRODUCT_CONTEXT", products: [] }, signature: "signed-context" };
    const { mock, fetcher } = responseSequence(
      { token, expiresAt: nowSeconds + 300, deviceId }, { ...ready, deviceAuthorized: true },
      { device: { authorized: true }, entitled: true }, context, { synced: true },
      { presenterId: sessionId }, { preparing: true },
    );
    const client = new LocalLiveClient(fetcher, () => nowSeconds * 1000);
    await client.pair("ABCDEF");
    const presenter = new File(["test-reference"], "presenter.jpg", { type: "image/jpeg" });
    await client.prepareAI(undefined, { accountId, productIds: [productId], presenter, microphoneId: null });
    expect(mock.mock.calls[3][0]).toBe("/api/ai-live/product-context");
    expect(JSON.parse(mock.mock.calls[3][1]?.body as string)).toEqual({ deviceId, accountId, productIds: [productId] });
    assertLoopbackCall(mock.mock.calls[4], "/v1/ai/product-context", true);
    expect(JSON.parse(mock.mock.calls[4][1]?.body as string)).toEqual({ context });
    assertLoopbackCall(mock.mock.calls[5], "/v1/references", true);
    expect(mock.mock.calls[5][1]?.body).toBe(presenter);
    assertLoopbackCall(mock.mock.calls[6], "/v1/ai/warmup", true);
    expect(JSON.parse(mock.mock.calls[6][1]?.body as string)).toEqual({ accountId, productIds: [productId], presenterId: sessionId, microphoneId: null });
    expect(client.snapshot().canStart).toBe(false);
    expect(JSON.stringify(client.snapshot())).not.toContain("signed-context");
    client.dispose();
  });

  it("adds liveMode only for LIVE Lite Auto warmup and rejects a Lite microphone before any request", async () => {
    const context = { payload: { purpose: "AI_LIVE_PRODUCT_CONTEXT", products: [] }, signature: "signed-context" };
    const { mock, fetcher } = responseSequence(
      { token, expiresAt: nowSeconds + 300, deviceId }, { ...ready, deviceAuthorized: true },
      { device: { authorized: true }, entitled: true }, context, { synced: true },
      { presenterId: sessionId }, { preparing: true },
    );
    const client = new LocalLiveClient(fetcher, () => nowSeconds * 1000);
    await client.pair("ABCDEF");
    const presenter = new File(["test-reference"], "presenter.jpg", { type: "image/jpeg" });
    await expect(client.prepareAI(undefined, { accountId, productIds: [productId], presenter, microphoneId: "default", liveMode: "lite" })).rejects.toThrow();
    await expect(client.prepareAI(undefined, { accountId, productIds: [productId], presenter, microphoneId: null, liveMode: "LITE" as never })).rejects.toThrow();
    expect(mock).toHaveBeenCalledTimes(3);
    await client.prepareAI(undefined, { accountId, productIds: [productId], presenter, microphoneId: null, liveMode: "lite" });
    assertLoopbackCall(mock.mock.calls[6], "/v1/ai/warmup", true);
    expect(JSON.parse(mock.mock.calls[6][1]?.body as string)).toEqual({ accountId, productIds: [productId], presenterId: sessionId, microphoneId: null, liveMode: "lite" });
    client.dispose();
  });

  it("starts LIVE Lite Auto with liveMode and no microphone, keeping the Pro request shape unchanged", async () => {
    const grant = { payload: { grantId: "grant" }, signature: "signed-grant" };
    const context = { payload: { purpose: "AI_LIVE_PRODUCT_CONTEXT", products: [] }, signature: "signed-context" };
    const challenge = { challenge: "c".repeat(43), deviceProof: "proof" };
    const startResponses = () => [challenge, grant, context, { synced: true }, { presenterId: sessionId },
      { ...ready, state: "BUSY", sessionActive: true, sessionId }];
    const { mock, fetcher } = responseSequence(
      { token, expiresAt: nowSeconds + 300, deviceId }, { ...ready, deviceAuthorized: true },
      { device: { authorized: true }, entitled: true }, ...startResponses(), ...startResponses(),
    );
    const client = new LocalLiveClient(fetcher, () => nowSeconds * 1000);
    await client.pair("ABCDEF");
    const presenter = new File(["test-reference"], "presenter.jpg", { type: "image/jpeg" });
    // Simulates the future release-validated state; the shipped gate keeps canStart false.
    const open = () => { Object.assign(client["current"], { canStart: true, deviceAuthorized: true,
      lite: { machineReady: true, reasons: [], canStart: true, commercialLive: false } }); };
    open();
    await expect(client.start({ accountId, productIds: [productId], presenter, microphoneId: "default", liveMode: "lite" })).rejects.toThrow();
    await expect(client.start({ accountId, productIds: [productId], presenter, microphoneId: null })).rejects.toThrow();
    expect(mock).toHaveBeenCalledTimes(3);
    await client.start({ accountId, productIds: [productId], presenter, microphoneId: null, liveMode: "lite" });
    assertLoopbackCall(mock.mock.calls[8], "/v1/sessions/start", true);
    expect(JSON.parse(mock.mock.calls[8][1]?.body as string)).toEqual({ grant, accountId, productIds: [productId],
      presenterId: sessionId, microphoneId: null, liveMode: "lite" });
    open();
    await client.start({ accountId, productIds: [productId], presenter, microphoneId: "default" });
    expect(JSON.parse(mock.mock.calls[14][1]?.body as string)).toEqual({ grant, accountId, productIds: [productId],
      presenterId: sessionId, microphoneId: "default" });
    client.dispose();
  });

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
      { token, expiresAt: nowSeconds + 120, deviceId }, ready, unregistered,
      { ...ready, reasons: ["ไม่พบอุปกรณ์เสียง"] }, unregistered, ready,
    );
    const client = new LocalLiveClient(fetcher, () => clock);
    expect(await client.pair("ABCDEF")).toMatchObject({ paired: true, state: "READY" });
    assertLoopbackCall(mock.mock.calls[0], "/v1/pair", false);
    expect(JSON.parse((mock.mock.calls[0][1]?.body ?? "") as string)).toEqual({ code: "ABCDEF" });
    assertLoopbackCall(mock.mock.calls[1], "/v1/status", true);
    expect((await client.checkHardware()).reasons).toContain("ไม่พบอุปกรณ์เสียง");
    assertLoopbackCall(mock.mock.calls[3], "/v1/hardware", true);

    clock += 121_000;
    expect(await client.discover()).toMatchObject({ paired: false, canStart: false });
    assertLoopbackCall(mock.mock.calls[5], "/v1/discovery", false);
    client.dispose();
  });

  it("renews a nearly expired pairing before a protected machine request", async () => {
    let clock = nowSeconds * 1000;
    const { mock, fetcher } = responseSequence(
      { token, expiresAt: nowSeconds + 90, deviceId }, ready, unregistered,
      { token: renewedToken, expiresAt: nowSeconds + 300, deviceId }, ready, unregistered,
    );
    const client = new LocalLiveClient(fetcher, () => clock);
    await client.pair("ABCDEF");
    clock += 40_000;
    expect((await client.checkHardware()).state).toBe("READY");
    expect(mock).toHaveBeenCalledTimes(6);
    assertLoopbackCall(mock.mock.calls[3], "/v1/renew", true);
    assertLoopbackCall(mock.mock.calls[4], "/v1/hardware", true, renewedToken);
    client.dispose();
  });

  it("restores a paused session from paired status and stops that same session", async () => {
    const { mock, fetcher } = responseSequence(
      { token, expiresAt: nowSeconds + 120, deviceId },
      { ...ready, state: "PAUSED", sessionActive: true, sessionId },
      unregistered,
      ready,
    );
    const client = new LocalLiveClient(fetcher, () => nowSeconds * 1000);
    expect(await client.pair("ABCDEF")).toMatchObject({ state: "PAUSED", sessionActive: true, canStart: false });
    expect(await client.stop()).toMatchObject({ state: "READY", sessionActive: false });
    expect(mock).toHaveBeenCalledTimes(4);
    assertLoopbackCall(mock.mock.calls[3], `/v1/sessions/${sessionId}/stop`, true);
    expect(mock.mock.calls[3][1]?.method).toBe("POST");
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

  it("registers through signed cloud challenge, local device proof and cloud registry without persisting secrets", async () => {
    const challenge = { payload: { deviceId, ownerId: accountId }, signature: "server-signature" };
    const proof = { payload: challenge.payload, publicKey: "public-key", signature: "device-signature" };
    const certificate = { payload: { deviceId }, signature: "certificate-signature" };
    const { mock, fetcher } = responseSequence(
      { token, expiresAt: nowSeconds + 300, deviceId }, ready, unregistered,
      challenge, proof, { certificate, device: { authorized: true } }, { authorized: true },
      { ...ready, deviceAuthorized: true }, { device: { authorized: true }, entitled: true },
    );
    const client = new LocalLiveClient(fetcher, () => nowSeconds * 1000);
    expect((await client.pair("ABCDEF")).deviceAuthorized).toBe(false);
    expect(await client.registerDevice()).toMatchObject({ deviceAuthorized: true, deviceStatus: "AUTHORIZED", canStart: false });
    expect(mock).toHaveBeenCalledTimes(9);
    expect(mock.mock.calls[3][0]).toBe("/api/ai-live/devices/challenge");
    expect(mock.mock.calls[3][1]).toMatchObject({ credentials: "same-origin", cache: "no-store", redirect: "error" });
    expect((mock.mock.calls[3][1]?.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(mock.mock.calls[3][1]?.body as string)).toEqual({ deviceId, versions: LIVE_COMPONENT_VERSIONS });
    assertLoopbackCall(mock.mock.calls[4], "/v1/device/proof", true);
    expect(JSON.parse(mock.mock.calls[4][1]?.body as string)).toEqual({ challenge });
    expect(mock.mock.calls[5][0]).toBe("/api/ai-live/devices/register");
    expect(JSON.parse(mock.mock.calls[5][1]?.body as string)).toEqual(proof);
    assertLoopbackCall(mock.mock.calls[6], "/v1/device/certificate", true);
    expect(JSON.parse(mock.mock.calls[6][1]?.body as string)).toEqual({ certificate });
    expect(JSON.stringify(client.snapshot())).not.toMatch(/signature|public-key|ownerId|deviceId/);
    client.dispose();
  });

  it.each([
    [{ device: { authorized: false }, entitled: true }, "UNREGISTERED"],
    [{ device: { authorized: true }, entitled: false }, "MEMBERSHIP_REQUIRED"],
    [new Error("server unavailable; raw diagnostics"), "UNAVAILABLE"],
  ])("requires current server authorization and membership even when the local certificate is valid", async (cloud, status) => {
    const { mock, fetcher } = responseSequence(
      { token, expiresAt: nowSeconds + 300, deviceId }, { ...ready, deviceAuthorized: true }, cloud,
    );
    const client = new LocalLiveClient(fetcher, () => nowSeconds * 1000);
    const view = await client.pair("ABCDEF");
    expect(view).toMatchObject({ deviceAuthorized: false, deviceStatus: status, canStart: false });
    expect(mock.mock.calls[2][0]).toBe(`/api/ai-live/devices/${deviceId}`);
    expect(JSON.stringify(view)).not.toContain("raw diagnostics");
    client.dispose();
  });

  it("revokes on the server before updating the local identity and keeps revocation effective if the agent disconnects", async () => {
    const receipt = { payload: { deviceId }, signature: "signed-revocation" };
    const { mock, fetcher } = responseSequence(
      { token, expiresAt: nowSeconds + 300, deviceId }, { ...ready, deviceAuthorized: true },
      { device: { authorized: true }, entitled: true }, { receipt }, new Error("local disconnected"),
    );
    const client = new LocalLiveClient(fetcher, () => nowSeconds * 1000);
    await client.pair("ABCDEF");
    await expect(client.revokeDevice()).rejects.toThrow();
    expect(mock.mock.calls[3][0]).toBe(`/api/ai-live/devices/${deviceId}`);
    expect(mock.mock.calls[3][1]?.method).toBe("DELETE");
    assertLoopbackCall(mock.mock.calls[4], "/v1/device/revoke", true);
    expect(JSON.parse(mock.mock.calls[4][1]?.body as string)).toEqual({ receipt });
    expect(client.snapshot()).toMatchObject({ deviceAuthorized: false, deviceStatus: "UNREGISTERED" });
    client.dispose();
  });

  it("blocks enrollment for incompatible components before any cloud request", async () => {
    const { mock, fetcher } = responseSequence(
      { token, expiresAt: nowSeconds + 300, deviceId }, { ...ready, versions: { ...LIVE_COMPONENT_VERSIONS, worker: "0.1.0" } },
    );
    const client = new LocalLiveClient(fetcher, () => nowSeconds * 1000);
    expect(await client.pair("ABCDEF")).toMatchObject({ state: "UPDATE_REQUIRED", updateStatus: "REQUIRED" });
    await expect(client.registerDevice()).rejects.toThrow();
    expect(mock).toHaveBeenCalledTimes(2);
    client.dispose();
  });

  it("keeps a registered device revocable after fresh pairing even when its membership has expired", async () => {
    const receipt = { payload: { deviceId }, signature: "signed-revocation" };
    const { mock, fetcher } = responseSequence(
      { token, expiresAt: nowSeconds + 300, deviceId }, ready,
      { device: { authorized: true }, entitled: false }, { receipt }, { deviceAuthorized: false },
      ready, { device: { authorized: false }, entitled: false },
    );
    const client = new LocalLiveClient(fetcher, () => nowSeconds * 1000);
    expect(await client.pair("ABCDEF")).toMatchObject({ deviceRegistered: true, deviceAuthorized: false, deviceStatus: "MEMBERSHIP_REQUIRED", canStart: false });
    expect(await client.revokeDevice()).toMatchObject({ deviceRegistered: false, deviceAuthorized: false });
    expect(mock.mock.calls[3][1]?.method).toBe("DELETE");
    assertLoopbackCall(mock.mock.calls[4], "/v1/device/revoke", true);
    client.dispose();
  });
});

describe("LIVE Lite Auto AI presenter choice", () => {
  const paired = () => [{ token, expiresAt: nowSeconds + 300, deviceId }, { ...ready, deviceAuthorized: true,
    lite: { machineReady: true, reasons: [], canStart: true, commercialLive: false } }, { device: { authorized: true }, entitled: true }] as const;
  const choice = { folder: "nara", voice: "th-TH-AcharaNeural" } as const;

  it("projects the companion's Lite admission separately from the Pro gate", () => {
    const view = projectLocalMachine({ ...ready, lite: { machineReady: true, canStart: true, reasons: ["CUDA private"], commercialLive: true } }, true);
    expect(view.canStart).toBe(false);
    expect(view.lite).toEqual({ machineReady: true, canStart: true, reasons: ["ต้องตรวจสอบความพร้อมของเครื่องเพิ่มเติม"], commercialLive: false });
    expect(projectLocalMachine({ ...ready, lite: { machineReady: false, canStart: true } }, true).lite?.canStart).toBe(false);
    expect(projectLocalMachine({ ...ready, lite: { machineReady: true, canStart: true } }, false).lite).toBeUndefined();
  });

  it("reads installed presenters, voices and key status without any key and drops unsafe entries", async () => {
    const catalog = {
      presenters: [
        { packId: "lite-1", folder: "nara", name: "นารา", source: "SYNTHETIC_CHARACTER", technicalTestOnly: false, defaultVoice: "th-TH-PremwadeeNeural", frames: 120 },
        { folder: "../escape", name: "x" }, { folder: "krit", name: "", defaultVoice: "en-US-JennyNeural" },
      ],
      voices: [{ id: "th-TH-PremwadeeNeural", label: "เปรมวดี (หญิง)" }, { id: "en-US-JennyNeural", label: "Jenny" }],
      speechKey: { configured: true, provider: "azure", region: "southeastasia", key: "should-never-be-kept" },
      freeTier: { monthly_cap_characters: 450000, used_this_month: 1200, requests_per_minute_cap: 18, paid_fallback: false },
    };
    const { mock, fetcher } = responseSequence(...paired(), catalog);
    const client = new LocalLiveClient(fetcher, () => nowSeconds * 1000);
    await client.pair("ABCDEF");
    const result = await client.litePresenters();
    assertLoopbackCall(mock.mock.calls[3], "/v1/lite/presenters", true);
    expect(result.presenters).toEqual([
      { folder: "nara", name: "นารา", technicalTestOnly: false, defaultVoice: "th-TH-PremwadeeNeural", frames: 120 },
      { folder: "krit", name: "krit", technicalTestOnly: true, defaultVoice: null, frames: 0 }]);
    expect(result.voices).toEqual([{ id: "th-TH-PremwadeeNeural", label: "เปรมวดี (หญิง)" }]);
    expect(result.speechKey).toEqual({ configured: true, region: "southeastasia" });
    expect(result.freeTier).toEqual({ monthlyCapCharacters: 450000, usedThisMonth: 1200 });
    expect(JSON.stringify(result)).not.toContain("should-never-be-kept");
    client.dispose();
  });

  it("reads a pack thumbnail by folder only, as a bounded JPEG", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const items: Response[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/thumbnail")) return new Response(jpeg, { headers: { "content-type": "image/jpeg", "content-length": "4" } });
      return items.shift() ?? Response.json({ ...ready, deviceAuthorized: true });
    });
    items.push(Response.json({ token, expiresAt: nowSeconds + 300, deviceId }), Response.json({ ...ready, deviceAuthorized: true }),
      Response.json({ device: { authorized: true }, entitled: true }));
    const client = new LocalLiveClient(fetcher as unknown as typeof fetch, () => nowSeconds * 1000);
    await client.pair("ABCDEF");
    const file = await client.litePresenterThumbnail("nara");
    expect(file.type).toBe("image/jpeg");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(jpeg);
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe("http://127.0.0.1:8766/v1/lite/presenters/nara/thumbnail");
    const calls = fetcher.mock.calls.length;
    await expect(client.litePresenterThumbnail("../nara")).rejects.toThrow();
    await expect(client.litePresenterThumbnail("a/b")).rejects.toThrow();
    expect(fetcher.mock.calls.length).toBe(calls);
    client.dispose();
  });

  it("warms Lite with the chosen presenter and voice and uploads no photo", async () => {
    const context = { payload: { purpose: "AI_LIVE_PRODUCT_CONTEXT", products: [] }, signature: "signed-context" };
    const { mock, fetcher } = responseSequence(...paired(), context, { synced: true }, { preparing: true });
    const client = new LocalLiveClient(fetcher, () => nowSeconds * 1000);
    await client.pair("ABCDEF");
    const presenter = new File(["test-reference"], "presenter.jpg", { type: "image/jpeg" });
    for (const bad of [{ litePresenter: choice }, { litePresenter: choice, liveMode: "lite" as const, presenter },
      { litePresenter: { ...choice, voice: "th-TH-Other" as never }, liveMode: "lite" as const },
      { litePresenter: { ...choice, folder: "../nara" }, liveMode: "lite" as const }]) {
      await expect(client.prepareAI(undefined, { accountId, productIds: [productId], microphoneId: null, ...bad })).rejects.toThrow();
    }
    expect(mock).toHaveBeenCalledTimes(3);
    await client.prepareAI(undefined, { accountId, productIds: [productId], microphoneId: null, liveMode: "lite", litePresenter: choice });
    expect(mock.mock.calls.map((call) => String(call[0]))).not.toContain("http://127.0.0.1:8766/v1/references");
    assertLoopbackCall(mock.mock.calls[5], "/v1/ai/warmup", true);
    expect(JSON.parse(mock.mock.calls[5][1]?.body as string)).toEqual({ accountId, productIds: [productId], microphoneId: null,
      liveMode: "lite", litePresenter: choice });
    client.dispose();
  });

  it("starts Lite on its own admission with the chosen presenter while Pro keeps its gate", async () => {
    const grant = { payload: { grantId: "grant" }, signature: "signed-grant" };
    const context = { payload: { purpose: "AI_LIVE_PRODUCT_CONTEXT", products: [] }, signature: "signed-context" };
    const challenge = { challenge: "c".repeat(43), deviceProof: "proof" };
    const { mock, fetcher } = responseSequence(...paired(), challenge, grant, context, { synced: true },
      { ...ready, state: "BUSY", sessionActive: true, sessionId });
    const client = new LocalLiveClient(fetcher, () => nowSeconds * 1000);
    await client.pair("ABCDEF");
    const presenter = new File(["test-reference"], "presenter.jpg", { type: "image/jpeg" });
    expect(client.snapshot()).toMatchObject({ canStart: false, lite: { canStart: true } });
    // LIVE Pro stays closed by its own gate even when Lite is admitted.
    await expect(client.start({ accountId, productIds: [productId], presenter, microphoneId: "default" })).rejects.toThrow();
    await expect(client.start({ accountId, productIds: [productId], litePresenter: choice, microphoneId: "default" })).rejects.toThrow();
    expect(mock).toHaveBeenCalledTimes(3);
    await client.start({ accountId, productIds: [productId], litePresenter: choice, microphoneId: null, liveMode: "lite" });
    assertLoopbackCall(mock.mock.calls[7], "/v1/sessions/start", true);
    expect(JSON.parse(mock.mock.calls[7][1]?.body as string)).toEqual({ grant, accountId, productIds: [productId],
      microphoneId: null, liveMode: "lite", litePresenter: choice });
    expect(mock.mock.calls.map((call) => String(call[0]))).not.toContain("http://127.0.0.1:8766/v1/references");
    client.dispose();
  });
});
