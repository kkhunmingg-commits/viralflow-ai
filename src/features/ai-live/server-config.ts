import "server-only";
import { createPublicKey, sign, timingSafeEqual, verify, type KeyObject } from "node:crypto";
import { z } from "zod";
import { canonicalSignedBytes, liveSigningKeyIdSchema, parseLocalLeaseSigningKey } from "./local-license";
import { parseDevicePublicKey } from "./device-identity";

// This feature schema is evaluated only on AI LIVE requests. Invalid or missing
// feature configuration fails closed without printing values or affecting AUTO.
export const liveSigningEnvironmentSchema = z.object({
  AI_LIVE_LEASE_SIGNING_PRIVATE_KEY: z.string().min(1).max(4096),
  AI_LIVE_SIGNING_KEY_ID: liveSigningKeyIdSchema.optional(),
  AI_LIVE_SIGNING_PUBLIC_KEYS_JSON: z.string().min(2).max(16384).optional(),
  AI_LIVE_SIGNING_LEGACY_PUBLIC_KEY: z.string().min(80).max(256).optional(),
});

export interface LiveSigningConfiguration {
  signingKey: KeyObject;
  keyId?: string;
  publicKeys: Readonly<Record<string, KeyObject>>;
  legacyPublicKey?: KeyObject;
}

function equalPublicKeys(a: KeyObject, b: KeyObject): boolean {
  const one = a.export({ type: "spki", format: "der" });
  const two = b.export({ type: "spki", format: "der" });
  return one.length === two.length && timingSafeEqual(one, two);
}

export function parseLivePublicKeyRing(json: string): Readonly<Record<string, KeyObject>> | null {
  try {
    const raw: unknown = JSON.parse(json);
    const parsed = z.record(liveSigningKeyIdSchema, z.string().min(80).max(256)).safeParse(raw);
    if (!parsed.success || Object.keys(parsed.data).length < 1 || Object.keys(parsed.data).length > 8) return null;
    const keys: Record<string, KeyObject> = Object.create(null) as Record<string, KeyObject>;
    const fingerprints = new Set<string>();
    for (const [keyId, pem] of Object.entries(parsed.data)) {
      const key = parseDevicePublicKey(pem);
      if (!key || fingerprints.has(key.fingerprint)) return null;
      fingerprints.add(key.fingerprint); keys[keyId] = key.key;
    }
    return Object.freeze(keys);
  } catch { return null; }
}

export function readLiveSigningConfiguration(environment: Readonly<Record<string, string | undefined>> = process.env): LiveSigningConfiguration | null {
  // Blank optional settings in .env.example mean not configured, not a secret.
  const schema = liveSigningEnvironmentSchema.safeParse({
    AI_LIVE_LEASE_SIGNING_PRIVATE_KEY: environment.AI_LIVE_LEASE_SIGNING_PRIVATE_KEY,
    AI_LIVE_SIGNING_KEY_ID: environment.AI_LIVE_SIGNING_KEY_ID || undefined,
    AI_LIVE_SIGNING_PUBLIC_KEYS_JSON: environment.AI_LIVE_SIGNING_PUBLIC_KEYS_JSON || undefined,
    AI_LIVE_SIGNING_LEGACY_PUBLIC_KEY: environment.AI_LIVE_SIGNING_LEGACY_PUBLIC_KEY || undefined,
  });
  if (!schema.success) return null;
  const config = schema.data;
  const signingKey = parseLocalLeaseSigningKey(config.AI_LIVE_LEASE_SIGNING_PRIVATE_KEY);
  if (!signingKey) return null;
  const derivedPublicKey = createPublicKey(signingKey);
  const legacy = config.AI_LIVE_SIGNING_LEGACY_PUBLIC_KEY ? parseDevicePublicKey(config.AI_LIVE_SIGNING_LEGACY_PUBLIC_KEY)?.key : undefined;
  if (config.AI_LIVE_SIGNING_LEGACY_PUBLIC_KEY && !legacy) return null;
  if (config.AI_LIVE_SIGNING_KEY_ID === undefined && config.AI_LIVE_SIGNING_PUBLIC_KEYS_JSON === undefined) {
    if (legacy && !equalPublicKeys(derivedPublicKey, legacy)) return null;
    return { signingKey, publicKeys: Object.freeze({}), legacyPublicKey: legacy ?? derivedPublicKey };
  }
  if (!config.AI_LIVE_SIGNING_KEY_ID || !config.AI_LIVE_SIGNING_PUBLIC_KEYS_JSON) return null;
  const publicKeys = parseLivePublicKeyRing(config.AI_LIVE_SIGNING_PUBLIC_KEYS_JSON);
  const activeKey = publicKeys?.[config.AI_LIVE_SIGNING_KEY_ID];
  if (!publicKeys || !activeKey || !equalPublicKeys(derivedPublicKey, activeKey)) return null;
  return { signingKey, keyId: config.AI_LIVE_SIGNING_KEY_ID, publicKeys, ...(legacy ? { legacyPublicKey: legacy } : {}) };
}

export function signLiveEnvelope<T extends object>(payload: T, config: LiveSigningConfiguration) {
  if (config.signingKey.asymmetricKeyType !== "ed25519") throw new Error("live_signing_key_invalid");
  return { payload, signature: sign(null, canonicalSignedBytes(payload, config.keyId), config.signingKey).toString("base64url"),
    ...(config.keyId === undefined ? {} : { keyId: config.keyId }) };
}

export function verifyLiveEnvelope(signed: unknown, config: Pick<LiveSigningConfiguration, "publicKeys" | "legacyPublicKey">): boolean {
  if (!signed || typeof signed !== "object" || Array.isArray(signed)) return false;
  const envelope = signed as Record<string, unknown>;
  const keys = Object.keys(envelope).sort().join(",");
  if (keys !== "payload,signature" && keys !== "keyId,payload,signature") return false;
  if (!envelope.payload || typeof envelope.payload !== "object" || Array.isArray(envelope.payload)
    || typeof envelope.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature)) return false;
  const keyId = envelope.keyId;
  if (keyId !== undefined && !liveSigningKeyIdSchema.safeParse(keyId).success) return false;
  const key = keyId === undefined ? config.legacyPublicKey : config.publicKeys[keyId as string];
  if (!key || key.asymmetricKeyType !== "ed25519") return false;
  try { return verify(null, canonicalSignedBytes(envelope.payload, keyId as string | undefined), key, Buffer.from(envelope.signature, "base64url")); } catch { return false; }
}
