import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logOps } from "@/lib/ops/logger";
import { SEMANTIC_CATEGORIES } from "./contracts";
import type { ComplianceChannel, ComplianceDecisionStatus, SemanticCategory } from "./contracts";
import { requirePolicyAdmin } from "./store";
import type { PolicyAdminActor } from "./store";

export const COMPLIANCE_FEEDBACK_EVENTS = ["content_generated","compliance_flag","human_edit","publish","platform_warning",
  "violation","appeal_submitted","appeal_accepted","appeal_rejected","content_removed"] as const;
export type ComplianceFeedbackEvent = typeof COMPLIANCE_FEEDBACK_EVENTS[number];
export type LearningLifecycle = "OBSERVED" | "LEARNED_RISK" | "SHADOW" | "VERIFIED" | "ENFORCED";
export const LEARNING_PRODUCT_CATEGORIES = ["SKINCARE","BEAUTY","HEALTH","GENERAL_COMMERCE","ELECTRONICS","FOOD","HOUSEHOLD","OTHER"] as const;
export type LearningProductCategory = typeof LEARNING_PRODUCT_CATEGORIES[number];
export interface LearningObservation {
  eventId:string; ownerId:string; eventType:ComplianceFeedbackEvent; policyVersion:string;
  semanticCategory:SemanticCategory; category:LearningProductCategory; country:string;
  platform:"TIKTOK"|"TIKTOK_SHOP"; channel:ComplianceChannel; riskScore:number;
  source:"OFFICIAL_PLATFORM"|"HUMAN_CORRECTION"|"SHADOW_EVALUATION";
  shadowDecision?:"BLOCK"|"AUTO_REWRITE";
}
/** This is the complete global DTO. Adding customer identifiers or arbitrary text is intentionally impossible here. */
export interface LearnedCompliancePattern {
  policyVersion:string; semanticCategory:SemanticCategory; category:LearningProductCategory;
  country:string; platform:"TIKTOK"|"TIKTOK_SHOP"; channel:ComplianceChannel;
  lifecycle:LearningLifecycle; evidenceSource:"OFFICIAL_PLATFORM"|"HUMAN_CORRECTION"|"SHADOW_EVALUATION";
  sampleCount:number; tenantCount:number; violationCount:number; appealAcceptedCount:number; appealRejectedCount:number;
  falsePositiveRate:number; confidence:number; riskScore:number; shadowWouldBlock:number; shadowWouldRewrite:number;
  shadowEvaluatedCount:number;shadowUnavailableCount:number;
  approved:boolean;
}
const round = (value:number) => Math.round(value*100000)/100000;
const keyOf = (event:LearningObservation) => [event.policyVersion,event.semanticCategory,event.category,event.country,event.platform,event.channel].join(":");

/** Sales optimization can learn only from content already permitted by compliance. */
export function complianceAllowsOptimization(status:ComplianceDecisionStatus|null|undefined):boolean {
  return status==="PASS"||status==="PASS_WITH_WARNING";
}

