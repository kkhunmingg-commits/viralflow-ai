import {createHash,createPrivateKey,createPublicKey,sign,verify,type KeyObject} from "node:crypto";
import {z} from "zod";
import {SEMANTIC_CATEGORIES} from "./contracts";
import type {PolicyPackPayload} from "./policy-registry";
import {isOfficialPolicyUrl} from "./policy-ingestion";

export interface SignedPolicyPack {payload:PolicyPackPayload;checksum:string;algorithm:"Ed25519";keyId:string;signature:string}
export interface PolicyPackVerificationOptions {now?:Date;knownSemanticCategories?:readonly string[];allowUnknownEffectiveDate?:boolean}
const id=z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:@-]*$/);
const category=z.union([id,z.literal("*")]);
const isoDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const date=new Date(`${value}T00:00:00Z`);return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value});
const policyDate=z.union([isoDate,z.literal("UNKNOWN")]);
const scope={platform:id,country:z.string().regex(/^[A-Z]{2}$/),region:category};
const channels=z.array(z.enum(["POST","LIVE"])).min(1).max(2).refine(values=>new Set(values).size===values.length);
const distinct=(values:string[])=>new Set(values).size===values.length;
const sourceSchema=z.object({
  ...scope,id,url:z.string().url().refine(isOfficialPolicyUrl),title:z.string().min(1).max(300),sourceHash:z.string().regex(/^[a-f0-9]{64}$/),
  hashBasis:z.literal("NORMALIZED_TEXT_V1"),retrievedAt:z.string().datetime(),publishedAt:policyDate.optional(),effectiveDate:policyDate,version:id,
  contentTypes:channels,categories:z.array(category).min(1).max(100).refine(distinct),
}).strict();
const ruleSchema=z.object({id,version:id,sourceIds:z.array(id).min(1).max(100).refine(distinct),semanticCategories:z.array(id).min(1).max(100).refine(distinct),
  obligation:z.string().min(10).max(4000),severity:z.enum(["LOW","MEDIUM","HIGH","CRITICAL"]),
  recommendedDecision:z.enum(["BLOCK","REVIEW_REQUIRED","AUTO_REWRITE","PASS_WITH_WARNING"]),contentTypes:channels,
  categories:z.array(category).min(1).max(100).refine(distinct),requiresEvidence:z.boolean(),}).strict();
const payloadSchema=z.object({schemaVersion:z.literal(1),...scope,id,version:id,effectiveDate:policyDate,issuedAt:z.string().datetime(),
  sources:z.array(sourceSchema).min(1).max(200),rules:z.array(ruleSchema).min(1).max(2000),}).strict();
const signedSchema=z.object({payload:payloadSchema,checksum:z.string().regex(/^[a-f0-9]{64}$/),algorithm:z.literal("Ed25519"),keyId:id,signature:z.string().max(1000)}).strict();
export const validatePolicySource=(input:unknown)=>sourceSchema.parse(input);
export const validatePolicyRule=(input:unknown)=>ruleSchema.parse(input);

