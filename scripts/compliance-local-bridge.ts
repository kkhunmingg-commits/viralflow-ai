/** Fixed managed Node entry; stdin/stdout are inherited private pipes, never a customer HTTP service. */
import { createInterface } from "node:readline";
import { z } from "zod";
import { isAbsolute, resolve } from "node:path";
import { LocalComplianceRuntime } from "../src/features/ai-live/compliance-local-runtime";
import { FileLocalSpeechAuditSink } from "../src/features/ai-live/compliance-local-audit";
import { FilePolicyRegistryStore } from "../src/features/compliance-brain/policy-file-store";
import { PolicyRegistry } from "../src/features/compliance-brain/policy-registry";

const publicKeys = z.record(z.string().min(1).max(128), z.string().max(4096)).refine(keys => Object.keys(keys).length <= 8);
const configSchema = z.strictObject({ policyDirectory: z.string().min(1).max(4096).refine(isAbsolute),
  contextPublicKeys: publicKeys, legacyContextPublicKey: z.string().max(4096).optional(), policyPublicKeys: publicKeys });
export async function serveComplianceBridge(input: NodeJS.ReadableStream, output: NodeJS.WritableStream) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  let runtime: LocalComplianceRuntime | undefined;
  for await (const line of lines) {
    if (Buffer.byteLength(line, "utf8") > 1024 * 1024) throw new Error("LIVE_COMPLIANCE_MESSAGE_TOO_LARGE");
    const value: unknown = JSON.parse(line);
    if (!runtime) {
      const config = configSchema.parse(value);
      runtime = new LocalComplianceRuntime(new PolicyRegistry(new FilePolicyRegistryStore(config.policyDirectory),
        config.policyPublicKeys, async () => false), config, Date.now,
        new FileLocalSpeechAuditSink(resolve(config.policyDirectory, "..", "compliance-audit")));
      output.write('{"ready":true}\n');
      continue;
    }
    const message = z.strictObject({ id: z.number().int().positive(), method: z.enum(["syncContext", "authorize"]), body: z.unknown() }).parse(value);
    try {
      const result = message.method === "syncContext" ? (runtime.syncContext(message.body), { synced: true })
        : await runtime.authorize(message.body, AbortSignal.timeout(900));
      output.write(JSON.stringify({ id: message.id, value: result }) + "\n");
    } catch { output.write(JSON.stringify({ id: message.id, error: "LIVE_COMPLIANCE_UNAVAILABLE" }) + "\n"); }
  }
}
if (process.argv[1] && /compliance-local-bridge\.(?:ts|cjs)$/.test(process.argv[1])) {
  serveComplianceBridge(process.stdin, process.stdout).catch(() => { process.exitCode = 1; });
}
