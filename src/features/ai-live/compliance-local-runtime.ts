import { createHash, createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import type { ComplianceDecision, ComplianceInput } from "../compliance-brain/contracts";
import { ComplianceEngine, contentHash } from "../compliance-brain/engine";
import { LiveSpeechGate } from "../compliance-brain/gates";
import { canonicalPolicyJson } from "../compliance-brain/policy-pack";
import { PolicyRegistry } from "../compliance-brain/policy-registry";
import { liveDeadline } from "./live-timeout";

const id = z.string().min(1).max(128), uuid = z.uuid(), date = z.iso.datetime({ offset: true });
const evidence = z.strictObject({ id: uuid, ownerId: uuid, productId: uuid,
  kind: z.enum(["PDP", "SELLER_DOCUMENT", "PRODUCT_LABEL", "CERTIFICATE", "REGISTRATION", "STUDY", "PROMOTION", "MEDIA_REVIEW"]),
  source: z.string().min(1).max(4096), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), jurisdiction: id,
  verified: z.literal(true), expiresAt: date.nullable() });
const claim = z.strictObject({ id: uuid, ownerId: uuid, productId: uuid, text: z.string().min(1).max(4000), type: id,
  source: z.string().min(1).max(4096), evidenceRefs: z.array(uuid).max(100), jurisdiction: id, expiresAt: date.nullable(),
  verified: z.literal(true), allowedChannels: z.array(z.enum(["POST", "LIVE"])).min(1).max(2),
  conditions: z.array(z.string().max(512)).max(30), aliases: z.array(z.string().max(4000)).max(30).optional() });
const product = z.object({ productId: uuid, name: z.string().max(160), version: id,
  facts: z.record(z.string(), z.unknown()), compliance: z.strictObject({ platform: id,
    country: z.string().regex(/^[A-Z]{2}$/), region: id, category: id,
    claims: z.array(claim).max(200), evidence: z.array(evidence).max(200) }).nullable() });
const payloadSchema = z.strictObject({ v: z.literal(1), purpose: z.literal("AI_LIVE_PRODUCT_CONTEXT"),
  ownerId: uuid, deviceId: uuid, accountId: uuid, productIds: z.array(uuid).min(1).max(10),
  products: z.array(product).min(1).max(10), issuedAt: z.number().int(), expiresAt: z.number().int(),
  versions: z.record(z.string(), z.string()) });
export const localSpeechRequestSchema = z.strictObject({ requestId: uuid, ownerId: uuid, accountId: uuid,
  roomId: id, productId: uuid.nullable(), contextVersion: id, text: z.string().trim().min(1).max(4000) });
export type LocalSpeechRequest = z.infer<typeof localSpeechRequestSchema>;
export const localSpeechRequestHash = (input: unknown) => createHash("sha256").update(canonicalPolicyJson(input)).digest("hex");
type ProductEnvelope = z.infer<typeof payloadSchema>;
export interface LocalComplianceTrust { contextPublicKeys: Readonly<Record<string, string>>; legacyContextPublicKey?: string }
/** Private audit contract deliberately excludes speech, comments, facts, sources and rewrites' text. */
export interface LocalSpeechAuditRecord {
  v: 1; requestId: string; requestHash: string; deviceId: string | null;
  ownerId: string; accountId: string; productId: string | null;
  contentHash: string; finalContentHash: string; checkedAt: string;
  policyVersion: string | null; policyRefs: string[]; claimRefs: string[]; evidenceRefs: string[];
  rewrites: ComplianceDecision["rewrites"]; finalStatus: ComplianceDecision["status"]; allowed: boolean;
}
export interface LocalSpeechAuditSink { append(record: LocalSpeechAuditRecord): Promise<void> }

