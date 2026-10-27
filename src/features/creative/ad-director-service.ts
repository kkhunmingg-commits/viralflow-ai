import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {loadCreativeContext} from "./services";
import {readCreativeIntelligenceResources} from "./intelligence-service";
import {directAd,type DirectorInput,type DirectorPlan} from "./ad-director";
import {buildStoryboard,validateStoryboard,type Storyboard,type StoryboardIssue} from "./storyboard";
import {compileFlowPlan,type FlowGenerationPlan} from "../video/flow-prompt-compiler";
import {configuredLocalLLM} from "./local-agent";
import {serverEnv} from "@/lib/server-env";
import {rankProducts,unknown,type ProductRankingReport} from "../products/intelligence";
import type {StrategyAsset,StrategyFact} from "./strategist";

/** Owner-visible director view for one Creative Project: reads only, writes nothing, spends nothing.
 * Uses the local model when the owner configured one; never calls a paid provider from a page view. */
export interface AdDirectorView {
  ranking:ProductRankingReport;plan:DirectorPlan;storyboard:Storyboard|null;storyboardIssues:StoryboardIssue[];flow:FlowGenerationPlan|null;
  evidence:{facts:number;clearedAssets:number};
}
const kindOf=(a:StrategyAsset):DirectorInput["assets"][number]["kind"]=>a.kind==="REAL_FOOTAGE"||a.kind==="COMPARISON_FOOTAGE"?(a.depictsOperation?"OPERATION_FOOTAGE":"REAL_FOOTAGE"):"REAL_IMAGE";

export function directorInputFrom(context:Awaited<ReturnType<typeof loadCreativeContext>>["context"],resources:{facts:StrategyFact[];assets:StrategyAsset[];affiliateEligible:boolean;storyHistory?:{formats?:string[];hooks?:string[]}}):DirectorInput{
  return {product:{id:context.product.id,title:context.product.title,categoryKey:context.product.category},
    facts:resources.facts.filter(f=>f.verified).map(f=>({id:f.id,text:f.text,role:f.role,source:f.source})),
    assets:resources.assets.filter(a=>a.kind!=="ATMOSPHERE").map(a=>({id:a.id,kind:kindOf(a),rightsCleared:a.rightsConfirmed&&a.reviewed,credit:context.product.attribution})),
    account:{id:context.account.id,mode:context.account.mode,affiliateEligible:resources.affiliateEligible},
    history:{formats:resources.storyHistory?.formats??[],hooks:[...(resources.storyHistory?.hooks??[]),...context.historicalCreativeSignals.recentHooks]}};
}

export async function readAdDirectorView(client:SupabaseClient,owner:string,projectId:string):Promise<AdDirectorView>{
  const {context}=await loadCreativeContext(client,owner,projectId);
  const {resources}=await readCreativeIntelligenceResources(client,owner,context);
  const input=directorInputFrom(context,resources);
  // Catalogue numbers are only shown as observed when a non-zero value was actually stored for this product.
  const at=new Date().toISOString(),seen=(v:number)=>v>0?{value:v,source:"catalog",observedAt:at,reliability:"MANUAL_ESTIMATE" as const}:unknown();
  const ranking=rankProducts([{id:context.product.id,title:context.product.title,categoryKey:context.product.category,model:null,adapter:"MANUAL_OWNER_ENTRY",sourceUrl:null,capturedAt:at,
    identityVerified:input.facts.length>0,stock:"UNKNOWN",price:seen(context.product.price),demand:{unitsSold30d:unknown(),velocityPerDay:unknown(),trend:null},
    commission:{rate:seen(context.product.commissionRate),amountThb:seen(context.product.commissionAmount)},marginThb:unknown(),
    reviews:{rating:context.product.rating?seen(context.product.rating):unknown(),count:context.product.reviewCount?seen(context.product.reviewCount):unknown(),complaintRate:unknown()},
    contentSaturation:unknown(),media:{rightsClearedImages:input.assets.filter(a=>a.rightsCleared&&a.kind==="REAL_IMAGE").length,rightsClearedVideos:input.assets.filter(a=>a.rightsCleared&&a.kind!=="REAL_IMAGE").length,operationFootage:input.assets.filter(a=>a.rightsCleared&&a.kind==="OPERATION_FOOTAGE").length},
    verifiedFactCount:input.facts.length,risk:{restrictedCategory:false,counterfeitRisk:false,claimSensitivity:"MEDIUM"},audienceFit:{},costPerUsableClipThb:unknown()}]);
  const local=serverEnv.creativeAIProvider==="local-llm"||serverEnv.creativeAIProvider==="hybrid"?configuredLocalLLM():null;
  const plan=await directAd(input,local);
  const selected=plan.concepts.find(c=>c.id===plan.selectedConceptId);
  let storyboard:Storyboard|null=null,issues:StoryboardIssue[]=[],flow:FlowGenerationPlan|null=null;
  if(selected){try{storyboard=buildStoryboard(selected,input);issues=validateStoryboard(storyboard,input);flow=compileFlowPlan(storyboard,context.product.title,{maxGenerations:1,observedCreditsPerGeneration:10})}
    catch(error){issues=[{code:"STORYBOARD_UNAVAILABLE",detail:error instanceof Error?error.message:String(error)}]}}
  return {ranking,plan,storyboard,storyboardIssues:issues,flow,evidence:{facts:input.facts.length,clearedAssets:input.assets.filter(a=>a.rightsCleared).length}};
}
