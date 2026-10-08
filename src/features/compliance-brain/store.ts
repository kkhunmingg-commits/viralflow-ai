import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ComplianceDecision, ComplianceScope, ProductClaim, ProductEvidence } from "./contracts";
import type { SignedPolicyPack } from "./policy-pack";
import type { AccountSafetySummary, SafetyDecisionRow } from "./presentation";
import { summarizeAccountSafety, unavailableAccountSafety } from "./presentation";

const uuid = z.uuid();
const evidenceRow = z.object({id: uuid, owner_id: uuid, product_id: uuid,
  kind: z.enum(["PDP","SELLER_DOCUMENT","PRODUCT_LABEL","CERTIFICATE","REGISTRATION","STUDY","PROMOTION","MEDIA_REVIEW"]),
  source_url: z.string().min(1), source_hash: z.string().regex(/^[a-f0-9]{64}$/), jurisdiction: z.string(),
  verified: z.boolean(), expires_at: z.string().nullable()});
const claimRow = z.object({id: uuid, owner_id: uuid, product_id: uuid, claim_text: z.string().min(1), claim_type: z.string(),
  source: z.string().min(1), evidence_refs: z.array(uuid), jurisdiction: z.string(), expires_at: z.string().nullable(),
  verified: z.boolean(), allowed_channels: z.array(z.enum(["POST","LIVE"])), conditions: z.array(z.string()), aliases: z.array(z.string())});
const evidenceFields = "id,owner_id,product_id,kind,source_url,source_hash,jurisdiction,verified,expires_at";
const claimFields = "id,owner_id,product_id,claim_text,claim_type,source,evidence_refs,jurisdiction,expires_at,verified,allowed_channels,conditions,aliases";

export async function loadProductLedger(client: SupabaseClient, ownerId: string, productId: string):
Promise<{claims: ProductClaim[]; evidence: ProductEvidence[]}> {
  uuid.parse(ownerId); uuid.parse(productId);
  const [claims, evidence] = await Promise.all([
    client.from("compliance_brain_claims").select(claimFields).eq("owner_id",ownerId).eq("product_id",productId),
    client.from("compliance_brain_evidence").select(evidenceFields).eq("owner_id",ownerId).eq("product_id",productId),
  ]);
  if (claims.error || evidence.error) throw new Error("compliance_ledger_unavailable");
  const claimRows = z.array(claimRow).parse(claims.data ?? []);
  const evidenceRows = z.array(evidenceRow).parse(evidence.data ?? []);
  if ([...claimRows,...evidenceRows].some(row => row.owner_id !== ownerId || row.product_id !== productId)) {
    throw new Error("compliance_ledger_scope_invalid");
  }
  return {claims: claimRows.map(row => ({id:row.id,ownerId:row.owner_id,productId:row.product_id,text:row.claim_text,
    type:row.claim_type,source:row.source,evidenceRefs:row.evidence_refs,jurisdiction:row.jurisdiction,expiresAt:row.expires_at,
    verified:row.verified,allowedChannels:row.allowed_channels,conditions:row.conditions,aliases:row.aliases})),
  evidence: evidenceRows.map(row => ({id:row.id,ownerId:row.owner_id,productId:row.product_id,kind:row.kind,
    source:row.source_url,sourceHash:row.source_hash,jurisdiction:row.jurisdiction,verified:row.verified,expiresAt:row.expires_at}))};
}

export async function recordDecision(serverClient: SupabaseClient, result: ComplianceDecision): Promise<string> {
  const payload = {id:uuid.parse(result.id),owner_id:uuid.parse(result.scope.ownerId),product_id:uuid.parse(result.scope.productId),
    account_id:result.scope.accountId ? uuid.parse(result.scope.accountId) : null,channel:result.scope.channel,stage:result.stage,
    platform:result.scope.platform,country:result.scope.country,region:result.scope.region,category:result.scope.category,
    category_risk:result.categoryRisk,policy_version:result.policyVersion,content_hash:result.contentHash,decision:result.status,
    risk_score:result.riskScore,policy_refs:result.policyRefs,claim_refs:result.claimRefs,evidence_refs:result.evidenceRefs,
    reasons:result.reasons,rewrites_json:result.rewrites,checked_at:result.checkedAt};
  const response = await serverClient.rpc("record_compliance_brain_decision",{p_decision:payload});
  if (response.error || typeof response.data !== "string") throw new Error("compliance_decision_record_failed");
  return response.data;
}

export async function loadActivePolicyPack(client: SupabaseClient, scope: Pick<ComplianceScope,"platform"|"country"|"region">):
Promise<SignedPolicyPack | null> {
  const result = await client.from("compliance_brain_policy_versions").select("version,pack_json,checksum,signature,region")
    .eq("platform",scope.platform).eq("country",scope.country).eq("status","ACTIVE")
    .in("region",[scope.region,"*"]).lte("effective_at",new Date().toISOString()).order("activated_at",{ascending:false}).limit(2);
  if (result.error) throw new Error("compliance_policy_unavailable");
  const rows = result.data ?? [];
  const row = rows.find(item => item.region === scope.region) ?? rows.find(item => item.region === "*");
  if (!row) return null;
  const pack = row.pack_json as SignedPolicyPack;
  // Signature verification is always performed by the caller's trusted-key registry.
  if (!pack || pack.payload?.version !== row.version || pack.payload.platform !== scope.platform
    || pack.payload.country !== scope.country || ![scope.region,"*"].includes(pack.payload.region)
    || pack.checksum !== row.checksum || pack.signature !== row.signature) throw new Error("compliance_policy_record_invalid");
  return pack;
}