export class ComplianceLearning {
  /** Identifiers are used only for in-memory deduplication/cohort size; returned patterns contain none. */
  aggregate(input:readonly LearningObservation[]):LearnedCompliancePattern[] {
    const groups = new Map<string,LearningObservation[]>();
    const seen = new Set<string>();
    for (const event of input) {
      if (!COMPLIANCE_FEEDBACK_EVENTS.includes(event.eventType) || !SEMANTIC_CATEGORIES.includes(event.semanticCategory)
        || !LEARNING_PRODUCT_CATEGORIES.includes(event.category) || !/^[A-Z]{2}$/.test(event.country)
        || !["TIKTOK","TIKTOK_SHOP"].includes(event.platform) || !["POST","LIVE"].includes(event.channel)
        || !["OFFICIAL_PLATFORM","HUMAN_CORRECTION","SHADOW_EVALUATION"].includes(event.source)
        || !Number.isFinite(event.riskScore) || event.riskScore<0 || event.riskScore>100 || !event.policyVersion
        || !event.eventId || !event.ownerId) throw new Error("compliance_learning_input_invalid");
      // Publication/revenue is not evidence that a risky claim should be permitted.
      if (["content_generated","publish","appeal_submitted"].includes(event.eventType)) continue;
      if (["platform_warning","violation","appeal_accepted","appeal_rejected","content_removed"].includes(event.eventType)
        && event.source!=="OFFICIAL_PLATFORM") continue;
      const identity = `${event.ownerId}:${event.eventId}:${keyOf(event)}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const key = keyOf(event);
      groups.set(key,[...(groups.get(key) ?? []),event]);
    }
    return [...groups.values()].map(events => {
      const seed = events[0];
      const count = (type:ComplianceFeedbackEvent) => events.filter(event=>event.eventType===type).length;
      const accepted = count("appeal_accepted"), rejected = count("appeal_rejected"), violations=count("violation")+count("content_removed");
      const corrections=count("human_edit");
      const falsePositiveRate = round((accepted+corrections)/Math.max(1,accepted+rejected+violations+corrections));
      const sampleCount = events.length;
      const confidence = round(sampleCount/(sampleCount+2)*(1-falsePositiveRate));
      return {policyVersion:seed.policyVersion,semanticCategory:seed.semanticCategory,category:seed.category,country:seed.country,
        platform:seed.platform,channel:seed.channel,lifecycle:sampleCount>=10?"SHADOW":sampleCount>=5?"LEARNED_RISK":"OBSERVED",
        evidenceSource:events.some(event=>event.source==="OFFICIAL_PLATFORM")?"OFFICIAL_PLATFORM":seed.source,
        sampleCount,tenantCount:new Set(events.map(event=>event.ownerId)).size,violationCount:violations,
        appealAcceptedCount:accepted,appealRejectedCount:rejected,falsePositiveRate,confidence,
        riskScore:round(Math.max(0,Math.min(100,events.reduce((sum,event)=>sum+event.riskScore,0)/sampleCount+rejected*2-accepted*8-corrections*4))),
        shadowWouldBlock:events.filter(event=>event.shadowDecision==="BLOCK").length,
        shadowWouldRewrite:events.filter(event=>event.shadowDecision==="AUTO_REWRITE").length,
        shadowEvaluatedCount:events.filter(event=>event.shadowDecision!==undefined).length,shadowUnavailableCount:0,approved:false};
    });
  }
  approve(pattern:LearnedCompliancePattern, actor:PolicyAdminActor):LearnedCompliancePattern {
    requirePolicyAdmin(actor);
    if (pattern.lifecycle!=="SHADOW" || pattern.sampleCount<20 || pattern.tenantCount<5 || pattern.confidence<0.9
      || pattern.falsePositiveRate>0.05) throw new Error("compliance_learning_insufficient_validation");
    return {...pattern,lifecycle:"VERIFIED",approved:true};
  }
  enforce(pattern:LearnedCompliancePattern, actor:PolicyAdminActor):LearnedCompliancePattern {
    requirePolicyAdmin(actor);
    if (pattern.lifecycle!=="VERIFIED" || !pattern.approved) throw new Error("compliance_learning_not_verified");
    return {...pattern,lifecycle:"ENFORCED"};
  }
}

const feedbackInput = z.object({ownerId:z.uuid(),decisionId:z.uuid(),eventKey:z.string().min(1).max(160),
  eventType:z.enum(COMPLIANCE_FEEDBACK_EVENTS),source:z.enum(["SYSTEM","HUMAN_CORRECTION","OFFICIAL_PLATFORM"]),
  platformReasonCode:z.string().max(160).optional(),platformReasonText:z.string().max(4000).optional(),
  platformEvidenceRef:z.string().max(2048).optional(),observedAt:z.iso.datetime({offset:true}).optional()}).strict();
const platformEvents:readonly ComplianceFeedbackEvent[]=["platform_warning","violation","appeal_submitted","appeal_accepted","appeal_rejected","content_removed"];

/** An admin imports a notice they have verified in the platform dashboard; this is not an API verification claim. */
export function isOfficialPlatformNoticeReference(reference:string):boolean {
  try {
    const url=new URL(reference);
    return url.protocol==="https:"&&!url.username&&!url.password&&!url.port
      && (url.hostname==="tiktok.com"||url.hostname.endsWith(".tiktok.com"));
  } catch {return false;}
}
export async function recordComplianceFeedback(client:SupabaseClient, input:{ownerId:string;decisionId:string;eventKey:string;
  eventType:ComplianceFeedbackEvent;source:"SYSTEM"|"HUMAN_CORRECTION"|"OFFICIAL_PLATFORM";platformReasonCode?:string;
  platformReasonText?:string;platformEvidenceRef?:string;observedAt?:string},actor?:PolicyAdminActor) {
  feedbackInput.parse(input);
  if (input.source!=="SYSTEM") requirePolicyAdmin(actor??null);
  if (input.source==="SYSTEM"&&!["content_generated","compliance_flag","publish"].includes(input.eventType)
    || input.source==="HUMAN_CORRECTION"&&input.eventType!=="human_edit"
    || input.source==="OFFICIAL_PLATFORM"&&(!platformEvents.includes(input.eventType)
      || !input.platformEvidenceRef || !isOfficialPlatformNoticeReference(input.platformEvidenceRef))) {
    throw new Error("compliance_feedback_source_invalid");
  }
  if(input.observedAt&&Date.parse(input.observedAt)>Date.now())throw new Error("compliance_feedback_time_invalid");
  const result = await client.rpc("append_compliance_brain_feedback",{p_feedback:{owner_id:input.ownerId,decision_id:input.decisionId,
    event_key:input.eventKey,event_type:input.eventType,source:input.source,platform_reason_code:input.platformReasonCode??null,
    platform_reason_text:input.platformReasonText??null,platform_evidence_ref:input.platformEvidenceRef??null,
    observed_at:input.observedAt??new Date().toISOString()}});
  if (result.error || typeof result.data!=="string") throw new Error("compliance_feedback_record_failed");
  try {
    const {refreshComplianceLearningForDecision}=await import("./learning-runtime");
    return {feedbackId:result.data,learning:await refreshComplianceLearningForDecision(client,input.ownerId,input.decisionId),learningPending:false};
  } catch {
    // Feedback is already durable and idempotent. An admin can retry the bounded refresh separately.
    logOps({severity:"WARN",component:"compliance-learning",operation:"feedback-refresh",error_category:"DATABASE",
      error_code:"compliance_learning_refresh_pending"});
    return {feedbackId:result.data,learning:null,learningPending:true};
  }
}
export async function persistLearningPattern(client:SupabaseClient, pattern:LearnedCompliancePattern,actor?:PolicyAdminActor,snapshotAt?:string) {
  if(pattern.approved||["VERIFIED","ENFORCED"].includes(pattern.lifecycle))requirePolicyAdmin(actor??null);
  const result = await client.rpc("upsert_compliance_brain_learning_pattern",{p_pattern:{policy_version:pattern.policyVersion,
    semantic_category:pattern.semanticCategory,category:pattern.category,country:pattern.country,platform:pattern.platform,channel:pattern.channel,
    lifecycle:pattern.lifecycle,evidence_source:pattern.evidenceSource,sample_count:pattern.sampleCount,tenant_count:pattern.tenantCount,
    violation_count:pattern.violationCount,appeal_accepted_count:pattern.appealAcceptedCount,appeal_rejected_count:pattern.appealRejectedCount,
    false_positive_rate:pattern.falsePositiveRate,confidence:pattern.confidence,risk_score:pattern.riskScore,
    shadow_would_block:pattern.shadowWouldBlock,shadow_would_rewrite:pattern.shadowWouldRewrite,approved:pattern.approved,
    shadow_evaluated_count:pattern.shadowEvaluatedCount,shadow_unavailable_count:pattern.shadowUnavailableCount,
    ...(snapshotAt?{observed_at:z.iso.datetime({offset:true}).parse(snapshotAt)}:{})},p_actor:actor?.id??null});
  if (result.error || typeof result.data!=="string") throw new Error("compliance_learning_record_failed");
  return result.data;
}
