import { generateKeyPairSync, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  LOCAL_LEASE_SECONDS,
  LOCAL_LEASE_VERSIONS,
  allowedLeaseExpiry,
  canonicalLeaseBytes,
  localGrantRequestSchema,
  parseLocalLeaseSigningKey,
  signLocalLease,
  verifyLocalLease,
  readLocalEntitlement,
  type LocalLeasePayload,
} from "./local-license";

const ownerId = "e26ed687-b36b-44d9-a8df-38e9545d760c";
const deviceId = "4b531890-5020-4273-b6fb-2cf6e3cb5f7a";
const accountId = "4d334044-44d6-427b-a44b-872243d58b93";
const productId = "9820f32b-5ff6-4fdc-a5b3-d4b223471b1e";
const now = 1_780_000_000;

function metadata(overrides: Record<string, unknown> = {}) {
  return { ai_live: {
    enabled: true,
    expiresAt: new Date((now + 600) * 1000).toISOString(),
    deviceLimit: 1,
    registeredDeviceIds: [deviceId],
    ...overrides,
  } };
}

describe("local AI LIVE lease", () => {
  it("requires fresh server entitlement; legacy metadata cannot authorize devices", () => {
    expect(allowedLeaseExpiry(metadata(), now)).toBe(now + LOCAL_LEASE_SECONDS);
    expect(allowedLeaseExpiry(metadata({ expiresAt: new Date((now + 20) * 1000).toISOString() }), now)).toBe(now + 20);
    expect(allowedLeaseExpiry({}, now)).toBeNull();
    expect(allowedLeaseExpiry(metadata({ enabled: false }), now)).toBeNull();
    expect(allowedLeaseExpiry(metadata({ expiresAt: new Date(now * 1000).toISOString() }), now)).toBeNull();
    expect(readLocalEntitlement(metadata(), now)).not.toHaveProperty("registeredDeviceIds");
    expect(allowedLeaseExpiry(metadata({ deviceLimit: 0 }), now)).toBeNull();
  });

  it("requires a fresh local challenge and bounded unique selection", () => {
    const challenge = randomBytes(32).toString("base64url");
    const request = { deviceId, challenge, accountId, productIds: [productId], deviceProof: { payload: {
      v: 1, purpose: "AI_LIVE_LEASE_REQUEST", deviceId, challenge, issuedAt: now, expiresAt: now + 120, versions: LOCAL_LEASE_VERSIONS,
    }, signature: "a".repeat(86) } };
    expect(localGrantRequestSchema.safeParse(request).success).toBe(true);
    expect(localGrantRequestSchema.safeParse({ ...request, challenge: "short" }).success).toBe(false);
    expect(localGrantRequestSchema.safeParse({ ...request, productIds: [productId, productId] }).success).toBe(false);
    expect(localGrantRequestSchema.safeParse({ ...request, ownerId }).success).toBe(false);
    expect(localGrantRequestSchema.safeParse({ ...request, versions: { ...LOCAL_LEASE_VERSIONS, agent: "old" } }).success).toBe(false);
  });

  it("signs exact sorted compact UTF-8 bytes with Ed25519 and rejects tampering or expiry", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(parseLocalLeaseSigningKey(pem)?.asymmetricKeyType).toBe("ed25519");
    expect(parseLocalLeaseSigningKey("invalid")).toBeNull();
    const payload: LocalLeasePayload = {
      v: 1, ownerId, deviceId, challenge: randomBytes(32).toString("base64url"), accountId,
      productIds: [productId], grantId: "7774a04a-683c-4c85-9c6c-16457d63a369",
      issuedAt: now, expiresAt: now + 120, entitled: true, versions: LOCAL_LEASE_VERSIONS,
    };
    const bytes = canonicalLeaseBytes(payload).toString("utf8");
    expect(bytes).toMatch(/^\{"accountId":/);
    expect(bytes).toContain(canonicalLeaseBytes(LOCAL_LEASE_VERSIONS).toString("utf8"));
    expect(bytes).not.toContain(": ");
    const lease = signLocalLease(payload, privateKey);
    expect(verifyLocalLease(lease.payload, lease.signature, publicKey, now + 1)).toBe(true);
    expect(verifyLocalLease({ ...payload, ownerId: deviceId }, lease.signature, publicKey, now + 1)).toBe(false);
    expect(verifyLocalLease(payload, lease.signature, publicKey, now + 120)).toBe(false);
  });
});
