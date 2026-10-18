import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/server-env";
import { buildCreativeContext } from "./context";
import { estimateCreativeGenerationCost,knownCreativeGenerationCost } from "./cost";
import { buildCreativePrompt } from "./prompts";
import { MockAIProvider,OpenAIProvider,generateValidated } from "./providers";
import { scoreCreativeConcept } from "./scoring";
import { CREATIVE_SCORE_VERSION,PROMPT_VERSION,type CreativeProjectRow } from "./types";
import { canStartCreativeProject,nextProjectStatus } from "./lifecycle";
import { readCreativeIntelligenceResources } from "./intelligence-service";
import { CREATIVE_STRATEGY_VERSION, assertHumanProductionReview, planCreativeStrategy, type CreativeStrategyInput } from "./strategist";
import { creativeScriptDigest, storedProductionStrategy } from "./production-gate";
import {discoverTrendCandidates,googleSearchDiscoverySource,tikTokTrendDiscoverySource,ownAccountPerformanceSource,ownPerformanceObservations} from "../growth-manager/trend-discovery";
import {createCreativeAgent} from "./agent";
import {planSelfLearningCreative,sealCreativeAttribution} from "./self-learning";
const publicTrendSource=googleSearchDiscoverySource();

async function one(client:SupabaseClient,table:string,owner:string,id:string){
  const {data,error}=await client.from(table).select("*").eq("owner_id",owner).eq("id",id).maybeSingle();
  if(error)throw new Error(error.message);return data as Record<string,unknown>|null;
}
export async function createProjectFromAssignment(client:SupabaseClient,owner:string,assignmentId:string){
  const assignment=await one(client,"product_assignments",owner,assignmentId);
  if(!assignment||!canStartCreativeProject({final_score:Number(assignment.final_score),status:String(assignment.status)}))throw new Error("Only an eligible active assignment can start a creative project");
  const existing=await client.from("creative_projects").select("*").eq("owner_id",owner).eq("product_assignment_id",assignmentId).maybeSingle();
  if(existing.error)throw new Error(existing.error.message);if(existing.data)return existing.data as CreativeProjectRow;
  const {data,error}=await client.from("creative_projects").insert({owner_id:owner,tiktok_account_id:assignment.tiktok_account_id,product_id:assignment.product_id,product_assignment_id:assignmentId,mode:assignment.effective_mode,status:"DRAFT"}).select("*").single();
  if(error)throw new Error(error.message);return data as CreativeProjectRow;
}
export async function listCreativeProjects(client:SupabaseClient,owner:string){
  const {data:projects,error}=await client.from("creative_projects").select("*").eq("owner_id",owner).order("updated_at",{ascending:false});
  if(error)throw new Error(error.message);
  const accounts=await client.from("tiktok_accounts").select("id,display_name").eq("owner_id",owner);
  const products=await client.from("products").select("id,title,category_key").eq("owner_id",owner);
  if(accounts.error||products.error)throw new Error(accounts.error?.message??products.error?.message);
  const accountMap=new Map((accounts.data??[]).map(v=>[v.id,v.display_name])),productMap=new Map((products.data??[]).map(v=>[v.id,v]));
  return (projects??[]).map(p=>({...p,account_name:accountMap.get(p.tiktok_account_id)??"Unknown",product:productMap.get(p.product_id)??null}));
}
export async function loadCreativeContext(client:SupabaseClient,owner:string,projectId:string){
  const project=await one(client,"creative_projects",owner,projectId);if(!project)throw new Error("Creative project not found");
  const assignment=await one(client,"product_assignments",owner,String(project.product_assignment_id));
  if(!assignment)throw new Error("Creative assignment is missing");
  const [account,product,assignmentScore]=await Promise.all([
    one(client,"tiktok_accounts",owner,String(project.tiktok_account_id)),
    one(client,"products",owner,String(project.product_id)),
    client.from("account_product_scores").select("*").eq("owner_id",owner).eq("id",String(assignment.score_id)).single(),
  ]);
  if(!account||!product||assignmentScore.error)throw new Error("Creative source context is incomplete");
  const [productScore,category,affinity,history,growthRecommendation]=await Promise.all([
    client.from("product_scores").select("*").eq("owner_id",owner).eq("product_id",String(project.product_id)).order("calculated_at",{ascending:false}).limit(1).maybeSingle(),
    client.from("categories").select("*").eq("owner_id",owner).eq("provider",String(product.external_provider)).eq("category_key",String(product.category_key)).maybeSingle(),
    client.from("account_category_affinity").select("*").eq("owner_id",owner).eq("tiktok_account_id",String(project.tiktok_account_id)).eq("category_key",String(product.category_key)).maybeSingle(),
    client.from("creative_angles").select("angle_type,hook").eq("owner_id",owner).eq("creative_project_id",projectId).order("created_at",{ascending:false}).limit(10),
    client.from("growth_recommendations").select("category_key,hook,angle,cta,experiment_axis,confidence,evidence_json").eq("owner_id",owner).eq("tiktok_account_id",String(project.tiktok_account_id)).order("created_at",{ascending:false}).limit(1).maybeSingle(),
  ]);
  if(productScore.error||category.error||affinity.error||history.error||growthRecommendation.error)throw new Error(productScore.error?.message??category.error?.message??affinity.error?.message??history.error?.message??growthRecommendation.error?.message);
  const categoryScore=category.data?await client.from("category_scores").select("*").eq("owner_id",owner).eq("category_id",category.data.id).order("calculated_at",{ascending:false}).limit(1).maybeSingle():{data:null,error:null};
  if(categoryScore.error)throw new Error(categoryScore.error.message);
  return {project:project as unknown as CreativeProjectRow,context:buildCreativeContext({assignment:assignment as never,account:account as never,product:product as never,productScore:productScore.data as never,categoryScore:categoryScore.data as never,affinity:affinity.data as never,assignmentScore:assignmentScore.data as never,history:(history.data??[]) as never,growthRecommendation:growthRecommendation.data as never})};
}
function providerFor(context:Awaited<ReturnType<typeof loadCreativeContext>>["context"],forceMock=false){
  if(!forceMock&&serverEnv.creativeAIProvider==="openai")return new OpenAIProvider(serverEnv.openAIApiKey!,serverEnv.creativeAIModel);
  return new MockAIProvider(context);
}
export async function generateCreativeProject(client:SupabaseClient,owner:string,projectId:string,options:{forceMock?:boolean;forAutoWorker?:boolean}={}){
  if(!options.forceMock)return generateEvidenceStrategyProject(client,owner,projectId,{forAutoWorker:options.forAutoWorker});
  const {project,context}=await loadCreativeContext(client,owner,projectId),provider=providerFor(context,options.forceMock),generationId=randomUUID(),prompt=buildCreativePrompt(context);
  const generatingStatus=nextProjectStatus(project.status,"GENERATE");
  const generating=await client.from("creative_projects").update({status:generatingStatus}).eq("owner_id",owner).eq("id",projectId);
  if(generating.error)throw new Error(generating.error.message);
  try{
    const {result,output}=await generateValidated(provider,prompt);
    const scored=output.concepts.map((concept,index)=>scoreCreativeConcept(concept,context,output.concepts.slice(0,index)));
    const angleIds=scored.map(()=>randomUUID());
    const angles=scored.map((s,index)=>({id:angleIds[index],owner_id:owner,creative_project_id:projectId,angle_type:s.concept.angleType,title:s.concept.title,hook:s.concept.hook,core_message:s.concept.coreMessage,cta_strategy:s.concept.cta,visual_strategy:s.concept.visualStrategy,score:s.score,confidence:s.confidence,policy_status:s.riskStatus,score_explanation_json:{...s.explanation,riskReasons:s.riskReasons},is_selected:false,created_at:new Date().toISOString()}));
    const scripts=scored.map((s,index)=>({id:randomUUID(),owner_id:owner,creative_project_id:projectId,creative_angle_id:angleIds[index],duration_seconds:8,hook_text:s.concept.hook,voice_script:s.concept.voiceScript,overlay_text_json:s.concept.overlayText,scene_plan_json:s.concept.scenePlan,cta_text:s.concept.cta,caption:s.concept.caption,hashtags_json:s.concept.hashtags,language:"th",status:s.riskStatus==="REJECT"?"REJECTED":"DRAFT",version:CREATIVE_SCORE_VERSION,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}));
    const cost=estimateCreativeGenerationCost(provider.model,result.usage.inputTokens,result.usage.outputTokens);
    const generation={id:generationId,owner_id:owner,creative_project_id:projectId,provider:provider.provider,model:provider.model,prompt_version:PROMPT_VERSION,input_tokens:result.usage.inputTokens,output_tokens:result.usage.outputTokens,estimated_cost:cost,raw_response_json:result.raw,validated_output_json:output,status:"SUCCEEDED",error:null,created_at:new Date().toISOString()};
    const {error}=options.forAutoWorker
      ? await client.rpc("save_auto_creative_generation",{p_owner_id:owner,p_project_id:projectId,p_generation:generation,p_angles:angles,p_scripts:scripts})
      : await client.rpc("save_creative_generation",{p_project_id:projectId,p_generation:generation,p_angles:angles,p_scripts:scripts});
    if(error)throw new Error(error.message);return {generationId,provider:provider.provider,model:provider.model,cost,count:angles.length};
  }catch(error){
    await client.from("creative_generations").insert({id:generationId,owner_id:owner,creative_project_id:projectId,provider:provider.provider,model:provider.model,prompt_version:PROMPT_VERSION,status:"FAILED",error:error instanceof Error?error.message:"Generation failed"});
    await client.from("creative_projects").update({status:"FAILED"}).eq("owner_id",owner).eq("id",projectId);
    throw error;
  }
}
export async function getCreativeProjectDetail(client:SupabaseClient,owner:string,projectId:string){
  const source=await loadCreativeContext(client,owner,projectId);
  const [angles,scripts,generations]=await Promise.all([
    client.from("creative_angles").select("*").eq("owner_id",owner).eq("creative_project_id",projectId).order("score",{ascending:false}),
    client.from("scripts").select("*").eq("owner_id",owner).eq("creative_project_id",projectId).order("created_at",{ascending:false}),
    client.from("creative_generations").select("*").eq("owner_id",owner).eq("creative_project_id",projectId).order("created_at",{ascending:false}),
  ]);
  if(angles.error||scripts.error||generations.error)throw new Error(angles.error?.message??scripts.error?.message??generations.error?.message);
  return {...source,angles:angles.data??[],scripts:scripts.data??[],generations:generations.data??[]};
}
/** Real LLM planning + account-scoped experimentation. Mock is an explicit test-only path above. */
const EVIDENCE_RUBRIC_MODEL="evidence-rubric-v1";
/** The paid LLM strategist, or null when the owner explicitly chose the zero-cost evidence rubric.
 * A missing LLM configuration still stops generation; it never silently degrades to template copy. */
