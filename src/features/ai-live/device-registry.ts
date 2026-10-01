import "server-only";
import { randomBytes, randomUUID, type KeyObject } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { LOCAL_LEASE_VERSIONS, readLocalEntitlement, type LocalGrantRequest } from "./local-license";
import {
  DEVICE_CERTIFICATE_SECONDS, DEVICE_CHALLENGE_SECONDS, deviceNonceHash, parseDevicePublicKey, signedDeviceMessage,
  validSignedWindow, verifyDeviceSignature, type DeviceChallengePayload, type DeviceRegistration,
} from "./device-identity";

export type DeviceRegistryClient = Pick<SupabaseClient, "from" | "rpc">;
const storedDeviceSchema = z.object({ device_id: z.uuid(), owner_id: z.uuid(), public_key: z.string(), key_fingerprint: z.string().regex(/^[a-f0-9]{64}$/), revoked_at: z.string().nullable() });

export async function createDeviceChallenge(input: { registry: DeviceRegistryClient; ownerId: string; appMetadata: unknown; deviceId: string; signingKey: KeyObject; nowSeconds?: number }) {
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const entitlement = readLocalEntitlement(input.appMetadata, now);
  if (!entitlement) return null;
  const payload: DeviceChallengePayload = { v: 1, purpose: "AI_LIVE_DEVICE_REGISTER", ownerId: input.ownerId, deviceId: input.deviceId,
    challengeId: randomUUID(), nonce: randomBytes(32).toString("base64url"), issuedAt: now,
    expiresAt: Math.min(now + DEVICE_CHALLENGE_SECONDS, Math.floor(Date.parse(entitlement.expiresAt) / 1000)), versions: LOCAL_LEASE_VERSIONS };
  const cleanup = await input.registry.from("ai_live_device_challenges").delete().eq("owner_id", input.ownerId)
    .lt("expires_at", new Date((now - 600) * 1000).toISOString());
  if (cleanup.error) throw new Error("device_registry_unavailable");
  const { error } = await input.registry.from("ai_live_device_challenges").insert({
    id: payload.challengeId, owner_id: payload.ownerId, device_id: payload.deviceId, nonce_hash: deviceNonceHash(payload.nonce),
    issued_at: new Date(payload.issuedAt * 1000).toISOString(), expires_at: new Date(payload.expiresAt * 1000).toISOString(),
  });
  if (error) throw new Error("device_registry_unavailable");
  return signedDeviceMessage(payload, input.signingKey);
}

export async function registerLiveDevice(input: { registry: DeviceRegistryClient; ownerId: string; appMetadata: unknown; proof: DeviceRegistration; signingKey: KeyObject; nowSeconds?: number }) {
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const entitlement = readLocalEntitlement(input.appMetadata, now);
  const payload = input.proof.payload;
  const publicKey = parseDevicePublicKey(input.proof.publicKey);
  if (!entitlement || !publicKey || payload.ownerId !== input.ownerId
    || !validSignedWindow(payload.issuedAt, payload.expiresAt, now, DEVICE_CHALLENGE_SECONDS)
    || !verifyDeviceSignature(payload, input.proof.signature, publicKey.key)) return null;
  // The nonce row was written after server membership checks. No client owner or limit is trusted.
  const { data, error } = await input.registry.rpc("ai_live_register_device", {
    p_owner_id: input.ownerId, p_device_id: payload.deviceId, p_challenge_id: payload.challengeId,
    p_nonce_hash: deviceNonceHash(payload.nonce), p_public_key: publicKey.pem, p_key_fingerprint: publicKey.fingerprint,
    p_device_limit: entitlement.deviceLimit, p_entitlement_expires_at: entitlement.expiresAt,
  });
  if (error) throw new Error("device_registry_unavailable");
  if (data !== true) return null;
  const certificate = signedDeviceMessage({ v: 1, purpose: "AI_LIVE_DEVICE_CERTIFICATE", ownerId: input.ownerId, deviceId: payload.deviceId,
    publicKeyFingerprint: publicKey.fingerprint, issuedAt: now, expiresAt: now + DEVICE_CERTIFICATE_SECONDS, versions: LOCAL_LEASE_VERSIONS }, input.signingKey);
  return { certificate, device: { authorized: true } };
}

