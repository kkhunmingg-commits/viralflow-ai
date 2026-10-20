import type {CreativeContext} from "./types";
import type {CreativeIntelligenceResources} from "./intelligence";
import type {VideoMetrics,AnalyticsSource} from "../analytics/types";
import {analyzeCreativeLearning} from "../analytics/creative-learning";
import {runCreativeAgent,CREATIVE_AGENT_VERSION} from "./agent";
import type {StructuredCreativeProvider} from "./providers";
import {strategyEvidenceDigest,strategyFingerprint,type CreativeStrategyInput} from "./strategist";
import {createAdaptiveArm,decideAdaptiveExperiment,type AdaptiveArm,type AdaptiveOutcome,type AdaptiveProposalRecord} from "../growth/adaptive-experiments";
import {analyzeTrendIntelligence} from "../growth-manager/topics";
import type {TrendDiscoveryReport} from "../growth-manager/trend-discovery";

export const SELF_LEARNING_VERSION="account-evidence-learning-v1";
export interface CreativeAttribution {
  version:typeof SELF_LEARNING_VERSION; ownerId:string; arm:AdaptiveArm;
  spokenHook:string; format:string; conceptId:string; planFingerprint:string; scriptDigest:string;
  decision:AdaptiveProposalRecord|null; createdAt:string; fingerprint:string;
}
export interface CreativeLearningHistory {
  attribution:CreativeAttribution; evidenceId:string; videoId:string; source:AnalyticsSource;
  publishedAt:string|null; observedAt:string; metrics:VideoMetrics;
  /** New followers TikTok Studio attributes to this post; only owner-imported reports carry it today. */
  newFollowers?:number|null;
}
export function sealCreativeAttribution(value:Omit<CreativeAttribution,"version"|"fingerprint">):CreativeAttribution{
  const payload={...value,version:SELF_LEARNING_VERSION as typeof SELF_LEARNING_VERSION};
  return {...payload,fingerprint:strategyEvidenceDigest(payload)};
}
/** Read only provenance tied to the same reviewed creative plan; edits are not retroactive audience evidence. */
export function readCreativeAttribution(metadata:unknown,scope:{ownerId:string;accountId:string;mode:string}):CreativeAttribution|null{
  try{
    if(!metadata||typeof metadata!=="object")return null;
    const row=metadata as Record<string,unknown>,record=row.creativeAttribution as CreativeAttribution;
    const stored=row.productionStrategy as {plan:Parameters<typeof strategyFingerprint>[0]&{fingerprint:string};conceptId:string;scriptDigest:string};
    if(!record||record.version!==SELF_LEARNING_VERSION||record.ownerId!==scope.ownerId||record.arm.ownerId!==scope.ownerId||
      record.arm.accountId!==scope.accountId||record.arm.mode!==scope.mode||createAdaptiveArm(record.arm).id!==record.arm.id||
      !stored||record.conceptId!==stored.conceptId||record.scriptDigest!==stored.scriptDigest||
      stored.plan.accountId!==scope.accountId||record.planFingerprint!==stored.plan.fingerprint||strategyFingerprint(stored.plan)!==record.planFingerprint)return null;
    const selected=stored.plan.concepts.find(c=>c.id===record.conceptId);
    if(!selected||selected.status==="REJECTED"||!selected.production.ready||record.spokenHook!==selected.concept.hook||
      record.arm.productionMethod!==selected.production.method||record.scriptDigest!==strategyEvidenceDigest([selected.concept.hook,
        selected.concept.voiceScript,selected.concept.cta,selected.concept.caption,selected.concept.scenePlan,selected.concept.overlayText]))return null;
    const {fingerprint,...payload}=record;
    return fingerprint===strategyEvidenceDigest(payload)?record:null;
  }catch{return null;}
}

/** Only owner-imported Studio reports carry per-post followers; API rows keep them unknown, and verified
 * ROI stays unknown everywhere. The engagement objective must never be reported as follower growth/sales. */
