import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { ownsVideoStoragePath } from "../video/storage";
import { ClaimLedger } from "./claim-ledger";
import type { ComplianceContent, ComplianceDecision, ComplianceInput, ComplianceScope } from "./contracts";
import { ComplianceEngine } from "./engine";
import { evaluateWithBoundedRewrite, passesCompliance, PublishGate } from "./gates";
import { verifySignedPolicyPack } from "./policy-pack";
import type { SignedPolicyPack } from "./policy-pack";
import type { PolicyPackPayload } from "./policy-registry";
import { loadActivePolicyPack, loadFinalMediaReview, loadProductLedger, recordDecision, type FinalMediaReview } from "./store";
import { createSemanticClassifierFromEnvironment } from "./semantic-local";
import { refreshComplianceLearning } from "./learning-runtime";
import { logOps } from "@/lib/ops/logger";

// A short outage may use verified authority; stale/revoked policy cannot authorize indefinitely.
const POLICY_OUTAGE_LEASE_MS=60_000;
const lastKnownGood = new Map<string, {envelope:SignedPolicyPack;verifiedAt:number}>();
export function readPolicyTrustKeys(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(process.env.COMPLIANCE_POLICY_PUBLIC_KEYS_JSON ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key, pem]) => /^[A-Za-z0-9._-]{1,128}$/.test(key)
      && typeof pem === "string" && pem.includes("BEGIN PUBLIC KEY"))) as Record<string, string>;
  } catch { return {}; }
}
export async function currentVerifiedPolicy(client: SupabaseClient, scope: ComplianceScope): Promise<PolicyPackPayload | null> {
  const lookupStartedAt=Date.now();
  const key = [scope.platform, scope.country, scope.region].join(":"), keys = readPolicyTrustKeys();
  if (!Object.keys(keys).length) {lastKnownGood.delete(key);return null;}
  const fallback=()=>{
    const cached=lastKnownGood.get(key),age=cached?Date.now()-cached.verifiedAt:-1;
    if(!cached||age<0||age>=POLICY_OUTAGE_LEASE_MS){lastKnownGood.delete(key);return null;}
    try{return verifySignedPolicyPack(cached.envelope,keys)}catch{lastKnownGood.delete(key);return null;}
  };
  let envelope;
  try { envelope = await loadActivePolicyPack(client, scope); }
  catch { return fallback(); }
  // Explicit retirement/deactivation clears cached authority. Only transport failure uses LKG.
  if (!envelope) { lastKnownGood.delete(key); return null; }
  const elapsed=Date.now()-lookupStartedAt;
  if(elapsed<0||elapsed>=POLICY_OUTAGE_LEASE_MS){lastKnownGood.delete(key);return null;}
  try {
    const pack = verifySignedPolicyPack(envelope, keys);
    if (lastKnownGood.size >= 32 && !lastKnownGood.has(key)) lastKnownGood.delete(lastKnownGood.keys().next().value!);
    lastKnownGood.set(key, {envelope,verifiedAt:lookupStartedAt}); return pack;
  } catch { return fallback(); }
}
export const commerceScope = (ownerId: string, productId: string, accountId: string, category: string): ComplianceScope =>
  ({ ownerId, productId, accountId, platform: "TIKTOK_SHOP", country: "TH", region: "TH", category, channel: "POST" });

