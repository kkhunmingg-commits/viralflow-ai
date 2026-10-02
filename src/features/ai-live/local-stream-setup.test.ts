import { describe, expect, it, vi } from "vitest";

vi.mock("client-only", () => ({}));

import { LocalLiveClient } from "./local-client";
import { AI_LIVE_REALTIME_VALIDATED, LIVE_COMPONENT_VERSIONS } from "./local-contract";

const nowSeconds = 1_780_000_000;
const deviceId = "4b531890-5020-4273-b6fb-2cf6e3cb5f7a";
const accountId = "4d334044-44d6-427b-a44b-872243d58b93";
const productId = "9820f32b-5ff6-4fdc-a5b3-d4b223471b1e";
const token = "t".repeat(48);
const grant = { payload: { deviceId, accountId }, signature: "signed-grant" };

async function setupClient(overrides: { local?: Record<string, unknown>; cloud?: Record<string, unknown>; result?: Record<string, unknown> } = {}) {
  const sequence = [
    { token, expiresAt: nowSeconds + 300, deviceId },
    { state: "GPU_REQUIRED", versions: LIVE_COMPONENT_VERSIONS, sessionActive: false, deviceAuthorized: true, ...overrides.local },
    { device: { authorized: true }, entitled: true, ...overrides.cloud },
    { challenge: "a".repeat(43), deviceProof: { signature: "device-proof" } },
    grant,
    { configured: false, ...overrides.result },
  ];
  const fetcher = vi.fn(async (_path: RequestInfo | URL, _init?: RequestInit) => {
    expect(_path).toBeDefined();
    expect(_init).toBeDefined();
    const next = sequence.shift();
    if (!next) throw new Error("Unexpected request");
    return Response.json(next);
  });
  const client = new LocalLiveClient(fetcher as typeof fetch, () => nowSeconds * 1000);
  await client.pair("ABCDEF");
  return { client, fetcher };
}

describe("native LIVE settings launch", () => {
  it("prepares legitimate settings without unlocking Start or needing GPU validation", async () => {
    expect(AI_LIVE_REALTIME_VALIDATED).toBe(false);
    const { client, fetcher } = await setupClient();
    expect(client.snapshot().canStart).toBe(false);
    expect(await client.configureStream({ accountId, productIds: [productId] })).toEqual({ configured: false });
    expect(fetcher.mock.calls[3][0]).toBe("http://127.0.0.1:8766/v1/challenge");
    expect(fetcher.mock.calls[4][0]).toBe("/api/ai-live/local-grant");
    expect(JSON.parse(fetcher.mock.calls[4][1]?.body as string)).toEqual({ deviceId, accountId,
      productIds: [productId], challenge: "a".repeat(43), deviceProof: { signature: "device-proof" } });
    expect(fetcher.mock.calls[5][0]).toBe("http://127.0.0.1:8766/v1/stream/setup");
    expect(JSON.parse(fetcher.mock.calls[5][1]?.body as string)).toEqual({ grant });
    expect(fetcher.mock.calls[5][1]).toMatchObject({ method: "POST", credentials: "omit", cache: "no-store",
      redirect: "error", referrerPolicy: "no-referrer", headers: { Authorization: `Bearer ${token}` } });
    expect(client.snapshot().canStart).toBe(false);
    client.dispose();
  });

  it.each([
    { cloud: { device: { authorized: false } } },
    { cloud: { entitled: false } },
    { local: { sessionActive: true } },
  ])("blocks settings launch without current permissions or while a session is active", async (overrides) => {
    const { client, fetcher } = await setupClient(overrides);
    await expect(client.configureStream({ accountId, productIds: [productId] })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(3);
    client.dispose();
  });

  it("validates the account and product selection before requesting a grant", async () => {
    const { client, fetcher } = await setupClient();
    await expect(client.configureStream({ accountId: "not-an-account", productIds: [productId] })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(3);
    client.dispose();
  });

  it("returns only a boolean configuration result, dropping any unexpected secrets", async () => {
    const { client } = await setupClient({ result: { configured: true, streamKey: "private-key", serverUrl: "rtmps://private" } });
    expect(await client.configureStream({ accountId, productIds: [productId] })).toEqual({ configured: true });
    expect(JSON.stringify(client.snapshot())).not.toMatch(/private-key|rtmps/);
    client.dispose();
  });
});
