import type {KeyObject} from "node:crypto";
import type {SignedPolicyPack,PolicyPackVerificationOptions} from "./policy-pack";
import {canonicalPolicyJson,validatePolicyRule,validatePolicySource,validatePolicyPackPayload,verifySignedPolicyPack} from "./policy-pack";
import {normalizePolicyText,policySourceHash,isOfficialPolicyUrl} from "./policy-ingestion";

export type PolicyLifecycleStatus="DISCOVERED"|"PARSED"|"VALIDATED"|"ACTIVE"|"RETIRED";
export type PolicyDate=string|"UNKNOWN";
export interface PolicyScope {platform:string;country:string;region:string}
export interface PolicySource extends PolicyScope {
  id:string;url:string;title:string;sourceHash:string;hashBasis:"NORMALIZED_TEXT_V1";
  retrievedAt:string;publishedAt?:PolicyDate;effectiveDate:PolicyDate;version:string;
  contentTypes:Array<"POST"|"LIVE">;categories:string[];
}
export interface PolicyRule {
  id:string;version:string;sourceIds:string[];semanticCategories:string[];obligation:string;
  severity:"LOW"|"MEDIUM"|"HIGH"|"CRITICAL";
  recommendedDecision:"BLOCK"|"REVIEW_REQUIRED"|"AUTO_REWRITE"|"PASS_WITH_WARNING";
  contentTypes:Array<"POST"|"LIVE">;categories:string[];requiresEvidence:boolean;
}
export interface PolicyPackPayload extends PolicyScope {
  schemaVersion:1;id:string;version:string;effectiveDate:PolicyDate;issuedAt:string;
  sources:PolicySource[];rules:PolicyRule[];
}
export interface PolicyAdminAuthorization {actorId:string;approvalId:string}
export interface PolicyValidation {
  approvedBy:string;approvalId:string;validatedAt:string;regressionReportHash:string;
  regressionPassed:number;regressionFailed:0;unknownEffectiveDateAcknowledged:boolean;
}
export interface PolicyCandidate {
  id:string;source:PolicySource;sourceText:string;status:PolicyLifecycleStatus;
  parserOrigin:"AI"|"HUMAN"|"DETERMINISTIC"|null;rules:PolicyRule[];
  previousSourceHash:string|null;changedObligations:string[];validation:PolicyValidation|null;
}
export interface PolicyRegistryState {
  version:1;candidates:PolicyCandidate[];packs:Record<string,SignedPolicyPack>;
  active:Record<string,string>;disabledScopes:string[];
}
export interface PolicyRegistryStore {
  /** Production adapters serialize read/mutate/write across processes, or use a database transaction. */
  withMutationLock?<T>(mutation:()=>Promise<T>):Promise<T>;
  readState():Promise<PolicyRegistryState>;
  writeState(state:PolicyRegistryState):Promise<void>;
  readLastKnownGood(scopeKey:string):Promise<SignedPolicyPack|null>;
  writeLastKnownGood(scopeKey:string,pack:SignedPolicyPack):Promise<void>;
  /** A durable tombstone prevents a corrupt primary state from undoing an admin disable. */
  disableLastKnownGood?(scopeKey:string):Promise<void>;
}
export interface PolicyResolution {pack:PolicyPackPayload|null;source:"ACTIVE"|"LAST_KNOWN_GOOD"|"NONE";errorCodes:string[]}
export const policyScopeKey=(scope:PolicyScope)=>`${scope.platform}:${scope.country}:${scope.region}`;
export const policyPackKey=(pack:PolicyPackPayload)=>`${pack.id}@${pack.version}`;
export const emptyPolicyRegistryState=():PolicyRegistryState=>({version:1,candidates:[],packs:{},active:{},disabledScopes:[]});

