import { describe, expect, it, vi } from "vitest";
vi.mock("client-only", () => ({}));
import { LocalLiveClient } from "./local-client";
import { LIVE_COMPONENT_VERSIONS } from "./local-contract";

const id = "7774a04a-683c-4c85-9c6c-16457d63a369";
const deviceId = "4b531890-5020-4273-b6fb-2cf6e3cb5f7a";
const token = "t".repeat(48);
const card = { id, name: "คน LIVE", voiceLabel: "เสียงของฉัน", assignedAccountIds: [id], status: "READY",
  hasReference: true, consentConfirmed: true, updatedAt: 1000 };
const ready = { state: "READY", versions: LIVE_COMPONENT_VERSIONS, deviceAuthorized: true, sessionActive: false };
function bridge(...replies: Response[]) {
  const fetcher = vi.fn(async () => {
    const response = replies.shift();
    if (!response) throw new Error("unexpected request");
    return response;
  });
  const client = new LocalLiveClient(fetcher as typeof fetch, () => 1_000_000);
  return { client, fetcher };
}
function paired(...responses: Response[]) {
  return bridge(Response.json({ token, expiresAt: 2000, deviceId }), Response.json(ready),
    Response.json({ device: { authorized: true }, entitled: true }), ...responses);
}

describe("owner-bound presenter library bridge", () => {
  it("uses the paired device boundary, strips diagnostics, and never puts credentials in URLs", async () => {
    const { client, fetcher } = paired(Response.json({ presenters: [{ ...card, secret: "do-not-return", model: "internal" }] }),
      Response.json({ presenter: card }), Response.json({ deleted: true }));
    await client.pair("one-time-code");
    expect(await client.listPresenters()).toEqual([card]);
    expect(await client.savePresenter({ name: card.name, voiceLabel: card.voiceLabel, assignedAccountIds: [id], consentConfirmed: true })).toEqual(card);
    await client.deletePresenter(id);
    for (const call of fetcher.mock.calls.slice(3) as unknown as [string, RequestInit][]) {
      expect(call[0]).not.toContain(token);
      expect(call[1].headers).toMatchObject({ Authorization: `Bearer ${token}` });
      expect(call[1]).toMatchObject({ redirect: "error", cache: "no-store", credentials: "omit" });
    }
    expect(client.snapshot().canStart).toBe(false);
    client.dispose();
  });

  it("rejects invalid selection, wrong projection and oversized binary references", async () => {
    const { client } = paired(Response.json({ presenters: [{ ...card, id: "../escape" }] }), Response.json(ready),
      new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/jpeg", "Content-Length": "2" } }));
    await client.pair("one-time-code");
    await expect(client.listPresenters()).rejects.toThrow("ข้อมูลคน LIVE");
    await expect(client.deletePresenter("../escape")).rejects.toThrow();
    await expect(client.presenterReference(id)).rejects.toThrow("ขนาด");
    client.dispose();
  });

  it("prevents unpaired library access and release-start bypass", async () => {
    const { client, fetcher } = bridge();
    await expect(client.listPresenters()).rejects.toThrow("เชื่อมส่วนเสริม");
    await expect(client.presenterReference(id)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("accepts the supported 20-pack / 50-account library without widening unrelated status limits", async () => {
    const identifiers = Array.from({ length: 50 }, (_, index) => `7774a04a-683c-4c85-9c6c-${String(index).padStart(12, "0")}`);
    const presenters = Array.from({ length: 20 }, (_, index) => ({ ...card,
      id: `7774a04a-683c-4c85-9c6c-${String(index + 100).padStart(12, "0")}`, assignedAccountIds: identifiers }));
    expect(JSON.stringify({ presenters }).length).toBeGreaterThan(16_384);
    const { client } = paired(Response.json({ presenters }));
    await client.pair("one-time-code");
    expect(await client.listPresenters()).toEqual(presenters);
    client.dispose();
    const status = paired(Response.json({ ...ready, oversized: "x".repeat(16_385) }));
    await status.client.pair("one-time-code");
    expect((await status.client.discover()).state).toBe("OFFLINE");
    status.client.dispose();
  });

  it("cancels an oversized streamed library instead of allocating an unbounded JSON response", async () => {
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(65_537))); },
      cancel: cancelled,
    });
    const { client } = paired(new Response(stream));
    await client.pair("one-time-code");
    await expect(client.listPresenters()).rejects.toThrow("ขนาด");
    expect(cancelled).toHaveBeenCalledTimes(1);
    client.dispose();
  });

  it("cancels rejected binary references before clearing their request deadline", async () => {
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1, 2])); }, cancel: cancelled,
    });
    const { client } = paired(Response.json(ready), new Response(stream, {
      headers: { "Content-Type": "image/svg+xml", "Content-Length": "2" },
    }));
    await client.pair("one-time-code");
    await expect(client.presenterReference(id)).rejects.toThrow("เปิดรูป");
    expect(cancelled).toHaveBeenCalledTimes(1);
    client.dispose();
  });

  it("does not return a reference file when the caller has cancelled even if the network boundary ignores abort", async () => {
    const aborted = new AbortController();
    const replies = [Response.json({ token, expiresAt: 2000, deviceId }), Response.json(ready),
      Response.json({ device: { authorized: true }, entitled: true }), Response.json(ready)];
    const fetcher = vi.fn(async () => {
      if (replies.length) return replies.shift()!;
      aborted.abort();
      return new Response(new Uint8Array([1, 2]), { headers: { "Content-Type": "image/jpeg", "Content-Length": "2" } });
    });
    const client = new LocalLiveClient(fetcher as typeof fetch, () => 1_000_000);
    await client.pair("one-time-code");
    await expect(client.presenterReference(id, aborted.signal)).rejects.toThrow("ไม่ครบถ้วน");
    client.dispose();
  });
});
