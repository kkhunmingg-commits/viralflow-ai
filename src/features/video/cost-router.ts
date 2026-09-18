import type {ProviderAvailability,StrategyDecision,VideoBudget} from "./types";
import {rankVideoProviders,selectVideoProvider,type ProviderEvidence} from "./provider-routing";

export interface StrategyInput {
  existingApprovedMaster:boolean;
  hasUsableAssets:boolean;
  qualityRequirement:number;
  budget:VideoBudget;
  availability:ProviderAvailability;
}
const paidBlocked=(budget:VideoBudget,estimate:number)=>estimate>budget.maxCostPerVideoUsd||budget.spentTodayUsd+estimate>budget.dailyVideoBudgetUsd||budget.spentMonthUsd+estimate>budget.monthlyVideoBudgetUsd;
export function chooseVideoStrategy(input:StrategyInput):StrategyDecision {
  if(input.existingApprovedMaster)return {strategy:"REUSE_MASTER",estimatedCostUsd:0,reason:["Approved compatible master already exists","Reuse has zero marginal generation cost"]};
  if(input.hasUsableAssets)return {strategy:"LOCAL_TEMPLATE",estimatedCostUsd:0,reason:["Usable product assets are available","Local FFmpeg template meets the quality floor at zero provider cost"]};
  if(input.availability.freeCredit)return {strategy:"FREE_CREDIT",estimatedCostUsd:0,reason:["Configured legitimate provider credit is available"]};
  const lowCost=.04;
  if(input.availability.lowCostPaid&&input.availability.paidAllowed&&!paidBlocked(input.budget,lowCost))return {strategy:"AI_IMAGE_TO_VIDEO",estimatedCostUsd:lowCost,reason:["Local assets are insufficient","Low-cost provider fits every budget limit"]};
  const premium=.35;
  if(input.qualityRequirement>=95&&input.availability.premium&&input.availability.paidAllowed&&!paidBlocked(input.budget,premium))return {strategy:"PREMIUM_AI_VIDEO",estimatedCostUsd:premium,reason:["Premium quality was explicitly requested","Premium estimate fits every budget limit"]};
  return {strategy:"LOCAL_TEMPLATE",estimatedCostUsd:0,reason:["Paid generation is unavailable or blocked by budget","Local deterministic placeholder remains allowed at zero cost"]};
}
export class CostRouter {
  choose(input:StrategyInput){return chooseVideoStrategy(input)}
  canSpend(budget:VideoBudget,cost:number){return cost===0||!paidBlocked(budget,cost)}
  rankProviders(candidates:ProviderEvidence[],qualityThreshold=85){return rankVideoProviders(candidates,qualityThreshold)}
  chooseProvider(candidates:ProviderEvidence[],budget:VideoBudget,qualityThreshold=85){const selected=selectVideoProvider(candidates,qualityThreshold);return selected&&this.canSpend(budget,selected.retryAdjustedCostUsd)?selected:null}
}
