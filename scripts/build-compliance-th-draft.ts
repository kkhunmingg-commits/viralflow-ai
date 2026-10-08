/** Offline construction only; never signs, activates or writes to a remote database. */
import { readFile, writeFile } from "node:fs/promises";
import { createPolicySourceSnapshot } from "../src/features/compliance-brain/policy-ingestion";
import { policyPackChecksum, validatePolicyPackPayload } from "../src/features/compliance-brain/policy-pack";
import type { PolicyRule } from "../src/features/compliance-brain/policy-registry";

async function main() {
const sourceFile = ".video-cache/compliance-real-world/policy-source-snapshots.json";
const snapshots = JSON.parse(await readFile(sourceFile, "utf8")) as Array<{
  id: string; url: string; title: string; text: string; publishedAt: string; recordedAt: string;
}>;
const old = JSON.parse(await readFile("docs/compliance-brain/tiktok-th-research-candidate.json", "utf8")) as { rules: PolicyRule[] };
const scope = { platform: "TIKTOK_SHOP", country: "TH", region: "TH" }, version = "research.2026.10.09";
const sources = snapshots.map(row => createPolicySourceSnapshot({ ...scope, id: row.id, url: row.url, title: row.title,
  publishedAt: row.publishedAt, retrievedAt: row.recordedAt, effectiveDate: "UNKNOWN", version,
  contentTypes: ["POST", "LIVE"], categories: ["*"] }, row.text).source);
const ids = new Set(sources.map(row => row.id));
const rules = old.rules.filter(rule => rule.sourceIds.every(id => ids.has(id))).map(rule => ({ ...rule, version }));
const disclosure = rules.find(rule => rule.id === "shop.aigc.disclosure")!;
disclosure.sourceIds = ["content", "aigc"];
const payload = validatePolicyPackPayload({ ...scope, schemaVersion: 1, id: "tiktok.shop.th", version,
  effectiveDate: "UNKNOWN", issuedAt: new Date().toISOString(), sources, rules });
const draft = { status: "PARSED", parserOrigin: "AI", ownerApproval: "PENDING", validation: null, signature: null,
  checksum: policyPackChecksum(payload), payload,
  limitations: ["Article publication dates are not asserted policy effective dates; effective dates remain UNKNOWN.",
    "Owner review, regressions, unknown-date acknowledgement and a trusted signature are required before activation.",
    "Sources are normalized retrieved article text, not raw publisher HTML or image interpretation.",
    "Classification covers a subset of policy categories; unknown visual meaning is held for review.",
    "Not a guarantee of enforcement prevention; category exceptions require product evidence and manual validation."] };
await writeFile("docs/compliance-brain/tiktok-th-policy-draft-2026-10-09.json", JSON.stringify(draft, null, 2) + "\n");
console.log(JSON.stringify({ sources: sources.length, rules: rules.length, checksum: draft.checksum, activated: false }));
}
main().catch(() => { console.error("POLICY_DRAFT_BUILD_FAILED"); process.exitCode = 1; });
