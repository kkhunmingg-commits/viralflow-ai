import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalPolicyJson } from "../compliance-brain/policy-pack";
import { createSignedPolicyTestFixture, POLICY_TEST_NOW } from "../compliance-brain/policy-test-fixtures";
import { MemoryPolicyRegistryStore, PolicyRegistry, policyScopeKey } from "../compliance-brain/policy-registry";
import { LocalComplianceRuntime, localSpeechRequestHash, type LocalSpeechAuditRecord } from "./compliance-local-runtime";

const ownerId = "dc5b335c-1a82-4e6f-8366-6174c351ca74", accountId = "0fef5a0f-8f67-4c09-9042-f9641ea9f45a",
  productId = "cb87c2be-5f9c-4b98-9ae6-dd9417d2c358", evidenceId = "ec0538a6-d1ef-459c-b70a-2c14f2f73ce4";
const verified = "ขวดมีขนาด 30 มิลลิลิตร", neutral = "ฉันยังไม่มีข้อมูลที่ยืนยันเรื่องนี้ จึงไม่ขอกล่าวอ้างเพิ่มเติม";
async function fixture(policy = true) {
  let clock = Date.parse(POLICY_TEST_NOW);
  const store = new MemoryPolicyRegistryStore(), signedPolicy = createSignedPolicyTestFixture();
  const audit: LocalSpeechAuditRecord[] = [];
  if (policy) await store.writeLastKnownGood(policyScopeKey(signedPolicy.payload), signedPolicy.signed);
  const signer = generateKeyPairSync("ed25519"), contextKey = signer.publicKey.export({ type: "spki", format: "pem" }).toString();
  const runtime = new LocalComplianceRuntime(new PolicyRegistry(store, signedPolicy.trustedKeys, async () => false,
    { now: new Date(POLICY_TEST_NOW) }), { contextPublicKeys: { "context.fixture": contextKey } }, () => clock,
    { append: async record => { audit.push(record); } });
  const context = { v: 1, purpose: "AI_LIVE_PRODUCT_CONTEXT", ownerId, accountId, deviceId: randomUUID(),
    productIds: [productId], issuedAt: clock / 1000, expiresAt: clock / 1000 + 120, versions: { worker: "1.0.0" },
    products: [{ productId, name: "Test-only bottle", version: "v1", facts: { price: 1 }, compliance: {
      platform: "TIKTOK_SHOP", country: "TH", region: "TH", category: "SKINCARE",
      claims: [{ id: randomUUID(), ownerId, productId, text: verified, type: "FEATURE", source: "test-only label",
        evidenceRefs: [evidenceId], jurisdiction: "TH", verified: true, expiresAt: null, allowedChannels: ["LIVE"], conditions: [] }],
      evidence: [{ id: evidenceId, ownerId, productId, kind: "PRODUCT_LABEL", source: "https://shop.example/label",
        sourceHash: "a".repeat(64), jurisdiction: "TH", verified: true, expiresAt: null }],
    } }] };
  const envelope = (payload = context) => ({ keyId: "context.fixture", payload,
    signature: sign(null, Buffer.from(canonicalPolicyJson({ keyId: "context.fixture", payload })), signer.privateKey).toString("base64url") });
  const request = (text = verified, extra = {}) => ({ requestId: randomUUID(), ownerId, accountId, roomId: "room-one",
    productId, contextVersion: "v1", text, ...extra });
  return { runtime, store, signedPolicy, context, contextKey, envelope, request, audit, advance: (ms: number) => { clock += ms; } };
}
describe("installed shared LIVE authority", () => {
  it("uses the actual POST engine with a signed offline LKG and verified LIVE ledger", async () => {
    const f = await fixture(); f.runtime.syncContext(f.envelope());
    const input = f.request();
    expect(await f.runtime.authorize(input)).toMatchObject({ allowed: true, text: verified, finalStatus: "PASS",
      requestHash: localSpeechRequestHash(input), policyVersion: f.signedPolicy.payload.version });
    const harmful = f.request("รักษาสิวหายขาดแน่นอนใน 3 วัน");
    expect(await f.runtime.authorize(harmful)).toMatchObject({ allowed: false, finalStatus: "BLOCK" });
    expect(await f.runtime.authorize(f.request(neutral, { productId: null, contextVersion: "GENERIC" })))
      .toMatchObject({ allowed: true, text: neutral });
  });
  it("rescans bounded rewrites and cannot treat raw signed store facts as verified claims", async () => {
    const f = await fixture(); f.runtime.syncContext(f.envelope());
    expect(await f.runtime.authorize(f.request("ราคา 1 บาท"))).toMatchObject({ allowed: true, text: verified, finalStatus: "PASS" });
    expect(f.audit[0]).toMatchObject({ allowed: true, finalStatus: "PASS", policyVersion: f.signedPolicy.payload.version,
      claimRefs: [f.context.products[0].compliance.claims[0].id], evidenceRefs: [evidenceId] });
    expect(f.audit[0].rewrites).toHaveLength(1);
    expect(f.audit[0].contentHash).toBe(f.audit[0].rewrites[0].inputHash);
    expect(f.audit[0].finalContentHash).toBe(f.audit[0].rewrites[0].outputHash);
    expect(JSON.stringify(f.audit)).not.toContain(verified);
    expect(JSON.stringify(f.audit)).not.toContain("ราคา 1 บาท");
  });
  it("cannot release speech without a durable private audit append", async () => {
    const f = await fixture();
    const registry = new PolicyRegistry(f.store, f.signedPolicy.trustedKeys, async () => false, { now: new Date(POLICY_TEST_NOW) });
    for (const audit of [undefined, { append: async () => { throw new Error("disk_unavailable"); } }]) {
      const runtime = new LocalComplianceRuntime(registry, { contextPublicKeys: { "context.fixture": f.contextKey } },
        () => Date.parse(POLICY_TEST_NOW), audit);
      runtime.syncContext(f.envelope());
      expect((await runtime.authorize(f.request())).allowed).toBe(false);
    }
  });
  it("cancels a stalled durable audit without releasing its otherwise safe reply", async () => {
    const f = await fixture(), registry = new PolicyRegistry(f.store, f.signedPolicy.trustedKeys, async () => false,
      { now: new Date(POLICY_TEST_NOW) });
    const runtime = new LocalComplianceRuntime(registry, { contextPublicKeys: { "context.fixture": f.contextKey } },
      () => Date.parse(POLICY_TEST_NOW), { append: () => new Promise(() => {}) });
    runtime.syncContext(f.envelope());
    const start = Date.now();
    expect((await runtime.authorize(f.request(), AbortSignal.timeout(20))).allowed).toBe(false);
    expect(Date.now() - start).toBeLessThan(250);
  });
  it("denies missing authority, missing verified context, wrong owner/account/version and expired snapshots", async () => {
    const missing = await fixture(false); missing.runtime.syncContext(missing.envelope());
    expect(await missing.runtime.authorize(missing.request())).toMatchObject({ allowed: false });
    const f = await fixture();
    expect(await f.runtime.authorize(f.request())).toMatchObject({ allowed: false });
    f.runtime.syncContext(f.envelope());
    for (const change of [{ ownerId: randomUUID() }, { accountId: randomUUID() }, { productId: randomUUID() }, { contextVersion: "old" }]) {
      expect(await f.runtime.authorize(f.request(verified, change))).toMatchObject({ allowed: false });
    }
    f.advance(120_000);
    expect(await f.runtime.authorize(f.request())).toMatchObject({ allowed: false });
  });
  it("rejects context signature tampering, unverified/cross-product claims and an untrusted signer", async () => {
    const f = await fixture(), signed = f.envelope();
    signed.payload.products[0].facts.price = 99;
    expect(() => f.runtime.syncContext(signed)).toThrow("LIVE_CONTEXT_SIGNATURE_INVALID");
    const bad = structuredClone(f.context); bad.products[0].compliance.claims[0].ownerId = randomUUID();
    expect(() => f.runtime.syncContext(f.envelope(bad))).toThrow("LIVE_CONTEXT_SCOPE_INVALID");
    expect(() => f.runtime.syncContext({ ...f.envelope(), keyId: "customer.key" })).toThrow("LIVE_CONTEXT_AUTHORITY_REQUIRED");
  });
  it("rechecks live policy availability for cached PCM authorization and binds exact text/room/scope bytes", async () => {
    const f = await fixture(); f.runtime.syncContext(f.envelope());
    expect((await f.runtime.authorize(f.request())).allowed).toBe(true);
    await f.store.disableLastKnownGood(policyScopeKey(f.signedPolicy.payload));
    expect((await f.runtime.authorize(f.request())).allowed).toBe(false);
    const original = f.request(), changed = { ...original, roomId: "other-room" };
    expect(localSpeechRequestHash(original)).not.toBe(localSpeechRequestHash(changed));
  });
});
