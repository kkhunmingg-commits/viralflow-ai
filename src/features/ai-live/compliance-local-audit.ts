import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { LocalSpeechAuditRecord, LocalSpeechAuditSink } from "./compliance-local-runtime";

const hash = z.string().regex(/^[a-f0-9]{64}$/), refs = z.array(z.string().min(1).max(128)).max(500);
const status = z.enum(["PASS", "PASS_WITH_WARNING", "AUTO_REWRITE", "REVIEW_REQUIRED", "BLOCK"]);
const recordSchema = z.strictObject({ v: z.literal(1), requestId: z.uuid(), requestHash: hash, deviceId: z.uuid(),
  ownerId: z.uuid(), accountId: z.uuid(), productId: z.uuid().nullable(), contentHash: hash, finalContentHash: hash,
  checkedAt: z.iso.datetime({ offset: true }), policyVersion: z.string().min(1).max(128).nullable(),
  policyRefs: refs, claimRefs: z.array(z.uuid()).max(200), evidenceRefs: z.array(z.uuid()).max(200),
  rewrites: z.array(z.strictObject({ inputHash: hash, outputHash: hash, status })).max(2), finalStatus: status,
  allowed: z.boolean() });

/** App-owned, per signed device/owner/account audit. Two bounded generations; no content bytes. */
export class FileLocalSpeechAuditSink implements LocalSpeechAuditSink {
  private pending: Promise<unknown> = Promise.resolve();
  private readonly root: string;
  constructor(directory: string, private readonly maxBytes = 4 * 1024 * 1024) {
    if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 16 * 1024 * 1024) throw new Error("LIVE_AUDIT_CAPACITY_INVALID");
    this.root = resolve(directory);
  }
  append(record: LocalSpeechAuditRecord): Promise<void> {
    // Parsing also prevents the audit API from accepting any raw content or customer supplied fields.
    const value = recordSchema.parse(record), line = JSON.stringify(value) + "\n";
    if (Buffer.byteLength(line, "utf8") > this.maxBytes) return Promise.reject(new Error("LIVE_AUDIT_TOO_LARGE"));
    const operation = this.pending.then(async () => {
      let directory = this.root;
      for (const segment of ["", value.deviceId, value.ownerId, value.accountId]) {
        directory = join(directory, segment);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const metadata = await lstat(directory);
        if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("LIVE_AUDIT_PATH_INVALID");
      }
      const path = join(directory, "decisions.jsonl"), previous = join(directory, "decisions.previous.jsonl");
      for (const file of [path, previous]) {
        const metadata = await lstat(file).catch(error => {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw error;
        });
        if (metadata && (!metadata.isFile() || metadata.isSymbolicLink())) throw new Error("LIVE_AUDIT_PATH_INVALID");
        if (file === path && metadata && metadata.size + Buffer.byteLength(line, "utf8") > this.maxBytes) {
          await unlink(previous).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
          await rename(path, previous);
        }
      }
      const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0), 0o600);
      try { await handle.writeFile(line, "utf8"); await handle.sync(); } finally { await handle.close(); }
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }
}