/** The caller supplies a server authority check; absent authority always denies mutations. */
export class PolicyRegistry {
  private pendingMutation:Promise<unknown>=Promise.resolve();
  constructor(private readonly store:PolicyRegistryStore,private readonly trustedKeys:Readonly<Record<string,string|KeyObject>>,
    private readonly authorizeAdmin:(authorization:PolicyAdminAuthorization)=>Promise<boolean>=async()=>false,
    private readonly options:PolicyPackVerificationOptions={}){}
  private mutate<T>(mutation:()=>Promise<T>):Promise<T>{
    const locked=()=>this.store.withMutationLock?this.store.withMutationLock(mutation):mutation();
    const result=this.pendingMutation.then(locked,locked);this.pendingMutation=result.catch(()=>undefined);return result;
  }
  private async requireAdmin(authorization:PolicyAdminAuthorization){
    if(!authorization.actorId.trim()||!authorization.approvalId.trim()||!await this.authorizeAdmin(authorization))throw new Error("POLICY_ADMIN_REQUIRED");
  }
  private async state(){
    const state=await this.store.readState();
    if(state.version!==1||!Array.isArray(state.candidates)||!state.packs||!state.active||!Array.isArray(state.disabledScopes))throw new Error("POLICY_STATE_INVALID");
    return structuredClone(state);
  }
  async discover(source:PolicySource,sourceText:string,previousSourceHash:string|null=null){
    return this.mutate(async()=>{
    validatePolicySource(source);
    if(!isOfficialPolicyUrl(source.url)||source.sourceHash!==policySourceHash(sourceText))throw new Error("POLICY_SOURCE_INVALID");
    const state=await this.state(),id=`${source.id}:${source.sourceHash}`;
    const existing=state.candidates.find(row=>row.id===id);if(existing)return structuredClone(existing);
    const candidate:PolicyCandidate={id,source:structuredClone(source),sourceText:normalizePolicyText(sourceText),status:"DISCOVERED",parserOrigin:null,rules:[],previousSourceHash,changedObligations:[],validation:null};
    state.candidates.push(candidate);await this.store.writeState(state);return structuredClone(candidate);
    });
  }
  async parseCandidate(id:string,rules:PolicyRule[],parserOrigin:"AI"|"HUMAN"|"DETERMINISTIC",changedObligations:string[]=[]){
    return this.mutate(async()=>{
    const state=await this.state(),candidate=state.candidates.find(row=>row.id===id);
    if(!candidate||candidate.status!=="DISCOVERED")throw new Error("POLICY_TRANSITION_INVALID");
    if(!rules.length||rules.some(rule=>!rule.sourceIds.includes(candidate.source.id)))throw new Error("POLICY_RULE_SOURCE_MISSING");
    rules.forEach(validatePolicyRule);
    if(!["AI","HUMAN","DETERMINISTIC"].includes(parserOrigin))throw new Error("POLICY_PARSER_ORIGIN_INVALID");
    candidate.rules=structuredClone(rules);candidate.parserOrigin=parserOrigin;
    candidate.changedObligations=[...changedObligations];candidate.status="PARSED";
    await this.store.writeState(state);return structuredClone(candidate);
    });
  }
  async validateCandidate(id:string,input:{regressionReportHash:string;regressionPassed:number;regressionFailed:number;unknownEffectiveDateAcknowledged:boolean},authorization:PolicyAdminAuthorization){
    return this.mutate(async()=>{
    await this.requireAdmin(authorization);
    const state=await this.state(),candidate=state.candidates.find(row=>row.id===id);
    if(!candidate||candidate.status!=="PARSED")throw new Error("POLICY_TRANSITION_INVALID");
    if(!/^[a-f0-9]{64}$/.test(input.regressionReportHash)||!Number.isInteger(input.regressionPassed)||input.regressionPassed<1||input.regressionFailed!==0)throw new Error("POLICY_REGRESSION_REQUIRED");
    if(candidate.source.effectiveDate==="UNKNOWN"&&!input.unknownEffectiveDateAcknowledged)throw new Error("POLICY_EFFECTIVE_DATE_UNKNOWN");
    if(candidate.source.sourceHash!==policySourceHash(candidate.sourceText))throw new Error("POLICY_SOURCE_HASH_MISMATCH");
    validatePolicyPackPayload({schemaVersion:1,platform:candidate.source.platform,country:candidate.source.country,region:candidate.source.region,
      effectiveDate:candidate.source.effectiveDate,id:`candidate.${candidate.source.id}`,version:candidate.source.version,
      issuedAt:(this.options.now??new Date()).toISOString(),sources:[candidate.source],rules:candidate.rules,
    },this.options);
    candidate.status="VALIDATED";candidate.validation={approvedBy:authorization.actorId,approvalId:authorization.approvalId,validatedAt:(this.options.now??new Date()).toISOString(),regressionReportHash:input.regressionReportHash,regressionPassed:input.regressionPassed,regressionFailed:0,unknownEffectiveDateAcknowledged:input.unknownEffectiveDateAcknowledged};
    await this.store.writeState(state);return structuredClone(candidate);
    });
  }
  private validatedCandidates(state:PolicyRegistryState,payload:PolicyPackPayload){
    return payload.sources.map(source=>{
      const candidate=state.candidates.find(row=>row.source.id===source.id&&row.source.sourceHash===source.sourceHash);
      if(!candidate||!["VALIDATED","ACTIVE","RETIRED"].includes(candidate.status)||!candidate.validation||candidate.validation.regressionFailed!==0||candidate.validation.regressionPassed<1)throw new Error("POLICY_CANDIDATE_NOT_VALIDATED");
      if(source.effectiveDate==="UNKNOWN"&&!candidate.validation.unknownEffectiveDateAcknowledged)throw new Error("POLICY_EFFECTIVE_DATE_UNKNOWN");
      if(candidate.source.sourceHash!==policySourceHash(candidate.sourceText))throw new Error("POLICY_SOURCE_HASH_MISMATCH");
      if(canonicalPolicyJson(candidate.source)!==canonicalPolicyJson(source))throw new Error("POLICY_SOURCE_NOT_VALIDATED");
      const sourceRules=payload.rules.filter(rule=>rule.sourceIds.includes(source.id));
      if(sourceRules.some(rule=>!candidate.rules.some(approved=>canonicalPolicyJson(approved)===canonicalPolicyJson(rule))))throw new Error("POLICY_RULE_NOT_VALIDATED");
      return candidate;
    });
  }
  async activateSignedPack(pack:SignedPolicyPack,authorization:PolicyAdminAuthorization){
    return this.mutate(()=>this.activate(pack,authorization));
  }
  private async activate(pack:SignedPolicyPack,authorization:PolicyAdminAuthorization){
    await this.requireAdmin(authorization);
    const payload=verifySignedPolicyPack(pack,this.trustedKeys,this.options),state=await this.state();
    const candidates=this.validatedCandidates(state,payload),scope=policyScopeKey(payload),key=policyPackKey(payload),previousKey=state.active[scope];
    if(state.packs[key]&&state.packs[key].checksum!==pack.checksum)throw new Error("POLICY_VERSION_IMMUTABLE");
    if(previousKey&&previousKey!==key){
      const previous=state.packs[previousKey];
      for(const candidate of state.candidates)if(previous?.payload.sources.some(source=>source.id===candidate.source.id&&source.sourceHash===candidate.source.sourceHash)&&!candidates.includes(candidate))candidate.status="RETIRED";
    }
    for(const candidate of candidates)candidate.status="ACTIVE";
    state.packs[key]=structuredClone(pack);state.active[scope]=key;state.disabledScopes=state.disabledScopes.filter(row=>row!==scope);
    // A failed state commit must never publish an uncommitted update through the fallback.
    await this.store.writeState(state);await this.store.writeLastKnownGood(scope,pack);return structuredClone(payload);
  }
  async rollback(scope:PolicyScope,targetPackKey:string,authorization:PolicyAdminAuthorization){
    return this.mutate(async()=>{
    await this.requireAdmin(authorization);const state=await this.state(),pack=state.packs[targetPackKey];
    if(!pack||policyScopeKey(pack.payload)!==policyScopeKey(scope))throw new Error("POLICY_ROLLBACK_TARGET_INVALID");
    return this.activate(pack,authorization);
    });
  }
  async deactivate(scope:PolicyScope,authorization:PolicyAdminAuthorization){
    return this.mutate(async()=>{
    await this.requireAdmin(authorization);const state=await this.state(),key=policyScopeKey(scope),pack=state.packs[state.active[key]];
    if(pack)for(const candidate of state.candidates)if(pack.payload.sources.some(source=>source.id===candidate.source.id&&source.sourceHash===candidate.source.sourceHash))candidate.status="RETIRED";
    delete state.active[key];if(!state.disabledScopes.includes(key))state.disabledScopes.push(key);
    await this.store.disableLastKnownGood?.(key);await this.store.writeState(state);
    });
  }
  async loadActive(scope:PolicyScope):Promise<PolicyResolution>{
    const key=policyScopeKey(scope),errors:string[]=[];
    try{
      const state=await this.state();
      if(state.disabledScopes.includes(key))return{pack:null,source:"NONE",errorCodes:["POLICY_ADMIN_DISABLED"]};
      const pack=state.packs[state.active[key]];
      if(pack){const payload=verifySignedPolicyPack(pack,this.trustedKeys,this.options);if(policyScopeKey(payload)!==key)throw new Error("POLICY_SCOPE_MISMATCH");this.validatedCandidates(state,payload);return{pack:structuredClone(payload),source:"ACTIVE",errorCodes:[]}}
    }catch(error){errors.push(error instanceof Error?error.message:"POLICY_LOAD_FAILED")}
    try{
      const last=await this.store.readLastKnownGood(key);
      if(last){const payload=verifySignedPolicyPack(last,this.trustedKeys,this.options);if(policyScopeKey(payload)!==key)throw new Error("POLICY_SCOPE_MISMATCH");return{pack:structuredClone(payload),source:"LAST_KNOWN_GOOD",errorCodes:errors}}
    }catch(error){errors.push(error instanceof Error?error.message:"POLICY_LKG_INVALID")}
    return{pack:null,source:"NONE",errorCodes:[...errors,"POLICY_PACK_UNAVAILABLE"]};
  }
  async listCandidates(){return structuredClone((await this.state()).candidates)}
}

/** Test/local store. Production can inject a service-only database or durable file store. */
export class MemoryPolicyRegistryStore implements PolicyRegistryStore {
  private stateValue=emptyPolicyRegistryState();private readonly last=new Map<string,SignedPolicyPack>();private lock:Promise<unknown>=Promise.resolve();
  withMutationLock<T>(mutation:()=>Promise<T>):Promise<T>{const result=this.lock.then(mutation,mutation);this.lock=result.catch(()=>undefined);return result}
  async readState(){return structuredClone(this.stateValue)}
  async writeState(state:PolicyRegistryState){this.stateValue=structuredClone(state)}
  async readLastKnownGood(key:string){return structuredClone(this.last.get(key)??null)}
  async writeLastKnownGood(key:string,pack:SignedPolicyPack){this.last.set(key,structuredClone(pack))}
  async disableLastKnownGood(key:string){this.last.delete(key)}
}
