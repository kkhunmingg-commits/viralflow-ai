import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { canonicalSignedBytes } from "./local-license";
import { parseLivePublicKeyRing, readLiveSigningConfiguration, signLiveEnvelope, verifyLiveEnvelope } from "./server-config";

const old = generateKeyPairSync("ed25519");
const current = generateKeyPairSync("ed25519");
const privatePem = (keys: typeof old) => keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicPem = (keys: typeof old) => keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const rotated = {
  AI_LIVE_LEASE_SIGNING_PRIVATE_KEY: privatePem(current), AI_LIVE_SIGNING_KEY_ID: "live-current",
  AI_LIVE_SIGNING_PUBLIC_KEYS_JSON: JSON.stringify({ "live-current": publicPem(current), "live-previous": publicPem(old) }),
};

describe("AI LIVE server-only signing configuration", () => {
  it("requires valid Ed25519 private key and validates active identity against pinned ring", () => {
    expect(readLiveSigningConfiguration({})).toBeNull();
    expect(readLiveSigningConfiguration({ AI_LIVE_LEASE_SIGNING_PRIVATE_KEY: "invalid" })).toBeNull();
    expect(readLiveSigningConfiguration(rotated)?.keyId).toBe("live-current");
    expect(readLiveSigningConfiguration({ ...rotated, AI_LIVE_SIGNING_KEY_ID: "unknown" })).toBeNull();
    expect(readLiveSigningConfiguration({ ...rotated, AI_LIVE_LEASE_SIGNING_PRIVATE_KEY: privatePem(old) })).toBeNull();
    expect(readLiveSigningConfiguration({ ...rotated, AI_LIVE_SIGNING_PUBLIC_KEYS_JSON: "" })).toBeNull();
    expect(readLiveSigningConfiguration({ ...rotated, AI_LIVE_SIGNING_KEY_ID: "" })).toBeNull();
    expect(parseLivePublicKeyRing(JSON.stringify({ valid: privatePem(old) }))).toBeNull();
    expect(parseLivePublicKeyRing(JSON.stringify({ "bad/id": publicPem(old) }))).toBeNull();
    expect(parseLivePublicKeyRing(JSON.stringify({ one: publicPem(old), two: publicPem(old) }))).toBeNull();
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(readLiveSigningConfiguration({ AI_LIVE_LEASE_SIGNING_PRIVATE_KEY: privatePem(rsa) })).toBeNull();
  });

  it("authenticates key ID, permits explicit overlap, and rejects removed or changed IDs without fallback", () => {
    const config = readLiveSigningConfiguration(rotated)!;
    const currentEnvelope = signLiveEnvelope({ purpose: "rotation-test", value: 1 }, config);
    expect(currentEnvelope.keyId).toBe("live-current");
    expect(verifyLiveEnvelope(currentEnvelope, config)).toBe(true);
    const previous = { ...config, signingKey: old.privateKey, keyId: "live-previous" };
    const previousEnvelope = signLiveEnvelope({ purpose: "rotation-test", value: 1 }, previous);
    expect(verifyLiveEnvelope(previousEnvelope, config)).toBe(true);
    expect(verifyLiveEnvelope({ ...currentEnvelope, keyId: "live-previous" }, config)).toBe(false);
    expect(verifyLiveEnvelope({ ...currentEnvelope, keyId: "unknown" }, config)).toBe(false);
    expect(verifyLiveEnvelope(previousEnvelope, { publicKeys: { "live-current": current.publicKey } })).toBe(false);
    const stripped = { payload: currentEnvelope.payload, signature: currentEnvelope.signature };
    expect(verifyLiveEnvelope(stripped, { ...config, legacyPublicKey: current.publicKey })).toBe(false);
    expect(canonicalSignedBytes({ a: 1 }, "live-current").toString()).toBe('{"keyId":"live-current","payload":{"a":1}}');
  });

  it("supports legacy envelopes only through an explicitly trusted legacy key", () => {
    const legacy = readLiveSigningConfiguration({ AI_LIVE_LEASE_SIGNING_PRIVATE_KEY: privatePem(old) })!;
    const envelope = signLiveEnvelope({ purpose: "legacy-test" }, legacy);
    expect(envelope).not.toHaveProperty("keyId");
    expect(verifyLiveEnvelope(envelope, legacy)).toBe(true);
    expect(verifyLiveEnvelope(envelope, readLiveSigningConfiguration(rotated)!)).toBe(false);
    const overlapped = readLiveSigningConfiguration({ ...rotated, AI_LIVE_SIGNING_LEGACY_PUBLIC_KEY: publicPem(old) })!;
    expect(verifyLiveEnvelope(envelope, overlapped)).toBe(true);
    expect(readLiveSigningConfiguration({ ...rotated, AI_LIVE_SIGNING_LEGACY_PUBLIC_KEY: "invalid" })).toBeNull();
  });
});
