import { describe, expect, it, vi } from "vitest";
vi.mock("client-only", () => ({}));
import { LocalLiveClient } from "./local-client";
import { LIVE_COMPONENT_VERSIONS, localMachineView, projectLocalMachine, projectLocalRooms, projectLocalCapacity } from "./local-contract";
import { customerRoomRuntime } from "./customer-room-view";

const accountA = "11111111-1111-4111-8111-111111111111";
const accountB = "22222222-2222-4222-8222-222222222222";
const sessionA = "33333333-3333-4333-8333-333333333333";
const sessionB = "44444444-4444-4444-8444-444444444444";
const productA = "55555555-5555-4555-8555-555555555555";
const productB = "66666666-6666-4666-8666-666666666666";
const room = (accountId: string, sessionId: string, currentProductId: string) => ({ accountId, sessionId, currentProductId,
  sessionStartedAt: 1000, state: "BUSY", customerStream: { phase: "CONNECTING", connectionQuality: "UNAVAILABLE" } });
const capacity = { status: "VERIFIED" as const, maximumRooms: 3, activeRooms: 2, canStartAnotherRoom: true };
const active = { versions: LIVE_COMPONENT_VERSIONS, state: "BUSY", sessionActive: true, sessionId: sessionA, activeAccountId: accountA,
  deviceAuthorized: true, rooms: [room(accountA, sessionA, productA), room(accountB, sessionB, productB)], capacity };

describe("owner-bound multi-room client", () => {
  it("targets pause/resume/stop by the selected account, preserving other room identity", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const inputs: unknown[] = [
      { token: "t".repeat(48), deviceId: "77777777-7777-4777-8777-777777777777", expiresAt: 1200 },
      active, { device: { authorized: true }, entitled: true },
      { ...active, rooms: [active.rooms[0], { ...active.rooms[1], state: "PAUSED" }] }, { device: { authorized: true }, entitled: true },
      active, { device: { authorized: true }, entitled: true },
      { ...active, rooms: [{ ...active.rooms[0], state: "STOPPED" }, active.rooms[1]], capacity: { ...capacity, activeRooms: 1 } },
      { device: { authorized: true }, entitled: true },
    ];
    const fetcher = vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
      calls.push([String(url), options]); return Response.json(inputs.shift());
    });
    const client = new LocalLiveClient(fetcher as typeof fetch, () => 1000_000);
    await client.pair("ABCDEF");
    const paused = await client.pauseAccount(accountB);
    expect(paused.rooms?.find((item) => item.accountId === accountB)?.state).toBe("PAUSED");
    expect(paused.rooms?.find((item) => item.accountId === accountA)?.state).toBe("BUSY");
    await client.resumeAccount(accountB);
    const stopped = await client.stopAccount(accountA);
    expect(stopped.rooms?.find((item) => item.accountId === accountB)?.state).toBe("BUSY");
    expect(calls.filter(([url]) => /\/(pause|resume|stop)$/.test(url)).map(([url]) => url)).toEqual([
      `http://127.0.0.1:8766/v1/sessions/${sessionB}/pause`,
      `http://127.0.0.1:8766/v1/sessions/${sessionB}/resume`,
      `http://127.0.0.1:8766/v1/sessions/${sessionA}/stop`,
    ]);
    const count = calls.length;
    await expect(client.stopAccount("unknown")).rejects.toThrow();
    expect(calls).toHaveLength(count);
    client.dispose();
  });

  it("projections select matching room state and never inherit another account's product", () => {
    const machine = projectLocalMachine(active, true);
    const options = { imageReady: true, microphoneReady: true, productsReady: true, busy: false };
    const b = customerRoomRuntime({ ...options, accountId: accountB, machine });
    expect(b).toMatchObject({ accountId: accountB, sessionActive: true, currentProductId: productB });
    expect(b.rooms).toHaveLength(2);
    expect(b.rooms[0]).not.toHaveProperty("sessionId");
    const other = customerRoomRuntime({ ...options, accountId: "another-account", machine });
    expect(other).toMatchObject({ sessionActive: false, currentProductId: null, sessionStartedAt: null });
    expect(b.canStart).toBe(false);
  });

  it("unknown or exhausted capacity never authorizes Start even if other readiness flags claim it", () => {
    const machine = { ...localMachineView("READY", true), canStart: true, deviceAuthorized: true };
    const options = { accountId: accountA, imageReady: true, microphoneReady: true, productsReady: true, busy: false };
    expect(customerRoomRuntime({ ...options, machine }).canStart).toBe(false);
    expect(customerRoomRuntime({ ...options, machine: { ...machine, capacity: { ...capacity, activeRooms: 3, canStartAnotherRoom: false } } }).canStart).toBe(false);
    expect(projectLocalCapacity({ ...capacity, maximumRooms: true }).status).toBe("UNVERIFIED_CAPACITY");
    expect(projectLocalCapacity({ ...capacity, maximumRooms: 30 }).maximumRooms).toBeNull();
  });

  it("rejects duplicate or malformed room routes and strips diagnostics from known rooms", () => {
    expect(projectLocalRooms([active.rooms[0], active.rooms[0]])).toEqual([]);
    expect(projectLocalRooms([{ ...active.rooms[0], sessionId: "unsafe" }])).toEqual([]);
    const projected = projectLocalRooms([{ ...active.rooms[0], token: "secret", provider: "internal", raw: { secret: true } }]);
    expect(JSON.stringify(projected)).not.toMatch(/secret|internal|token|raw/);
    const incompatible = projectLocalMachine({ ...active, versions: {} }, true);
    expect(incompatible.rooms).toHaveLength(2);
    expect(incompatible.canStart).toBe(false);
  });

  it("room snapshots do not allow callers to mutate another room's routing state", async () => {
    const inputs = [{ token: "t".repeat(48), deviceId: "77777777-7777-4777-8777-777777777777", expiresAt: 1200 },
      active, { device: { authorized: true }, entitled: true }];
    const client = new LocalLiveClient(vi.fn(async () => Response.json(inputs.shift())) as typeof fetch, () => 1000_000);
    await client.pair("ABCDEF");
    const snapshot = client.snapshot();
    snapshot.rooms![0].sessionId = sessionB;
    snapshot.capacity!.maximumRooms = 10;
    expect(client.snapshot().rooms![0].sessionId).toBe(sessionA);
    expect(client.snapshot().capacity!.maximumRooms).toBe(3);
    client.dispose();
  });
});
