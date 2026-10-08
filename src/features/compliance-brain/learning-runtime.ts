import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {z} from "zod";
import {SEMANTIC_CATEGORIES} from "./contracts";
import {categoryRisk} from "./engine";
import {ComplianceLearning,LEARNING_PRODUCT_CATEGORIES,persistLearningPattern} from "./learning";
import type {LearnedCompliancePattern,LearningObservation,LearningProductCategory} from "./learning";

export const MINIMUM_GLOBAL_LEARNING_TENANTS=5;
export const LEARNING_SNAPSHOT_LIMIT=5000;
const policyVersionSchema=z.string().min(1).max(120);
const observationRow=z.object({event_id:z.uuid(),owner_id:z.uuid(),decision_id:z.uuid(),
  event_type:z.enum(["content_generated","compliance_flag","human_edit","publish","platform_warning",
    "violation","appeal_submitted","appeal_accepted","appeal_rejected","content_removed"]),
  source:z.enum(["SYSTEM","HUMAN_CORRECTION","OFFICIAL_PLATFORM"]),policy_version:policyVersionSchema,
  semantic_categories:z.array(z.enum(SEMANTIC_CATEGORIES)),category:z.string().max(160),country:z.string().regex(/^[A-Z]{2}$/),
  platform:z.enum(["TIKTOK","TIKTOK_SHOP"]),channel:z.enum(["POST","LIVE"]),risk_score:z.number().min(0).max(100),
  decision:z.enum(["PASS","PASS_WITH_WARNING","AUTO_REWRITE","REVIEW_REQUIRED","BLOCK"]),
  observed_at:z.iso.datetime({offset:true})}).strict();
const snapshotSchema=z.object({snapshot_at:z.iso.datetime({offset:true}),complete:z.boolean(),
  observations:z.array(observationRow).max(LEARNING_SNAPSHOT_LIMIT)}).strict();
type ObservationRow=z.infer<typeof observationRow>;
export interface ComplianceLearningRefresh {
  policyVersion:string;snapshotAt:string;feedbackCount:number;observationCount:number;
  persistedPatternCount:number;cohortSuppressedPatternCount:number;shadowEvaluatedCount:number;shadowUnavailableCount:number;
}

function learningCategory(value:string):LearningProductCategory {
  const normalized=value.toUpperCase();
  return LEARNING_PRODUCT_CATEGORIES.includes(normalized as LearningProductCategory)?normalized as LearningProductCategory:"OTHER";
}

/** No free text, product/account IDs, or platform reason fields cross this projection. */
export function createLearningObservations(rows:readonly ObservationRow[],policyVersion:string):LearningObservation[] {
  const valid=rows.map(row=>observationRow.parse(row));
  if(valid.some(row=>row.policy_version!==policyVersion))throw new Error("compliance_learning_scope_invalid");
  const caseKey=(row:ObservationRow)=>`${row.owner_id}:${row.decision_id}`;
  const priorAdverseEvents=new Map<string,number>();
  for(const row of valid) {
    if(row.source==="OFFICIAL_PLATFORM"&&["platform_warning","violation","content_removed"].includes(row.event_type)) {
      const key=caseKey(row),at=Date.parse(row.observed_at);
      priorAdverseEvents.set(key,Math.min(priorAdverseEvents.get(key)??Infinity,at));
    }
  }
  const observations:LearningObservation[]=[];
  // One decision/outcome is one sample even if an importer retries with a different event key.
  const seen=new Set<string>();
  for(const row of valid.toSorted((a,b)=>a.observed_at.localeCompare(b.observed_at)||a.event_id.localeCompare(b.event_id))) {
    if(["publish","appeal_submitted"].includes(row.event_type))continue;
    if(row.source==="SYSTEM"&&!["content_generated","compliance_flag"].includes(row.event_type)
      ||row.source==="HUMAN_CORRECTION"&&row.event_type!=="human_edit"
      ||row.source==="OFFICIAL_PLATFORM"&&!["platform_warning","violation","appeal_accepted","appeal_rejected","content_removed"].includes(row.event_type))continue;
    if(["appeal_accepted","appeal_rejected"].includes(row.event_type)
      &&(priorAdverseEvents.get(caseKey(row))??Infinity)>Date.parse(row.observed_at))continue;
    for(const semanticCategory of new Set(row.semantic_categories)) {
      const identity=`${caseKey(row)}:${row.event_type}:${semanticCategory}`;
      if(seen.has(identity))continue;
      seen.add(identity);
      observations.push({eventId:`${row.decision_id}:${row.event_type}`,ownerId:row.owner_id,eventType:row.event_type,
        policyVersion,semanticCategory,category:learningCategory(row.category),country:row.country,platform:row.platform,
        channel:row.channel,riskScore:row.risk_score,
        source:row.source==="SYSTEM"?"SHADOW_EVALUATION":row.source});
    }
  }
  return observations;
}

export type LearnedShadowOutcome="WOULD_BLOCK"|"WOULD_REWRITE"|"NO_CHANGE"|"UNAVAILABLE"|"NO_MATCH";
type ShadowSignal=Pick<LearningObservation,"policyVersion"|"semanticCategory"|"category"|"country"|"platform"|"channel">;

