import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), rpc: vi.fn(), rate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceOwnerMutationRateLimit: mocks.rate }));
import { POST as challenge } from "../../app/api/ai-live/devices/challenge/route";
import { POST as register } from "../../app/api/ai-live/devices/register/route";
import { GET as status, DELETE as revoke } from "../../app/api/ai-live/devices/[id]/route";
import { LOCAL_LEASE_VERSIONS } from "./local-license";
import { signedDeviceMessage } from "./device-identity";

const ownerId = "e26ed687-b36b-44d9-a8df-38e9545d760c";
const deviceId = "4b531890-5020-4273-b6fb-2cf6e3cb5f7a";
const serverKeys = generateKeyPairSync("ed25519");
const deviceKeys = generateKeyPairSync("ed25519");
const url = "https://app.test/api/ai-live/devices";
const routeContext = { params: Promise.resolve({ id: deviceId }) };
let user: { id: string; app_metadata: Record<string, unknown> };
function request(path: string, body: unknown, origin = "https://app.test", method = "POST") {
  return new Request(url + path, { method, headers: { origin, "content-type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AI_LIVE_LEASE_SIGNING_PRIVATE_KEY", serverKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  user = { id: ownerId, app_metadata: { ai_live: { enabled: true, expiresAt: new Date(Date.now() + 300_000).toISOString(), deviceLimit: 1 } } };
  mocks.getUser.mockImplementation(async () => ({ data: { user }, error: null }));
  mocks.rate.mockResolvedValue(undefined);
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.from.mockImplementation(() => {
    const query = { select: () => query, eq: () => query, delete: () => query, lt: async () => ({ error: null }), insert: async () => ({ error: null }),
      maybeSingle: async () => ({ data: { device_id: deviceId, revoked_at: null }, error: null }) };
    return query;
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("authenticated AI LIVE registration routes", () => {
  it("executes challenge -> device proof -> durable registration -> signed certificate through real handlers", async () => {
    const challengeResponse = await challenge(request("/challenge", { deviceId, versions: LOCAL_LEASE_VERSIONS }));
    expect(challengeResponse.status).toBe(200);
    const signedChallenge = await challengeResponse.json();
    const proof = { ...signedDeviceMessage(signedChallenge.payload, deviceKeys.privateKey), publicKey: deviceKeys.publicKey.export({ type: "spki", format: "pem" }).toString() };
    const response = await register(request("/register", proof));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ device: { authorized: true }, certificate: { payload: { purpose: "AI_LIVE_DEVICE_CERTIFICATE", ownerId, deviceId } } });
    expect(mocks.getUser).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledWith("ai_live_register_device", expect.objectContaining({ p_device_limit: 1, p_owner_id: ownerId }));
  });

  it("enforces origin, authentication, current membership and compatible versions before registration", async () => {
    expect((await challenge(request("/challenge", { deviceId, versions: LOCAL_LEASE_VERSIONS }, "https://evil.test"))).status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled();
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await challenge(request("/challenge", { deviceId, versions: LOCAL_LEASE_VERSIONS }))).status).toBe(401);
    mocks.getUser.mockImplementation(async () => ({ data: { user }, error: null }));
    expect((await challenge(request("/challenge", { deviceId, versions: { ...LOCAL_LEASE_VERSIONS, agent: "old" } }))).status).toBe(400);
    user.app_metadata = { ai_live: { enabled: true, expiresAt: new Date(Date.now() - 1000).toISOString(), deviceLimit: 1 } };
    expect((await challenge(request("/challenge", { deviceId, versions: LOCAL_LEASE_VERSIONS }))).status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("revokes through scoped persistence and reports only authorization to the customer", async () => {
    const result = await revoke(request("/" + deviceId, null, "https://app.test", "DELETE"), routeContext);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ receipt: { payload: { purpose: "AI_LIVE_DEVICE_REVOKED", ownerId, deviceId } } });
    expect(await (await status(new Request(url + "/" + deviceId), routeContext)).json()).toEqual({ device: { authorized: true }, entitled: true });
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect((await revoke(request("/" + deviceId, null, "https://app.test", "DELETE"), routeContext)).status).toBe(404);
  });

  it("fails honestly on missing signing key or registry without exposing raw errors", async () => {
    vi.stubEnv("AI_LIVE_LEASE_SIGNING_PRIVATE_KEY", "");
    expect((await challenge(request("/challenge", { deviceId, versions: LOCAL_LEASE_VERSIONS }))).status).toBe(503);
    mocks.from.mockImplementation(() => { throw new Error("private postgres data"); });
    const response = await status(new Request(url + "/" + deviceId), routeContext);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("postgres");
  });
});
