import { generateKeyPairSync, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyLocalLease, type LocalLeasePayload } from "@/features/ai-live/local-license";
import { LOCAL_LEASE_VERSIONS } from "@/features/ai-live/local-license";
import { parseDevicePublicKey, signedDeviceMessage } from "@/features/ai-live/device-identity";
import { readLiveSigningConfiguration, verifyLiveEnvelope } from "@/features/ai-live/server-config";
import { RequestSecurityError } from "@/lib/security/request";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), rateLimit: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser }, from: mocks.from })),
}));
vi.mock("@/lib/security/rate-limit", () => ({ enforceOwnerMutationRateLimit: mocks.rateLimit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));

import { POST } from "./route";

const origin = "https://viralflow.example";
const ownerId = "e26ed687-b36b-44d9-a8df-38e9545d760c";
const otherOwnerId = "213e1bce-c780-45dc-a85a-aa7728e1e05e";
const deviceId = "4b531890-5020-4273-b6fb-2cf6e3cb5f7a";
const accountId = "4d334044-44d6-427b-a44b-872243d58b93";
const productId = "9820f32b-5ff6-4fdc-a5b3-d4b223471b1e";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const deviceKeys = generateKeyPairSync("ed25519");
const devicePublicKey = deviceKeys.publicKey.export({ type: "spki", format: "pem" }).toString();

type Row = Record<string, unknown>;
let rows: Record<string, Row[]>;
let user: { id: string; app_metadata: Record<string, unknown>; user_metadata?: Record<string, unknown> };

function selectRows(table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  const result = () => ({ data: (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row))), error: null });
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
    in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
    is: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
    maybeSingle: async () => ({ ...result(), data: result().data[0] ?? null }),
    then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
  };
  return query;
}

