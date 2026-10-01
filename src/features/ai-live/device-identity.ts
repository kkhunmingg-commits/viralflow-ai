import "server-only";
import { createHash, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { z } from "zod";
import { canonicalSignedBytes, localVersionsSchema } from "./local-license";

export const DEVICE_CHALLENGE_SECONDS = 120;
export const DEVICE_CERTIFICATE_SECONDS = 86400;

export const deviceChallengeRequestSchema = z.strictObject({ deviceId: z.uuid(), versions: localVersionsSchema });
export const deviceChallengePayloadSchema = z.strictObject({
  v: z.literal(1), purpose: z.literal("AI_LIVE_DEVICE_REGISTER"), ownerId: z.uuid(), deviceId: z.uuid(),
  challengeId: z.uuid(), nonce: z.base64url().length(43), issuedAt: z.number().int(), expiresAt: z.number().int(),
  versions: localVersionsSchema,
});
export const deviceRegistrationSchema = z.strictObject({
  payload: deviceChallengePayloadSchema, publicKey: z.string().min(80).max(256), signature: z.base64url().length(86),
});
export type DeviceRegistration = z.infer<typeof deviceRegistrationSchema>;
export type DeviceChallengePayload = z.infer<typeof deviceChallengePayloadSchema>;

export function validSignedWindow(issuedAt: number, expiresAt: number, now: number, ttl: number) {
  return issuedAt <= now && issuedAt >= now - ttl && expiresAt > now && expiresAt > issuedAt && expiresAt - issuedAt <= ttl;
}

export function parseDevicePublicKey(pem: string): { key: KeyObject; pem: string; fingerprint: string } | null {
  try {
    if (!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/.test(pem)) return null;
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== "ed25519") return null;
    const der = key.export({ type: "spki", format: "der" });
    return { key, pem: key.export({ type: "spki", format: "pem" }).toString(), fingerprint: createHash("sha256").update(der).digest("hex") };
  } catch { return null; }
}

export function signedDeviceMessage<T extends Record<string, unknown>>(payload: T, key: KeyObject, keyId?: string) {
  if (key.asymmetricKeyType !== "ed25519") throw new Error("invalid_device_signer");
  return { payload, signature: sign(null, canonicalSignedBytes(payload, keyId), key).toString("base64url"), ...(keyId === undefined ? {} : { keyId }) };
}

export function verifyDeviceSignature(payload: unknown, signature: string, key: KeyObject, keyId?: string) {
  if (key.asymmetricKeyType !== "ed25519" || !/^[A-Za-z0-9_-]{86}$/.test(signature)) return false;
  try { return verify(null, canonicalSignedBytes(payload, keyId), key, Buffer.from(signature, "base64url")); } catch { return false; }
}

export function deviceNonceHash(nonce: string) { return createHash("sha256").update(nonce).digest("hex"); }
