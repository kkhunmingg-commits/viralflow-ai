import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ConfiguredLiveUpdateDistribution, createLiveUpdateManifest, LIVE_UPDATE_MANIFEST_SECONDS,
  readLiveUpdateRelease } from "./update-distribution";
import { readLiveSigningConfiguration, verifyLiveEnvelope } from "./server-config";
import { LIVE_COMPONENT_VERSIONS } from "./local-contract";

const keys = generateKeyPairSync("ed25519");
const versions = { web: LIVE_COMPONENT_VERSIONS.web, agent: LIVE_COMPONENT_VERSIONS.agent, worker: LIVE_COMPONENT_VERSIONS.worker };
const release = { versions, minimumVersions: versions, mandatory: false,
  rollbackVersion: null, package: { sha256: "a".repeat(64), sizeBytes: 1000 } };
function environment(config: unknown = release, origin = "https://downloads.viralflow.example") {
  return { AI_LIVE_UPDATE_ORIGIN: origin, AI_LIVE_UPDATE_RELEASE_JSON: JSON.stringify(config) };
}
function signer() {
  const configuration = readLiveSigningConfiguration({
    AI_LIVE_LEASE_SIGNING_PRIVATE_KEY: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    AI_LIVE_SIGNING_KEY_ID: "release-2026", AI_LIVE_SIGNING_PUBLIC_KEYS_JSON: JSON.stringify({
      "release-2026": keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    }),
  });
  if (!configuration) throw new Error("fixture signer unavailable");
  return configuration;
}
afterEach(() => vi.unstubAllEnvs());

describe("AI LIVE authenticated release distribution", () => {
  it("derives an immutable fixed-origin package URL from validated release data and signs keyId", () => {
    const configured = readLiveUpdateRelease(environment());
    expect(configured).not.toBeNull();
    const configuration = signer();
    const manifest = createLiveUpdateManifest(new ConfiguredLiveUpdateDistribution(configured!), configuration, 1000);
    expect(manifest).toMatchObject({ keyId: "release-2026", payload: { v: 2, issuedAt: 1000,
      expiresAt: 1000 + LIVE_UPDATE_MANIFEST_SECONDS, minimumVersions: release.minimumVersions,
      mandatory: false, rollbackVersion: null, package: { url: `https://downloads.viralflow.example/viralflow/ai-live/releases/${versions.agent}/package.zip` } } });
    expect(verifyLiveEnvelope(manifest, configuration)).toBe(true);
    expect(verifyLiveEnvelope({ ...manifest, keyId: "another-key" }, configuration)).toBe(false);
    expect(verifyLiveEnvelope({ ...manifest, payload: { ...manifest.payload, mandatory: true } }, configuration)).toBe(false);
    expect(JSON.stringify(manifest)).not.toContain("PRIVATE KEY");
    expect(Object.keys(manifest).sort()).toEqual(["keyId", "payload", "signature"]);
  });

  it("rejects missing and malformed configuration instead of fabricating a release or fetching storage", () => {
    expect(readLiveUpdateRelease({})).toBeNull();
    expect(readLiveUpdateRelease({ ...environment(), AI_LIVE_UPDATE_RELEASE_JSON: "invalid JSON" })).toBeNull();
    for (const invalid of ["http://downloads.example.com", "https://localhost", "https://127.0.0.1", "https://[::1]",
      "https://secret@downloads.example.com", "https://downloads.example.com:8443", "https://downloads.example.com/other",
      "https://downloads.example.com/?token=secret", "https://downloads.example.com/#fragment", "https://internal.local"]) {
      expect(readLiveUpdateRelease(environment(release, invalid))).toBeNull();
    }
  });

  it("validates size, hashes, minimum versions, explicit rollback and rejects browser-provided paths", () => {
    const invalid = [
      { ...release, package: { ...release.package, sizeBytes: 0 } },
      { ...release, package: { ...release.package, sizeBytes: 256 * 1024 * 1024 + 1 } },
      { ...release, package: { ...release.package, sha256: "invalid" } },
      { ...release, minimumVersions: { ...release.minimumVersions, agent: "999.0.0" } },
      { ...release, versions: { ...release.versions, worker: "0.1.0" } },
      { ...release, rollbackVersion: versions.agent },
      { ...release, versions: { ...release.versions, agent: "../escape" } },
      { ...release, package: { ...release.package, url: "https://arbitrary.example/package.zip" } },
      { ...release, secret: "must never reach manifest" },
    ];
    for (const metadata of invalid) expect(readLiveUpdateRelease(environment(metadata))).toBeNull();
    expect(readLiveUpdateRelease(environment({ ...release, rollbackVersion: "0.1.0" }))).not.toBeNull();
  });

  it("requires the modern signing configuration for update delivery and rejects invalid clock", () => {
    const configured = readLiveUpdateRelease(environment())!;
    const distribution = new ConfiguredLiveUpdateDistribution(configured);
    expect(() => distribution.manifest(Number.NaN)).toThrow();
    expect(() => distribution.manifest(-1)).toThrow();
    expect(() => createLiveUpdateManifest(distribution, { ...signer(), keyId: undefined }, 1000)).toThrow();
  });

  it("validates the provider constructor and prevents post-validation alias changes from modifying signed metadata", () => {
    const configured = readLiveUpdateRelease(environment())!;
    expect(() => new ConfiguredLiveUpdateDistribution({ ...configured, origin: "https://127.0.0.1" })).toThrow();
    expect(() => new ConfiguredLiveUpdateDistribution({ ...configured, release: { ...configured.release,
      package: { ...configured.release.package, sha256: "not-valid" } } })).toThrow();
    const provider = new ConfiguredLiveUpdateDistribution(configured);
    configured.origin = "https://arbitrary.example";
    configured.release.versions.agent = "999.0.0";
    configured.release.package.sha256 = "b".repeat(64);
    const manifest = createLiveUpdateManifest(provider, signer(), 1000);
    expect(manifest.payload.package.url).toBe(`https://downloads.viralflow.example/viralflow/ai-live/releases/${versions.agent}/package.zip`);
    expect(manifest.payload.package.sha256).toBe("a".repeat(64));
    manifest.payload.package.sha256 = "c".repeat(64);
    expect(provider.manifest(1001).package.sha256).toBe("a".repeat(64));
  });
});
