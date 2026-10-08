/** Isolated pipe regression fixture. Ephemeral private signers never leave this process. */
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalPolicyJson, signPolicyPack } from "../../../src/features/compliance-brain/policy-pack";
import { createPolicyTestPayload } from "../../../src/features/compliance-brain/policy-test-fixtures";
import { FilePolicyRegistryStore } from "../../../src/features/compliance-brain/policy-file-store";
import { policyScopeKey } from "../../../src/features/compliance-brain/policy-registry";

async function main() {
const root = resolve(process.argv[2]), components = join(root, "components"), app = join(root, "app");
await mkdir(join(components, "runtime"), { recursive: true });
await mkdir(join(components, "worker"), { recursive: true });
await copyFile(process.execPath, join(components, "runtime/node.exe"));
await copyFile(resolve(".ai-live-dev/compliance/compliance-local-bridge.cjs"), join(components, "worker/compliance-local-bridge.cjs"));
const policyKeys = generateKeyPairSync("ed25519"), contextKeys = generateKeyPairSync("ed25519");
const now = new Date(), payload = createPolicyTestPayload();
payload.issuedAt = now.toISOString(); payload.sources.forEach(source => { source.retrievedAt = now.toISOString(); });
const signedPack = signPolicyPack(payload, "pipe.fixture.policy", policyKeys.privateKey, { now });
await new FilePolicyRegistryStore(join(app, "compliance-policy")).writeLastKnownGood(policyScopeKey(payload), signedPack);
const trust = { format: "viralflow-compliance-trust-v1",
  contextPublicKeys: { "pipe.fixture.context": contextKeys.publicKey.export({ type: "spki", format: "pem" }).toString() },
  policyPublicKeys: { "pipe.fixture.policy": policyKeys.publicKey.export({ type: "spki", format: "pem" }).toString() } };
await writeFile(join(components, "worker/compliance-trust.json"), JSON.stringify(trust));
const ownerId = randomUUID(), accountId = randomUUID(), deviceId = randomUUID(), productId = randomUUID(), claimId = randomUUID(), evidenceId = randomUUID();
const approved = "ขวดมีขนาด 30 มิลลิลิตร", spokenApproved = "ขวดมีขนาด สามสิบ มิลลิลิตร";
const context = { v: 1, purpose: "AI_LIVE_PRODUCT_CONTEXT", ownerId, accountId, deviceId,
  productIds: [productId], issuedAt: Math.floor(now.getTime() / 1000), expiresAt: Math.floor(now.getTime() / 1000) + 120,
  versions: { worker: "fixture" }, products: [{ productId, name: "Pipe test bottle", version: "fixture-v1", facts: { price: 1 },
    compliance: { platform: "TIKTOK_SHOP", country: "TH", region: "TH", category: "SKINCARE",
      claims: [{ id: claimId, ownerId, productId, text: approved, type: "FEATURE", source: "Synthetic test label",
        evidenceRefs: [evidenceId], jurisdiction: "TH", expiresAt: null, verified: true, allowedChannels: ["LIVE"], conditions: [],
        aliases: [spokenApproved] }],
      evidence: [{ id: evidenceId, ownerId, productId, kind: "PRODUCT_LABEL", source: "https://shop.example/label",
        sourceHash: "a".repeat(64), jurisdiction: "TH", verified: true, expiresAt: null }] } }] };
const signedContext = { keyId: "pipe.fixture.context", payload: context,
  signature: sign(null, Buffer.from(canonicalPolicyJson({ keyId: "pipe.fixture.context", payload: context })), contextKeys.privateKey).toString("base64url") };
const files: Record<string, { sha256: string; sizeBytes: number }> = {};
for (const name of ["runtime/node.exe", "worker/compliance-local-bridge.cjs", "worker/compliance-trust.json"]) {
  const bytes = await readFile(join(components, name)); files[name] = { sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length };
}
await writeFile(join(root, "fixture.json"), JSON.stringify({ files, signedContext, ownerId, accountId, deviceId, productId, claimId, evidenceId, approved, spokenApproved }));
}
main().catch(() => { process.exitCode = 1; });