/** Private inherited-pipe authority. Shares the exact POST engine; no Python policy copy or request-supplied claims. */
export class LocalComplianceRuntime {
  private contexts = new Map<string, ProductEnvelope>();
  private readonly engine: ComplianceEngine;
  constructor(private readonly registry: Pick<PolicyRegistry, "loadActive">, private readonly trust: LocalComplianceTrust,
    private readonly clock: () => number = Date.now, private readonly audit?: LocalSpeechAuditSink) {
    this.engine = new ComplianceEngine({ policy: async input => (await this.registry.loadActive(input.scope)).pack });
  }
  syncContext(signed: unknown) {
    const envelope = z.union([
      z.strictObject({ keyId: id, payload: z.unknown(), signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/) }),
      z.strictObject({ payload: z.unknown(), signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/) }),
    ]).parse(signed);
    const keyId = "keyId" in envelope ? envelope.keyId : undefined;
    const pem = keyId ? this.trust.contextPublicKeys[keyId] : this.trust.legacyContextPublicKey;
    if (!pem) throw new Error("LIVE_CONTEXT_AUTHORITY_REQUIRED");
    const publicKey = createPublicKey(pem);
    if (publicKey.asymmetricKeyType !== "ed25519" || !verify(null,
      Buffer.from(canonicalPolicyJson(keyId ? { keyId, payload: envelope.payload } : envelope.payload)),
      publicKey, Buffer.from(envelope.signature, "base64url"))) throw new Error("LIVE_CONTEXT_SIGNATURE_INVALID");
    const payload = payloadSchema.parse(envelope.payload), now = Math.floor(this.clock() / 1000);
    if (payload.issuedAt > now + 30 || payload.expiresAt <= now || payload.expiresAt - payload.issuedAt <= 0
      || payload.expiresAt - payload.issuedAt > 120 || new Set(payload.productIds).size !== payload.productIds.length
      || payload.products.length !== payload.productIds.length || new Set(payload.products.map(row => row.productId)).size !== payload.products.length
      || payload.products.some(row => !payload.productIds.includes(row.productId)
        || row.compliance && [...row.compliance.claims, ...row.compliance.evidence].some(item =>
          item.ownerId !== payload.ownerId || item.productId !== row.productId))) throw new Error("LIVE_CONTEXT_SCOPE_INVALID");
    const key = `${payload.ownerId}:${payload.accountId}`;
    if (!this.contexts.has(key) && this.contexts.size >= 10) throw new Error("LIVE_CONTEXT_LIMIT");
    this.contexts.set(key, payload);
  }
  async authorize(raw: unknown, signal?: AbortSignal) {
    // Bind to original transport bytes, including whitespace, before schema normalization.
    const requestHash = localSpeechRequestHash(raw), request = localSpeechRequestSchema.parse(raw);
    const denied = () => ({ requestId: request.requestId, requestHash, allowed: false, text: "",
      finalStatus: "REVIEW_REQUIRED", policyVersion: null });
    const context = this.contexts.get(`${request.ownerId}:${request.accountId}`);
    const record = async (decision?: ComplianceDecision, allowed = false) => {
      if (!this.audit || signal?.aborted) throw new Error("LIVE_AUDIT_REQUIRED");
      const originalHash = contentHash({ script: request.text });
      await liveDeadline(this.audit.append({ v: 1, requestId: request.requestId, requestHash, deviceId: context?.deviceId ?? null,
        ownerId: request.ownerId, accountId: request.accountId, productId: request.productId,
        contentHash: decision?.rewrites[0]?.inputHash ?? decision?.contentHash ?? originalHash,
        finalContentHash: decision?.contentHash ?? originalHash,
        checkedAt: decision?.checkedAt ?? new Date(this.clock()).toISOString(), policyVersion: decision?.policyVersion ?? null,
        policyRefs: decision?.policyRefs ?? [], claimRefs: decision?.claimRefs ?? [], evidenceRefs: decision?.evidenceRefs ?? [],
        rewrites: decision?.rewrites ?? [], finalStatus: decision?.status ?? "REVIEW_REQUIRED", allowed }),
      900, signal, "LIVE_AUDIT_TIMEOUT");
    };
    const reject = async () => { await record().catch(() => undefined); return denied(); };
    if (!context || context.expiresAt <= Math.floor(this.clock() / 1000)) return reject();
    const current = request.productId ? context.products.find(row => row.productId === request.productId)
      : request.contextVersion === "GENERIC" ? context.products[0] : undefined;
    if (!current?.compliance || request.productId && request.contextVersion !== current.version) return reject();
    const facts = current.compliance;
    const input: Omit<ComplianceInput, "content" | "stage"> = {
      scope: { ownerId: request.ownerId, accountId: request.accountId, productId: current.productId,
        platform: facts.platform, country: facts.country, region: facts.region, category: facts.category, channel: "LIVE" },
      // Generic filler has no product claims; it cannot accidentally inherit another product's facts.
      claims: request.productId ? facts.claims : [], evidence: request.productId ? facts.evidence : [],
      now: new Date(this.clock()).toISOString(),
    };
    try {
      const result = await new LiveSpeechGate(this.engine, () => input).authorize(request.text, signal);
      // Expiry/revocation/context replacement during evaluation cannot authorize stale speech.
      if (signal?.aborted || this.contexts.get(`${request.ownerId}:${request.accountId}`) !== context
        || context.expiresAt <= Math.floor(this.clock() / 1000)) return reject();
      await record(result.decision, result.allowed);
      // A durable append must finish before PCM may be released, and cannot outlive its context.
      if (signal?.aborted || this.contexts.get(`${request.ownerId}:${request.accountId}`) !== context
        || context.expiresAt <= Math.floor(this.clock() / 1000)) return denied();
      return { requestId: request.requestId, requestHash, allowed: result.allowed, text: result.allowed ? result.text : "",
        finalStatus: result.decision.status, policyVersion: result.decision.policyVersion };
    } catch { return denied(); }
  }
}