export function adaptiveHistoryOutcomes(history:readonly CreativeLearningHistory[]):AdaptiveOutcome[]{
  return history.map(row=>({evidenceId:row.evidenceId,ownerId:row.attribution.ownerId,accountId:row.attribution.arm.accountId,
    mode:row.attribution.arm.mode,contextKey:row.attribution.arm.contextKey,armId:row.attribution.arm.id,videoId:row.videoId,
    source:row.source==="MOCK"?"SIMULATED":row.source==="OWNER_REPORT_IMPORT"?"OWNER_REPORTED":row.source,authorized:row.source!=="MOCK",publishedAt:row.publishedAt,
    observedAt:row.observedAt,window:row.publishedAt?{startAt:row.publishedAt,endAt:row.observedAt,complete:true}:null,
    views:row.metrics.views,likes:row.metrics.likes,comments:row.metrics.comments,shares:row.metrics.shares,
    ...(row.source==="OWNER_REPORT_IMPORT"&&typeof row.newFollowers==="number"?{attributedFollowers:row.newFollowers,followerAttribution:"VIDEO" as const}
      :{attributedFollowers:null,followerAttribution:"UNKNOWN" as const}),orders:row.metrics.orders,
    commissionUsd:null,actualCostUsd:null,salesAttribution:"UNKNOWN",commerceVerified:false,costBasis:"UNKNOWN"}));
}

/** An existing scheduled item supplies capacity. This function proposes content,
 * not posting frequency, consent, paid-video authorization or learned policy rules. */
