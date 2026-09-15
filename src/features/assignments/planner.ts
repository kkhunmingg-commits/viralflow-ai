import { resolvePolicy, scorePairs } from "./scoring";
import type { AssignmentInput, DailyPlan, PairScore, PlannedAssignment, Policy } from "./types";

export function assignmentDate(now: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Bangkok", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date(now));
}
export function applyDiversificationPolicy(scores: PairScore[], input: AssignmentInput, policy: Policy): Omit<DailyPlan,"scores"|"policy"> {
  const date = assignmentDate(input.now);
  const existing = (input.existing??[]).filter(a=>a.assignment_date===date);
  const locked = existing.filter(a=>a.status==="SELECTED"||a.status==="USED");
  const assignments: PlannedAssignment[] = [], omitted: DailyPlan["omitted"] = [];
  const accountCount = new Map<string,number>();
  const categoryCount = new Map<string,number>();
  const productAccounts = new Map<string,Set<string>>();
  const chosen = new Set<string>(existing.filter(a=>["SELECTED","USED","SKIPPED"].includes(a.status)).map(a=>a.tiktok_account_id+":"+a.product_id));
  for(const row of locked) {
    accountCount.set(row.tiktok_account_id,(accountCount.get(row.tiktok_account_id)??0)+1);
    const key=row.tiktok_account_id+":"+row.category_key;
    categoryCount.set(key,(categoryCount.get(key)??0)+1);
    const owners=productAccounts.get(row.product_id)??new Set<string>();owners.add(row.tiktok_account_id);productAccounts.set(row.product_id,owners);
  }
  const quota=new Map(input.accounts.map(a=>{
    const used=locked.filter(l=>l.tiktok_account_id===a.id&&l.status==="USED").length;
    const published=Math.max(0,input.publishedToday?.[a.id]??0);
    // USED assignments may already be reflected in the publication count.
    return [a.id,Math.max(0,Math.min(a.daily_post_target,a.daily_post_hard_limit)-Math.max(0,published-used))];
  }));
  const sorted=scores.filter(s=>s.eligible).toSorted((a,b)=>b.final_viral_opportunity_score-a.final_viral_opportunity_score || a.accountId.localeCompare(b.accountId) || a.productId.localeCompare(b.productId));
  for(const score of sorted) {
    const key=score.accountId+":"+score.productId, catKey=score.accountId+":"+score.categoryKey;
    let reason="";
    if(chosen.has(key)) reason="Already selected, used, or skipped today.";
    else if((accountCount.get(score.accountId)??0)>=(quota.get(score.accountId)??0)) reason="Daily target or hard limit reached.";
    else if((categoryCount.get(catKey)??0)>=policy.maxProductsPerCategoryPerAccount) reason="Category diversity limit reached.";
    const users=productAccounts.get(score.productId)??new Set<string>();
    let shared=false;
    if(!reason && users.size>=policy.maxAccountsPerProduct) reason="Maximum accounts per product reached.";
    if(!reason && users.size && policy.avoidSameProductSameDayAcrossAccounts) {
      const alternative=sorted.find(s=>s.accountId===score.accountId&&!chosen.has(s.accountId+":"+s.productId)&&s.productId!==score.productId&&!(productAccounts.get(s.productId)?.size)&&
        (categoryCount.get(s.accountId+":"+s.categoryKey)??0)<policy.maxProductsPerCategoryPerAccount);
      const gap=score.final_viral_opportunity_score-(alternative?.final_viral_opportunity_score??0);
      shared=policy.allowSharedProductWhenScoreAdvantageIsLarge&&gap>=policy.sharingScoreGap;
      if(!shared) reason="Reserved for the strongest-fit account; next-best product preferred.";
    }
    if(reason){omitted.push({accountId:score.accountId,productId:score.productId,reason});continue;}
    chosen.add(key); users.add(score.accountId);productAccounts.set(score.productId,users);
    accountCount.set(score.accountId,(accountCount.get(score.accountId)??0)+1);
    categoryCount.set(catKey,(categoryCount.get(catKey)??0)+1);
    assignments.push({score,rank:accountCount.get(score.accountId)!,status:"CANDIDATE",reason:shared?"Sharing allowed: score advantage exceeds policy threshold.":"Highest eligible fit within daily and diversification limits."});
  }
  return {date,assignments,omitted};
}
export function buildDailyAssignments(input: AssignmentInput, overrides: Partial<Policy> = {}): DailyPlan {
  const policy=resolvePolicy(overrides), scores=scorePairs(input,policy).toSorted((a,b)=>a.accountId.localeCompare(b.accountId)||a.productId.localeCompare(b.productId));
  return {...applyDiversificationPolicy(scores,input,policy),scores,policy};
}
export function getRecommendationsForAccount(plan: DailyPlan, accountId: string) {
  return plan.assignments.filter(a=>a.score.accountId===accountId).toSorted((a,b)=>a.rank-b.rank);
}
export function getRecommendationExplanation(score: PairScore) { return score.explanation_json; }