export async function loadComplianceContext(client: SupabaseClient, scope: ComplianceScope) {
  const ledger = await loadProductLedger(client, scope.ownerId, scope.productId).catch(() => ({ claims: [], evidence: [] }));
  return { scope, ...ledger };
}
async function persistOrHold(decision: ComplianceDecision) {
  let admin:SupabaseClient;
  try {
    admin=createAdminClient();
    await recordDecision(admin, decision);
  }
  catch {
    return { ...decision, status: passesCompliance(decision) ? "REVIEW_REQUIRED" as const : decision.status,
      reasons: [...decision.reasons, { code: "AUDIT_UNAVAILABLE", message: "ยังบันทึกผลการตรวจสอบได้ไม่ครบ", policyRefs: [] }] };
  }
  if(decision.policyVersion){
    try{await refreshComplianceLearning(admin,decision.policyVersion);}
    catch{logOps({severity:"WARN",component:"compliance",operation:"learning_refresh_pending"});}
  }
  // Optional aggregate learning cannot override an already audited compliance verdict.
  return decision;
}
export async function evaluateProductionCompliance(client: SupabaseClient, input: Omit<ComplianceInput, "claims" | "evidence">,
  rewrite = false) {
  const context = await loadComplianceContext(client, input.scope);
  const authority = new ComplianceEngine({ policy: () => currentVerifiedPolicy(client, input.scope), classifier:createSemanticClassifierFromEnvironment() });
  const result = await evaluateWithBoundedRewrite(authority, { ...input, ...context }, rewrite ? 2 : 0);
  return { input: result.input, decision: await persistOrHold(result.decision) };
}
export async function generationConstraints(client: SupabaseClient, scope: ComplianceScope) {
  const context = await loadComplianceContext(client, scope), policy = await currentVerifiedPolicy(client, scope);
  const claims = new ClaimLedger(scope, context.claims, context.evidence).permitted();
  if (!policy || !claims.length) throw new Error("compliance_review_required");
  const check = await evaluateProductionCompliance(client, { scope, stage: "PRE_GENERATION",
    content: { script: claims.map(claim => claim.text).join("\n") } });
  if (!passesCompliance(check.decision)) throw new Error("compliance_review_required");
  return { policyVersion: policy.version, allowedClaims: claims.map(claim => ({ text: claim.text, conditions: claim.conditions })),
    obligations: policy.rules.filter(rule => rule.contentTypes.includes("POST")
      && (rule.categories.includes("*") || rule.categories.includes(scope.category))).map(rule => rule.obligation),
    unknownFacts: "Never infer a product fact, approval, result, price, review or feature outside allowedClaims." };
}
export function scriptContent(script: Record<string, unknown>): ComplianceContent {
  return { hook: String(script.hook_text ?? ""), script: String(script.voice_script ?? ""), cta: String(script.cta_text ?? ""),
    caption: String(script.caption ?? ""), hashtags: Array.isArray(script.hashtags_json) ? script.hashtags_json.map(String) : [],
    onScreenText: Array.isArray(script.overlay_text_json) ? script.overlay_text_json.map(item => typeof item === "string" ? item : String(item?.text ?? "")) : [] };
}
export async function assertScriptCompliance(client: SupabaseClient, scope: ComplianceScope, script: Record<string, unknown>) {
  const checked = await evaluateProductionCompliance(client, { scope, stage: "PRE_GENERATION", content: scriptContent(script) });
  if (!passesCompliance(checked.decision)) throw new Error("compliance_review_required");
  return checked.decision;
}
export async function checkFinalMedia(client: SupabaseClient, scope: ComplianceScope, storagePath: string,
  content: ComplianceContent, stage: "POST_GENERATION" | "FINAL_PUBLISH" = "FINAL_PUBLISH", publishDisclosure?:boolean,
  deliveryMedia?:Blob|null) {
  let assetHash = "", review: FinalMediaReview | null = null;
  try {
    if(!ownsVideoStoragePath(scope.ownerId,storagePath))throw new Error("compliance_media_scope_invalid");
    const admin = createAdminClient();
    // At upload, inspect the same immutable Blob delivered to the provider, without a second download.
    // An external pull URL has no immutable byte binding here; explicit null keeps it held for review.
    const file = deliveryMedia === undefined ? await admin.storage.from("video-assets").download(storagePath)
      : {data:deliveryMedia,error:null};
    if (!file.error && file.data && file.data.size > 0 && file.data.size <= 100_000_000) {
      assetHash = createHash("sha256").update(new Uint8Array(await file.data.arrayBuffer())).digest("hex");
      review=await loadFinalMediaReview(admin,scope.ownerId,scope.productId,assetHash,scope.accountId);
    }
  } catch { /* Missing actual-media verification stays held for review. */ }
  const context = await loadComplianceContext(client, scope);
  const input: ComplianceInput = { ...context, stage, content: { ...content,
    transcript: review?.transcript, onScreenText: review?.onScreenText, coverText: review?.coverText,
    visibleClaims: review?.visibleClaims, metadata: review?.metadata },
    aiGenerated: true, disclosureApplied: publishDisclosure===undefined?review?.aiDisclosed===true:publishDisclosure,
    media: { assetHash, coverageComplete: review?.coverageComplete === true, evidenceRefs:review?.evidenceRefs??[] } };
  const authority = new ComplianceEngine({ policy: () => currentVerifiedPolicy(client, scope), classifier:createSemanticClassifierFromEnvironment() });
  const decision = stage === "FINAL_PUBLISH" ? (await new PublishGate(authority).check(input)).decision : await authority.evaluate(input);
  return persistOrHold(decision);
}
