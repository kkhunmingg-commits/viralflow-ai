import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FileLocalSpeechAuditSink } from "./compliance-local-audit";
import type { LocalSpeechAuditRecord } from "./compliance-local-runtime";

function record(): LocalSpeechAuditRecord {
  return { v: 1, requestId: randomUUID(), requestHash: "a".repeat(64), deviceId: randomUUID(), ownerId: randomUUID(),
    accountId: randomUUID(), productId: randomUUID(), contentHash: "b".repeat(64), finalContentHash: "c".repeat(64),
    checkedAt: "2026-10-07T01:00:00Z", policyVersion: "fixture.1", policyRefs: ["fixture.rule"], claimRefs: [randomUUID()],
    evidenceRefs: [randomUUID()], rewrites: [], finalStatus: "PASS", allowed: true };
}
async function temporaryDirectory() {
  const root = resolve(".ai-live-dev/compliance");
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, "audit-test-"));
}
describe("bounded private LIVE audit", () => {
  it("serializes concurrent appends and partitions signed device, owner and account", async () => {
    const directory = await temporaryDirectory();
    try {
      const sink = new FileLocalSpeechAuditSink(directory), first = record(), second = { ...first, requestId: randomUUID() };
      await Promise.all([sink.append(first), sink.append(second)]);
      const path = join(directory, first.deviceId!, first.ownerId, first.accountId, "decisions.jsonl");
      const records = (await readFile(path, "utf8")).trim().split("\n").map(line => JSON.parse(line));
      expect(records).toEqual([first, second]);
      const other = { ...first, accountId: randomUUID() };
      await sink.append(other);
      expect(await readdir(join(directory, first.deviceId!, first.ownerId))).toHaveLength(2);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("retains only two bounded generations and rejects raw content or unbound device", async () => {
    const directory = await temporaryDirectory();
    try {
      const sink = new FileLocalSpeechAuditSink(directory, 1024), first = record();
      for (let index = 0; index < 6; index++) await sink.append({ ...first, requestId: randomUUID() });
      const scope = join(directory, first.deviceId!, first.ownerId, first.accountId), files = await readdir(scope);
      expect(files.sort()).toEqual(["decisions.jsonl", "decisions.previous.jsonl"]);
      for (const file of files) expect((await stat(join(scope, file))).size).toBeLessThanOrEqual(1024);
      expect(() => sink.append({ ...first, deviceId: null })).toThrow();
      expect(() => sink.append({ ...first, text: "private speech" } as LocalSpeechAuditRecord)).toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