function request(body?: unknown, requestOrigin = origin) {
  const challenge = randomBytes(32).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  body ??= { deviceId, challenge, accountId, productIds: [productId], deviceProof: signedDeviceMessage({
    v: 1, purpose: "AI_LIVE_LEASE_REQUEST", deviceId, challenge, issuedAt: now, expiresAt: now + 120, versions: LOCAL_LEASE_VERSIONS,
  }, deviceKeys.privateKey) };
  return new Request(`${origin}/api/ai-live/local-grant`, {
    method: "POST", headers: { origin: requestOrigin, "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AI_LIVE_LEASE_SIGNING_PRIVATE_KEY", privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  user = {
    id: ownerId,
    app_metadata: { ai_live: {
      enabled: true, expiresAt: new Date(Date.now() + 300_000).toISOString(),
      deviceLimit: 1, registeredDeviceIds: [deviceId],
    } },
  };
  rows = {
    tiktok_accounts: [{ id: accountId, owner_id: ownerId, is_mock: false, authorization_status: "authorized", hidden_at: null }],
    products: [{ id: productId, owner_id: ownerId, status: "available" }],
    ai_live_devices: [{ device_id: deviceId, owner_id: ownerId, public_key: devicePublicKey, key_fingerprint: parseDevicePublicKey(devicePublicKey)!.fingerprint, revoked_at: null }],
  };
  mocks.getUser.mockImplementation(async () => ({ data: { user }, error: null }));
  mocks.from.mockImplementation(selectRows);
  mocks.rateLimit.mockResolvedValue(undefined);
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/ai-live/local-grant", () => {
  it("requires a user freshly returned by Supabase Auth before reading selections", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();

    mocks.getUser.mockResolvedValue({ data: { user }, error: new Error("auth unavailable") });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("issues a short Ed25519 lease tied to the server owner, registered device, challenge and owned selection", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const lease = await response.json() as { payload: LocalLeasePayload; signature: string };
    expect(Object.keys(lease).sort()).toEqual(["payload", "signature"]);
    expect(lease.payload).toMatchObject({
      v: 1, ownerId, deviceId, accountId, productIds: [productId], entitled: true,
    });
    expect(lease.payload.expiresAt - lease.payload.issuedAt).toBeLessThanOrEqual(120);
    expect(verifyLocalLease(lease.payload, lease.signature, publicKey, Math.floor(Date.now() / 1000))).toBe(true);
    expect(mocks.rateLimit).toHaveBeenCalledWith("ai-live-local-grant", ownerId);
    expect(mocks.from.mock.calls.map(([table]) => table).sort()).toEqual(["ai_live_devices", "products", "tiktok_accounts"]);
  });

  it("does not infer entitlement from login or editable user metadata", async () => {
    user.app_metadata = {};
    user.user_metadata = { ai_live: { enabled: true, registeredDeviceIds: [deviceId] } };
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("denies unregistered or expired devices and refuses selections outside the owner or current availability", async () => {
    rows.ai_live_devices[0].owner_id = otherOwnerId;
    expect((await POST(request())).status).toBe(403);
    rows.ai_live_devices[0].owner_id = ownerId;
    rows.ai_live_devices[0].revoked_at = new Date().toISOString();
    expect((await POST(request())).status).toBe(403);
    rows.ai_live_devices[0].revoked_at = null;
    user.app_metadata.ai_live = { enabled: true, expiresAt: new Date(Date.now() - 1_000).toISOString(), deviceLimit: 1, registeredDeviceIds: [deviceId] };
    expect((await POST(request())).status).toBe(403);
    user.app_metadata.ai_live = { enabled: true, expiresAt: new Date(Date.now() + 300_000).toISOString(), deviceLimit: 1, registeredDeviceIds: [deviceId] };
    rows.tiktok_accounts[0].owner_id = otherOwnerId;
    expect((await POST(request())).status).toBe(403);
    rows.tiktok_accounts[0].owner_id = ownerId;
    rows.tiktok_accounts[0].is_mock = true;
    expect((await POST(request())).status).toBe(403);
    rows.tiktok_accounts[0].is_mock = false;
    rows.tiktok_accounts[0].authorization_status = "revoked";
    expect((await POST(request())).status).toBe(403);
    rows.tiktok_accounts[0].authorization_status = "authorized";
    rows.products[0].status = "unavailable";
    expect((await POST(request())).status).toBe(403);
    rows.products[0].status = "available";
    rows.products[0].owner_id = otherOwnerId;
    expect((await POST(request())).status).toBe(403);
  });

  it("rejects cross-origin and oversized requests before issuing a lease", async () => {
    expect((await POST(request(undefined, "https://other.example"))).status).toBe(403);
    expect((await POST(request(undefined, ""))).status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled();
    const oversized = { deviceId, challenge: randomBytes(32).toString("base64url"), accountId, productIds: [productId], padding: "x".repeat(5000) };
    expect((await POST(request(oversized))).status).toBe(413);
  });

  it("fails closed on a missing signing key and rate limiting", async () => {
    vi.stubEnv("AI_LIVE_LEASE_SIGNING_PRIVATE_KEY", "");
    expect((await POST(request())).status).toBe(503);
    mocks.rateLimit.mockRejectedValue(new RequestSecurityError("rate_limited", 429));
    const limited = await POST(request());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("uses the configured active signing key ID on real grant handlers and denies inactive membership", async () => {
    vi.stubEnv("AI_LIVE_SIGNING_KEY_ID", "live-current");
    vi.stubEnv("AI_LIVE_SIGNING_PUBLIC_KEYS_JSON", JSON.stringify({ "live-current": publicKey.export({ type: "spki", format: "pem" }).toString() }));
    const response = await POST(request());
    expect(response.status).toBe(200);
    const grant = await response.json();
    expect(grant.keyId).toBe("live-current");
    expect(verifyLiveEnvelope(grant, readLiveSigningConfiguration()!)).toBe(true);
    expect(JSON.stringify(grant)).not.toContain("PRIVATE KEY");
    user.app_metadata.ai_live = { ...(user.app_metadata.ai_live as Record<string, unknown>), status: "inactive" };
    expect((await POST(request())).status).toBe(403);
  });
});
