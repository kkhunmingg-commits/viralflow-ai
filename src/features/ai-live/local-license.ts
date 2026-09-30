import "server-only";
import { createPrivateKey, sign, verify, type KeyObject } from "node:crypto";
import { z } from "zod";
import { LIVE_COMPONENT_VERSIONS } from "./local-contract";

export const LOCAL_LEASE_VERSIONS = LIVE_COMPONENT_VERSIONS;

export const LOCAL_LEASE_SECONDS = 120;

const versionsSchema = z.strictObject({
  web: z.literal(LOCAL_LEASE_VERSIONS.web),
  agent: z.literal(LOCAL_LEASE_VERSIONS.agent),
  worker: z.literal(LOCAL_LEASE_VERSIONS.worker),
  model: z.literal(LOCAL_LEASE_VERSIONS.model),
});

export const localGrantRequestSchema = z.strictObject({
  deviceId: z.uuid(),
  challenge: z.base64url().length(43),
  accountId: z.uuid(),
  productIds: z.array(z.uuid()).min(1).max(10),
  versions: versionsSchema.optional(),
}).refine((value) => new Set(value.productIds).size === value.productIds.length, {
  path: ["productIds"],
});

export type LocalGrantRequest = z.infer<typeof localGrantRequestSchema>;

// This is an interface for trusted server provisioning, not a browser registration API.
// Missing metadata or an unregistered device always denies a grant.
const entitlementSchema = z.strictObject({
  enabled: z.literal(true),
  expiresAt: z.iso.datetime({ offset: true }),
  deviceLimit: z.number().int().positive(),
  registeredDeviceIds: z.array(z.uuid()).max(1000),
});

export type LocalLicenseEntitlement = z.infer<typeof entitlementSchema>;

export interface LocalLeasePayload {
  v: 1;
  ownerId: string;
  deviceId: string;
  challenge: string;
  accountId: string;
  productIds: string[];
  grantId: string;
  issuedAt: number;
  expiresAt: number;
  entitled: true;
  versions: typeof LOCAL_LEASE_VERSIONS;
}

const leasePayloadSchema = z.strictObject({
  v: z.literal(1),
  ownerId: z.uuid(),
  deviceId: z.uuid(),
  challenge: z.base64url().length(43),
  accountId: z.uuid(),
  productIds: z.array(z.uuid()).min(1).max(10),
  grantId: z.uuid(),
  issuedAt: z.number().int(),
  expiresAt: z.number().int(),
  entitled: z.literal(true),
  versions: versionsSchema,
}).refine((value) => new Set(value.productIds).size === value.productIds.length);

export function allowedLeaseExpiry(appMetadata: unknown, deviceId: string, nowSeconds: number): number | null {
  const metadata = z.object({ ai_live: entitlementSchema }).safeParse(appMetadata);
  if (!metadata.success) return null;
  const entitlement = metadata.data.ai_live;
  const registered = entitlement.registeredDeviceIds;
  if (registered.length > entitlement.deviceLimit || new Set(registered).size !== registered.length || !registered.includes(deviceId)) {
    return null;
  }
  const entitlementExpiry = Math.floor(Date.parse(entitlement.expiresAt) / 1000);
  if (!Number.isSafeInteger(entitlementExpiry) || entitlementExpiry <= nowSeconds) return null;
  return Math.min(nowSeconds + LOCAL_LEASE_SECONDS, entitlementExpiry);
}

// Cross-language contract: recursively sort object keys, then compact JSON and UTF-8.
// Python: json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
export function canonicalLeaseBytes(value: unknown): Buffer {
  function sorted(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(sorted);
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, item]) => [key, sorted(item)]));
    }
    return input;
  }
  return Buffer.from(JSON.stringify(sorted(value)), "utf8");
}

export function parseLocalLeaseSigningKey(pem: string | undefined): KeyObject | null {
  if (!pem) return null;
  try {
    const key = createPrivateKey(pem);
    return key.asymmetricKeyType === "ed25519" ? key : null;
  } catch {
    return null;
  }
}

export function signLocalLease(payload: LocalLeasePayload, key: KeyObject) {
  if (key.asymmetricKeyType !== "ed25519") throw new Error("local_lease_signing_key_invalid");
  if (!leasePayloadSchema.safeParse(payload).success) throw new Error("local_lease_payload_invalid");
  return { payload, signature: sign(null, canonicalLeaseBytes(payload), key).toString("base64url") };
}

export function verifyLocalLease(payload: LocalLeasePayload, signature: string, publicKey: KeyObject, nowSeconds: number) {
  if (publicKey.asymmetricKeyType !== "ed25519" || !leasePayloadSchema.safeParse(payload).success) return false;
  if (!Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt)
    || payload.issuedAt > nowSeconds || payload.expiresAt <= nowSeconds
    || payload.expiresAt - payload.issuedAt > LOCAL_LEASE_SECONDS) return false;
  if (!/^[A-Za-z0-9_-]{86}$/.test(signature)) return false;
  try {
    return verify(null, canonicalLeaseBytes(payload), publicKey, Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}
