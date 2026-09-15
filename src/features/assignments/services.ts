import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getProductRadar } from "@/features/products/services";
import { getCategoryRadar } from "@/features/categories/services";
import type { AccountCategoryAffinity, AccountDailyStat } from "@/features/accounts/types";
import { assignmentDate, buildDailyAssignments } from "./planner";
import type { AssignmentInput, ExistingAssignment, PairScore, Policy } from "./types";

async function readAll<T>(client:SupabaseClient, table:string, owner:string):Promise<T[]> {
  const rows:T[]=[];
  for(let offset=0;;offset+=500) {
    const {data,error}=await client.from(table).select("*").eq("owner_id",owner).order("id").range(offset,offset+499);
    if(error)throw new Error("Recommendation data could not be loaded: "+error.message);
    rows.push(...(data??[]) as T[]); if(!data||data.length<500)return rows;
  }
}
export async function loadAssignmentInput(client:SupabaseClient,owner:string,now=new Date()):Promise<AssignmentInput> {
  const [radar,categories,affinities,stats,existing]=await Promise.all([
    getProductRadar(client,owner,{},now),getCategoryRadar(client,owner),
    readAll<AccountCategoryAffinity>(client,"account_category_affinity",owner),
    readAll<AccountDailyStat>(client,"account_daily_stats",owner),
    readAll<ExistingAssignment>(client,"product_assignments",owner),
  ]);
  const timestamp=now.toISOString(), date=assignmentDate(timestamp);
  return {
    now:timestamp,accounts:categories.accounts,existing,
    products:radar.items.map(({product,score})=>({
      product,momentum:score?.product_momentum_score??0,creative:score?.creative_potential_score??0,
      commission:score?.commission_score??0,price:score?.price_attractiveness??0,
      acceleration:score?.sales_acceleration??0,confidence:score?.data_confidence??0,
      observedAt:score?new Date(now.getTime()-score.explanation_json.staleHours*3600000).toISOString():product.last_seen_at,
      competition:1-(score?.competition_score??0)/100,trend:score?.explanation_json.trend??"LOW_DATA",
    })),
    categories:categories.items.map(i=>({
      id:i.category.id,key:i.category.category_key,provider:i.category.provider,active:i.category.status==="active",
      momentum:i.score.category_momentum_score,commercial:i.score.commercial_opportunity_score,
      confidence:i.snapshot.data_confidence,saturation:i.snapshot.saturation_signal,observedAt:i.snapshot.captured_at,
    })),
    affinities:affinities.map(a=>({accountId:a.tiktok_account_id,categoryKey:a.category_key,score:Number(a.affinity_score),confidence:Number(a.confidence)})),
    publishedToday:Object.fromEntries(stats.filter(s=>s.stat_date===date).map(s=>[s.tiktok_account_id,s.posts_published])),
  };
}
export interface RecommendationFilters { account?:string; mode?:string; category?:string; minScore?:number }
export function filterPairScores(scores:PairScore[],filters:RecommendationFilters) {
  return scores.filter(s=>s.eligible&&(!filters.account||s.accountId===filters.account)&&
    (!filters.mode||s.mode===filters.mode)&&(!filters.category||s.categoryKey===filters.category)&&
    s.final_viral_opportunity_score>=(filters.minScore??0))
    .toSorted((a,b)=>b.final_viral_opportunity_score-a.final_viral_opportunity_score||a.accountId.localeCompare(b.accountId)||a.productId.localeCompare(b.productId));
}
export async function getRecommendationData(client:SupabaseClient,owner:string,now=new Date()) {
  const input=await loadAssignmentInput(client,owner,now);
  return {input,plan:buildDailyAssignments(input)};
}
export async function persistDailyAssignments(client:SupabaseClient,owner:string,overrides:Partial<Policy>={}) {
  const input=await loadAssignmentInput(client,owner);
  const plan=buildDailyAssignments(input,overrides), runId=randomUUID();
  const idByPair=new Map<string,string>();
  const scores=plan.scores.map(s=>{
    const id=randomUUID();idByPair.set(s.accountId+":"+s.productId,id);
    return {
      id,owner_id:owner,tiktok_account_id:s.accountId,product_id:s.productId,category_id:s.categoryId,
      run_id:runId,calculated_at:s.calculated_at,created_at:s.calculated_at,
      product_component:s.product_component,category_component:s.category_component,account_category_component:s.account_category_component,
      commercial_component:s.commercial_component,mode_fit_component:s.mode_fit_component,confidence_component:s.confidence_component,
      freshness_component:s.freshness_component,competition_component:s.competition_component,
      account_product_fit_score:s.account_product_fit_score,final_viral_opportunity_score:s.final_viral_opportunity_score,
      effective_mode:s.mode,eligible:s.eligible,score_version:s.score_version,explanation_json:s.explanation_json,
    };
  });
  const assignments=plan.assignments.map(a=>({
    id:randomUUID(),owner_id:owner,tiktok_account_id:a.score.accountId,product_id:a.score.productId,
    category_key:a.score.categoryKey,score_id:idByPair.get(a.score.accountId+":"+a.score.productId),
    assignment_date:plan.date,rank_for_account:a.rank,effective_mode:a.score.mode,
    final_score:a.score.final_viral_opportunity_score,status:a.status,score_version:a.score.score_version,
    reason_json:{...a.score.explanation_json,plannerReason:a.reason,policy:plan.policy,runId},
    created_at:input.now,updated_at:input.now,
  }));
  const {error}=await client.rpc("save_daily_assignments",{p_date:plan.date,p_scores:scores,p_assignments:assignments});
  if(error)throw new Error("Plan could not be saved: "+error.message);
  return {scores:scores.length,assignments:assignments.length};
}