function configuredCreativeAgent(){
  if(serverEnv.creativeAIProvider==="evidence-rubric")return null;
  return createCreativeAgent({provider:serverEnv.creativeAIProvider,apiKey:serverEnv.openAIApiKey,model:serverEnv.creativeAIModel});
}
/** Same evidence gates and human review as the LLM path, with fixed Thai copy and no token spend. */
function evidenceRubricCreative(context:Awaited<ReturnType<typeof loadCreativeContext>>["context"],
  resources:Awaited<ReturnType<typeof readCreativeIntelligenceResources>>["resources"],discovery:{intelligence:CreativeStrategyInput["trends"]}){
  const plan=planCreativeStrategy({now:resources.now,account:{id:context.account.id,mode:context.account.mode,affiliateEligible:resources.affiliateEligible},
    product:context.account.mode==="AFFILIATE"?{id:context.product.id,title:context.product.title,mechanism:resources.mechanism??"UNKNOWN"}:undefined,
    facts:resources.facts,assets:resources.assets,costs:resources.costs,trends:discovery.intelligence});
  return {plan,arms:[] as Array<{conceptId:string;arm:Parameters<typeof sealCreativeAttribution>[0]["arm"]}>,output:null,decision:null,
    usage:{inputTokens:0,outputTokens:0},promptVersion:EVIDENCE_RUBRIC_MODEL};
}
export async function generateEvidenceStrategyProject(client:SupabaseClient,owner:string,projectId:string,options:{forAutoWorker?:boolean}={}){
  const provider=configuredCreativeAgent();
  if(provider&&knownCreativeGenerationCost(provider.model,0,0)===null)throw new Error("CREATIVE_MODEL_PRICING_UNKNOWN");
  const {context,project}=await loadCreativeContext(client,owner,projectId);
  if(project.status==="GENERATING"||options.forAutoWorker&&project.status==="FAILED")throw new Error("CREATIVE_GENERATION_REVIEW_REQUIRED");
  const now=new Date(),{resources}=await readCreativeIntelligenceResources(client,owner,context,{now});
  if(!resources.realAccount||!resources.optedIn)throw new Error("CREATIVE_ACCOUNT_AUTOMATION_NOT_AUTHORIZED");
  const generatingStatus=nextProjectStatus(project.status,"GENERATE"),generationId=randomUUID();
  // Claim before text spending: two workers/UI clicks cannot both generate the same item.
  const claim=await client.from("creative_projects").update({status:generatingStatus}).eq("owner_id",owner).eq("id",projectId).eq("status",project.status).select("id").maybeSingle();
  if(claim.error||!claim.data)throw new Error("CREATIVE_GENERATION_ALREADY_CLAIMED");
  try{
  const discovery=await discoverTrendCandidates([publicTrendSource,tikTokTrendDiscoverySource(),
    ownAccountPerformanceSource(async()=>ownPerformanceObservations(resources.adaptiveHistory??[],owner,context.account.id,now))],
    {accountId:context.account.id,region:resources.region,productCategoryKey:context.account.mode==="AFFILIATE"?context.product.category:undefined},now);
  const intelligence=provider?await planSelfLearningCreative(context,resources,provider,{cycleKey:projectId,availableSlots:1,discovery})
    :evidenceRubricCreative(context,resources,discovery),plan=intelligence.plan;
  const angleIds=plan.concepts.map(()=>randomUUID()),createdAt=new Date().toISOString();
  const scripts=plan.concepts.map((s,index)=>({id:randomUUID(),owner_id:owner,creative_project_id:projectId,creative_angle_id:angleIds[index],duration_seconds:8,
    hook_text:s.concept.hook,voice_script:s.concept.voiceScript,overlay_text_json:s.concept.overlayText,scene_plan_json:s.concept.scenePlan,cta_text:s.concept.cta,
    caption:s.concept.caption,hashtags_json:s.concept.hashtags,language:"th",status:s.status==="REJECTED"?"REJECTED":"DRAFT",version:CREATIVE_STRATEGY_VERSION,created_at:createdAt,updated_at:createdAt}));
  const angles=plan.concepts.map((s,index)=>({id:angleIds[index],owner_id:owner,creative_project_id:projectId,angle_type:s.concept.angleType,title:s.concept.title,
    hook:s.concept.hook,core_message:s.concept.coreMessage,cta_strategy:s.concept.cta,visual_strategy:s.concept.visualStrategy,score:s.score,confidence:s.confidence??0,
    policy_status:s.status==="REJECTED"?"REJECT":"REVIEW",is_selected:false,created_at:createdAt,
    score_explanation_json:{scoreMeaning:"No fixed creative score; LLM reasoning + observed experiment objective",reasons:s.reasons,confidenceBasis:plan.confidenceBasis,
      ...(intelligence.arms.find(a=>a.conceptId===s.id)?{creativeAttribution:sealCreativeAttribution({ownerId:owner,arm:intelligence.arms.find(a=>a.conceptId===s.id)!.arm,
        spokenHook:s.concept.hook,format:intelligence.output!.concepts.find(c=>c.id===s.id)!.format,conceptId:s.id,planFingerprint:plan.fingerprint,
        scriptDigest:creativeScriptDigest(scripts[index]),decision:s.id===plan.selectedConceptId?intelligence.decision!.proposal:null,createdAt})}:{}),
      productionStrategy:{plan,conceptId:s.id,productId:context.product.id,scriptDigest:creativeScriptDigest(scripts[index]),review:null}}}));
  const cost=provider?knownCreativeGenerationCost(provider.model,intelligence.usage.inputTokens,intelligence.usage.outputTokens):0;
  const generation={id:generationId,owner_id:owner,creative_project_id:projectId,provider:provider?.provider??"local",model:provider?.model??EVIDENCE_RUBRIC_MODEL,
    prompt_version:intelligence.promptVersion,input_tokens:intelligence.usage.inputTokens,output_tokens:intelligence.usage.outputTokens,estimated_cost:cost,
    raw_response_json:{source:plan.source,humanReview:"PENDING",costBasis:"TEXT_TOKEN_RATE_ESTIMATE_NOT_ACTUAL_BILL"},
    validated_output_json:{concepts:plan.concepts.map(c=>c.concept),strategyPlan:plan,agentOutput:intelligence.output,
      adaptiveDecision:intelligence.decision,trendDiscovery:discovery},status:"SUCCEEDED",error:null,created_at:createdAt};
  const result=options.forAutoWorker?await client.rpc("save_auto_creative_generation",{p_owner_id:owner,p_project_id:projectId,p_generation:generation,p_angles:angles,p_scripts:scripts})
    :await client.rpc("save_creative_generation",{p_project_id:projectId,p_generation:generation,p_angles:angles,p_scripts:scripts});
  if(result.error||result.data!==generationId)throw new Error("CREATIVE_STRATEGY_SAVE_FAILED");
  // AI chooses; owner only verifies facts/media/quality before production.
  const selected=plan.concepts.findIndex(c=>c.id===plan.selectedConceptId);
  await selectCreative(client,owner,projectId,angleIds[selected],scripts[selected].id);
  return {generationId,count:angles.length,cost,humanReview:"PENDING",intelligence};
  }catch(error){
    await client.from("creative_projects").update({status:"FAILED"}).eq("owner_id",owner).eq("id",projectId).eq("status","GENERATING");
    throw error;
  }
}
export async function approveEvidenceCreative(client:SupabaseClient,owner:string,projectId:string,angleId:string,scriptId:string,
  checks:{creativeApproved:boolean;factualAccuracyApproved:boolean;mediaRightsApproved:boolean}){
  const {data}=await client.auth.getUser();if(data.user?.id!==owner)throw new Error("HUMAN_CREATIVE_REVIEW_REQUIRED");
  const [project,angle,script]=await Promise.all([one(client,"creative_projects",owner,projectId),one(client,"creative_angles",owner,angleId),one(client,"scripts",owner,scriptId)]);
  if(!project||!angle||!script||angle.creative_project_id!==projectId||script.creative_project_id!==projectId||script.creative_angle_id!==angleId)throw new Error("Creative selection mismatch");
  const stored=storedProductionStrategy(angle);
  if(!stored||stored.productId!==project.product_id||stored.plan.accountId!==project.tiktok_account_id||stored.scriptDigest!==creativeScriptDigest(script))throw new Error("HUMAN_CREATIVE_REVIEW_REQUIRED");
  const review={...checks,fingerprint:stored.plan.fingerprint,conceptId:stored.conceptId,reviewedBy:owner};
  assertHumanProductionReview(stored.plan,review);
  const result=await client.from("creative_angles").update({policy_status:"SAFE",score_explanation_json:{...(angle.score_explanation_json as Record<string,unknown>),productionStrategy:{...stored,review}}})
    .eq("owner_id",owner).eq("id",angleId).select("id").maybeSingle();
  if(result.error||!result.data)throw new Error("CREATIVE_REVIEW_SAVE_FAILED");
}
export async function selectCreative(client:SupabaseClient,owner:string,projectId:string,angleId:string,scriptId:string){
  const angle=await one(client,"creative_angles",owner,angleId),script=await one(client,"scripts",owner,scriptId);
  if(!angle||!script||angle.creative_project_id!==projectId||script.creative_project_id!==projectId||script.creative_angle_id!==angleId)throw new Error("Creative selection mismatch");
  await client.from("creative_angles").update({is_selected:false}).eq("owner_id",owner).eq("creative_project_id",projectId);
  const [a,s,p]=await Promise.all([
    client.from("creative_angles").update({is_selected:true}).eq("owner_id",owner).eq("id",angleId),
    client.from("scripts").update({status:"SELECTED"}).eq("owner_id",owner).eq("id",scriptId),
    client.from("creative_projects").update({selected_angle_id:angleId,selected_script_id:scriptId,status:"SELECTED"}).eq("owner_id",owner).eq("id",projectId),
  ]);
  if(a.error||s.error||p.error)throw new Error(a.error?.message??s.error?.message??p.error?.message);
}
export async function updateScript(client:SupabaseClient,owner:string,scriptId:string,values:{voice_script:string;cta_text:string;caption:string}){
  const {error}=await client.from("scripts").update({...values,status:"EDITED"}).eq("owner_id",owner).eq("id",scriptId);if(error)throw new Error(error.message);
}
export async function rejectScript(client:SupabaseClient,owner:string,scriptId:string){
  const {error}=await client.from("scripts").update({status:"REJECTED"}).eq("owner_id",owner).eq("id",scriptId);if(error)throw new Error(error.message);
}
