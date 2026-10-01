import { generateKeyPairSync, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { LOCAL_LEASE_VERSIONS, type LocalGrantRequest } from "./local-license";
import { parseDevicePublicKey, signedDeviceMessage, verifyDeviceSignature, type DeviceRegistration } from "./device-identity";
import { authorizeDeviceLease, createDeviceChallenge, liveDeviceStatus, registerLiveDevice, revokeLiveDevice } from "./device-registry";

const ownerId = "e26ed687-b36b-44d9-a8df-38e9545d760c";
const deviceId = "4b531890-5020-4273-b6fb-2cf6e3cb5f7a";
const otherOwner = "213e1bce-c780-45dc-a85a-aa7728e1e05e";
const now = 1_780_000_000;
const serverKeys = generateKeyPairSync("ed25519");
const deviceKeys = generateKeyPairSync("ed25519");
const devicePublicKey = deviceKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
const fingerprint = parseDevicePublicKey(devicePublicKey)!.fingerprint;
const metadata = { ai_live: { enabled: true, expiresAt: new Date((now + 600) * 1000).toISOString(), deviceLimit: 1 } };
const from = vi.fn();
const rpc = vi.fn();
const registry = { from, rpc } as unknown as SupabaseClient;
let device: Record<string, unknown> | null;
let inserts: unknown[];

beforeEach(() => {
  vi.clearAllMocks(); inserts = [];
  device = { device_id: deviceId, owner_id: ownerId, public_key: devicePublicKey, key_fingerprint: fingerprint, revoked_at: null };
  from.mockImplementation(() => {
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    const query = {
      select: () => query, eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      delete: () => query, lt: async () => ({ error: null }),
      is: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      insert: async (row: unknown) => { inserts.push(row); return { error: null }; },
      maybeSingle: async () => ({ data: device && filters.every(filter => filter(device!)) ? device : null, error: null }),
    };
    return query;
  });
  rpc.mockResolvedValue({ data: true, error: null });
});

async function registration(): Promise<DeviceRegistration> {
  const challenge = await createDeviceChallenge({ registry, ownerId, appMetadata: metadata, deviceId, signingKey: serverKeys.privateKey, nowSeconds: now });
  expect(challenge).not.toBeNull();
  expect(verifyDeviceSignature(challenge!.payload, challenge!.signature, serverKeys.publicKey)).toBe(true);
  return { ...signedDeviceMessage(challenge!.payload, deviceKeys.privateKey), publicKey: devicePublicKey };
}

function leaseRequest(): LocalGrantRequest {
  const challenge = randomBytes(32).toString("base64url");
  return { deviceId, challenge, accountId: deviceId, productIds: [deviceId], deviceProof: signedDeviceMessage({
    v: 1 as const, purpose: "AI_LIVE_LEASE_REQUEST" as const, deviceId, challenge, issuedAt: now, expiresAt: now + 120, versions: LOCAL_LEASE_VERSIONS,
  }, deviceKeys.privateKey) };
}

describe("durable AI LIVE device registration boundary", () => {
  it("persists a fresh server nonce then verifies device proof and signs an owner-bound certificate", async () => {
    const proof = await registration();
    expect(inserts[0]).toMatchObject({ owner_id: ownerId, device_id: deviceId });
    const result = await registerLiveDevice({ registry, ownerId, appMetadata: metadata, proof, signingKey: serverKeys.privateKey, nowSeconds: now });
    expect(result?.device.authorized).toBe(true);
    expect(result?.certificate.payload).toMatchObject({ purpose: "AI_LIVE_DEVICE_CERTIFICATE", ownerId, deviceId, publicKeyFingerprint: fingerprint });
    expect(verifyDeviceSignature(result!.certificate.payload, result!.certificate.signature, serverKeys.publicKey)).toBe(true);
    expect(result!.certificate.payload).not.toHaveProperty("entitled");
    expect(rpc).toHaveBeenCalledWith("ai_live_register_device", expect.objectContaining({ p_owner_id: ownerId, p_device_limit: 1, p_key_fingerprint: fingerprint }));
  });

  it("refuses wrong user, invalid identity signature, expired challenge, or expired membership before persistence", async () => {
    const proof = await registration();
    const input = { registry, ownerId, appMetadata: metadata, proof, signingKey: serverKeys.privateKey, nowSeconds: now };
    expect(await registerLiveDevice({ ...input, ownerId: otherOwner })).toBeNull();
    expect(await registerLiveDevice({ ...input, proof: { ...proof, signature: "a".repeat(86) } })).toBeNull();
    expect(await registerLiveDevice({ ...input, nowSeconds: now + 120 })).toBeNull();
    expect(await registerLiveDevice({ ...input, appMetadata: { ai_live: { ...metadata.ai_live, expiresAt: new Date(now * 1000).toISOString() } } })).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not authorize when atomic registration denies replay, takeover, or device limit", async () => {
    const proof = await registration();
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await registerLiveDevice({ registry, ownerId, appMetadata: metadata, proof, signingKey: serverKeys.privateKey, nowSeconds: now })).toBeNull();
  });

  it("requires the persisted active public key and consumes a proof nonce once before a lease", async () => {
    const request = leaseRequest();
    const input = { registry, ownerId, request, nowSeconds: now, deviceLimit: 1 };
    expect(await authorizeDeviceLease(input)).toBe(true);
    expect(rpc).toHaveBeenCalledWith("ai_live_claim_device_lease", expect.objectContaining({ p_owner_id: ownerId, p_device_id: deviceId, p_device_limit: 1 }));
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await authorizeDeviceLease(input)).toBe(false);
    rpc.mockClear();
    device!.revoked_at = new Date(now * 1000).toISOString();
    expect(await authorizeDeviceLease(input)).toBe(false);
    device!.revoked_at = null; device!.owner_id = otherOwner;
    expect(await authorizeDeviceLease(input)).toBe(false);
    device!.owner_id = ownerId;
    const otherKeys = generateKeyPairSync("ed25519");
    input.request.deviceProof = signedDeviceMessage(input.request.deviceProof.payload, otherKeys.privateKey);
    expect(await authorizeDeviceLease(input)).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns a signed revoke receipt after scoped revoke, but does not grant membership", async () => {
    const result = await revokeLiveDevice({ registry, ownerId, deviceId, signingKey: serverKeys.privateKey, nowSeconds: now });
    expect(result?.receipt.payload).toMatchObject({ purpose: "AI_LIVE_DEVICE_REVOKED", ownerId, deviceId });
    expect(verifyDeviceSignature(result!.receipt.payload, result!.receipt.signature, serverKeys.publicKey)).toBe(true);
    expect(rpc).toHaveBeenCalledWith("ai_live_revoke_device", { p_owner_id: ownerId, p_device_id: deviceId });
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await revokeLiveDevice({ registry, ownerId: otherOwner, deviceId, signingKey: serverKeys.privateKey, nowSeconds: now })).toBeNull();
    expect(await liveDeviceStatus(registry, ownerId, deviceId, {}, now)).toEqual({ device: { authorized: true }, entitled: false });
  });

  it("rejects unsupported key types and exposes no database errors through service results", async () => {
    expect(parseDevicePublicKey("not a key")).toBeNull();
    const proof = await registration();
    rpc.mockResolvedValue({ data: null, error: { message: "secret database detail" } });
    await expect(registerLiveDevice({ registry, ownerId, appMetadata: metadata, proof, signingKey: serverKeys.privateKey, nowSeconds: now })).rejects.toThrow("device_registry_unavailable");
  });
});