export async function planSelfLearningCreative(context:CreativeContext,resources:CreativeIntelligenceResources,
  provider:StructuredCreativeProvider,options:{cycleKey:string;availableSlots:number;discovery?:TrendDiscoveryReport;
    environment?:"REAL"|"SIMULATED";outcomes?:AdaptiveOutcome[];historicalArms?:AdaptiveArm[];ledger?:AdaptiveProposalRecord[]} ){
  const environment=options.environment??"REAL";
  if(!Number.isSafeInteger(options.availableSlots)||options.availableSlots<=0)throw new Error("CREATIVE_PLANNER_CAPACITY_REQUIRED");
  if(environment==="REAL"&&(!resources.realAccount||!resources.optedIn))throw new Error("CREATIVE_ACCOUNT_AUTOMATION_NOT_AUTHORIZED");
  const contextKey=context.account.mode==="AFFILIATE"?`product:${context.product.id}`:"organic-growth";
  const adaptiveContext={ownerId:resources.ownerId,accountId:context.account.id,mode:context.account.mode,
    contextKey,environment,optedIn:resources.optedIn,affiliateEligible:resources.affiliateEligible};
  const history=resources.adaptiveHistory??[];
  const historyArms=options.historicalArms??history.map(r=>r.attribution.arm);
  const outcomes=options.outcomes??adaptiveHistoryOutcomes(history);
  const ledger=options.ledger??history.flatMap(r=>r.attribution.decision?[r.attribution.decision]:[]);
  let objective: "ENGAGEMENT_PER_VIEW"|undefined;
  let before=decideAdaptiveExperiment({context:adaptiveContext,cycleKey:options.cycleKey,now:resources.now,
    observationWindowHours:24,availableSlots:options.availableSlots,arms:historyArms,outcomes,ledger,objective});
  if(before.status==="ALREADY_PROPOSED"||before.status==="REVIEW_REQUIRED")throw new Error("CREATIVE_EXPERIMENT_ALREADY_PROPOSED");
  if(context.account.mode==="GROWTH"&&!before.assessments.some(a=>a.metrics.followersPer1000Views!==null)){
    objective="ENGAGEMENT_PER_VIEW";
    before=decideAdaptiveExperiment({context:adaptiveContext,cycleKey:options.cycleKey,now:resources.now,
      observationWindowHours:24,availableSlots:options.availableSlots,arms:historyArms,outcomes,ledger,objective});
  }
  if(options.discovery&&options.discovery.accountId!==context.account.id)throw new Error("CREATIVE_TREND_ACCOUNT_MISMATCH");
  const trend=options.discovery?.intelligence??analyzeTrendIntelligence(resources.trends,{accountId:context.account.id,
    region:resources.region,audienceSegments:resources.audienceSegments,
    productCategoryKey:context.account.mode==="AFFILIATE"?context.product.category:undefined},resources.now);
  const learning=analyzeCreativeLearning(resources.outcomes,{ownerId:resources.ownerId,accountId:context.account.id,
    mode:context.account.mode,optedIn:resources.optedIn&&resources.realAccount,affiliateEligible:resources.affiliateEligible},resources.now);
  const input:CreativeStrategyInput={now:resources.now,account:{id:context.account.id,mode:context.account.mode,affiliateEligible:resources.affiliateEligible},
    product:context.account.mode==="AFFILIATE"?{id:context.product.id,title:context.product.title,mechanism:resources.mechanism??"UNKNOWN"}:undefined,
    facts:resources.facts,assets:resources.assets,costs:resources.costs,trends:trend,history:resources.storyHistory,
    learning:{accountId:context.account.id,source:environment==="REAL"?"REAL":"MOCK",evidenceIds:learning.evidenceIds,
      preferredAngle:learning.preferredAngle,preferredHook:learning.preferredHook,confidence:learning.confidence}};
  const generated=await runCreativeAgent(input,provider,{trendEvidence:options.discovery?{accountId:options.discovery.accountId,
    sources:options.discovery.sources.map(s=>({id:s.id,domain:s.domain,status:s.status,reason:s.reason})),candidates:options.discovery.candidates,
    globalTikTokTrendStatus:options.discovery.globalTikTokTrendStatus}:null,learningEvidence:{source:environment,objective:before.objective,
    historicalArms:historyArms.filter(a=>a.ownerId===resources.ownerId&&a.accountId===context.account.id&&a.mode===context.account.mode&&a.contextKey===contextKey),
    assessments:before.assessments,preferredArmId:before.preferredArmId,
    note:"Keep exact semantic feature labels when deliberately repeating a proven pattern; invent a new pattern when exploring. Association is not causal proof or a viral guarantee."}});
  const candidates=generated.plan.concepts.filter(c=>c.production.ready&&c.status!=="REJECTED").map(c=>{
    const idea=generated.output.concepts.find(i=>i.id===c.id)!;
    let arm=createAdaptiveArm({ownerId:resources.ownerId,accountId:context.account.id,mode:context.account.mode,contextKey,hook:idea.hookPattern,angle:idea.angle,topic:idea.topic,
      productionMethod:c.production.method,introducedAt:resources.now.toISOString()});
    const prior=historyArms.find(a=>a.id===arm.id);if(prior)arm=prior;
    return {conceptId:c.id,arm};
  });
  // With no comparable real results there is nothing to learn from, so the model's own reasoned pick stands
  // (when it passed the gates) instead of a random draw among its ideas. Real results switch this back to the experiment.
  const modelPick=candidates.find(c=>c.conceptId===generated.plan.selectedConceptId);
  const coldStart=!before.preferredArmId&&!before.assessments.some(a=>a.eligibleForExploitation);
  const decision=decideAdaptiveExperiment({context:adaptiveContext,cycleKey:options.cycleKey,now:resources.now,
    observationWindowHours:24,availableSlots:options.availableSlots,arms:(coldStart&&modelPick?[modelPick]:candidates).map(c=>c.arm),outcomes,ledger,objective});
  const selected=candidates.find(c=>c.arm.id===decision.selectedArmId);
  const selectedId=selected?.conceptId??generated.plan.selectedConceptId;
  const selectedIdea=generated.output.concepts.find(i=>i.id===selectedId)!;
  const plan={...generated.plan,selectedConceptId:selectedId,topic:selectedIdea.topic};
  plan.trendStatus=trend.observations.some(o=>o.topic===selectedIdea.topic&&o.productFit!=="MISMATCH"&&o.accountFit!=="UNKNOWN")?"OBSERVED":"UNKNOWN";
  if(selectedId!==generated.plan.selectedConceptId){
    plan.analysis={...plan.analysis,audience:{...plan.analysis.audience,status:"HYPOTHESIS",basis:"สมมติฐานสำหรับแนวทางทดลองที่เลือก ยังไม่ใช่กลุ่มผู้ชมที่ยืนยันแล้ว"}};
    plan.concepts=plan.concepts.map(c=>c.id===selectedId?{...c,reasons:[...c.reasons,
      decision.status==="EXPLOIT"?"เลือกจากผลตอบรับจริงที่เทียบกันได้ในบัญชีนี้":"เลือกทดลองแนวทางนี้เพื่อเก็บหลักฐานเพิ่ม ยังไม่ใช่สูตรไวรัล"]}:c);
  }
  // Bind the actual experimental choice, not the LLM's pre-experiment preference.
  plan.fingerprint=strategyFingerprint(plan);
  return {...generated,plan,decision,arms:candidates,learning,trend,version:SELF_LEARNING_VERSION,promptVersion:CREATIVE_AGENT_VERSION,
    contextSource:environment,videoGenerated:false as const,paidVideoCalls:0 as const,postingCalls:0 as const};
}