export async function authorizeDeviceLease(input: { registry: DeviceRegistryClient; ownerId: string; request: LocalGrantRequest; nowSeconds: number; deviceLimit: number }) {
  const { data, error } = await input.registry.from("ai_live_devices").select("device_id,owner_id,public_key,key_fingerprint,revoked_at")
    .eq("owner_id", input.ownerId).eq("device_id", input.request.deviceId).is("revoked_at", null).maybeSingle();
  if (error) throw new Error("device_registry_unavailable");
  const stored = storedDeviceSchema.safeParse(data);
  const proof = input.request.deviceProof;
  if (!stored.success || stored.data.owner_id !== input.ownerId || stored.data.device_id !== input.request.deviceId || stored.data.revoked_at !== null
    || proof.payload.deviceId !== input.request.deviceId || proof.payload.challenge !== input.request.challenge
    || !validSignedWindow(proof.payload.issuedAt, proof.payload.expiresAt, input.nowSeconds, DEVICE_CHALLENGE_SECONDS)) return false;
  const publicKey = parseDevicePublicKey(stored.data.public_key);
  if (!publicKey || publicKey.fingerprint !== stored.data.key_fingerprint || !verifyDeviceSignature(proof.payload, proof.signature, publicKey.key)) return false;
  const result = await input.registry.rpc("ai_live_claim_device_lease", { p_owner_id: input.ownerId, p_device_id: input.request.deviceId,
    p_nonce_hash: deviceNonceHash(proof.payload.challenge), p_expires_at: new Date(proof.payload.expiresAt * 1000).toISOString(), p_device_limit: input.deviceLimit });
  if (result.error) throw new Error("device_registry_unavailable");
  return result.data === true;
}

export async function revokeLiveDevice(input: { registry: DeviceRegistryClient; ownerId: string; deviceId: string; signingKey: KeyObject; nowSeconds?: number }) {
  const result = await input.registry.rpc("ai_live_revoke_device", { p_owner_id: input.ownerId, p_device_id: input.deviceId });
  if (result.error) throw new Error("device_registry_unavailable");
  if (result.data !== true) return null;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  return { receipt: signedDeviceMessage({ v: 1, purpose: "AI_LIVE_DEVICE_REVOKED", ownerId: input.ownerId, deviceId: input.deviceId,
    issuedAt: now, expiresAt: now + DEVICE_CHALLENGE_SECONDS }, input.signingKey) };
}

export async function listLiveDevices(registry: DeviceRegistryClient, ownerId: string) {
  const { data, error } = await registry.from("ai_live_devices").select("device_id,created_at,last_seen_at,revoked_at")
    .eq("owner_id", ownerId).order("created_at", { ascending: false }).limit(1000);
  if (error) throw new Error("device_registry_unavailable");
  return (data ?? []).map((row) => ({ deviceId: row.device_id, authorized: row.revoked_at === null, registeredAt: row.created_at, lastSeenAt: row.last_seen_at }));
}

export async function liveDeviceStatus(registry: DeviceRegistryClient, ownerId: string, deviceId: string, appMetadata: unknown, now = Math.floor(Date.now() / 1000)) {
  const { data, error } = await registry.from("ai_live_devices").select("device_id,revoked_at")
    .eq("owner_id", ownerId).eq("device_id", deviceId).maybeSingle();
  if (error) throw new Error("device_registry_unavailable");
  return { device: { authorized: data?.device_id === deviceId && data.revoked_at === null }, entitled: readLocalEntitlement(appMetadata, now) !== null };
}