/** Statistical candidate replay only. Customer verdicts and sales do not participate in this evaluation. */
export function evaluateLearnedShadowCandidate(pattern:LearnedCompliancePattern,signal:ShadowSignal):LearnedShadowOutcome {
  if(["policyVersion","semanticCategory","category","country","platform","channel"].some(key=>
    pattern[key as keyof ShadowSignal]!==signal[key as keyof ShadowSignal]))return "NO_MATCH";
  if(pattern.lifecycle!=="SHADOW"||pattern.sampleCount<10||pattern.tenantCount<MINIMUM_GLOBAL_LEARNING_TENANTS
    ||pattern.confidence<0.6||!Number.isFinite(pattern.riskScore))return "UNAVAILABLE";
  const thresholds={LOW:{block:95,rewrite:70},MEDIUM:{block:90,rewrite:60},HIGH:{block:85,rewrite:50},CRITICAL:{block:80,rewrite:40}};
  const profile=thresholds[categoryRisk(pattern.category)];
  return pattern.riskScore>=profile.block?"WOULD_BLOCK":pattern.riskScore>=profile.rewrite?"WOULD_REWRITE":"NO_CHANGE";
}

export function replayLearnedShadowCandidate(pattern:LearnedCompliancePattern,observations:readonly LearningObservation[]):LearnedCompliancePattern {
  let evaluated=0,unavailable=0,block=0,rewrite=0;
  const seen=new Set<string>();
  for(const signal of observations) {
    // Only immutable initial decision signals measure candidate behavior; feedback retries cannot inflate shadow results.
    if(signal.source!=="SHADOW_EVALUATION"||!["content_generated","compliance_flag"].includes(signal.eventType))continue;
    const identity=`${signal.ownerId}:${signal.eventId}`;
    if(seen.has(identity))continue;
    seen.add(identity);
    const outcome=evaluateLearnedShadowCandidate(pattern,signal);
    if(outcome==="NO_MATCH")continue;
    if(outcome==="UNAVAILABLE"){unavailable++;continue;}
    evaluated++;
    if(outcome==="WOULD_BLOCK")block++;
    if(outcome==="WOULD_REWRITE")rewrite++;
  }
  return {...pattern,shadowWouldBlock:block,shadowWouldRewrite:rewrite,shadowEvaluatedCount:evaluated,shadowUnavailableCount:unavailable};
}

/** Complete bounded snapshots only; candidates never activate policy packs or alter a customer verdict. */
export async function refreshComplianceLearning(client:SupabaseClient,policyVersion:string):Promise<ComplianceLearningRefresh> {
  policyVersionSchema.parse(policyVersion);
  const response=await client.rpc("read_compliance_brain_learning_observations",{p_policy_version:policyVersion,p_limit:LEARNING_SNAPSHOT_LIMIT});
  if(response.error)throw new Error("compliance_learning_snapshot_unavailable");
  const parsed=snapshotSchema.safeParse(response.data);
  if(!parsed.success)throw new Error("compliance_learning_snapshot_invalid");
  const snapshot=parsed.data;
  if(!snapshot.complete)throw new Error("compliance_learning_snapshot_limit_exceeded");
  const observations=createLearningObservations(snapshot.observations,policyVersion);
  const patterns=new ComplianceLearning().aggregate(observations).map(pattern=>replayLearnedShadowCandidate(pattern,observations));
  const eligible=patterns.filter(pattern=>pattern.tenantCount>=MINIMUM_GLOBAL_LEARNING_TENANTS
    &&pattern.sampleCount>=MINIMUM_GLOBAL_LEARNING_TENANTS);
  for(const pattern of eligible)await persistLearningPattern(client,pattern,undefined,snapshot.snapshot_at);
  return {policyVersion,snapshotAt:snapshot.snapshot_at,feedbackCount:snapshot.observations.length,
    observationCount:observations.length,persistedPatternCount:eligible.length,
    cohortSuppressedPatternCount:patterns.length-eligible.length,
    shadowEvaluatedCount:eligible.reduce((sum,pattern)=>sum+pattern.shadowEvaluatedCount,0),
    shadowUnavailableCount:eligible.reduce((sum,pattern)=>sum+pattern.shadowUnavailableCount,0)};
}

export async function refreshComplianceLearningForDecision(client:SupabaseClient,ownerId:string,decisionId:string):Promise<ComplianceLearningRefresh|null> {
  z.uuid().parse(ownerId);z.uuid().parse(decisionId);
  const result=await client.from("compliance_brain_decisions").select("id,owner_id,policy_version")
    .eq("owner_id",ownerId).eq("id",decisionId).maybeSingle();
  if(result.error||!result.data)throw new Error("compliance_learning_decision_unavailable");
  if(result.data.id!==decisionId||result.data.owner_id!==ownerId)throw new Error("compliance_learning_scope_invalid");
  if(result.data.policy_version===null)return null;
  return refreshComplianceLearning(client,policyVersionSchema.parse(result.data.policy_version));
}
