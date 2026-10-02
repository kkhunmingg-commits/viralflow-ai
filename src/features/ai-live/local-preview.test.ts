import { beforeEach, describe, expect, it, vi } from "vitest";

const release = vi.hoisted(() => ({ validated: true }));
vi.mock("client-only", () => ({}));
vi.mock("./local-contract", async (original) => ({ ...await original<typeof import("./local-contract")>(),
  get AI_LIVE_REALTIME_VALIDATED() { return release.validated; } }));

import { LocalLiveClient } from "./local-client";
import { LIVE_COMPONENT_VERSIONS } from "./local-contract";

const nowSeconds = 1_780_000_000;
const deviceId = "4b531890-5020-4273-b6fb-2cf6e3cb5f7a";
const sessionId = "7774a04a-683c-4c85-9c6c-16457d63a369";
const token = "t".repeat(48);

async function pairedClient(frame: Response | ((init?: RequestInit) => Promise<Response>), authorized = true) {
  const sequence = [
    Response.json({ token, expiresAt: nowSeconds + 300, deviceId }),
    Response.json({ state: "BUSY", versions: LIVE_COMPONENT_VERSIONS, sessionActive: true, sessionId, deviceAuthorized: true }),
    Response.json({ device: { authorized }, entitled: true }),
  ];
  const fetcher = vi.fn(async (_path: RequestInfo | URL, init?: RequestInit) => {
    if (sequence.length) return sequence.shift()!;
    return typeof frame === "function" ? frame(init) : frame;
  });
  const client = new LocalLiveClient(fetcher as typeof fetch, () => nowSeconds * 1000);
  await client.pair("ABCDEF");
  return { client, fetcher };
}

beforeEach(() => { release.validated = true; });

describe("owned presenter frame browser boundary", () => {
  it("keeps preview disabled before production validation, even with an active authorized session", async () => {
    const { client, fetcher } = await pairedClient(new Response("jpeg", { headers: { "Content-Type": "image/jpeg" } }));
    release.validated = false;
    expect(await client.previewFrame()).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(3);
    client.dispose();
  });

  it("never requests frames before pairing or without cloud device authorization", async () => {
    const unpairedFetch = vi.fn();
    const unpaired = new LocalLiveClient(unpairedFetch);
    expect(await unpaired.previewFrame()).toBeNull();
    expect(unpairedFetch).not.toHaveBeenCalled();
    unpaired.dispose();
    const { client, fetcher } = await pairedClient(new Response(), false);
    expect(await client.previewFrame()).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(3);
    client.dispose();
  });

  it("fetches JPEG bytes from the fixed owned loopback path with credentials only in a header", async () => {
    const { client, fetcher } = await pairedClient(new Response(new Uint8Array([255, 216, 255, 217]), {
      headers: { "Content-Type": "image/jpeg", "Content-Length": "4" },
    }));
    const frame = await client.previewFrame();
    expect(frame?.type).toBe("image/jpeg");
    expect(frame?.size).toBe(4);
    expect(fetcher.mock.calls[3][0]).toBe(`http://127.0.0.1:8766/v1/sessions/${sessionId}/frame`);
    expect(fetcher.mock.calls[3][1]).toMatchObject({ method: "GET", credentials: "omit", cache: "no-store",
      redirect: "error", referrerPolicy: "no-referrer", headers: { Authorization: `Bearer ${token}`, Accept: "image/jpeg" } });
    expect(String(fetcher.mock.calls[3][0])).not.toContain(token);
    client.dispose();
  });

  it("treats a not-yet-generated frame as absent without inventing an image", async () => {
    const { client } = await pairedClient(new Response(null, { status: 204 }));
    expect(await client.previewFrame()).toBeNull();
    client.dispose();
  });

  it.each(["text/html", "image/svg+xml", "application/json"])("rejects unsafe content type %s", async (type) => {
    const { client } = await pairedClient(new Response("private diagnostic", { headers: { "Content-Type": type } }));
    await expect(client.previewFrame()).rejects.toThrow("ยังไม่สามารถแสดงภาพจากระบบได้");
    client.dispose();
  });

  it("bounds declared and streamed image sizes without trusting Content-Length", async () => {
    const { client: declared } = await pairedClient(new Response("small", {
      headers: { "Content-Type": "image/jpeg", "Content-Length": String(4 * 1024 * 1024 + 1) },
    }));
    await expect(declared.previewFrame()).rejects.toThrow("ภาพจากระบบมีขนาดไม่ถูกต้อง");
    declared.dispose();
    const { client: streamed } = await pairedClient(new Response(new Uint8Array(4 * 1024 * 1024 + 1), {
      headers: { "Content-Type": "image/jpeg", "Content-Length": "1" },
    }));
    await expect(streamed.previewFrame()).rejects.toThrow("ภาพจากระบบมีขนาดไม่ถูกต้อง");
    streamed.dispose();
  });

  it("aborts in-flight frame work on disposal", async () => {
    let signal: AbortSignal | undefined;
    const { client } = await pairedClient((init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    });
    const frame = client.previewFrame();
    client.dispose();
    expect(signal?.aborted).toBe(true);
    await expect(frame).rejects.toThrow("aborted");
  });
});