/** Stable UTF-8 JSON. No executable rules, regexes, functions or platform secrets are accepted. */
export function canonicalPolicyJson(value:unknown):string {
  if(value===null||typeof value==="boolean"||typeof value==="string")return JSON.stringify(value);
  if(typeof value==="number"){if(!Number.isFinite(value))throw new Error("POLICY_JSON_INVALID");return JSON.stringify(value)}
  if(Array.isArray(value))return`[${value.map(canonicalPolicyJson).join(",")}]`;
  if(typeof value==="object"){
    const object=value as Record<string,unknown>;return`{${Object.keys(object).sort().map(key=>`${JSON.stringify(key)}:${canonicalPolicyJson(object[key])}`).join(",")}}`;
  }
  throw new Error("POLICY_JSON_INVALID");
}
export const policyPackChecksum=(payload:PolicyPackPayload)=>createHash("sha256").update(canonicalPolicyJson(payload),"utf8").digest("hex");
const signedBytes=(pack:Omit<SignedPolicyPack,"signature">)=>Buffer.from(canonicalPolicyJson(pack),"utf8");
export function validatePolicyPackPayload(input:unknown,options:PolicyPackVerificationOptions={}):PolicyPackPayload {
  const payload=payloadSchema.parse(input),now=options.now??new Date(),known=new Set(options.knownSemanticCategories??SEMANTIC_CATEGORIES);
  if(new Set(payload.sources.map(row=>row.id)).size!==payload.sources.length||new Set(payload.rules.map(row=>row.id)).size!==payload.rules.length)throw new Error("POLICY_IDS_DUPLICATED");
  if(payload.effectiveDate==="UNKNOWN"&&options.allowUnknownEffectiveDate===false)throw new Error("POLICY_EFFECTIVE_DATE_UNKNOWN");
  if(payload.effectiveDate!=="UNKNOWN"&&new Date(`${payload.effectiveDate}T00:00:00Z`)>now)throw new Error("POLICY_NOT_EFFECTIVE");
  if(new Date(payload.issuedAt).getTime()>now.getTime()+300000)throw new Error("POLICY_ISSUED_IN_FUTURE");
  const sourceIds=new Set(payload.sources.map(row=>row.id));
  if(payload.sources.some(source=>source.platform!==payload.platform||source.country!==payload.country||source.region!==payload.region))throw new Error("POLICY_SCOPE_MISMATCH");
  if(payload.sources.some(source=>source.effectiveDate!=="UNKNOWN"&&new Date(`${source.effectiveDate}T00:00:00Z`)>now))throw new Error("POLICY_NOT_EFFECTIVE");
  if(options.allowUnknownEffectiveDate===false&&payload.sources.some(source=>source.effectiveDate==="UNKNOWN"))throw new Error("POLICY_EFFECTIVE_DATE_UNKNOWN");
  for(const rule of payload.rules){
    if(rule.sourceIds.some(sourceId=>!sourceIds.has(sourceId)))throw new Error("POLICY_RULE_SOURCE_MISSING");
    if(rule.semanticCategories.some(category=>!known.has(category)))throw new Error("POLICY_SEMANTIC_CATEGORY_UNKNOWN");
    if(rule.sourceIds.some(sourceId=>rule.contentTypes.some(channel=>!payload.sources.find(source=>source.id===sourceId)!.contentTypes.includes(channel))))throw new Error("POLICY_CHANNEL_SCOPE_MISMATCH");
    if(rule.sourceIds.some(sourceId=>{const source=payload.sources.find(row=>row.id===sourceId)!;return !source.categories.includes("GENERAL")&&!source.categories.includes("*")&&rule.categories.some(category=>!source.categories.includes(category))}))throw new Error("POLICY_CATEGORY_SCOPE_MISMATCH");
  }
  return payload;
}
export function signPolicyPack(input:PolicyPackPayload,keyId:string,privateKey:string|KeyObject,options:PolicyPackVerificationOptions={}):SignedPolicyPack {
  id.parse(keyId);
  const payload=validatePolicyPackPayload(input,options),key=typeof privateKey==="string"?createPrivateKey(privateKey):privateKey;
  if(key.asymmetricKeyType!=="ed25519"||key.type!=="private")throw new Error("POLICY_SIGNING_KEY_INVALID");
  const envelope:Omit<SignedPolicyPack,"signature">={payload,checksum:policyPackChecksum(payload),algorithm:"Ed25519",keyId};
  return{...envelope,signature:sign(null,signedBytes(envelope),key).toString("base64")};
}
export function verifySignedPolicyPack(input:unknown,trustedKeys:Readonly<Record<string,string|KeyObject>>,options:PolicyPackVerificationOptions={}):PolicyPackPayload {
  const pack=signedSchema.parse(input),payload=validatePolicyPackPayload(pack.payload,options),trusted=Object.hasOwn(trustedKeys,pack.keyId)?trustedKeys[pack.keyId]:undefined;
  if(!trusted)throw new Error("POLICY_SIGNER_UNTRUSTED");
  if(policyPackChecksum(payload)!==pack.checksum)throw new Error("POLICY_CHECKSUM_MISMATCH");
  const signature=Buffer.from(pack.signature,"base64");
  if(signature.length!==64||signature.toString("base64")!==pack.signature)throw new Error("POLICY_SIGNATURE_INVALID");
  const key=typeof trusted==="string"?createPublicKey(trusted):trusted;
  if(key.asymmetricKeyType!=="ed25519"||key.type!=="public")throw new Error("POLICY_VERIFICATION_KEY_INVALID");
  if(!verify(null,signedBytes({payload,checksum:pack.checksum,algorithm:pack.algorithm,keyId:pack.keyId}),key,signature))throw new Error("POLICY_SIGNATURE_INVALID");
  return structuredClone(payload);
}
