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
export { versionsSchema as localVersionsSchema };

export const localGrantRequestSchema = z.strictObject({
  deviceId: z.uuid(),
  challenge: z.base64url().length(43),
  accountId: z.uuid(),
  productIds: z.array(z.uuid()).min(1).max(10),
  versions: versionsSchema.optional(),
  deviceProof: z.strictObject({
    payload: z.strictObject({
      v: z.literal(1), purpose: z.literal("AI_LIVE_LEASE_REQUEST"), deviceId: z.uuid(),
      challenge: z.base64url().length(43), issuedAt: z.number().int(), expiresAt: z.number().int(), versions: versionsSchema,
    }),
    signature: z.base64url().length(86),
  }),
}).refine((value) => new Set(value.productIds).size === value.productIds.length, {
  path: ["productIds"],
});

export type LocalGrantRequest = z.infer<typeof localGrantRequestSchema>;

// Membership is trusted Auth app_metadata; device authorization lives in the registry.
const entitlementSchema = z.object({
  enabled: z.literal(true),
  status: z.enum(["active", "inactive", "revoked"]).optional(),
  revokedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  expiresAt: z.iso.datetime({ offset: true }),
  deviceLimit: z.number().int().positive().max(1000),
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

export function readLocalEntitlement(appMetadata: unknown, nowSeconds: number): LocalLicenseEntitlement | null {
  const metadata = z.object({ ai_live: entitlementSchema }).safeParse(appMetadata);
  if (!metadata.success) return null;
  const entitlement = metadata.data.ai_live;
  if ((entitlement.status !== undefined && entitlement.status !== "active") || entitlement.revokedAt) return null;
  const entitlementExpiry = Math.floor(Date.parse(entitlement.expiresAt) / 1000);
  if (!Number.isSafeInteger(entitlementExpiry) || entitlementExpiry <= nowSeconds) return null;
  return entitlement;
}

export function allowedLeaseExpiry(appMetadata: unknown, nowSeconds: number): number | null {
  const entitlement = readLocalEntitlement(appMetadata, nowSeconds);
  if (!entitlement) return null;
  return Math.min(nowSeconds + LOCAL_LEASE_SECONDS, Math.floor(Date.parse(entitlement.expiresAt) / 1000));
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

export const liveSigningKeyIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
export function canonicalSignedBytes(payload: unknown, keyId?: string): Buffer {
  if (keyId !== undefined && !liveSigningKeyIdSchema.safeParse(keyId).success) throw new Error("live_signing_key_id_invalid");
  return canonicalLeaseBytes(keyId === undefined ? payload : { keyId, payload });
}

export function signLocalLease(payload: LocalLeasePayload, key: KeyObject, keyId?: string) {
  if (key.asymmetricKeyType !== "ed25519") throw new Error("local_lease_signing_key_invalid");
  if (!leasePayloadSchema.safeParse(payload).success) throw new Error("local_lease_payload_invalid");
  return { payload, signature: sign(null, canonicalSignedBytes(payload, keyId), key).toString("base64url"), ...(keyId === undefined ? {} : { keyId }) };
}

export function verifyLocalLease(payload: LocalLeasePayload, signature: string, publicKey: KeyObject, nowSeconds: number, keyId?: string) {
  if (publicKey.asymmetricKeyType !== "ed25519" || !leasePayloadSchema.safeParse(payload).success) return false;
  if (!Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt)
    || payload.issuedAt > nowSeconds || payload.expiresAt <= nowSeconds
    || payload.expiresAt - payload.issuedAt > LOCAL_LEASE_SECONDS) return false;
  if (!/^[A-Za-z0-9_-]{86}$/.test(signature)) return false;
  try {
    return verify(null, canonicalSignedBytes(payload, keyId), publicKey, Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}