export interface FinalMediaReview {
  assetHash:string;evidenceRefs:string[];transcript:string;onScreenText:string[];coverText:string;
  visibleClaims:string[];metadata:string[];aiDisclosed:boolean;coverageComplete:boolean;reviewedAt:string;expiresAt:string|null;
}
export async function loadFinalMediaReview(client:SupabaseClient,ownerId:string,productId:string,assetHash:string,
  accountId?:string,now=new Date()):Promise<FinalMediaReview|null> {
  uuid.parse(ownerId);uuid.parse(productId);z.string().regex(/^[a-f0-9]{64}$/).parse(assetHash);
  const result=await client.from("compliance_brain_media_reviews")
    .select("owner_id,product_id,account_id,asset_hash,evidence_id,transcript,on_screen_text,cover_text,visible_claims,metadata,ai_disclosed,coverage_complete,reviewed_at,expires_at")
    .eq("owner_id",ownerId).eq("product_id",productId).eq("asset_hash",assetHash).maybeSingle();
  if(result.error)throw new Error("compliance_media_review_unavailable");
  const row=result.data;
  if(!row)return null;
  if(row.owner_id!==ownerId||row.product_id!==productId||row.asset_hash!==assetHash
    ||row.account_id&&row.account_id!==accountId)throw new Error("compliance_media_review_scope_invalid");
  if(!Number.isFinite(Date.parse(row.reviewed_at))||Date.parse(row.reviewed_at)>now.getTime()
    ||row.expires_at!==null&&(!Number.isFinite(Date.parse(row.expires_at))||Date.parse(row.expires_at)<=now.getTime()))return null;
  return {assetHash:row.asset_hash,evidenceRefs:[uuid.parse(row.evidence_id)],transcript:row.transcript,onScreenText:row.on_screen_text,
    coverText:row.cover_text,visibleClaims:row.visible_claims,metadata:row.metadata,aiDisclosed:row.ai_disclosed===true,
    coverageComplete:row.coverage_complete===true,reviewedAt:row.reviewed_at,expiresAt:row.expires_at};
}

export async function loadOwnerAccountSafety(client: SupabaseClient, ownerId: string, accountIds: readonly string[],
  now = new Date()): Promise<Record<string,AccountSafetySummary>> {
  if (!accountIds.length) return {};
  const fallback = Object.fromEntries(accountIds.map(id => [id,unavailableAccountSafety()]));
  const rows: SafetyDecisionRow[] = [];
  const since = new Date(now.getTime()-30*86400_000).toISOString();
  for (let page=0;page<30;page++) {
    const result = await client.from("compliance_brain_decisions")
      .select("id,account_id,channel,stage,content_hash,decision,rewritten,checked_at").eq("owner_id",ownerId).in("account_id",[...accountIds])
      .gte("checked_at",since).lte("checked_at",now.toISOString()).order("checked_at",{ascending:false}).order("id").range(page*1000,page*1000+999);
    if (result.error) return fallback;
    const batch = (result.data??[]) as SafetyDecisionRow[];
    rows.push(...batch);
    if (batch.length<1000) {
      const policy = await client.from("compliance_brain_policy_versions").select("activated_at")
        .eq("status","ACTIVE").eq("country","TH").order("activated_at",{ascending:false}).limit(1).maybeSingle();
      const updated = !policy.error && typeof policy.data?.activated_at === "string" ? policy.data.activated_at : null;
      return Object.fromEntries(accountIds.map(id => [id,summarizeAccountSafety(rows,id,updated)]));
    }
  }
  return fallback;
}

export interface PolicyAdminActor {id:string;app_metadata?:Record<string,unknown>}
export function requirePolicyAdmin(actor: PolicyAdminActor | null): PolicyAdminActor {
  if (!actor || !["admin","developer"].includes(String(actor.app_metadata?.viralflow_role))) throw new Error("compliance_admin_required");
  return actor;
}

/** The verifier must use server-owned trusted keys; this API never accepts a customer-supplied public key. */
export async function activatePolicyVersion(client: SupabaseClient, actor: PolicyAdminActor, version: string,
  verify: (pack: unknown) => {version:string;platform:string;country:string;region:string}, rollback=false) {
  requirePolicyAdmin(actor);
  const result = await client.from("compliance_brain_policy_versions")
    .select("version,platform,country,region,status,pack_json,validation_hash,validated_at").eq("version",version).maybeSingle();
  if (result.error || !result.data || !["VALIDATED","RETIRED"].includes(result.data.status)
    || !result.data.validation_hash || !result.data.validated_at) throw new Error("compliance_policy_not_validated");
  const payload = verify(result.data.pack_json);
  if (payload.version!==version || payload.platform!==result.data.platform || payload.country!==result.data.country
    || payload.region!==result.data.region) throw new Error("compliance_policy_scope_invalid");
  const response = await client.rpc("activate_compliance_brain_policy",{p_version:version,p_actor:uuid.parse(actor.id),p_rollback:rollback});
  if (response.error) throw new Error("compliance_policy_activation_failed");
}
